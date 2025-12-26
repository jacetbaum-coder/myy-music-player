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
    // 1. Get all Artist folders inside your main musicplayer folder
    const artistFolders = await drive.files.list({
      q: `'${process.env.GCP_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
    });

    const allAlbums = [];

    for (const artist of artistFolders.data.files) {
      // 2. Get Album folders inside each Artist
      const albumFolders = await drive.files.list({
        q: `'${artist.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
      });

      for (const album of albumFolders.data.files) {
        // 3. Get everything inside the Album folder
        const files = await drive.files.list({
          q: `'${album.id}' in parents and trashed = false`,
          fields: 'files(id, name, webContentLink, mimeType, thumbnailLink)',
        });

        const songs = files.data.files.filter(f => f.mimeType.includes('audio'));
        
        // This looks for ANY file that has "cover" in the name (like cover1, cover 120, etc.)
        const cover = files.data.files.find(f => f.name.toLowerCase().includes('cover'));

        allAlbums.push({
          artistName: artist.name,
          albumName: album.name,
          // If a cover image exists, use it. Otherwise, use the Google Drive thumbnail.
          coverArt: cover ? cover.webContentLink : (songs[0] ? songs[0].thumbnailLink : null),
          songs: songs
        });
      }
    }

    res.status(200).json(allAlbums);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
