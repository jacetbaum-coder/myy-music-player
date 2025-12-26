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
    // 1. Get Artist Folders (Daniel Caesar, Frank Ocean, etc.)
    const artists = await drive.files.list({
      q: `'${process.env.GCP_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
    });

    const allAlbums = [];

    for (const artist of artists.data.files) {
      // 2. Get Album Folders inside each Artist
      const albums = await drive.files.list({
        q: `'${artist.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
      });

      for (const album of albums.data.files) {
        // 3. Get songs and covers inside the Album folder
        const content = await drive.files.list({
          q: `'${album.id}' in parents and trashed = false`,
          fields: 'files(id, name, webContentLink, mimeType, thumbnailLink)',
        });

        const songs = content.data.files.filter(f => f.mimeType.includes('audio'));
        const cover = content.data.files.find(f => f.name.toLowerCase().includes('cover'));

        // This sends exactly what index.html is looking for
        allAlbums.push({
          artistName: artist.name,
          albumName: album.name,
          coverArt: cover ? cover.webContentLink : (songs[0] ? songs[0].thumbnailLink : null),
          songs: songs.map(s => ({ name: s.name, link: s.webContentLink }))
        });
      }
    }

    res.status(200).json(allAlbums);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
