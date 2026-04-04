"""
Music Importer Server — runs locally on port 8765.
Wraps SpotDL (Spotify) and yt-dlp (YouTube), reads/writes ID3 tags via mutagen,
and uploads files directly to Cloudflare R2 via boto3.

Start: python server.py  (or bash start.sh)
"""

from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import re
import shutil
import subprocess
import sys
import uuid
from pathlib import Path
from typing import Any, Optional

import boto3
import uvicorn
from botocore.config import Config
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
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
import tempfile

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


class SearchRequest(BaseModel):
    query: str
    limit: int = 8


class PreviewRequest(BaseModel):
    url: str


class PatchFileRequest(BaseModel):
    localPath: str
    field: str   # title | artist | album | albumartist
    value: str


class UploadFileSpec(BaseModel):
    localPath: str
    r2Key: str


class UploadRequest(BaseModel):
    files: list[UploadFileSpec]
    r2AccountId: Optional[str] = None
    r2AccessKeyId: Optional[str] = None
    r2SecretAccessKey: Optional[str] = None
    r2Bucket: Optional[str] = None
    userId: Optional[str] = None


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
    userId: Optional[str] = None


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


def _extract_cover_art(audio_path: Path) -> Optional[bytes]:
    """Extract embedded cover art from an audio file. Returns JPEG/PNG bytes or None."""
    try:
        raw = MutagenFile(str(audio_path), easy=False)
        if raw is None or not hasattr(raw, "tags") or not raw.tags:
            return None
        # MP3: APIC frames
        for key in raw.tags:
            if key.startswith("APIC"):
                return raw.tags[key].data
        # MP4/M4A: covr
        if "covr" in raw.tags and raw.tags["covr"]:
            return bytes(raw.tags["covr"][0])
    except Exception:
        pass
    return None


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
        info["title"] = _clean_title((audio.get("title") or [p.stem])[0])
        info["artist"] = _clean_artist((audio.get("artist") or [""])[0])
        info["album"] = (audio.get("album") or [""])[0]
        info["albumartist"] = _clean_artist((audio.get("albumartist") or [""])[0])

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


_TITLE_NOISE = re.compile(
    r'\s*[\(\[\{]'
    r'(official\s*(music\s*)?video|official\s*audio|official\s*lyric\s*video'
    r'|lyric\s*video|lyrics?|visuali[sz]er|audio|hd|hq|4k|live|live\s*session'
    r'|extended|acoustic|remix|official\s*clip|studio\s*session|full\s*album'
    r'|official|video\s*clip|360°?)'
    r'[\)\]\}]',
    re.IGNORECASE,
)


def _clean_title(title: str) -> str:
    """Strip common noise suffixes from a YouTube video title."""
    cleaned = _TITLE_NOISE.sub('', str(title or '')).strip()
    cleaned = re.sub(r'\s{2,}', ' ', cleaned).strip(' -–—|')
    return cleaned or str(title or '')


def _clean_artist(artist: str) -> str:
    """Strip common noise like ' - Topic' from YouTube artist names."""
    cleaned = re.sub(r'\s*-\s*Topic$', '', str(artist or ''), flags=re.IGNORECASE).strip()
    return cleaned or str(artist or '')


def _module_available(module_name: str) -> bool:
    return importlib.util.find_spec(module_name) is not None


def _module_command(module_name: str, *args: str) -> list[str]:
    return [sys.executable, "-m", module_name, *args]


def _run_json_command(cmd: list[str], timeout: int = 30) -> Any:
    try:
        result = subprocess.run(
            cmd,
            stdin=subprocess.DEVNULL,
            capture_output=True,
            text=True,
            timeout=timeout,
            check=False,
        )
    except FileNotFoundError:
        raise HTTPException(status_code=500, detail=f"'{cmd[0]}' not found. Make sure it is installed and on your PATH.")
    except subprocess.TimeoutExpired:
        raise HTTPException(status_code=504, detail="Lookup timed out.")

    stdout = (result.stdout or "").strip()
    stderr = (result.stderr or "").strip()

    if result.returncode != 0:
        detail = stderr or stdout or f"{cmd[0]} failed with exit code {result.returncode}."
        raise HTTPException(status_code=502, detail=detail)

    if not stdout:
        raise HTTPException(status_code=502, detail=f"{cmd[0]} returned no data.")

    try:
        return json.loads(stdout)
    except json.JSONDecodeError:
        raise HTTPException(status_code=502, detail=f"{cmd[0]} returned invalid JSON.")


def _pick_thumbnail(data: Any) -> str:
    if not isinstance(data, dict):
        return ""

    thumbs = data.get("thumbnails")
    if isinstance(thumbs, list):
        for item in reversed(thumbs):
            if isinstance(item, dict) and item.get("url"):
                return str(item["url"])

    return str(data.get("thumbnail") or "")


def _extract_year(data: Any) -> str:
    if not isinstance(data, dict):
        return ""

    for key in ("release_year", "release_date", "upload_date"):
        value = data.get(key)
        if value is None:
            continue
        text = str(value).strip()
        if len(text) >= 4:
            return text[:4]
    return ""


def _extract_duration_label(data: Any) -> str:
    if not isinstance(data, dict):
        return ""

    value = data.get("duration_string")
    if value:
        return str(value)

    seconds = data.get("duration")
    if not isinstance(seconds, (int, float)) or seconds <= 0:
        return ""

    total = int(seconds)
    minutes, sec = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours}:{minutes:02d}:{sec:02d}"
    return f"{minutes}:{sec:02d}"


def _normalize_source_url(data: Any) -> str:
    if not isinstance(data, dict):
        return ""

    raw = str(data.get("webpage_url") or "").strip()
    if raw.startswith("http"):
        return raw

    display_id = str(data.get("url") or "").strip()
    if display_id.startswith("http"):
        return display_id

    video_id = str(data.get("id") or display_id).strip()
    if video_id:
        return f"https://www.youtube.com/watch?v={video_id}"

    return ""


def _normalize_search_item(entry: Any) -> dict[str, Any]:
    if not isinstance(entry, dict):
        return {}

    kind = "playlist" if entry.get("_type") == "playlist" else "track"
    title = _clean_title(str(entry.get("title") or entry.get("playlist_title") or "Untitled"))
    artist = str(
        entry.get("artist")
        or entry.get("uploader")
        or entry.get("channel")
        or entry.get("playlist_uploader")
        or ""
    )
    album = str(entry.get("album") or entry.get("playlist_title") or "")

    return {
        "provider": "youtube",
        "kind": kind,
        "title": title,
        "artist": artist,
        "album": album,
        "year": _extract_year(entry),
        "durationLabel": _extract_duration_label(entry),
        "coverUrl": _pick_thumbnail(entry),
        "sourceUrl": _normalize_source_url(entry),
    }


def _normalize_preview_track(entry: Any) -> dict[str, Any]:
    if not isinstance(entry, dict):
        return {}

    return {
        "title": _clean_title(str(entry.get("track") or entry.get("title") or "Untitled")),
        "artist": str(entry.get("artist") or entry.get("uploader") or entry.get("channel") or ""),
        "sourceUrl": _normalize_source_url(entry),
        "durationLabel": _extract_duration_label(entry),
    }


def _normalize_preview(data: Any, source_url: str) -> dict[str, Any]:
    if not isinstance(data, dict):
        raise HTTPException(status_code=502, detail="Preview data was missing or malformed.")

    entries = [entry for entry in (data.get("entries") or []) if isinstance(entry, dict)]
    if entries:
        tracks = [_normalize_preview_track(entry) for entry in entries]
        return {
            "provider": "youtube",
            "kind": "playlist",
            "title": str(data.get("playlist_title") or data.get("title") or "Playlist"),
            "artist": str(data.get("playlist_uploader") or data.get("uploader") or ""),
            "album": str(data.get("playlist_title") or data.get("title") or ""),
            "year": _extract_year(data) or _extract_year(entries[0]),
            "coverUrl": _pick_thumbnail(data) or _pick_thumbnail(entries[0]),
            "sourceUrl": source_url,
            "trackCount": len(tracks),
            "tracks": tracks,
        }

    single_track = _normalize_preview_track(data)
    return {
        "provider": "youtube",
        "kind": "track",
        "title": _clean_title(single_track.get("title") or "Untitled"),
        "artist": single_track.get("artist") or "",
        "album": str(data.get("album") or data.get("playlist_title") or ""),
        "year": _extract_year(data),
        "coverUrl": _pick_thumbnail(data),
        "sourceUrl": source_url,
        "trackCount": 1,
        "tracks": [single_track],
    }


async def run_download(job_id: str, request: DownloadRequest) -> None:
    """Run the download subprocess and update the job store on completion."""
    request = request.model_copy(update={"url": _clean_youtube_url(request.url)})
    url_type = detect_url_type(request.url)
    output_dir = str(OUTPUT_DIR)

    if url_type == "spotify":
        if not _module_available("spotdl"):
            append_log(job_id, "✗ 'spotdl' is not installed in this Python environment.")
            jobs[job_id]["status"] = "error"
            return

        cmd = _module_command(
            "spotdl",
            "download",
            request.url,
            "--output",
            os.path.join(output_dir, request.outputFormat.lstrip("/")),
        )
        if request.spotifyClientId:
            cmd += ["--client-id", request.spotifyClientId]
        if request.spotifyClientSecret:
            cmd += ["--client-secret", request.spotifyClientSecret]
    else:
        if not _module_available("yt_dlp"):
            append_log(job_id, "✗ 'yt-dlp' is not installed in this Python environment.")
            jobs[job_id]["status"] = "error"
            return

        # Build yt-dlp output template — embed the folder structure
        yt_template = os.path.join(output_dir, "%(uploader)s", "%(album,playlist_title,uploader)s", "%(title)s.%(ext)s")
        cmd = _module_command(
            "yt_dlp",
            "-x",
            "--audio-format", "mp3",
            "--audio-quality", "0",
            "--embed-thumbnail",
            "--add-metadata",
            "--no-playlist",
            "--ignore-errors",
            "--js-runtimes", "node",
            "--remote-components", "ejs:github",
            "-o", yt_template,
            request.url,
        )

    append_log(job_id, f"▶ Running: {' '.join(cmd)}")

    try:
        proc = await asyncio.create_subprocess_exec(
            *cmd,
            stdin=asyncio.subprocess.DEVNULL,
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
        append_log(job_id, f"✗ '{tool}' could not be launched from this Python environment.")
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
# R2 configuration — prefer environment variables over per-request credentials
# ---------------------------------------------------------------------------
_ENV_R2_ACCOUNT_ID        = os.environ.get("R2_ACCOUNT_ID", "")
_ENV_R2_ACCESS_KEY_ID     = os.environ.get("R2_ACCESS_KEY_ID", "")
_ENV_R2_SECRET_ACCESS_KEY = os.environ.get("R2_SECRET_ACCESS_KEY", "")
_ENV_R2_BUCKET            = os.environ.get("R2_BUCKET", "")

def _r2_configured() -> bool:
    return bool(
        _ENV_R2_ACCOUNT_ID
        and _ENV_R2_ACCESS_KEY_ID
        and _ENV_R2_SECRET_ACCESS_KEY
        and _ENV_R2_BUCKET
    )


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.get("/health")
def health():
    return {"ok": True, "outputDir": str(OUTPUT_DIR), "r2Configured": _r2_configured()}


@app.post("/playlist-tracks")
async def playlist_tracks(request: PreviewRequest):
    """Return the full flat track list for a YouTube playlist/mix URL."""
    # Do NOT clean the URL here — we want the full playlist/radio enumeration
    url = str(request.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required.")
    if not _module_available("yt_dlp"):
        raise HTTPException(status_code=500, detail="'yt-dlp' is not installed.")
    cmd = [
        *_module_command("yt_dlp"),
        "--dump-single-json",
        "--flat-playlist",
        "--no-warnings",
        "--skip-download",
        "--js-runtimes", "node",
        "--remote-components", "ejs:github",
        "--playlist-end", "100",
        url,
    ]
    data = await asyncio.to_thread(_run_json_command, cmd, 90)
    entries = [e for e in (data.get("entries") or []) if isinstance(e, dict)]
    if not entries:
        # single video — wrap it
        entries = [data]
    tracks = [_normalize_search_item(e) for e in entries]
    tracks = [t for t in tracks if t.get("sourceUrl")]
    return {"tracks": tracks, "total": len(tracks)}


# ---------------------------------------------------------------------------
# Spotify playlist helpers (no credentials required for public playlists)
# ---------------------------------------------------------------------------

class SpotifyPlaylistTracksRequest(BaseModel):
    url: str
    spotifyClientId: str = ""
    spotifyClientSecret: str = ""


def _spotify_extract_playlist_id(url: str) -> Optional[str]:
    m = re.search(r'spotify\.com/playlist/([A-Za-z0-9]+)', url)
    if m:
        return m.group(1)
    m = re.search(r'spotify:playlist:([A-Za-z0-9]+)', url)
    if m:
        return m.group(1)
    return None


def _spotify_get_anonymous_token() -> Optional[str]:
    """Request an anonymous web-player access token from Spotify (no credentials needed)."""
    try:
        import urllib.request as _ureq
        req = _ureq.Request(
            'https://open.spotify.com/get_access_token?reason=transport&productType=web_player',
            headers={
                'User-Agent': (
                    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) '
                    'AppleWebKit/537.36 (KHTML, like Gecko) '
                    'Chrome/124.0.0.0 Safari/537.36'
                ),
                'Accept': 'application/json',
                'Accept-Language': 'en-US,en;q=0.9',
                'Referer': 'https://open.spotify.com/',
            },
        )
        with _ureq.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data.get('accessToken') or None
    except Exception:
        return None


def _spotify_get_token_from_credentials(client_id: str, client_secret: str) -> Optional[str]:
    """Exchange client credentials for a Spotify API access token."""
    try:
        import base64
        import urllib.request as _ureq
        credentials = base64.b64encode(f'{client_id}:{client_secret}'.encode()).decode()
        req = _ureq.Request(
            'https://accounts.spotify.com/api/token',
            data=b'grant_type=client_credentials',
            headers={
                'Authorization': f'Basic {credentials}',
                'Content-Type': 'application/x-www-form-urlencoded',
            },
        )
        with _ureq.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            return data.get('access_token') or None
    except Exception:
        return None


def _spotify_fetch_playlist_info(playlist_id: str, token: str) -> dict:
    """Fetch playlist name and cover image."""
    import urllib.request as _ureq
    req = _ureq.Request(
        f'https://api.spotify.com/v1/playlists/{playlist_id}?fields=name,images',
        headers={'Authorization': f'Bearer {token}', 'Accept': 'application/json'},
    )
    try:
        with _ureq.urlopen(req, timeout=10) as resp:
            data = json.loads(resp.read().decode('utf-8'))
    except Exception:
        return {'name': '', 'coverUrl': ''}
    images = data.get('images') or []
    cover_url = images[0].get('url', '') if images else ''
    return {'name': data.get('name') or '', 'coverUrl': cover_url}


def _spotify_fetch_playlist_tracks(playlist_id: str, token: str) -> list[dict]:
    """Paginate through all tracks in a Spotify playlist (up to 500)."""
    import urllib.request as _ureq
    tracks: list[dict] = []
    fields = 'next,items(track(name,artists(name),album(name,images(url)),duration_ms))'
    url: Optional[str] = (
        f'https://api.spotify.com/v1/playlists/{playlist_id}/tracks'
        f'?limit=100&offset=0&fields={fields}'
    )
    while url and len(tracks) < 500:
        req = _ureq.Request(
            url,
            headers={
                'Authorization': f'Bearer {token}',
                'Accept': 'application/json',
            },
        )
        try:
            with _ureq.urlopen(req, timeout=15) as resp:
                data = json.loads(resp.read().decode('utf-8'))
        except Exception as e:
            raise HTTPException(status_code=502, detail=f'Spotify API error: {e}')
        for item in (data.get('items') or []):
            track = item.get('track') if isinstance(item, dict) else None
            if not track or not isinstance(track, dict):
                continue
            name = track.get('name') or ''
            if not name:
                continue
            artists = [a['name'] for a in (track.get('artists') or []) if a.get('name')]
            album_data = track.get('album') or {}
            album = album_data.get('name') or ''
            album_images = album_data.get('images') or []
            album_cover = album_images[0].get('url', '') if album_images else ''
            duration_ms = track.get('duration_ms') or 0
            tracks.append({
                'title': name,
                'artist': ', '.join(artists),
                'album': album,
                'durationMs': duration_ms,
                'albumCoverUrl': album_cover,
            })
        url = data.get('next') or None
    return tracks


@app.post("/spotify-playlist-tracks")
async def spotify_playlist_tracks(request: SpotifyPlaylistTracksRequest):
    """
    Return the track list for a public Spotify playlist.
    No credentials are required for public playlists — an anonymous web-player
    token is used automatically. If that fails, provided credentials (or
    SPOTIFY_CLIENT_ID / SPOTIFY_CLIENT_SECRET env vars) are used as fallback.
    """
    url = str(request.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="URL is required.")

    playlist_id = _spotify_extract_playlist_id(url)
    if not playlist_id:
        raise HTTPException(status_code=400, detail="Could not extract a playlist ID from that URL.")

    # 1. Try request-provided credentials
    token: Optional[str] = None
    if request.spotifyClientId and request.spotifyClientSecret:
        token = await asyncio.to_thread(
            _spotify_get_token_from_credentials,
            request.spotifyClientId,
            request.spotifyClientSecret,
        )

    # 2. Fall back to server environment variables
    if not token:
        env_id = os.environ.get("SPOTIFY_CLIENT_ID", "")
        env_secret = os.environ.get("SPOTIFY_CLIENT_SECRET", "")
        if env_id and env_secret:
            token = await asyncio.to_thread(
                _spotify_get_token_from_credentials, env_id, env_secret
            )

    if not token:
        raise HTTPException(
            status_code=403,
            detail="SPOTIFY_CREDENTIALS_REQUIRED",
        )

    playlist_info, tracks = await asyncio.gather(
        asyncio.to_thread(_spotify_fetch_playlist_info, playlist_id, token),
        asyncio.to_thread(_spotify_fetch_playlist_tracks, playlist_id, token),
    )
    if not tracks:
        raise HTTPException(
            status_code=404,
            detail="No tracks found. The playlist may be empty or private.",
        )

    return {
        "tracks": tracks,
        "total": len(tracks),
        "playlistName": playlist_info.get('name') or '',
        "coverUrl": playlist_info.get('coverUrl') or '',
    }


@app.post("/search")
async def search(request: SearchRequest):
    query = str(request.query or "").strip()
    limit = max(1, min(int(request.limit or 8), 12))
    if not query:
        raise HTTPException(status_code=400, detail="Query is required.")

    cmd = [
        *_module_command("yt_dlp"),
        "--dump-single-json",
        "--flat-playlist",
        "--no-warnings",
        "--js-runtimes", "node",
        "--remote-components", "ejs:github",
        f"ytsearch{limit}:{query}",
    ]
    if not _module_available("yt_dlp"):
        raise HTTPException(status_code=500, detail="'yt-dlp' is not installed in this Python environment.")
    data = await asyncio.to_thread(_run_json_command, cmd, 30)
    entries = [entry for entry in (data.get("entries") or []) if isinstance(entry, dict)]
    items = [_normalize_search_item(entry) for entry in entries]
    items = [item for item in items if item.get("sourceUrl")]
    return {"provider": "youtube", "query": query, "items": items}


def _clean_youtube_url(url: str) -> str:
    """Strip radio/mix/playlist params from a YouTube watch URL, keeping only ?v=VIDEO_ID."""
    try:
        from urllib.parse import urlparse, parse_qs
        parsed = urlparse(url)
        if parsed.hostname in ("www.youtube.com", "youtube.com", "m.youtube.com") and parsed.path == "/watch":
            qs = parse_qs(parsed.query, keep_blank_values=False)
            video_id = (qs.get("v") or [None])[0]
            if video_id:
                return f"https://www.youtube.com/watch?v={video_id}"
    except Exception:
        pass
    return url


@app.post("/preview")
async def preview(request: PreviewRequest):
    url = _clean_youtube_url(str(request.url or "").strip())
    if not url:
        raise HTTPException(status_code=400, detail="URL is required.")
    if detect_url_type(url) != "youtube":
        raise HTTPException(status_code=400, detail="Preview is currently supported for YouTube links and search matches only.")
    if not _module_available("yt_dlp"):
        raise HTTPException(status_code=500, detail="'yt-dlp' is not installed in this Python environment.")

    cmd = [
        *_module_command("yt_dlp"),
        "--dump-single-json",
        "--no-warnings",
        "--skip-download",
        "--js-runtimes", "node",
        "--remote-components", "ejs:github",
        url,
    ]
    data = await asyncio.to_thread(_run_json_command, cmd, 45)
    return {"provider": "youtube", "preview": _normalize_preview(data, url)}


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


@app.get("/stream")
def stream_file(path: str):
    """Serve a local audio file for in-browser playback."""
    p = safe_path(path)
    if not p.exists() or not p.is_file():
        raise HTTPException(status_code=404, detail="File not found.")
    if not is_audio(p):
        raise HTTPException(status_code=400, detail="Not an audio file.")
    media_types = {
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".opus": "audio/opus",
        ".wav": "audio/wav",
        ".wma": "audio/x-ms-wma",
        ".aac": "audio/aac",
    }
    mt = media_types.get(p.suffix.lower(), "application/octet-stream")
    return FileResponse(str(p), media_type=mt, filename=p.name)


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
    # Resolve R2 credentials: env vars take priority, then request body
    account_id = _ENV_R2_ACCOUNT_ID or (request.r2AccountId or "")
    access_key = _ENV_R2_ACCESS_KEY_ID or (request.r2AccessKeyId or "")
    secret_key = _ENV_R2_SECRET_ACCESS_KEY or (request.r2SecretAccessKey or "")
    bucket     = _ENV_R2_BUCKET or (request.r2Bucket or "")

    if not (account_id and access_key and secret_key and bucket):
        raise HTTPException(
            status_code=400,
            detail="R2 credentials are not configured on the server.",
        )

    endpoint = f"https://{account_id}.r2.cloudflarestorage.com"

    s3 = boto3.client(
        "s3",
        endpoint_url=endpoint,
        aws_access_key_id=access_key,
        aws_secret_access_key=secret_key,
        config=Config(signature_version="s3v4"),
        region_name="auto",
    )

    results = []
    uploaded_cover_albums: set[str] = set()   # track which albums already got a cover

    for spec in request.files:
        p = safe_path(spec.localPath)
        target_key = _account_scoped_r2_key(spec.r2Key, request.userId)
        if not p.exists():
            results.append({"r2Key": target_key, "ok": False, "error": "File not found."})
            continue
        content_type = _mime_for(p)
        try:
            s3.upload_file(
                str(p),
                bucket,
                target_key,
                ExtraArgs={"ContentType": content_type},
            )
            results.append({"r2Key": target_key, "ok": True})

            # Auto-upload cover.jpg for the album (once per album)
            album_prefix = "/".join(target_key.split("/")[:-1])  # e.g. users/{uid}/{artist}/{album}
            if album_prefix and album_prefix not in uploaded_cover_albums:
                cover_data = _extract_cover_art(p)
                if cover_data:
                    cover_key = f"{album_prefix}/cover.jpg"
                    try:
                        s3.put_object(
                            Bucket=bucket,
                            Key=cover_key,
                            Body=cover_data,
                            ContentType="image/jpeg",
                        )
                        uploaded_cover_albums.add(album_prefix)
                    except Exception:
                        pass  # non-fatal — song uploaded fine, cover is bonus

        except Exception as exc:
            results.append({"r2Key": target_key, "ok": False, "error": str(exc)})

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


def _account_scoped_r2_key(raw_key: str, user_id: Optional[str]) -> str:
    key = str(raw_key or "").lstrip("/")
    uid = str(user_id or "").strip()
    if not uid or not key or key.startswith("users/"):
        return key
    return f"users/{uid}/{key}"


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
    target_key = _account_scoped_r2_key(body.r2Key, body.userId)
    content_type = _mime_for(Path(target_key))

    def _upload() -> None:
        s3.upload_fileobj(
            io.BytesIO(content),
            body.r2Bucket,
            target_key,
            ExtraArgs={"ContentType": content_type},
        )

    await asyncio.to_thread(_upload)
    return {"ok": True, "r2Key": target_key, "size": len(content)}


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    uvicorn.run("server:app", host="127.0.0.1", port=PORT, reload=False)
