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
          fields: 'files(id, name, webContentLink, mimeType, thumbnailLink)',
        });

        const songs = content.data.files.filter(f => f.mimeType.includes('audio'));
        const coverFile = content.data.files.find(f => f.name.toLowerCase().includes('cover'));

        let highResCover = null;
        if (coverFile) {
          highResCover = `https://lh3.googleusercontent.com/u/0/d/${coverFile.id}=s1000`;
        }

        allAlbums.push({
          artistName: artist.name,
          albumName: album.name,
          coverArt: highResCover,
          songs: songs.map(s => ({ 
            name: s.name, 
            // This new link format is a "direct stream" bypass
            link: `https://drive.google.com/uc?export=download&id=${s.id}` 
          }))
        });
      }
    }

    res.status(200).json(allAlbums);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
