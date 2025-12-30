import { kv } from "@vercel/kv";

function safeKey(s) {
  return String(s || "").trim();
}

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  try {
    const body = req.body || {};
    const artistName = safeKey(body.artistName);
    const albumName = safeKey(body.albumName);
    const cover = safeKey(body.cover);

    if (!artistName || !albumName) {
      return res.status(400).json({ error: "artistName and albumName are required" });
    }

    const key = `${artistName} — ${albumName}`;
    const overrides = (await kv.get("albumCoverOverrides")) || {};
    const cleanOverrides = (overrides && typeof overrides === "object") ? overrides : {};

    if (!cover) {
      delete cleanOverrides[key];
    } else {
      cleanOverrides[key] = cover;
    }

    const ts = Date.now();
    await kv.set("albumCoverOverrides", cleanOverrides);
    await kv.set("albumCoverOverridesUpdatedAt", ts);

    return res.status(200).json({ ok: true, updatedAt: ts });
  } catch (e) {
    return res.status(500).json({ error: "Failed to save cover" });
  }
}
