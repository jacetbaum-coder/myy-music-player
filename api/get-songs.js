import { google } from "googleapis";
import { kv } from "@vercel/kv";

let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

function makeCoverStorageKey(artistName, albumName) {
  return `cover-${artistName}-${albumName}`.replace(/\s+/g, "-").toLowerCase();
}

function missingEnv(keys) {
  return keys.filter((k) => !process.env[k] || !String(process.env[k]).trim());
}

function looksLikeAudio(file) {
  const name = String(file?.name || "").toLowerCase();
  const mt = String(file?.mimeType || "").toLowerCase();
  if (mt.startsWith("audio/")) return true;
  // Drive sometimes returns application/octet-stream; fall back to extension
  return (
    name.endsWith(".mp3") ||
    name.endsWith(".m4a") ||
    name.endsWith(".flac") ||
    name.endsWith(".wav") ||
    name.endsWith(".ogg") ||
    name.endsWith(".aac")
  );
}

export default async function handler(req, res) {
  try {
    // -----------------------
    // POST: save / delete cover overrides
    // -----------------------
    if (req.method === "POST") {
      const { key, url, artistName, albumName, coverUrl } = req.body || {};
      const resolvedKey =
        key ||
        (artistName && albumName ? makeCoverStorageKey(artistName, albumName) : null);

      const resolvedUrl = url ?? coverUrl ?? "";

      if (!resolvedKey) {
        return res.status(400).json({ ok: false, error: "Missing cover key." });
      }

      // kv can throw if not configured — keep it inside try/catch
      if (String(resolvedUrl).trim()) {
        await kv.set(resolvedKey, String(resolvedUrl).trim());
      } else {
        await kv.del(resolvedKey);
      }

      cachedData = null;
      lastFetchTime = 0;
      return res.status(200).json({ ok: true, success: true });
    }

    // -----------------------
    // GET: return cached library if fresh
    // -----------------------
    const now = Date.now();
    if (cachedData && now - lastFetchTime < CACHE_DURATION) {
      return res.status(200).json(cachedData);
    }

    // -----------------------
    // Env validation (PREVENTS CRASH)
    // -----------------------
    const missing = missingEnv([
      "GCP_SERVICE_ACCOUNT_EMAIL",
      "GCP_PRIVATE_KEY",
      "GCP_FOLDER_ID",
    ]);

    if (missing.length) {
      return res.status(500).json({
        ok: false,
        error: "Missing required environment variables on Vercel.",
        missing,
      });
    }

    // -----------------------
    // Google Drive auth
    // -----------------------
    const auth = new google.auth.JWT(
      process.env.GCP_SERVICE_ACCOUNT_EMAIL,
      null,
      String(process.env.GCP_PRIVATE_KEY).replace(/\\n/g, "\n"),
      ["https://www.googleapis.com/auth/drive.readonly"]
    );

    const drive = google.drive({ version: "v3", auth });

    // ✅ Drive listings are paginated. This helper returns ALL pages.
    async function driveListAll({ q, fields, pageSize = 1000 }) {
      let pageToken = undefined;
      const all = [];

      while (true) {
        const r = await drive.files.list({
          q,
          fields: `nextPageToken, files(${fields})`,
          pageSize,
          pageToken,
          supportsAllDrives: true,
          includeItemsFromAllDrives: true,
        });

        const files = r?.data?.files || [];
        all.push(...files);

        pageToken = r?.data?.nextPageToken;
        if (!pageToken) break;
      }

      return all;
    }

    // -----------------------
    // List artist folders
    // -----------------------
    const artists = await driveListAll({
      q: `'${process.env.GCP_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: "id, name",
    });

    const allAlbums = [];

    // Keep your parallelization, but safe
    await Promise.all(
      artists.map(async (artist) => {
        const albums = await driveListAll({
          q: `'${artist.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
          fields: "id, name",
        });

        for (const album of albums) {
          const contents = await driveListAll({
            q: `'${album.id}' in parents and trashed = false`,
            fields: "id, name, mimeType",
          });

          const songs = contents.filter(looksLikeAudio);

          // -----------------------
          // Cover art (KV override → Worker fallback)
          // -----------------------
          const storageKey = makeCoverStorageKey(artist.name, album.name);

          let coverUrl = null;
          try {
            coverUrl = await kv.get(storageKey);
          } catch (e) {
            // If KV isn’t set up, don’t crash the whole endpoint
            coverUrl = null;
          }

          const r2Base = "https://music-streamer.jacetbaum.workers.dev/?id=";
          const albumCoverPath = `${artist.name}/${album.name}/cover.jpg`;
          const artistCoverPath = `${artist.name}/cover.jpg`;

          if (!coverUrl) {
            coverUrl = `${r2Base}${encodeURIComponent(albumCoverPath)}`;
          }

          const fallbackCover = `${r2Base}${encodeURIComponent(artistCoverPath)}`;

          // -----------------------
          // Build album object
          // -----------------------
          allAlbums.push({
            artistName: artist.name,
            albumName: album.name,
            coverArt: coverUrl,
            fallbackArt: fallbackCover,
            songs: songs.map((s) => {
              const r2Path = `${artist.name}/${album.name}/${s.name}`;
              const trackId = r2Path;

              const title = String(s.name || "").replace(/\.[^/.]+$/, "");

              return {
                id: trackId,
                r2Path,
                fileName: s.name,
                title,
                artistName: artist.name,
                albumName: album.name,
                link: `https://music-streamer.jacetbaum.workers.dev/?id=${encodeURIComponent(
                  r2Path
                )}`,
              };
            }),
          });
        }
      })
    );

    cachedData = allAlbums;
    lastFetchTime = now;

    return res.status(200).json(allAlbums);
  } catch (error) {
    console.error("get-songs crashed:", error);
    return res.status(500).json({
      ok: false,
      error: String(error?.message || error),
      // This helps you see exactly what type it was in Vercel logs:
      name: error?.name || null,
    });
  }
}

