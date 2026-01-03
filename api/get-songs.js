import { google } from 'googleapis';
import { kv } from '@vercel/kv';

let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000;

function makeCoverStorageKey(artistName, albumName) {
  return `cover-${artistName}-${albumName}`.replace(/\s+/g, '-').toLowerCase();
}

export default async function handler(req, res) {
  // -----------------------
  // POST: save / delete cover overrides
  // -----------------------
  if (req.method === 'POST') {
    const { key, url, artistName, albumName, coverUrl } = req.body || {};
    const resolvedKey =
      key || (artistName && albumName
        ? makeCoverStorageKey(artistName, albumName)
        : null);

    const resolvedUrl = url ?? coverUrl ?? "";

    if (!resolvedKey) {
      return res.status(400).json({ error: 'Missing cover key.' });
    }

    if (String(resolvedUrl).trim()) {
      await kv.set(resolvedKey, String(resolvedUrl).trim());
    } else {
      await kv.del(resolvedKey);
    }

    cachedData = null;
    lastFetchTime = 0;
    return res.status(200).json({ success: true });
  }

  // -----------------------
  // GET: return cached library if fresh
  // -----------------------
  const now = Date.now();
  if (cachedData && now - lastFetchTime < CACHE_DURATION) {
    return res.status(200).json(cachedData);
  }

  // -----------------------
  // Google Drive auth
  // -----------------------
  const auth = new google.auth.JWT(
    process.env.GCP_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/drive.readonly']
  );

  const drive = google.drive({ version: 'v3', auth });

  try {
    // -----------------------
    // List artist folders
    // -----------------------
    const artistsRes = await drive.files.list({
      q: `'${process.env.GCP_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
    });

    const allAlbums = [];

    await Promise.all(
      artistsRes.data.files.map(async (artist) => {
        const albumsRes = await drive.files.list({
          q: `'${artist.id}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
          fields: 'files(id, name)',
        });

        for (const album of albumsRes.data.files) {
          const contentRes = await drive.files.list({
            q: `'${album.id}' in parents`,
            fields: 'files(id, name, mimeType)',
          });

          const songs = contentRes.data.files.filter(f =>
            f.mimeType?.includes('audio')
          );

          // -----------------------
          // Cover art (KV override → iTunes fallback)
          // -----------------------
          const storageKey = makeCoverStorageKey(artist.name, album.name);
          let coverUrl = await kv.get(storageKey);

          if (!coverUrl) {
            const searchTerm = encodeURIComponent(
              `${artist.name} ${album.name}`
            );
            const itunesRes = await fetch(
              `https://itunes.apple.com/search?term=${searchTerm}&entity=album&limit=1`
            );
            const itunesData = await itunesRes.json();
            coverUrl =
              itunesData.results?.[0]?.artworkUrl100?.replace(
                '100x100bb',
                '600x600bb'
              ) ||
              'https://via.placeholder.com/600x600?text=No+Cover+Found';
          }

          // -----------------------
          // Build album object
          // -----------------------
          allAlbums.push({
            artistName: artist.name,
            albumName: album.name,
            coverArt: coverUrl,

            songs: songs.map((s) => {
              // Canonical R2 object path
              const r2Path = `${artist.name}/${album.name}/${s.name}`;

              // Stable track ID (used for dedupe + playlists)
              const trackId = r2Path;

              // Clean title (no extension)
              const title = String(s.name || "").replace(
                /\.(mp3|m4a|flac|wav)$/i,
                ""
              );

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
    res.status(200).json(allAlbums);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
}
