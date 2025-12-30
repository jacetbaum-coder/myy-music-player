import { google } from 'googleapis';
import { kv } from '@vercel/kv';

let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; 

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { key, url } = req.body;
    await kv.set(key, url);
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
          coverUrl = itunesData.results?.[0]?.artworkUrl100?.replace('100x100bb', '600x600bb') || '/apple-touch-icon.png';
        }

        allAlbums.push({
          artistName: artist.name,
          albumName: album.name,
          coverArt: coverUrl, 
          songs: songs.map(s => {
            // NEW LOGIC: This creates the "Artist/Album/Song.mp3" path for R2
            const r2Path = `${artist.name}/${album.name}/${s.name}`;
            return { 
              name: s.name, 
              link: `https://music-streamer.jacetbaum.workers.dev/?id=${encodeURIComponent(r2Path)}` 
            };
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
