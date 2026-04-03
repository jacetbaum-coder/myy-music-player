"""
Music Importer Server — runs locally on port 8765.
Wraps SpotDL (Spotify) and yt-dlp (YouTube), reads/writes ID3 tags via mutagen,
and uploads files directly to Cloudflare R2 via boto3.

Start: python server.py  (or bash start.sh)
"""

from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import uuid
from pathlib import Path
from typing import Any, Optional

import boto3
import uvicorn
from botocore.config import Config
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from mutagen import File as MutagenFile
from mutagen.id3 import (
    TALB,
    TIT2,
    TPE1,
    TPE2,
    ID3,
    ID3NoHeaderError,
)
from mutagen.mp4 import MP4
from pydantic import BaseModel

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
PORT = 8765
OUTPUT_DIR = Path.home() / "Downloads" / "music-importer"
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------
app = FastAPI(title="Music Importer")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------------------------------------------------------------------------
# In-memory job store
# ---------------------------------------------------------------------------
jobs: dict[str, dict[str, Any]] = {}


def new_job() -> str:
    job_id = str(uuid.uuid4())
    jobs[job_id] = {"status": "running", "logs": [], "files": []}
    return job_id


def append_log(job_id: str, line: str) -> None:
    if job_id in jobs:
        jobs[job_id]["logs"].append(line)


# ---------------------------------------------------------------------------
# Models
# ---------------------------------------------------------------------------
class DownloadRequest(BaseModel):
    url: str
    spotifyClientId: Optional[str] = None
    spotifyClientSecret: Optional[str] = None
    outputFormat: str = "{artist}/{album}/{title}.{output-ext}"


class PatchFileRequest(BaseModel):
    localPath: str
    field: str   # title | artist | album | albumartist
    value: str


class UploadFileSpec(BaseModel):
    localPath: str
    r2Key: str


class UploadRequest(BaseModel):
    files: list[UploadFileSpec]
    r2AccountId: str
    r2AccessKeyId: str
    r2SecretAccessKey: str
    r2Bucket: str


class DeleteFileRequest(BaseModel):
    localPath: str


class MySongsRequest(BaseModel):
    r2AccountId: str
    r2AccessKeyId: str
    r2SecretAccessKey: str
    r2Bucket: str


class CopyFromUrlRequest(BaseModel):
    sourceUrl: str
    r2Key: str
    r2AccountId: str
    r2AccessKeyId: str
    r2SecretAccessKey: str
    r2Bucket: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
AUDIO_EXTS = {".mp3", ".m4a", ".flac", ".wav", ".ogg", ".aac", ".opus"}


def is_audio(p: Path) -> bool:
    return p.suffix.lower() in AUDIO_EXTS


def safe_path(raw: str) -> Path:
    """Resolve and validate the path is inside OUTPUT_DIR."""
    p = Path(raw).resolve()
    # Allow any path under OUTPUT_DIR
    try:
        p.relative_to(OUTPUT_DIR.resolve())
    except ValueError:
        raise HTTPException(status_code=400, detail="Path must be inside output directory.")
    return p


def read_tags(p: Path) -> dict:
    """Return a dict of common tag fields from an audio file."""
    info: dict[str, Any] = {
        "localPath": str(p),
        "fileName": p.name,
        "size": p.stat().st_size if p.exists() else 0,
        "title": p.stem,
        "artist": "",
        "album": "",
        "albumartist": "",
        "hasCover": False,
    }
    try:
        audio = MutagenFile(p, easy=True)
        if audio is None:
            return info
        info["title"] = (audio.get("title") or [p.stem])[0]
        info["artist"] = (audio.get("artist") or [""])[0]
        info["album"] = (audio.get("album") or [""])[0]
        info["albumartist"] = (audio.get("albumartist") or [""])[0]

        # Check for embedded cover art
        raw = MutagenFile(p, easy=False)
        if raw is not None:
            if hasattr(raw, "tags") and raw.tags:
                keys = list(raw.tags.keys())
                # MP3: APIC frames; MP4: covr
                info["hasCover"] = any(
                    k.startswith("APIC") or k == "covr" for k in keys
                )
    except Exception:
        pass
    return info


def write_tag(p: Path, field: str, value: str) -> None:
    """Write a single tag field to an audio file."""
    ext = p.suffix.lower()

    if ext == ".mp3":
        try:
            tags = ID3(str(p))
        except ID3NoHeaderError:
            tags = ID3()
        frame_map = {
            "title": TIT2,
            "artist": TPE1,
            "album": TALB,
            "albumartist": TPE2,
        }
        if field not in frame_map:
            raise HTTPException(status_code=400, detail=f"Unknown field: {field}")
        FrameClass = frame_map[field]
        tags.add(FrameClass(encoding=3, text=value))
        tags.save(str(p))

    elif ext == ".m4a":
        audio = MP4(str(p))
        tag_map = {
            "title": "\xa9nam",
            "artist": "\xa9ART",
            "album": "\xa9alb",
            "albumartist": "aART",
        }
        if field not in tag_map:
            raise HTTPException(status_code=400, detail=f"Unknown field: {field}")
        audio[tag_map[field]] = [value]
        audio.save()

    else:
        # For other formats try easy mutagen
        audio = MutagenFile(p, easy=True)
        if audio is None:
            raise HTTPException(status_code=400, detail="Cannot open file with mutagen.")
        audio[field] = value
        audio.save()


def detect_url_type(url: str) -> str:
    """Return 'spotify' or 'youtube'."""
    if "spotify.com" in url or url.startswith("spotify:"):
        return "spotify"
    return "youtube"


async def run_download(job_id: str, request: DownloadRequest) -> None:
    """Run the download subprocess and update the job store on completion."""
    url_type = detect_url_type(request.url)
    output_dir = str(OUTPUT_DIR)

    if url_type == "spotify":
        cmd = [
            "spotdl",
            "download",
            request.url,
            "--output",
            os.path.join(output_dir, request.outputFormat.lstrip("/")),
        ]
        if request.spotifyClientId:
            cmd += ["--client-id", request.spotifyClientId]
        if request.spotifyClientSecret:
            cmd += ["--client-secret", request.spotifyClientSecret]
    else:
        # Build yt-dlp output template — embed the folder structure
        yt_template = os.path.join(output_dir, "%(uploader)s", "%(album,playlist_title,uploader)s", "%(title)s.%(ext)s")
        cmd = [
            "yt-dlp",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--embed-thumbnail",
            "--add-metadata",
            "-o", yt_template,
            request.url,
        ]

    append_log(job_id, f"▶ Running: {' '.join(cmd)}")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.STDOUT,
        )

        while True:
            line_bytes = await proc.stdout.readline()
            if not line_bytes:
                break
            line = line_bytes.decode("utf-8", errors="replace").rstrip()
            if line:
                append_log(job_id, line)

        await proc.wait()

        if proc.returncode != 0:
            append_log(job_id, f"✗ Process exited with code {proc.returncode}")
            jobs[job_id]["status"] = "error"
        else:
            append_log(job_id, "✓ Download complete.")
            jobs[job_id]["status"] = "done"

    except FileNotFoundError as exc:
        tool = "spotdl" if url_type == "spotify" else "yt-dlp"
        append_log(job_id, f"✗ '{tool}' not found. Make sure it is installed and on your PATH.")
        jobs[job_id]["status"] = "error"
    except Exception as exc:
        append_log(job_id, f"✗ Unexpected error: {exc}")
        jobs[job_id]["status"] = "error"

    # Populate file list
    files = []
    for p in sorted(OUTPUT_DIR.rglob("*")):
        if p.is_file() and is_audio(p):
            files.append(read_tags(p))
    jobs[job_id]["files"] = files


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"ok": True, "outputDir": str(OUTPUT_DIR)}


@app.post("/download")
async def download(request: DownloadRequest):
    job_id = new_job()
    asyncio.create_task(run_download(job_id, request))
    return {"jobId": job_id}


@app.get("/job/{job_id}")
def get_job(job_id: str):
    if job_id not in jobs:
        raise HTTPException(status_code=404, detail="Job not found.")
    return jobs[job_id]


@app.get("/files")
def list_files():
    files = []
    for p in sorted(OUTPUT_DIR.rglob("*")):
        if p.is_file() and is_audio(p):
            files.append(read_tags(p))
    return {"files": files, "outputDir": str(OUTPUT_DIR)}


@app.patch("/file")
def patch_file(request: PatchFileRequest):
    p = safe_path(request.localPath)
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    allowed = {"title", "artist", "album", "albumartist"}
    if request.field not in allowed:
        raise HTTPException(status_code=400, detail=f"Field must be one of: {allowed}")
    write_tag(p, request.field, request.value)
    return {"ok": True, "file": read_tags(p)}


@app.post("/upload")
async def upload(request: UploadRequest):
    endpoint = f"https://{request.r2AccountId}.r2.cloudflarestorage.com"

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=request.r2AccessKeyId,
        aws_secret_access_key=request.r2SecretAccessKey,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )

    results = []
    for spec in request.files:
        p = safe_path(spec.localPath)
        if not p.exists():
            results.append({"r2Key": spec.r2Key, "ok": False, "error": "File not found."})
            continue
        content_type = _mime_for(p)
        try:
            s3.upload_file(
                str(p),
                request.r2Bucket,
                spec.r2Key,
                ExtraArgs={"ContentType": content_type},
            )
            results.append({"r2Key": spec.r2Key, "ok": True})
        except Exception as exc:
            results.append({"r2Key": spec.r2Key, "ok": False, "error": str(exc)})

    return {"results": results}


@app.delete("/file")
def delete_file(request: DeleteFileRequest):
    p = safe_path(request.localPath)
    if not p.exists():
        raise HTTPException(status_code=404, detail="File not found.")
    p.unlink()
    # Remove empty parent dirs up to OUTPUT_DIR
    try:
        for parent in p.parents:
            if parent == OUTPUT_DIR:
                break
            if not any(parent.iterdir()):
                parent.rmdir()
    except Exception:
        pass
    return {"ok": True}


@app.post("/clear")
def clear_all():
    """Delete all files in the output directory."""
    if OUTPUT_DIR.exists():
        shutil.rmtree(str(OUTPUT_DIR))
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    return {"ok": True}


# ---------------------------------------------------------------------------
# MIME helpers
# ---------------------------------------------------------------------------
_MIME_MAP = {
    ".mp3": "audio/mpeg",
    ".m4a": "audio/mp4",
    ".flac": "audio/flac",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".aac": "audio/aac",
    ".opus": "audio/opus",
}


def _mime_for(p: Path) -> str:
    return _MIME_MAP.get(p.suffix.lower(), "application/octet-stream")


def _make_s3_client(account_id: str, access_key: str, secret_key: str):
    return boto3.client(
        "s3",
        endpoint_url=f"https://{account_id}.r2.cloudflarestorage.com",
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )


@app.post("/my-songs")
async def get_my_songs(body: MySongsRequest):
    """List all songs in user's R2 bucket and return in app library format with 7-day presigned stream URLs."""
    s3 = _make_s3_client(body.r2AccountId, body.r2AccessKeyId, body.r2SecretAccessKey)

    audio_keys: list[str] = []
    paginator = s3.get_paginator("list_objects_v2")
    for page in paginator.paginate(Bucket=body.r2Bucket):
        for obj in page.get("Contents", []):
            key = obj["Key"]
            if Path(key).suffix.lower() in AUDIO_EXTS:
                audio_keys.append(key)

    # Group by Artist/Album from path structure
    albums_map: dict[tuple[str, str], list[str]] = {}
    for key in audio_keys:
        parts = key.split("/")
        if len(parts) >= 3:
            artist, album = parts[0], parts[1]
        elif len(parts) == 2:
            artist, album = parts[0], "Singles"
        else:
            artist, album = "Unknown Artist", "Singles"
        albums_map.setdefault((artist, album), []).append(key)

    PRESIGN_TTL = 604800  # 7 days
    results = []
    for (artist, album), keys in sorted(albums_map.items()):
        cover_key = f"{artist}/{album}/cover.jpg"
        try:
            cover_url = s3.generate_presigned_url(
                "get_object",
                Params={"Bucket": body.r2Bucket, "Key": cover_key},
                ExpiresIn=PRESIGN_TTL,
            )
        except Exception:
            cover_url = ""

        songs = []
        for key in sorted(keys):
            filename = key.split("/")[-1]
            title = Path(filename).stem
            try:
                stream_url = s3.generate_presigned_url(
                    "get_object",
                    Params={"Bucket": body.r2Bucket, "Key": key},
                    ExpiresIn=PRESIGN_TTL,
                )
            except Exception:
                stream_url = ""
            songs.append({
                "id": key,
                "r2Path": key,
                "fileName": filename,
                "title": title,
                "artistName": artist,
                "albumName": album,
                "link": stream_url,
            })

        results.append({
            "artistName": artist,
            "albumName": album,
            "coverArt": cover_url,
            "fallbackArt": "",
            "songs": songs,
        })

    return results


@app.post("/copy-from-url")
async def copy_from_url_endpoint(body: CopyFromUrlRequest):
    """Download a file from a public URL and upload it to the user's R2 bucket."""
    import io
    import urllib.request as _urllib

    def _fetch(url: str) -> bytes:
        req = _urllib.Request(url, headers={"User-Agent": "MusicImporter/1.0"})
        with _urllib.urlopen(req, timeout=60) as resp:
            return resp.read()

    content = await asyncio.to_thread(_fetch, body.sourceUrl)

    s3 = _make_s3_client(body.r2AccountId, body.r2AccessKeyId, body.r2SecretAccessKey)
    content_type = _mime_for(Path(body.r2Key))

    def _upload() -> None:
        s3.upload_fileobj(
            io.BytesIO(content),
            body.r2Bucket,
            body.r2Key,
            ExtraArgs={"ContentType": content_type},
        )

    await asyncio.to_thread(_upload)
    return {"ok": True, "r2Key": body.r2Key, "size": len(content)}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=PORT, reload=False)
