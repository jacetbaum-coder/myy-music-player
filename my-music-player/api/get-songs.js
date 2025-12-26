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
    const response = await drive.files.list({
      q: `'${process.env.GCP_FOLDER_ID}' in parents and trashed = false`,
      fields: 'files(id, name, webContentLink)',
    });
    res.status(200).json(response.data.files);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
}