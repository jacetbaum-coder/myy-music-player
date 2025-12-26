const { google } = require('googleapis');

export default async function handler(req, res) {
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
    for (const artist of artists.data.files) {
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
        // Find the image file (usually named cover.jpg or similar)
        const coverFile = content.data.files.find(f => 
          f.mimeType.includes('image') || f.name.toLowerCase().includes('cover')
        );

        allAlbums.push({
          artistName: artist.name,
          albumName: album.name,
          // FIX: Use Cloudflare to proxy the image too
          coverArt: coverFile ? `https://music-streamer.jacetbaum.workers.dev/?id=${coverFile.id}` : null,
          songs: songs.map(s => ({ 
            name: s.name, 
            link: `https://music-streamer.jacetbaum.workers.dev/?id=${s.id}` 
          }))
        });
      }
    }
    res.status(200).json(allAlbums);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
