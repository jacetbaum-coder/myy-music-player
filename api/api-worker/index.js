export default {
  async fetch(request, env) {
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, HEAD, POST, PUT, DELETE, OPTIONS",
      // ✅ Safari is picky — don’t use "*"
      "Access-Control-Allow-Headers": "Content-Type, Authorization, Range",
      "Access-Control-Max-Age": "86400",
    };


    const json = (obj, status = 200) =>
      new Response(JSON.stringify(obj), {
        status,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });

    const errJson = (status, message, extra = {}) =>
      json({ ok: false, error: message, ...extra }, status);

      if (request.method === "OPTIONS") {
        return new Response(null, { status: 204, headers: corsHeaders });
      }
  

    try {
      const url = new URL(request.url);

      // ✅ DEBUG: confirm you are hitting THIS deployed code
      
      if (url.pathname === "/api/ping") {
        return json({ ok: true, version: "PING-2026-01-13-A" });
      }
      // ✅ DEBUG: show first few keys visible to this Worker
      if (url.pathname === "/api/r2-sample") {
        const page = await env.MUSIC_BUCKET.list({ limit: 5 });
        const keys = (page.objects || []).map(o => o.key);
        return json({ ok: true, keys });
      }

      // ✅ DEBUG: list a few keys under a prefix
      // GET /api/r2-prefix?prefix=Adrianne%20Lenker/
      if (url.pathname === "/api/r2-prefix") {
        const prefix = String(url.searchParams.get("prefix") || "").trim();
        if (!prefix) return errJson(400, "Missing prefix");
        const page = await env.MUSIC_BUCKET.list({ prefix, limit: 50 });
        const keys = (page.objects || []).map(o => o.key);
        return json({ ok: true, prefix, count: keys.length, keys });
      }


      // ✅ DEBUG: check if a specific R2 key exists
      // GET /api/r2-exists?key=...
      if (url.pathname === "/api/r2-exists") {
        const rawKey = String(url.searchParams.get("key") || "").trim();
        if (!rawKey) return errJson(400, "Missing key");

        const candidates = [];
        const pushCand = (v) => {
          const s = String(v || "").trim();
          if (!s) return;
          if (!candidates.includes(s)) candidates.push(s);
        };

        pushCand(rawKey);
        pushCand("reson_library/" + rawKey);
        pushCand("music-files/" + rawKey);

        for (const k of candidates) {
          try {
            const head = await env.MUSIC_BUCKET.head(k);
            if (head) return json({ ok: true, exists: true, key: k, tried: candidates });
          } catch (e) {}
        }

        return json({ ok: true, exists: false, tried: candidates });
      }

      async function assertPlaylistOwner(playlistId, userId) {


        if (!playlistId || !userId) return true;
        const row = await env.DB.prepare(
          "SELECT playlist_id FROM playlists WHERE playlist_id = ? AND user_id = ?"
        ).bind(playlistId, userId).first();
        if (!row) throw new Error("Playlist not found for this user");
        return true;
      }

            // --- /api/artist-crop (D1, synced forever) ---
      // GET    /api/artist-crop?userId=...&artist=...
      // POST   /api/artist-crop   { userId, artist, x, y, zoom }
      // DELETE /api/artist-crop?userId=...&artist=...
      if (url.pathname === "/api/artist-crop") {
        // ensure table exists (safe to run repeatedly)
        try {
          await env.DB.prepare(
            "CREATE TABLE IF NOT EXISTS artist_crops (" +
              "user_id TEXT NOT NULL, " +
              "artist_slug TEXT NOT NULL, " +
              "x INTEGER NOT NULL, " +
              "y INTEGER NOT NULL, " +
              "zoom INTEGER NOT NULL, " +
              "updated_at INTEGER NOT NULL, " +
              "PRIMARY KEY (user_id, artist_slug)" +
            ")"
          ).run();
        } catch (e) {
          return errJson(500, "artist_crops table init failed: " + (e && e.message ? e.message : String(e)));
        }

        const slugify = (s) =>
          String(s || "")
            .trim()
            .toLowerCase()
            .replace(/&/g, "and")
            .replace(/[^a-z0-9]+/g, "-")
            .replace(/^-+|-+$/g, "")
            .slice(0, 120);

        if (request.method === "GET") {
          const userId = String(url.searchParams.get("userId") || "").trim();
          const artist = String(url.searchParams.get("artist") || "").trim();
          if (!userId) return errJson(400, "Missing userId");
          if (!artist) return errJson(400, "Missing artist");

          const artistSlug = slugify(artist);
          const row = await env.DB.prepare(
            "SELECT x, y, zoom, updated_at FROM artist_crops WHERE user_id = ? AND artist_slug = ?"
          ).bind(userId, artistSlug).first();

          return json({ ok: true, crop: row || null });
        }

        if (request.method === "POST" || request.method === "PUT") {
          const body = await request.json().catch(() => ({}));
          const userId = String(body.userId || "").trim();
          const artist = String(body.artist || "").trim();
          if (!userId) return errJson(400, "Missing userId");
          if (!artist) return errJson(400, "Missing artist");

          const x = Math.max(0, Math.min(100, parseInt(body.x, 10) || 50));
          const y = Math.max(0, Math.min(100, parseInt(body.y, 10) || 50));
          const zoom = Math.max(100, Math.min(200, parseInt(body.zoom, 10) || 100));

          const artistSlug = slugify(artist);
          const now = Date.now();

          await env.DB.prepare(
            "INSERT INTO artist_crops (user_id, artist_slug, x, y, zoom, updated_at) VALUES (?, ?, ?, ?, ?, ?) " +
            "ON CONFLICT(user_id, artist_slug) DO UPDATE SET x=excluded.x, y=excluded.y, zoom=excluded.zoom, updated_at=excluded.updated_at"
          ).bind(userId, artistSlug, x, y, zoom, now).run();

          return json({ ok: true, crop: { x, y, zoom, updated_at: now } });
        }

        if (request.method === "DELETE") {
          const userId = String(url.searchParams.get("userId") || "").trim();
          const artist = String(url.searchParams.get("artist") || "").trim();
          if (!userId) return errJson(400, "Missing userId");
          if (!artist) return errJson(400, "Missing artist");

          const artistSlug = slugify(artist);

          await env.DB.prepare(
            "DELETE FROM artist_crops WHERE user_id = ? AND artist_slug = ?"
          ).bind(userId, artistSlug).run();

          return json({ ok: true });
        }

        return errJson(405, "Method Not Allowed");
      }

      // --- /api/get-songs ---

            // --- /api/artist-image (Wikipedia -> save to R2 forever -> serve) ---
            if (url.pathname === "/api/artist-image") {
              const name = (url.searchParams.get("name") || "").trim();
              if (!name) return errJson(400, "Missing ?name=");
      
              // slug -> stable filename
              const slug = name
                .toLowerCase()
                .replace(/&/g, "and")
                .replace(/[^a-z0-9]+/g, "-")
                .replace(/^-+|-+$/g, "")
                .slice(0, 80) || "artist";
      
              const key = `artist-images/${slug}.jpg`;
      
              // 1) If already in R2, serve it
              const existing = await env.MUSIC_BUCKET.get(key);
              if (existing) {
                const headers = {
                  ...corsHeaders,
                  "Content-Type": existing.httpMetadata?.contentType || "image/jpeg",
                  "Cache-Control": "public, max-age=31536000, immutable",
                };
                return new Response(existing.body, { status: 200, headers });
              }
      
              // 2) Otherwise fetch an image from Wikipedia summary API
              let imageUrl = "";
              try {
                const wiki = await fetch(
                  "https://en.wikipedia.org/api/rest_v1/page/summary/" + encodeURIComponent(name),
                  { headers: { "User-Agent": "Reson/1.0 (artist image fetch)" } }
                );
                if (wiki.ok) {
                  const data = await wiki.json();
                  imageUrl =
                    (data?.thumbnail && data.thumbnail.source) ||
                    (data?.originalimage && data.originalimage.source) ||
                    "";
                }
              } catch (e) {}
      
              if (!imageUrl) return errJson(404, "No Wikipedia image found for artist", { name });
      
              // 3) Fetch the image bytes
              const imgResp = await fetch(imageUrl, {
                headers: {
                  // Wikimedia often blocks generic/bot-like requests without a UA + referer
                  "User-Agent": "Reson/1.0 (artist image fetch)",
                  "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                  "Referer": "https://en.wikipedia.org/",
                },
              });
      
              if (!imgResp.ok) return errJson(502, "Failed to fetch artist image", { imageUrl });
      
              const contentType = imgResp.headers.get("content-type") || "image/jpeg";
              const buf = await imgResp.arrayBuffer();
      
              // 4) Save to R2 forever
              await env.MUSIC_BUCKET.put(key, buf, {
                httpMetadata: { contentType },
              });
      
              // 5) Serve the saved bytes
              const headers = {
                ...corsHeaders,
                "Content-Type": contentType,
                "Cache-Control": "public, max-age=31536000, immutable",
              };
              return new Response(buf, { status: 200, headers });
            }
      
            if (url.pathname === "/api/get-songs") {

              // ✅ CACHE: avoid listing the entire R2 bucket on every load.
              // Normalize cache key (ignore ?t=... bust param)
              const cache = caches.default;
              const cacheUrl = new URL(request.url);
              cacheUrl.searchParams.delete("t");
              const cacheKey = new Request(cacheUrl.toString(), request);

              // Serve cached response if available
              const cached = await cache.match(cacheKey);
              if (cached) return cached;

              // OPTIONAL: precomputed tag album maps (generated offline + uploaded to R2)
              // - If missing, everything still works exactly like before.
              let tagAlbumByTrack = null; // key: "Artist/Album/Track.mp3" -> "Real Album Name"

              let tagAlbumByAlbum = null; // key: "Artist///Album"        -> "Real Album Name"
            
              try {
                const obj1 = await env.MUSIC_BUCKET.get("_meta/tagAlbumByTrack.json");
                if (obj1) tagAlbumByTrack = JSON.parse(await obj1.text());
              } catch (e) {}
            
              try {
                const obj2 = await env.MUSIC_BUCKET.get("_meta/tagAlbumByAlbum.json");
                if (obj2) tagAlbumByAlbum = JSON.parse(await obj2.text());
              } catch (e) {}
            
              const allKeys = [];
            
      
      
        let cursor = undefined;
        while (true) {
          const page = await env.MUSIC_BUCKET.list({ cursor, limit: 1000 });
          const objs = Array.isArray(page.objects) ? page.objects : [];
          for (const o of objs) { if (o && o.key) allKeys.push(String(o.key)); }
          cursor = page.cursor;
          if (!cursor) break;
        }

        const isAudio = (key) => {
          const k = String(key || "").toLowerCase();
          return k.endsWith(".mp3") || k.endsWith(".m4a") || k.endsWith(".wav") || k.endsWith(".flac") || k.endsWith(".ogg") || k.endsWith(".aac");
        };

        const byAlbum = new Map();
        for (const key of allKeys) {
          if (!isAudio(key)) continue;
          if (key.includes("/.DS_Store")) continue;

          const parts = key.split("/");
          if (parts.length < 3) continue;

          const artistName = parts[0];

          // folder album name (what's in the R2 path)
          const folderAlbumName = parts[1];

          // tag lookups are keyed by folder albumKey (Artist///Singles)
          const folderAlbumKey = `${artistName}///${folderAlbumName}`;

          // ✅ If this is a Singles folder, prefer the tag album name for grouping/display
          let albumName = folderAlbumName;
          if (String(folderAlbumName).trim().toLowerCase() === "singles") {
            albumName =
              (tagAlbumByTrack && tagAlbumByTrack[key]) ||
              (tagAlbumByAlbum && tagAlbumByAlbum[folderAlbumKey]) ||
              folderAlbumName;
          }

          const title = parts.slice(2).join("/").replace(/\.[^/.]+$/, "");
          const albumKey = `${artistName}///${albumName}`;


          if (!byAlbum.has(albumKey)) {
            // Auto-link the cover.jpg if it exists in this folder
                        // ✅ cover MUST use the folder album name (what exists in R2),
            // not the tag-renamed albumName used for display/grouping.
            const coverUrl = `${url.origin}/?id=${encodeURIComponent(
              artistName + "/" + folderAlbumName + "/cover.jpg"
            )}`;
            byAlbum.set(albumKey, { artistName, albumName, coverArt: coverUrl, songs: [] });

          }
          byAlbum.get(albumKey).songs.push({
            id: key, r2Path: key, title, artistName, albumName,
            tagAlbum: (tagAlbumByAlbum && tagAlbumByAlbum[albumKey]) ? String(tagAlbumByAlbum[albumKey]) : "",
            link: `${url.origin}/?id=${encodeURIComponent(key)}`,

          });

        }
        return json(Array.from(byAlbum.values()));
      }

            // --- /api/delete-album (R2) ---
      // DELETE /api/delete-album?artist=...&album=...
      if (url.pathname === "/api/delete-album" && request.method === "DELETE") {
        const artist = String(url.searchParams.get("artist") || "").trim();
        const album = String(url.searchParams.get("album") || "").trim();

        if (!artist) return errJson(400, "Missing artist");
        if (!album) return errJson(400, "Missing album");

        const prefix = `${artist}/${album}/`;

        // List all objects under the album folder
        const keys = [];
        let cursor = undefined;

        while (true) {
          const page = await env.MUSIC_BUCKET.list({ prefix, cursor, limit: 1000 });
          const objs = Array.isArray(page.objects) ? page.objects : [];
          for (const o of objs) {
            if (o && o.key) keys.push(String(o.key));
          }
          cursor = page.cursor;
          if (!cursor) break;
        }

        // Delete in chunks (Cloudflare supports bulk delete arrays)
        let deleted = 0;
        const chunkSize = 500;

        for (let i = 0; i < keys.length; i += chunkSize) {
          const chunk = keys.slice(i, i + chunkSize);
          if (chunk.length) {
            await env.MUSIC_BUCKET.delete(chunk);
            deleted += chunk.length;
          }
        }

        return json({ ok: true, prefix, deleted });
      }

            // --- /api/now-playing ---
      // GET  /api/now-playing?userId=...
      // POST /api/now-playing   { userId, trackId, contextType, contextId, positionSec }
      if (url.pathname === "/api/now-playing") {
        const userIdQ = url.searchParams.get("userId");

        if (request.method === "GET") {
          if (!userIdQ) return errJson(400, "Missing userId");

          const row = await env.DB.prepare(
            "SELECT user_id, track_id, context_type, context_id, position_sec, updated_at FROM now_playing WHERE user_id = ?"
          ).bind(userIdQ).first();

          if (!row) return json({ ok: true, data: null });

          const oneHour = 60 * 60 * 1000;
          if (!row.updated_at || (Date.now() - row.updated_at) > oneHour) {
            return json({ ok: true, data: null });
          }

          return json({ ok: true, data: row });
        }

        if (request.method === "POST") {
          const body = await request.json().catch(() => ({}));

          const userId = String(body.userId || "").trim();
          const trackId = String(body.trackId || "").trim();

          if (!userId) return errJson(400, "Missing userId");
          if (!trackId) return errJson(400, "Missing trackId");

          const contextType = body.contextType ? String(body.contextType) : null;
          const contextId = body.contextId ? String(body.contextId) : null;
          const positionSec = Number(body.positionSec || 0);

          await env.DB.prepare(`
            INSERT INTO now_playing (user_id, track_id, context_type, context_id, position_sec, updated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(user_id) DO UPDATE SET
              track_id=excluded.track_id,
              context_type=excluded.context_type,
              context_id=excluded.context_id,
              position_sec=excluded.position_sec,
              updated_at=excluded.updated_at
          `).bind(
            userId,
            trackId,
            contextType,
            contextId,
            positionSec,
            Date.now()
          ).run();

          return json({ ok: true });
        }
      }

      // --- /api/import-playlist ---
      // NOTE:
      // - If playlistId is provided: import INTO that playlist
      // - If playlistId is NOT provided: ALWAYS create a NEW playlist (duplicates allowed)
      if (url.pathname === "/api/import-playlist" && request.method === "POST") {
        const body = await request.json().catch(() => ({}));

        const userId = String(body.userId || "").trim();
        const name = String(body.name || "").trim();
        const trackIds = Array.isArray(body.trackIds) ? body.trackIds : [];

        let playlistId = String(body.playlistId || body.playlist_id || "").trim();

        if (!userId) return errJson(400, "Missing userId");
        if (!name) return errJson(400, "Missing name");

        if (!playlistId) {
          // always create new playlist to allow duplicates
          playlistId = crypto.randomUUID();
          await env.DB.prepare(
            "INSERT INTO playlists (playlist_id, user_id, name) VALUES (?, ?, ?)"
          ).bind(playlistId, userId, name).run();
        } else {
          // validate ownership if provided
          await assertPlaylistOwner(playlistId, userId);
        }

        const insertTrack = env.DB.prepare("INSERT OR IGNORE INTO tracks (track_id, r2_key) VALUES (?, ?)");
        const insertItem = env.DB.prepare(
          "INSERT OR IGNORE INTO playlist_items (playlist_id, track_id, position, title, artist, album, cover_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
        );

        const row = await env.DB.prepare(
          "SELECT COALESCE(MAX(position), -1) AS maxPos FROM playlist_items WHERE playlist_id = ?"
        ).bind(playlistId).first();

        let pos = (row?.maxPos ?? -1) + 1;
        let added = 0;

        for (const rawId of trackIds) {
          const trackId = String(rawId || "").trim();
          if (!trackId) continue;

          const parts = trackId.split("/");
          const artist = parts[0] || "Unknown Artist";
          const album = parts[1] || "Unknown Album";
          const title = (parts[parts.length - 1] || "Song").replace(/\.[^/.]+$/, "");
          const coverFolder = (String(folderAlbumName).trim().toLowerCase() === "singles") ? folderAlbumName : albumName;
          const coverUrl = `${url.origin}/?id=${encodeURIComponent(artistName + "/" + coverFolder + "/cover.jpg")}`;


          await insertTrack.bind(trackId, trackId).run();
          const res = await insertItem.bind(playlistId, trackId, pos, title, artist, album, coverUrl).run();
          if (res?.meta?.changes > 0) { added++; pos++; }
        }

        return json({ ok: true, playlistId, added });
      }

      // --- PLAYLISTS API ---
// plus: Recently Deleted (D1, synced across devices)

async function ensureRecentlyDeletedTable() {
  // safe to run repeatedly
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS recently_deleted (" +
      "user_id TEXT NOT NULL, " +
      "item_type TEXT NOT NULL, " +   // 'playlist' | 'album'
      "item_id TEXT NOT NULL, " +     // playlist_id OR albumKey
      "name TEXT, " +
      "payload TEXT, " +              // JSON string for future-proofing
      "deleted_at INTEGER NOT NULL, " +
      "expires_at INTEGER NOT NULL, " +
      "PRIMARY KEY (user_id, item_type, item_id)" +
    ")"
  ).run();

  // (Optional but helpful) index for expiry scans
  try {
    await env.DB.prepare("CREATE INDEX IF NOT EXISTS idx_recently_deleted_expires ON recently_deleted (expires_at)").run();
  } catch (e) {}
}

function thirtyDaysMs() {
  return 30 * 24 * 60 * 60 * 1000;
}

// --------------------
// Recently Deleted API
// --------------------
// GET    /api/recently-deleted?userId=...&type=playlist|album&q=...
// POST   /api/recently-deleted/restore  { userId, type, id }
// DELETE /api/recently-deleted/forever?userId=...&type=...&id=...
if (url.pathname === "/api/recently-deleted") {
  await ensureRecentlyDeletedTable();

  if (request.method === "GET") {
    const userId = String(url.searchParams.get("userId") || "").trim();
    const type = String(url.searchParams.get("type") || "").trim(); // optional
    const q = String(url.searchParams.get("q") || "").trim();

    if (!userId) return errJson(400, "Missing userId");

    const now = Date.now();

    // build query safely (no string concat in SQL except fixed parts)
    let sql =
      "SELECT item_type AS type, item_id AS id, name, payload, deleted_at AS deletedAt, expires_at AS expiresAt " +
      "FROM recently_deleted " +
      "WHERE user_id = ? AND expires_at > ? ";
    const binds = [userId, now];

    if (type) {
      sql += "AND item_type = ? ";
      binds.push(type);
    }
    if (q) {
      sql += "AND (name LIKE ? OR item_id LIKE ?) ";
      binds.push("%" + q + "%", "%" + q + "%");
    }

    sql += "ORDER BY deleted_at DESC LIMIT 200";

    const rows = await env.DB.prepare(sql).bind(...binds).all();
    const items = (rows?.results || []).map(r => {
      let payloadObj = null;
      try { payloadObj = r.payload ? JSON.parse(r.payload) : null; } catch (e) {}
      return {
        type: r.type,
        id: r.id,
        name: r.name || "",
        deletedAt: r.deletedAt,
        expiresAt: r.expiresAt,
        payload: payloadObj,
      };
    });

    return json({ ok: true, items });
  }

  return errJson(405, "Method Not Allowed");
}

if (url.pathname === "/api/recently-deleted/restore" && (request.method === "POST" || request.method === "PUT")) {
  await ensureRecentlyDeletedTable();

  const body = await request.json().catch(() => ({}));
  const userId = String(body.userId || "").trim();
  const type = String(body.type || "").trim();
  const id = String(body.id || "").trim();

  if (!userId) return errJson(400, "Missing userId");
  if (!type) return errJson(400, "Missing type");
  if (!id) return errJson(400, "Missing id");

  const now = Date.now();

  // only restore if not expired
  const row = await env.DB.prepare(
    "SELECT expires_at AS expiresAt FROM recently_deleted WHERE user_id = ? AND item_type = ? AND item_id = ?"
  ).bind(userId, type, id).first();

  if (!row) return errJson(404, "Not found in recently deleted");
  if (Number(row.expiresAt || 0) <= now) {
    // expired -> treat as gone
    await env.DB.prepare(
      "DELETE FROM recently_deleted WHERE user_id = ? AND item_type = ? AND item_id = ?"
    ).bind(userId, type, id).run();
    return errJson(410, "Expired");
  }

  await env.DB.prepare(
    "DELETE FROM recently_deleted WHERE user_id = ? AND item_type = ? AND item_id = ?"
  ).bind(userId, type, id).run();

  return json({ ok: true });
}

if (url.pathname === "/api/recently-deleted/forever" && request.method === "DELETE") {
  await ensureRecentlyDeletedTable();

  const userId = String(url.searchParams.get("userId") || "").trim();
  const type = String(url.searchParams.get("type") || "").trim();
  const id = String(url.searchParams.get("id") || "").trim();

  if (!userId) return errJson(400, "Missing userId");
  if (!type) return errJson(400, "Missing type");
  if (!id) return errJson(400, "Missing id");

  // If it's a playlist, hard delete playlist + items (songs remain in R2 because they are separate)
  if (type === "playlist") {
    await assertPlaylistOwner(id, userId);

    await env.DB.prepare("DELETE FROM playlist_items WHERE playlist_id = ?").bind(id).run();
    await env.DB.prepare("DELETE FROM playlists WHERE playlist_id = ?").bind(id).run();
  }

  // If it's an album, this endpoint just removes the "hidden" record.
  // (We will implement hiding in /api/get-songs later when the UI starts passing userId.)
  await env.DB.prepare(
    "DELETE FROM recently_deleted WHERE user_id = ? AND item_type = ? AND item_id = ?"
  ).bind(userId, type, id).run();

  return json({ ok: true });
}


// --------------------
// Playlists list/create/delete
// --------------------

// GET /api/playlists?userId=...
if (url.pathname === "/api/playlists" && request.method === "GET") {
  await ensureRecentlyDeletedTable();

  const userId = url.searchParams.get("userId");
  if (!userId) return errJson(400, "Missing userId");

  const now = Date.now();

  // Hide playlists that are in recently_deleted and not expired
  const rows = await env.DB.prepare(
    "SELECT p.playlist_id AS id, p.name AS name " +
    "FROM playlists p " +
    "WHERE p.user_id = ? " +
    "AND NOT EXISTS (" +
      "SELECT 1 FROM recently_deleted rd " +
      "WHERE rd.user_id = p.user_id " +
      "AND rd.item_type = 'playlist' " +
      "AND rd.item_id = p.playlist_id " +
      "AND rd.expires_at > ?" +
    ") " +
    "ORDER BY p.rowid DESC"
  ).bind(userId, now).all();

  return json({ ok: true, playlists: rows?.results || [] });
}

// POST /api/playlists  body: { userId, name }
if (url.pathname === "/api/playlists" && request.method === "POST") {
  const body = await request.json().catch(() => ({}));
  const userId = body.userId ?? body.id; // accept either
  const name = String(body.name || "").trim();

  if (!userId) return errJson(400, "Missing userId");
  if (!name) return errJson(400, "Missing name");

  const playlistId = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO playlists (playlist_id, user_id, name) VALUES (?, ?, ?)"
  ).bind(playlistId, String(userId), name).run();

  // If this playlist existed in recently_deleted for some reason, clear it
  try {
    await ensureRecentlyDeletedTable();
    await env.DB.prepare(
      "DELETE FROM recently_deleted WHERE user_id = ? AND item_type = 'playlist' AND item_id = ?"
    ).bind(String(userId), playlistId).run();
  } catch (e) {}

  return json({ ok: true, id: playlistId });
}

// DELETE /api/playlists?playlistId=...&userId=...
// ✅ SOFT DELETE: move to recently_deleted for 30 days (does NOT delete tracks/items)
if (url.pathname === "/api/playlists" && request.method === "DELETE") {
  await ensureRecentlyDeletedTable();

  const playlistId = String(url.searchParams.get("playlistId") || "").trim();
  const userId = String(url.searchParams.get("userId") || "").trim();

  if (!playlistId) return errJson(400, "Missing playlistId");
  if (!userId) return errJson(400, "Missing userId");

  await assertPlaylistOwner(playlistId, userId);

  // get playlist name for display
  const pl = await env.DB.prepare(
    "SELECT name FROM playlists WHERE playlist_id = ? AND user_id = ?"
  ).bind(playlistId, userId).first();

  if (!pl) return errJson(404, "Playlist not found for this user");

  const now = Date.now();
  const expiresAt = now + thirtyDaysMs();

  const payload = {
    playlistId,
    userId,
  };

  await env.DB.prepare(
    "INSERT INTO recently_deleted (user_id, item_type, item_id, name, payload, deleted_at, expires_at) " +
    "VALUES (?, 'playlist', ?, ?, ?, ?, ?) " +
    "ON CONFLICT(user_id, item_type, item_id) DO UPDATE SET " +
      "name=excluded.name, payload=excluded.payload, deleted_at=excluded.deleted_at, expires_at=excluded.expires_at"
  ).bind(
    userId,
    playlistId,
    String(pl.name || ""),
    JSON.stringify(payload),
    now,
    expiresAt
  ).run();

  return json({ ok: true, softDeleted: true, playlistId, expiresAt });
}


// GET /api/playlists?userId=...
if (url.pathname === "/api/playlists" && request.method === "GET") {
  const userId = url.searchParams.get("userId");
  if (!userId) return errJson(400, "Missing userId");

  const rows = await env.DB.prepare(
    "SELECT playlist_id AS id, name FROM playlists WHERE user_id = ? ORDER BY rowid DESC"
  ).bind(userId).all();

  return json({ ok: true, playlists: rows?.results || [] });
}

// POST /api/playlists  body: { userId, name }
if (url.pathname === "/api/playlists" && request.method === "POST") {
  const body = await request.json().catch(() => ({}));
  const userId = body.userId ?? body.id; // accept either
  const name = String(body.name || "").trim();

  if (!userId) return errJson(400, "Missing userId");
  if (!name) return errJson(400, "Missing name");

  const playlistId = crypto.randomUUID();

  await env.DB.prepare(
    "INSERT INTO playlists (playlist_id, user_id, name) VALUES (?, ?, ?)"
  ).bind(playlistId, String(userId), name).run();

  return json({ ok: true, id: playlistId });
}

// DELETE /api/playlists?playlistId=...&userId=...
if (url.pathname === "/api/playlists" && request.method === "DELETE") {
  const playlistId = url.searchParams.get("playlistId");
  const userId = url.searchParams.get("userId");

  if (!playlistId) return errJson(400, "Missing playlistId");
  if (userId) await assertPlaylistOwner(playlistId, userId);

  await env.DB.prepare("DELETE FROM playlist_items WHERE playlist_id = ?").bind(playlistId).run();
  await env.DB.prepare("DELETE FROM playlists WHERE playlist_id = ?").bind(playlistId).run();

  return json({ ok: true });
}

// GET /api/playlist-items?playlistId=...
if (url.pathname === "/api/playlist-items" && request.method === "GET") {
  const playlistId = url.searchParams.get("playlistId");
  if (!playlistId) return errJson(400, "Missing playlistId");

  const rows = await env.DB.prepare(
    "SELECT track_id AS trackId, position, title, artist, album, cover_url AS coverUrl FROM playlist_items WHERE playlist_id = ? ORDER BY position ASC"
  ).bind(playlistId).all();

  return json({ ok: true, items: rows?.results || [] });
}

// POST /api/playlist-items  body: { playlistId, trackId }
if (url.pathname === "/api/playlist-items" && request.method === "POST") {
  const body = await request.json().catch(() => ({}));
  const playlistId = body.playlistId;
  const trackId = body.trackId;

  if (!playlistId) return errJson(400, "Missing playlistId");
  if (!trackId) return errJson(400, "Missing trackId");

  const parts = String(trackId).split("/");
  const artist = parts[0] || "Unknown Artist";
  const album = parts[1] || "Unknown Album";
  const title = (parts[parts.length - 1] || "Song").replace(/\.[^/.]+$/, "");
  const coverUrl = `${url.origin}/?id=${encodeURIComponent(artist + "/" + album + "/cover.jpg")}`;

  const row = await env.DB.prepare(
    "SELECT COALESCE(MAX(position), -1) AS maxPos FROM playlist_items WHERE playlist_id = ?"
  ).bind(playlistId).first();

  const nextPos = (row?.maxPos ?? -1) + 1;

  // keep tracks table in sync
  await env.DB.prepare("INSERT OR IGNORE INTO tracks (track_id, r2_key) VALUES (?, ?)")
    .bind(trackId, trackId).run();

  await env.DB.prepare(
    "INSERT OR IGNORE INTO playlist_items (playlist_id, track_id, position, title, artist, album, cover_url) VALUES (?, ?, ?, ?, ?, ?, ?)"
  ).bind(playlistId, trackId, nextPos, title, artist, album, coverUrl).run();

  return json({ ok: true });
}

// DELETE /api/playlist-items?playlistId=...&trackId=...
if (url.pathname === "/api/playlist-items" && request.method === "DELETE") {
  const playlistId = url.searchParams.get("playlistId");
  const trackId = url.searchParams.get("trackId");

  if (!playlistId) return errJson(400, "Missing playlistId");
  if (!trackId) return errJson(400, "Missing trackId");

  await env.DB.prepare(
    "DELETE FROM playlist_items WHERE playlist_id = ? AND track_id = ?"
  ).bind(playlistId, trackId).run();

  return json({ ok: true });
}

// -----------------------
// CRATE (notes-like) (D1 via Worker)
// -----------------------
if (url.pathname === "/api/crate") {
  // Ensure table exists (safe to run repeatedly)
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS crates (user_id TEXT PRIMARY KEY, doc TEXT NOT NULL, updated_at INTEGER NOT NULL)"
    ).run();
  } catch (e) {
    return errJson(500, "Crate table init failed: " + (e && e.message ? e.message : String(e)));
  }

  // GET /api/crate?userId=...
  if (request.method === "GET") {
    const uid = (url.searchParams.get("userId") || "").trim();
    if (!uid) return errJson(400, "Missing userId");

    const row = await env.DB.prepare(
      "SELECT doc, updated_at FROM crates WHERE user_id = ?"
    ).bind(uid).first();

    if (!row) return json({ ok: true, doc: null });

    let parsed = null;
    try { parsed = JSON.parse(row.doc); } catch (e) { parsed = null; }

    return json({ ok: true, doc: parsed });
  }

  // PUT/POST /api/crate  body: { userId, doc }
  if (request.method === "PUT" || request.method === "POST") {
    let body = null;
    try { body = await request.json(); } catch (e) { body = null; }

    const uid = (body && body.userId ? String(body.userId) : "").trim();
    if (!uid) return errJson(400, "Missing userId");

    const doc = (body && body.doc && typeof body.doc === "object") ? body.doc : null;
    if (!doc) return errJson(400, "Missing doc");

    // Ensure updatedAt exists
    const now = Date.now();
    const updatedAt = Number(doc.updatedAt || now) || now;
    doc.updatedAt = updatedAt;

    const docJson = JSON.stringify(doc);

    await env.DB.prepare(
      "INSERT INTO crates (user_id, doc, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at"
    ).bind(uid, docJson, updatedAt).run();

    return json({ ok: true });
  }

  return errJson(405, "Method Not Allowed");
}

// -----------------------
// HISTORY LOG (Recents) (D1 via Worker)
// -----------------------
// GET  /api/history-log?id=...        (supports id OR userId)
// GET  /api/history-log?userId=...
// POST /api/history-log  { id|userId, history:[...] }
if (url.pathname === "/api/history-log") {
  // Ensure table exists (safe to run repeatedly)
  try {
    await env.DB.prepare(
      "CREATE TABLE IF NOT EXISTS history_logs (" +
        "user_id TEXT PRIMARY KEY, " +
        "doc TEXT NOT NULL, " +
        "updated_at INTEGER NOT NULL" +
      ")"
    ).run();
  } catch (e) {
    return errJson(500, "History table init failed: " + (e && e.message ? e.message : String(e)));
  }

  // GET
  if (request.method === "GET") {
    const uid =
      String(url.searchParams.get("userId") || "").trim() ||
      String(url.searchParams.get("id") || "").trim();

    if (!uid) return errJson(400, "Missing userId");

    const row = await env.DB.prepare(
      "SELECT doc, updated_at FROM history_logs WHERE user_id = ?"
    ).bind(uid).first();

    if (!row) return json({ ok: true, history: [] });

    let parsed = [];
    try { parsed = JSON.parse(row.doc); } catch (e) { parsed = []; }
    if (!Array.isArray(parsed)) parsed = [];

    return json({ ok: true, history: parsed });
  }

  // POST / PUT
  if (request.method === "POST" || request.method === "PUT") {
    const body = await request.json().catch(() => ({}));

    const uid = String(body.userId || body.id || "").trim();
    if (!uid) return errJson(400, "Missing userId");

    let history = Array.isArray(body.history) ? body.history : [];
    history = history.slice(0, 16);

    const now = Date.now();
    const docJson = JSON.stringify(history);

    await env.DB.prepare(
      "INSERT INTO history_logs (user_id, doc, updated_at) VALUES (?, ?, ?) " +
      "ON CONFLICT(user_id) DO UPDATE SET doc = excluded.doc, updated_at = excluded.updated_at"
    ).bind(uid, docJson, now).run();

    return json({ ok: true });
  }

  return errJson(405, "Method Not Allowed");
}


// STREAMING LOGIC (Must stay at the bottom)

const rawId = url.searchParams.get("id");
if (!rawId) return errJson(400, "No ID provided");

// ✅ Cover images should be aggressively cached (they never change unless you re-upload)
const isCoverRequest = /\/cover\.jpg$/i.test(String(rawId || ""));
if (isCoverRequest) {
  const cache = caches.default;
  const cachedCover = await cache.match(request);
  if (cachedCover) return cachedCover;
}


// ✅ Parse Range header into the format R2 expects (R2 needs {offset,length} not "bytes=...")
function parseRangeHeader(rangeHeader) {
  const h = String(rangeHeader || "").trim();
  if (!h) return null;

  const m = /^bytes=(\d*)-(\d*)$/i.exec(h);
  if (!m) return null;

  const startStr = m[1];
  const endStr = m[2];

  const start = startStr === "" ? null : Number(startStr);
  const end = endStr === "" ? null : Number(endStr);

  if (start !== null && (!Number.isFinite(start) || start < 0)) return null;
  if (end !== null && (!Number.isFinite(end) || end < 0)) return null;

  // bytes=0-1023
  if (start !== null && end !== null && end >= start) {
    return { offset: start, length: (end - start + 1) };
  }

  // bytes=123-
  if (start !== null && end === null) {
    return { offset: start };
  }

  // bytes=-500 (suffix) not handled
  return null;
}

const rangeObj = parseRangeHeader(request.headers.get("Range") || "");

// Build candidate keys
const candidates = [];
const pushCand = (v) => {
  const s = String(v || "").trim();
  if (!s) return;
  if (!candidates.includes(s)) candidates.push(s);
};

pushCand(rawId);
pushCand(String(rawId).replace(/\+/g, " "));
try { pushCand(decodeURIComponent(rawId)); } catch (e) {}

// ✅ Compatibility fallback: Artist/Album/Title.mp3 -> Artist/Title.mp3
// IMPORTANT: Do NOT apply this fallback to album cover requests.
// Otherwise Artist/Album/cover.jpg falls back to Artist/cover.jpg,
// making every album by the same artist look identical.
try {
  const extra = [];

  const isAlbumCoverRequest = candidates.some((k) => {
    const s = String(k || "");
    return /\/[^\/]+\/cover\.jpg$/i.test(s);
  });

  if (!isAlbumCoverRequest) {
    for (const k of candidates.slice()) {
      const parts = String(k).split("/");
      if (parts.length >= 3) {
        extra.push(parts[0] + "/" + parts.slice(2).join("/"));
      }
    }
    for (const k of extra) pushCand(k);
  }
} catch (e) {}


let object = null;
let foundKey = "";

for (const k of candidates) {
  try {
    object = await env.MUSIC_BUCKET.get(k, rangeObj ? { range: rangeObj } : undefined);
    if (object) { foundKey = k; break; }
  } catch (e) {}
}

if (!object) {
  return errJson(404, "Not Found", { tried: candidates });
}

const headers = new Headers(corsHeaders);
object.writeHttpMetadata(headers);

// ✅ Strong caching for images (album covers / artist jpgs)
// This makes re-renders instant because the browser can reuse cached bytes.
try {
  const lowerKey = String(foundKey || "").toLowerCase();
  const isImage =
    lowerKey.endsWith(".jpg") ||
    lowerKey.endsWith(".jpeg") ||
    lowerKey.endsWith(".png") ||
    lowerKey.endsWith(".webp") ||
    lowerKey.endsWith(".gif") ||
    lowerKey.endsWith(".avif");

  if (isImage) {
    headers.set("Cache-Control", "public, max-age=31536000, immutable");
  }
} catch (e) {}

// Ensure Content-Type is present

if (!headers.get("Content-Type")) {
  const lower = foundKey.toLowerCase();
  if (lower.endsWith(".mp3")) headers.set("Content-Type", "audio/mpeg");
  else if (lower.endsWith(".m4a")) headers.set("Content-Type", "audio/mp4");
  else if (lower.endsWith(".aac")) headers.set("Content-Type", "audio/aac");
  else if (lower.endsWith(".ogg")) headers.set("Content-Type", "audio/ogg");
  else if (lower.endsWith(".wav")) headers.set("Content-Type", "audio/wav");
}

// ✅ Covers: cache basically forever (browser + edge)
if (/\/cover\.jpg$/i.test(foundKey)) {
  headers.set("Cache-Control", "public, max-age=31536000, immutable");
  // If Cloudflare tries to infer caching, this helps it stick
  headers.set("Vary", "Accept-Encoding");

  // Save to edge cache (only safe for non-range, non-personalized responses)
  try {
    const cache = caches.default;
    const resp = new Response(object.body, { status: 200, headers });
    cache.put(request, resp.clone());
    return resp;
  } catch (e) {
    // fall through to normal response
  }
}

// Some environments return 206 without populating object.range reliably, but media
// elements (especially iOS Safari) still need Content-Range + Accept-Ranges.
if (rangeObj) {
  headers.set("Accept-Ranges", "bytes");

  const total = Number(object.size || 0) || 0;
  const start = Number(rangeObj.offset || 0) || 0;

  let end = start;
  if (typeof rangeObj.length === "number" && rangeObj.length > 0) {
    end = start + rangeObj.length - 1;
  } else if (total > 0) {
    end = total - 1;
  }

  if (total > 0 && end >= total) end = total - 1;

  const length = (end >= start) ? (end - start + 1) : 0;

  headers.set(
    "Content-Range",
    `bytes ${start}-${end}/${total > 0 ? total : "*"}`
  );

  if (length > 0) headers.set("Content-Length", String(length));

  return new Response(object.body, { status: 206, headers });
}


return new Response(object.body, { status: 200, headers });
    } catch (e) {
      return errJson(500, e.message);
    }
  },
};
