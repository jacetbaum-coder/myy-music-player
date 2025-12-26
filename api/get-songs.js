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
    // 1. Get Artist Folders (Daniel Caesar, Frank Ocean, Joni Mitchell, etc.)
    const artists = await drive.files.list({
      q: `'${process.env.GCP_FOLDER_ID}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
      fields: 'files(id, name)',
    });

    const allAlbums = [];

    for (const artist of artists.data.files) {
      // 2. Get Album Folders inside each Artist folder
      const albums = await drive.files.list({
        q: `'${artist.id}' in parents and mimeType = 'application/vnd.google-apps.folder' and trashed = false`,
        fields: 'files(id, name)',
      });

      for (const album of albums.data.files) {
        // 3. Get songs and covers inside the specific Album folder
        const content = await drive.files.list({
          q: `'${album.id}' in parents and trashed = false`,
          fields: 'files(id, name, webContentLink, mimeType, thumbnailLink)',
        });

        const songs = content.data.files.filter(f => f.mimeType.includes('audio'));
        
        // This looks for ANY file containing the word "cover" (cover1, cover 120, etc.)
        const coverFile = content.data.files.find(f => f.name.toLowerCase().includes('cover'));

        // Convert the tiny Google thumbnail into a high-quality 1000px image
        let highResCover = null;
        if (coverFile && coverFile.thumbnailLink) {
          highResCover = coverFile.thumbnailLink.replace(/=s220$/, '=s1000');
        } else if (songs[0] && songs[0].thumbnailLink) {
          // Fallback to the song's own metadata thumbnail if no cover file is found
          highResCover = songs[0].thumbnailLink.replace(/=s220$/, '=s1000');
        }

        allAlbums.push({
          artistName: artist.name,
          albumName: album.name,
          coverArt: highResCover,
          songs: songs.map(s => ({ 
            name: s.name, 
            link: s.webContentLink 
          }))
        });
      }
    }

    // Sort albums alphabetically by artist name for a cleaner look
    allAlbums.sort((a, b) => a.artistName.localeCompare(b.artistName));

    res.status(200).json(allAlbums);
  } catch (error) {
    console.error("API Error:", error.message);
    res.status(500).json({ error: error.message });
  }
}
