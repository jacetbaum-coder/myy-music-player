import { google } from 'googleapis';
import { kv } from '@vercel/kv';

let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; 

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { key, url, title } = req.body || {};
    const value = title ?? url;
    if (!key || !value) {
      return res.status(400).json({ success: false, error: 'Missing key or value' });
    }
    await kv.set(key, value);
    if (!key || !value) {
      return res.status(400).json({ success: false, error: 'Missing key or value' });
    }
    await kv.set(key, value);
    return res.status(200).json({ success: true });
  }

  const now = Date.now();
  if (cachedData && (now - lastFetchTime < CACHE_DURATION)) {
    return res.status(200).json(cachedData);
  }

  const auth = new google.auth.JWT(
    process.env.GCP_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/drive.readonly']
  );
  const drive = google.drive({ version: 'v3', auth });

  try {
    const artists = await drive.files.list({
      q: `'${process.env.GCP_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
      fields: 'files(id, name)',
    });

    const allAlbums = [];
    await Promise.all(artists.data.files.map(async (artist) => {
      const albums = await drive.files.list({
        q: `'${artist.id}' in parents and mimeType = 'application/vnd.google-apps.folder'`,
        fields: 'files(id, name)',
      });

      for (const album of albums.data.files) {
        const content = await drive.files.list({
          q: `'${album.id}' in parents`,
          fields: 'files(id, name, mimeType)',
        });

        const songs = content.data.files.filter(f => f.mimeType.includes('audio'));
        const storageKey = `cover-${artist.name}-${album.name}`.replace(/\s+/g, '-').toLowerCase();
        let coverUrl = await kv.get(storageKey);

        if (!coverUrl) {
          const searchTerm = encodeURIComponent(`${artist.name} ${album.name}`);
          const itunesRes = await fetch(`https://itunes.apple.com/search?term=${searchTerm}&entity=album&limit=1`);
          const itunesData = await itunesRes.json();
          coverUrl = itunesData.results?.[0]?.artworkUrl100.replace('100x100bb', '600x600bb') || 'https://via.placeholder.com/600x600?text=No+Cover+Found';
        }

         const songsWithMetadata = await Promise.all(songs.map(async (s) => {
          const r2Path = `${artist.name}/${album.name}/${s.name}`;
          const titleKey = `title-${r2Path}`;
          const legacyTitleKey = `title-${encodeURIComponent(r2Path)}`;
          let savedTitle = null;
          try {
            savedTitle = await kv.get(titleKey);
            if (!savedTitle) {
              savedTitle = await kv.get(legacyTitleKey);
            }
          } catch (error) {
            savedTitle = null;
          }
          return {
            name: savedTitle || s.name,
            originalName: s.name,
            titleKey,
            link: `https://music-streamer.jacetbaum.workers.dev/?id=${encodeURIComponent(r2Path)}`
          };
        }));

        allAlbums.push({
          artistName: artist.name,
          albumName: album.name,
          coverArt: coverUrl,
          songs: songsWithMetadata
          })
        });
      }
    }));

    cachedData = allAlbums;
    lastFetchTime = now;
    res.status(200).json(allAlbums);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
