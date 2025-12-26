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
          fields: 'files(id, name, mimeType, thumbnailLink)', // Added thumbnailLink
        });

        const songs = content.data.files.filter(f => f.mimeType.includes('audio'));
        
        // IMPROVED IMAGE SEARCH: Look for ANY image file in the folder
        let coverFile = content.data.files.find(f => f.mimeType.startsWith('image/'));
        
        // ULTIMATE FALLBACK: If no image file exists, try to use the first song's auto-generated thumbnail
        let coverUrl = null;
        if (coverFile) {
          coverUrl = `https://music-streamer.jacetbaum.workers.dev/?id=${coverFile.id}`;
        } else if (songs.length > 0 && songs[0].thumbnailLink) {
          // Use the internal Google thumbnail for the MP3 (often contains the art!)
          coverUrl = songs[0].thumbnailLink.replace('=s220', '=s1000'); 
        }

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
    }
    res.status(200).json(allAlbums);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}
