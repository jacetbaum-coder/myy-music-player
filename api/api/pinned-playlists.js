import { kv } from '@vercel/kv';

const PINNED_KEY = 'pinned-playlists';
const MAX_PINNED = 4;

function normalizePinnedNames(names) {
  const unique = [];
  if (Array.isArray(names)) {
    names.forEach((name) => {
      const trimmed = String(name || '').trim();
      if (trimmed && !unique.includes(trimmed)) {
        unique.push(trimmed);
      }
    });
  }
  return unique.slice(0, MAX_PINNED);
}

export default async function handler(req, res) {
  if (req.method === 'POST') {
    const { names } = req.body || {};
    const normalized = normalizePinnedNames(names);
    await kv.set(PINNED_KEY, normalized);
    return res.status(200).json({ success: true, names: normalized });
  }

  if (req.method === 'GET') {
    const stored = await kv.get(PINNED_KEY);
    const normalized = normalizePinnedNames(stored);
    return res.status(200).json({ names: normalized });
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
