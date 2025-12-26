const { google } = require('googleapis');

// This variable stays "alive" in Vercel's memory for a short time
let cachedData = null;
let lastFetchTime = 0;
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes in milliseconds

export default async function handler(req, res) {
  // Check if we have a fresh version of the data already
  const now = Date.now();
  if (cachedData && (now - lastFetchTime < CACHE_DURATION)) {
    console.log("Serving from cache");
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
      q: `'${process.env.GCP_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
    });

    const allAlbums = [];
    // We use Promise.all to fetch artists in parallel, making the initial load faster too
    await Promise.all(artists.data.files.map(async (artist) => {
      const albums = await drive.files.list({
        q: `'${artist.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
      });

      for (const album of albums.data.files) {
        const content = await drive.files.list({
          q: `'${album.id}' in parents and trashed = false`,
          fields: 'files(id, name, mimeType)',
        });

        const songs = content.data.files.filter(f => f.mimeType.includes('audio'));
        
        // Fetch art from iTunes
        const searchTerm = encodeURIComponent(`${artist.name} ${album.name}`);
        const itunesRes = await fetch(`https://itunes.apple.com/search?term=${searchTerm}&entity=album&limit=1`);
        const itunesData = await itunesRes.json();
        
        let coverUrl = itunesData.results?.[0]?.artworkUrl100.replace('100x100bb', '600x600bb') || 'https://via.placeholder.com/600x600?text=No+Cover+Found';

        allAlbums.push({
          artistName: artist.name,
          albumName: album.name,
          coverArt: coverUrl, 
          songs: songs.map(s => ({ 
            name: s.name, 
            link: `https://music-streamer.jacetbaum.workers.dev/?id=${s.id}` 
          }))
        });
      }
    }));

    // Update the cache
    cachedData = allAlbums;
    lastFetchTime = now;

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate');
    res.status(200).json(allAlbums);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
