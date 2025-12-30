import { kv } from "@vercel/kv";

export default async function handler(req, res) {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET,OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "GET") return res.status(405).json({ error: "Method not allowed" });

  try {
    const overrides = (await kv.get("albumCoverOverrides")) || {};
    const updatedAt = (await kv.get("albumCoverOverridesUpdatedAt")) || 0;

    return res.status(200).json({
      updatedAt: Number(updatedAt) || 0,
      overrides: (overrides && typeof overrides === "object") ? overrides : {}
    });
  } catch (e) {
    return res.status(500).json({ error: "Failed to load covers" });
  }
}
