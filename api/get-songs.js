const { google } = require('googleapis');

export default async function handler(req, res) {
  const auth = new google.auth.JWT(
    process.env.GCP_SERVICE_ACCOUNT_EMAIL,
    null,
    process.env.GCP_PRIVATE_KEY.replace(/\\n/g, '\n'),
    ['https://www.googleapis.com/auth/drive.readonly']
  );
  const drive = google.drive({ version: 'v3', auth });

  // 1. HANDLE STREAMING REQUESTS
  if (req.query.fileId) {
    try {
      const response = await drive.files.get(
        { fileId: req.query.fileId, alt: 'media' },
        { responseType: 'stream' }
      );
      
      res.setHeader('Content-Type', 'audio/mpeg');
      return response.data.pipe(res);
    } catch (err) {
      return res.status(500).send("Stream Error");
    }
  }

  // 2. HANDLE LISTING REQUESTS
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
        
        // We use a simplified cover art fetch or keep your existing logic
        allAlbums.push({
          artistName: artist.name,
          albumName: album.name,
          // You can keep your cover art logic here
          songs: songs.map(s => ({ 
            name: s.name, 
            link: `/api/get-songs?fileId=${s.id}` // Link points back to this API!
          }))
        });
      }
    }
    res.status(200).json(allAlbums);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
