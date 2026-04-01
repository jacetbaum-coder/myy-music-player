/* ==========================================================
   PLAYLISTS FEATURE
   - Playlist CRUD (create, read, update, delete)
   - Cloud sync (D1 via Cloudflare Worker)
   - Pinned playlists
   - Add track to playlist submenu
   - Playlist menus / context menus
   - Playlist covers & hydration
   - renderPlaylists (sidebar + submenu)
   ========================================================== */


window.cloudPlaylists = [];

// Convert DB playlist row -> UI playlist object
function cloudRowToUiPlaylist(row) {
  const id = row.playlist_id || row.id || "";
  return {
    id,
    name: row.name || "Playlist",
    // keep cover fields (your renderers may read either)
    cover: row.cover_url || row.cover || "",
    coverUrl: row.cover_url || row.cover || "",
    // local fields your UI expects
    songs: Array.isArray(row.songs) ? row.songs : [],
    songCount: typeof row.songCount === "number" ? row.songCount : (typeof row.song_count === "number" ? row.song_count : undefined),
  };
}

// ✅ Load playlists list (meta) from Cloudflare for the current user
window.loadPlaylistsFromCloud = async function () {
  const uid = window.APP_USER_ID || localStorage.getItem("app_user_id");
  if (!uid) return [];

  const res = await fetch(
    "https://music-streamer.jacetbaum.workers.dev/api/playlists?userId=" + encodeURIComponent(uid)
  );

  const data = await res.json().catch(() => ({}));

if (res.ok && data && data.ok && Array.isArray(data.playlists)) {
  window.cloudPlaylists = data.playlists;
console.log("☁️ cloud playlists loaded:", (window.cloudPlaylists || []).length);
try { if (typeof window.hydrateCloudPlaylistCovers === "function") window.hydrateCloudPlaylistCovers(1); } catch (e) {}

// ✅ Hide/show the main player dock when it's empty (startup + audio events)
try {
  if (typeof updateMainDockVisibility === "function") updateMainDockVisibility();

  if (window.player && !window.__MAIN_DOCK_EVENTS__) {
    window.__MAIN_DOCK_EVENTS__ = true;

    ["play", "pause", "loadedmetadata", "emptied", "ended"].forEach(evt => {
      try { window.player.addEventListener(evt, updateMainDockVisibility); } catch (e) {}
    });
  }
} catch (e) {}



  // ✅ IMPORTANT: merge cloud playlists into the actual UI `playlists` array (do NOT wipe local-only playlists)
  try {
    const uid2 = window.APP_USER_ID || localStorage.getItem("app_user_id") || "";
    const uid = String(uid2 || "").trim();

    // 1) Convert cloud rows to UI objects
    const cloudUi = data.playlists
      .map(cloudRowToUiPlaylist)
      .filter(pl => pl && pl.id);

    const localArr = Array.isArray(playlists) ? playlists : [];
    const byId = new Map(localArr.map(p => [p.id, p]));

    // 2) Merge: cloud wins for name/cover/count, but keep local songs/trackIds if cloud doesn't have them
    for (const c of cloudUi) {
      const existing = byId.get(c.id);
      if (existing) {
        byId.set(c.id, {
          ...existing,
          ...c,
          songs: Array.isArray(existing.songs) && (!Array.isArray(c.songs) || c.songs.length === 0) ? existing.songs : c.songs,
          trackIds: Array.isArray(existing.trackIds) && (!Array.isArray(c.trackIds) || c.trackIds.length === 0) ? existing.trackIds : c.trackIds,
        });
      } else {
        byId.set(c.id, c);
      }
    }

    // 3) ✅ Ask cloud which playlists are recently deleted, and filter them out locally
    let deletedPlaylistIds = new Set();
    try {
      if (uid) {
        const rd = await fetch(
          "https://music-streamer.jacetbaum.workers.dev/api/recently-deleted?userId=" +
            encodeURIComponent(uid) + "&type=playlist"
        ).then(r => r.json()).catch(() => null);

        if (rd && rd.ok && Array.isArray(rd.items)) {
          deletedPlaylistIds = new Set(
            rd.items
              .map(x => String(x?.id || "").trim())
              .filter(Boolean)
          );
        }
      }
    } catch (e) {}

    // Keep local-only playlists EXCEPT ones that are in recently deleted
    playlists = Array.from(byId.values()).filter(p => {
      const id = String(p?.id || "").trim();
      if (!id) return false;
      return !deletedPlaylistIds.has(id);
    });

  // ✅ Expose merged playlists on window for other helpers (covers/hydration)
  try { window.playlists = playlists; } catch (e) {}

  // Persist locally so refresh works even if offline
  try { localStorage.setItem("playlists", JSON.stringify(playlists)); } catch (e) {}


    // ✅ Background-hydrate trackIds so playlist covers (1-cover / 2x2) can render without opening each playlist
    try {
      if (typeof window.hydratePlaylistTrackIdsInBackground === "function") {
        window.hydratePlaylistTrackIdsInBackground({ max: 12, concurrency: 3 });
      }
    } catch (e) {}

  } catch (e) {
    console.warn("Failed to merge cloud playlists:", e);
  }

  return data.playlists;
}

// fallback
window.cloudPlaylists = [];
return [];
};


// -----------------------
// AUTO CLOUD PULL (background sync)
// -----------------------
window.__cloudPlaylistSig = "";
window.__cloudPlaylistSyncTimer = null;

function computeCloudPlaylistSig(rows) {
  try {
    const arr = Array.isArray(rows) ? rows : [];
    // Only include fields that change when playlists change
    const slim = arr.map(r => ({
      id: r.playlist_id || r.id || "",
      name: r.name || "",
      cover: r.cover_url || r.cover || "",
      // count fields (your API may return one or the other)
      song_count: (typeof r.song_count === "number") ? r.song_count : (typeof r.songCount === "number" ? r.songCount : null),
      updated_at: r.updated_at || r.updatedAt || ""
    }));
    return JSON.stringify(slim);
  } catch (e) {
    return "";
  }
}

window.forceCloudPlaylistPull = async function () {
  try {
    const before = window.__cloudPlaylistSig || "";
    const rows = await window.loadPlaylistsFromCloud();
    const next = computeCloudPlaylistSig(rows);
    if (next && next !== before) {
      window.__cloudPlaylistSig = next;
      try { renderPlaylists(); } catch (e) {}
      // If home shows playlists, refresh it too
      try { if (typeof renderHome === "function") renderHome(); } catch (e) {}
      // History can include playlists; refresh to remove deleted ones
      try { if (typeof renderHistory === "function") renderHistory(); } catch (e) {}
    }
  } catch (e) {
    // silent: background sync should never crash the app
  }
};

window.startCloudPlaylistSync = function () {
  // Guard: only start once
  if (window.__cloudPlaylistSyncTimer) return;

  // Pull immediately once
  try { window.forceCloudPlaylistPull(); } catch (e) {}

  // Pull every 12 seconds
  window.__cloudPlaylistSyncTimer = setInterval(() => {
    try { window.forceCloudPlaylistPull(); } catch (e) {}
  }, 12000);

  // Also pull when the tab becomes active again
  window.addEventListener("focus", () => {
    try { window.forceCloudPlaylistPull(); } catch (e) {}
  });

  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) {
      try { window.forceCloudPlaylistPull(); } catch (e) {}
    }
  });
};

// ✅ start the background sync as soon as this section loads
try { window.startCloudPlaylistSync(); } catch (e) {}

// ✅ Load playlist items (tracks) from Cloudflare for a specific playlist

// ✅ Resolve playlist trackIds into master-library track objects (tracksById).
// If a track isn't in the library yet, return a playable fallback object.
window.resolveTrackIdsToSongs = function (trackIds) {
  const idsRaw = Array.isArray(trackIds) ? trackIds : [];

  // ✅ If we can, expand short ids using the library (unique title match).
  // Example: "Artist/Title.mp3" -> "Artist/Album/Title.mp3"
  let ids = idsRaw;
  try {
    if (typeof window.expandPlaylistShortIdsFromLibrary === "function") {
      ids = window.expandPlaylistShortIdsFromLibrary(idsRaw);
    }
  } catch (e) {}

  const out = [];

  const r2Base = "https://music-streamer.jacetbaum.workers.dev/?id=";

    for (const id of ids) {
    let key = String(id || "").trim();
    if (!key) continue;

    // ✅ If the id is a full URL, extract ?id=... first
    try {
      if (key.includes("://")) {
        const u = new URL(key);
        const qp = u.searchParams.get("id");
        if (qp) key = qp;
      }
    } catch (e) {}

    // ✅ Handle "...?id=..." even if it's not a full URL object parse
    if (key.includes("?id=")) {
      try { key = key.split("?id=")[1].split("&")[0]; } catch (e) {}
    }

    try { key = decodeURIComponent(key); } catch (e) {}
    key = key.replace(/^\/+/, "").trim();
    if (!key) continue;

    // ✅ CRITICAL FIX:
    // If we only have "Artist/File.ext", treat it as "Artist/Singles/File.ext"
    const parts0 = key.split("/").filter(Boolean);
    if (parts0.length === 2) {
      key = `${parts0[0]}/Singles/${parts0[1]}`;
    }


    const found =
      (window.tracksById && typeof window.tracksById.get === "function")
        ? (window.tracksById.get(key) || null)
        : null;

    // ✅ Best case: we have the real track from the library
    if (found) {
      out.push(found);
      continue;
    }

    // ✅ Fallback: derive title/artist/album/cover from the trackId path
    const parts = key.split("/").filter(Boolean);
    const file = parts.length ? parts[parts.length - 1] : key;

    const titleOnly = String(file).replace(/\.[^/.]+$/, ""); // remove .mp3/.m4a/etc

    const artistName = parts.length >= 2 ? parts[0] : "";

// ✅ If it's 2-part ("Artist/Track.mp3"), treat as Singles
const albumName  = parts.length >= 3 ? parts[1] : (artistName ? "Singles" : "");

// ✅ Build cover for both "Artist/Album/..." AND "Artist/Track.mp3" (Singles)
const coverUrl =
  (artistName && albumName)
    ? (r2Base + encodeURIComponent(`${artistName}/${albumName}/cover.jpg`))
    : "";

// ✅ If it's 2-part audio, also normalize the audio path to Artist/Singles/Track.mp3
let audioKey = key;
try {
  if (artistName && parts.length === 2 && /\.(mp3|m4a|flac|wav|aac|ogg)$/i.test(file)) {
    audioKey = `${artistName}/Singles/${parts[1]}`;
  }
} catch (e) {}

const audioUrl = r2Base + encodeURIComponent(audioKey);


    out.push({
      id: key,
      r2Path: key,
      key: key,

      // ✅ what the UI should show
      title: titleOnly,
      name: titleOnly,
      artist: artistName,
      album: albumName,
      artistName: artistName,
      albumName: albumName,

      // ✅ what the UI should use for thumbs
      cover: coverUrl,
      coverArt: coverUrl,

      // ✅ playback
      url: audioUrl,
      link: audioUrl,
    });
  }

  return out;
};

window.loadPlaylistItemsFromCloud = async function (playlistId) {
  if (!playlistId) return [];

  const res = await fetch(
    "https://music-streamer.jacetbaum.workers.dev/api/playlist-items?playlistId=" + encodeURIComponent(playlistId)
  );

  const data = await res.json().catch(() => ({}));

  if (res.ok && data && data.ok && Array.isArray(data.items)) {
    // Accept either:
    // - ["Artist/Album/Song.mp3", ...]
    // - [{ track_id:"Artist/Album/Song.mp3" }, ...]
    // - [{ r2_key:"Artist/Album/Song.mp3" }, ...]
    // - [{ key:"Artist/Album/Song.mp3" }, ...]
    return data.items
      .map((it) => {
        if (typeof it === "string") return it;
        if (!it) return "";
        return (it.r2_key || it.track_id || it.trackId || it.key || it.id || "");
      })
      .map((x) => String(x).trim())
      .filter(Boolean);
  }

  return [];
};

// -----------------------
// -----------------------
// PLAYLIST COVER HYDRATION (safe, read-only)
// Purpose: cloud playlists list only has {id,name}, so covers are blank.
// We prefetch trackIds for a few playlists in the background so getPlaylistCoverMarkup() can build covers.
// -----------------------

window.__cloudPlaylistHydrateOnce = window.__cloudPlaylistHydrateOnce || new Set();

window.hydrateCloudPlaylistCovers = async function (limit = 1) {
  try {
    const cloud = Array.isArray(window.cloudPlaylists) ? window.cloudPlaylists : [];
    if (!cloud.length) return;

    // Only hydrate first `limit` playlists (safe rollout)
    const slice = cloud.slice(0, Math.max(0, Number(limit) || 0));

    for (const row of slice) {
      const id = row && row.id;
      if (!id) continue;
      if (window.__cloudPlaylistHydrateOnce.has(id)) continue;
      window.__cloudPlaylistHydrateOnce.add(id);

      let items = [];
      try { items = await window.loadPlaylistItemsFromCloud(id); } catch (e) {}

      let ids = (Array.isArray(items) ? items : [])
        .map(x => (typeof x === "string" ? x : (x && (x.track_id || x.r2_key || x.id))))
        .filter(Boolean);

      // Expand short ids like "Artist/Title.mp3" -> "Artist/Album/Title.ext"
      try {
        if (typeof window.expandPlaylistShortIdsFromLibrary === "function") {
          ids = window.expandPlaylistShortIdsFromLibrary(ids) || ids;
        }
      } catch (e) {}

      // Write into the UI playlist object if present
      try {
        const ui = (window.playlists || []).find(p => p && p.id === id);
        if (ui) {
          ui.trackIds = ids;
          ui.songCount = Array.isArray(ids) ? ids.length : 0;
          // If you already have this function, it will compute autoCover
          if (typeof window.updatePlaylistAutoCoverById === "function") {
            await window.updatePlaylistAutoCoverById(id);
          }
        }
      } catch (e) {}

      console.log("🧪 hydrated playlist", id, "trackIds:", (ids || []).length, "first:", ids[0]);
    }

    try { if (typeof window.renderPlaylists === "function") window.renderPlaylists(); } catch (e) {}
  } catch (e) {}
};


// ✅ Expand playlist short IDs ("Artist/Title.mp3") into full canonical IDs ("Artist/Album/Title.ext")
// Uses libraryData songs' .title (extension-insensitive). Only expands when UNIQUE.
window.expandPlaylistShortIdsFromLibrary = function expandPlaylistShortIdsFromLibrary(trackIds) {
  const ids = Array.isArray(trackIds) ? trackIds.slice() : [];

  const lib = window.libraryData || window.library_data || window.__libraryData || null;
  const albums = Array.isArray(lib) ? lib : (lib && Array.isArray(lib.albums) ? lib.albums : null);
  if (!albums) return ids;

  const canonTrackId = (v) => {
    let s = String(v || "").trim();
    if (!s) return "";
    try {
      if (s.includes("://")) {
        const u = new URL(s);
        const id = u.searchParams.get("id");
        if (id) s = id;
      }
    } catch {}
    if (s.includes("?id=")) {
      try { s = s.split("?id=")[1].split("&")[0]; } catch {}
    }
    try { s = decodeURIComponent(s); } catch {}
    return s.replace(/^\/+/, "").trim();
  };

  const norm = (t) => String(t || "")
    .toLowerCase()
    .replace(/\.[^/.]+$/, "")     // drop extension
    .replace(/\([^)]*\)/g, " ")   // drop (...) like (Remastered)
    .replace(/\[[^\]]*\]/g, " ")  // drop [...]
    .replace(/[_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // Build unique map: "artist|title" -> fullId
  const map = new Map();
  const dup = new Set();

  for (const a of albums) {
    const fallbackArtist = String(a?.artistName || "").trim();
    const songs = Array.isArray(a?.songs) ? a.songs : [];
    for (const s of songs) {
      const full = canonTrackId(s?.id || s?.r2Path || s?.link || "");
      if (!full) continue;

      const artist = String(s?.artistName || fallbackArtist || "").trim();
      const title = String(s?.title || "").trim();
      if (!artist || !title) continue;

      const key = `${artist.toLowerCase()}|${norm(title)}`;
      if (dup.has(key)) continue;

      if (!map.has(key)) map.set(key, full);
      else if (map.get(key) !== full) { map.delete(key); dup.add(key); }
    }
  }

  for (let i = 0; i < ids.length; i++) {
    const id = canonTrackId(ids[i]);
    const segs = id.split("/").filter(Boolean);
    if (segs.length !== 2) continue;

    const artist = segs[0];
    const file = segs[1];
    const baseTitle = file.replace(/\.[^/.]+$/, "");

    const key = `${artist.toLowerCase()}|${norm(baseTitle)}`;
    const mapped = map.get(key) || "";
    if (mapped) ids[i] = mapped;
  }

  return ids;
};

window.hydratePlaylistTrackIdsInBackground = async function (opts) {

  opts = opts || {};
  const max = Number.isFinite(opts.max) ? opts.max : 12;         // how many playlists to hydrate per run
  const concurrency = Number.isFinite(opts.concurrency) ? opts.concurrency : 3;

  // guard: don't run twice at the same time
  if (window.__playlistHydrateInFlight) return;
  window.__playlistHydrateInFlight = true;

  try {
    const list = Array.isArray(playlists) ? playlists : [];
    const targets = list
      .filter(p => p && p.id && (!Array.isArray(p.trackIds) || p.trackIds.length === 0))
      .slice(0, max);

    if (!targets.length) return;

    let i = 0;
    async function worker() {
      while (i < targets.length) {
        const pl = targets[i++];
        try {
          const ids = await window.loadPlaylistItemsFromCloud(pl.id);
          pl.trackIds = Array.isArray(ids) ? ids : [];

          // optional: fill songs so covers resolve immediately from library
          if ((!Array.isArray(pl.songs) || pl.songs.length === 0) && typeof window.resolveTrackIdsToSongs === "function") {
            pl.songs = window.resolveTrackIdsToSongs(pl.trackIds);
          }
        } catch (e) {
          // ignore single-playlist failures
        }
      }
    }

    const workers = [];
    for (let k = 0; k < Math.max(1, concurrency); k++) workers.push(worker());
    await Promise.all(workers);

    try { if (typeof window.renderPlaylists === "function") window.renderPlaylists(); } catch (e) {}
  } finally {
    window.__playlistHydrateInFlight = false;
  }
};

// ✅ Add playlist item in cloud

window.addTrackToPlaylistInCloud = async function (playlistId, trackId) {
  if (!playlistId || !trackId) throw new Error("Missing playlistId or trackId");

// ✅ Always record the last add attempt (even if the function gets reassigned later)
try {
  window.__lastAddToPlaylist = { playlistId, trackId, at: new Date().toISOString() };
} catch (e) {}

const body = {

    playlistId,
    playlist_id: playlistId,
    id: playlistId,

    trackId,
    track_id: trackId,
    r2_key: trackId,
    key: trackId
  };

  // Try POST with JSON body
  let res = await fetch("https://music-streamer.jacetbaum.workers.dev/api/playlist-items", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  // Fallback: some APIs expect query params
  if (!res.ok) {
    res = await fetch(
      "https://music-streamer.jacetbaum.workers.dev/api/playlist-items?playlistId=" +
        encodeURIComponent(playlistId) +
        "&trackId=" +
        encodeURIComponent(trackId),
      { method: "POST" }
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.ok) throw new Error(data?.error || "Add item failed");
  return data;
};

// ✅ Remove playlist item in cloud
window.removeTrackFromPlaylistInCloud = async function (playlistId, trackId) {
  if (!playlistId || !trackId) throw new Error("Missing playlistId or trackId");

  const body = {
    playlistId,
    playlist_id: playlistId,
    id: playlistId,

    trackId,
    track_id: trackId,
    r2_key: trackId,
    key: trackId
  };

  // Try DELETE with JSON body
  let res = await fetch("https://music-streamer.jacetbaum.workers.dev/api/playlist-items", {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });

  // Fallback: some APIs expect query params
  if (!res.ok) {
    res = await fetch(
      "https://music-streamer.jacetbaum.workers.dev/api/playlist-items?playlistId=" +
        encodeURIComponent(playlistId) +
        "&trackId=" +
        encodeURIComponent(trackId),
      { method: "DELETE" }
    );
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.ok) throw new Error(data?.error || "Remove item failed");
  return data;
};



// ✅ Create playlist in cloud
// ✅ Create playlist in cloud
window.createPlaylistInCloud = async function (name) {
  const uid = window.APP_USER_ID || localStorage.getItem("app_user_id");
  if (!uid) throw new Error("Missing id");

  const res = await fetch("https://music-streamer.jacetbaum.workers.dev/api/playlists", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id: uid, name: String(name || "Playlist") })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.ok) throw new Error(data?.error || "Create playlist failed");
  return data;
};


// ✅ Delete playlist in cloud
window.deletePlaylistFromCloud = async function (playlistId) {
  const uid = String((window.APP_USER_ID || localStorage.getItem("app_user_id") || "")).trim();
  if (!uid) throw new Error("Missing userId (app_user_id)");
  if (!playlistId) throw new Error("Missing playlistId");

  const res = await fetch(
    "https://music-streamer.jacetbaum.workers.dev/api/playlists?playlistId=" +
      encodeURIComponent(playlistId) +
      "&userId=" + encodeURIComponent(uid),
    { method: "DELETE" }
  );

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.ok) throw new Error(data?.error || "Delete playlist failed");
  return data;
};



// Plays a playlist by id (respects shuffle)
function playPlaylistById(playlistId) {
  const pl = (Array.isArray(playlists) ? playlists.find(p => p.id === playlistId) : null);
  if (!pl) return;

  const queue = buildQueueFromSongs(pl.songs || [], { album: pl.name || 'Playlist' });
  playContext = { type: 'playlist', label: pl.name || 'Playlist' };
  playQueue(queue, 0);
}


        function openPlaylistSubmenu(event){
  // ✅ Prevent the global "click outside" closer from instantly closing menus
  try { suppressContextMenuCloseUntil = Date.now() + 650; } catch(e){}
  try { suppressPlaylistMenuCloseUntil = Date.now() + 650; } catch(e){}

  // ✅ IMPORTANT: if closeContextMenu() started a mobile hide timer, cancel it
  // (otherwise the submenu can appear briefly, then get hidden by that timer)
  try {
    if (typeof contextMenuCloseTimer !== 'undefined' && contextMenuCloseTimer) {
      clearTimeout(contextMenuCloseTimer);
      contextMenuCloseTimer = null;
    }
  } catch (e) {}

  try { if (event) event.preventDefault(); } catch(e){}
  try { if (event) event.stopPropagation(); } catch(e){}


  // ✅ Prevent “ghost tap” (finger release clicking first playlist item)
  try {
    const tmp = document.getElementById('playlist-submenu');
    if (tmp) {
      tmp.style.pointerEvents = 'none';
      setTimeout(() => { try { tmp.style.pointerEvents = 'auto'; } catch(e){} }, 250);
    }
  } catch(e){}

  const sub = document.getElementById('playlist-submenu');


  if (!sub) return;

    // ✅ Spotify-ish: full-width sheet that slides up (not a tiny floating box)
  try {
    const cm = document.getElementById('context-menu');
    if (cm && cm.style) {
      try { cm.style.display = 'none'; } catch (e) {}
    }

    sub.style.position = 'fixed';
    sub.style.left = '0';
    sub.style.top  = '0';
    sub.style.right = '0';
    sub.style.bottom = '12px';

    sub.style.width = '100vw';
    sub.style.maxHeight = 'none';
        sub.style.overflow = 'hidden';

    // Make it lay out like a proper sheet: header stays, list scrolls
    sub.style.display = 'flex';
    sub.style.flexDirection = 'column';

    // sheet visuals
    sub.style.background = 'rgba(18,18,18,0.96)';
    sub.style.backdropFilter = 'blur(14px)';
    sub.style.borderRadius = '0';
    sub.style.boxShadow = 'none';

    // animate in (slide up fast)
    sub.style.transition = 'transform 160ms ease, opacity 160ms ease';
    sub.style.transform = 'translateY(18px)';
    sub.style.opacity = '0';

    requestAnimationFrame(() => {

      sub.style.transform = 'translateY(0)';
      sub.style.opacity = '1';
    });
  } catch (e) {}


  // ✅ playlist-submenu-items may be missing at runtime (DOM rebuild) — recreate it

  let items = document.getElementById('playlist-submenu-items');
  if (!items) {
    items = document.createElement('div');
    items.id = 'playlist-submenu-items';
    sub.appendChild(items);
  }

  // build playlist list fresh each time

  // ✅ CLEANUP: remove any stray menu-item children that are NOT inside #playlist-submenu-items
  // (renderPlaylists() sometimes appends menu-item rows directly into #playlist-submenu — delete those)
  try {
    const keepNew = sub.querySelector('.menu-item[onclick*="createNewPlaylist"]');

    Array.from(sub.children).forEach((child) => {
      if (!child || !child.classList) return;

      // keep structural elements
      if (child.classList.contains('cm-handle')) return;
      if (child.classList.contains('cm-submenu-header')) return;
      if (child.id === 'playlist-submenu-items') return;

      // keep "+ New Playlist"
      if (keepNew && child === keepNew) return;
      const oc = child.getAttribute && child.getAttribute('onclick');
      if (oc && oc.includes('createNewPlaylist')) return;

      // ❌ delete any other direct menu-item
      if (child.classList.contains('menu-item')) {
        try { child.remove(); } catch (e) {}
      }
    });
  } catch (e) {}

  // ✅ Make ONLY the list scroll + add a subtle bottom “end” strip
try {
  sub.style.overflow = 'hidden';

  // ✅ IMPORTANT: remove the 320px cap so the list can actually fill the sheet
  items.style.maxHeight = 'none';
  items.style.height = 'auto';

  // ✅ Make ONLY the list scroll
  items.style.flex = '1 1 auto';
  items.style.minHeight = '0';
  items.style.overflowY = 'auto';
  items.style.webkitOverflowScrolling = 'touch';

  // tiny “end strip” to show where it ends
  items.style.boxShadow = 'inset 0 -14px 0 rgba(255,255,255,0.10)';
} catch (e) {}

  // ✅ Clean slate
  items.innerHTML = '';

  // ============================
  // UI v2: header + search + bubbles + Done/Cancel
  // ============================

  // Ensure submenu is scroll-safe on mobile (list scrolls, header stays)
  sub.style.overflow = 'hidden';
  sub.style.webkitOverflowScrolling = 'touch';
  sub.style.position = 'relative';

  // Build / reuse header
  let header = sub.querySelector('#ps_header');
  if (!header) {
    header = document.createElement('div');
    header.id = 'ps_header';
    header.style.position = 'sticky';
    header.style.top = '0';
    header.style.zIndex = '10';
    header.style.background = '#000';
    header.style.padding = '14px 12px';
    header.style.borderBottom = '1px solid rgba(255,255,255,.12)';

    header.innerHTML = `
      <div style="display:flex;align-items:center;justify-content:space-between">
        <button id="ps_cancel" type="button" style="color:#fff;opacity:.85;font-size:16px;background:transparent;border:none;">Cancel</button>
        <div style="color:#fff;font-weight:900;font-size:17px;">Add to playlist</div>
        <div style="width:56px;"></div>
      </div>

      <button id="ps_new" type="button"
        style="margin:12px auto 0 auto;width:68%;background:#fff;color:#000;font-weight:900;border-radius:999px;padding:12px 14px;border:none;display:block;">
        New playlist

      </button>

      <div style="margin-top:10px;background:#1a1a1a;border-radius:12px;padding:10px 12px;display:flex;align-items:center;gap:10px;">
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
       xmlns="http://www.w3.org/2000/svg"
       style="opacity:.7;flex-shrink:0">
    <circle cx="11" cy="11" r="7" stroke="white" stroke-width="2"/>
    <line x1="16.65" y1="16.65" x2="21" y2="21"
          stroke="white" stroke-width="2" stroke-linecap="round"/>
  </svg>

  <input id="ps_search" placeholder="Find playlist" autocomplete="off"
    style="flex:1;background:transparent;border:none;outline:none;color:#fff;font-size:16px;">
</div>

    `;
    sub.insertBefore(header, sub.firstChild);
  }

  // Build / reuse Done button (pinned to bottom of submenu)
  let doneBtn = sub.querySelector('#ps_done');
  if (!doneBtn) {
    doneBtn = document.createElement('button');
    doneBtn.id = 'ps_done';
    doneBtn.type = 'button';
    doneBtn.textContent = 'Done';
    doneBtn.style.position = 'absolute';
    doneBtn.style.left = '50%';
    doneBtn.style.transform = 'translateX(-50%)';
    doneBtn.style.bottom = '14px';
        doneBtn.style.width = '38%';
    doneBtn.style.maxWidth = '260px';

    doneBtn.style.background = '#1db954';
    doneBtn.style.color = '#000';
    doneBtn.style.fontWeight = '950';
    doneBtn.style.borderRadius = '999px';
    doneBtn.style.padding = '14px';
    doneBtn.style.border = 'none';
    doneBtn.style.zIndex = '20';
    sub.appendChild(doneBtn);
  }

  // Make the playlist list area scrollable and leave room for Done
  items.style.overflowY = 'auto';
  items.style.webkitOverflowScrolling = 'touch';
  items.style.padding = '8px 0 90px 0';

  // Size the submenu so it fits on mobile and keeps Done visible
  const headerH = header.getBoundingClientRect().height || 140;
  const maxH = Math.min(window.innerHeight * 0.85, window.innerHeight - 80);
  sub.style.maxHeight = `${maxH}px`;
  items.style.maxHeight = `${Math.max(200, maxH - headerH)}px`;

  // Selection state: playlist ids
  sub.__selectedPlaylistIds = sub.__selectedPlaylistIds || new Set();

  // ---- helpers ----
  function __canonTrackIdLocal(v) {
    let s = String(v || '').trim();
    if (!s) return '';
    try {
      if (s.includes('://')) {
        const u = new URL(s);
        const id = u.searchParams.get('id');
        if (id) s = id;
      }
    } catch (e) {}
    if (s.includes('?id=')) {
      try { s = (s.split('?id=')[1] || '').split('&')[0] || s; } catch (e) {}
    }
    try { s = decodeURIComponent(s); } catch (e) {}
    return s.replace(/^\/+/, '').trim();
  }

  function __resolveTrackIdForMenu() {
    const s = window.menuTargetSong;
    if (!s) return '';
    let trackId =
      s.id || s.r2Path || s.track_id || s.trackId || s.key || s.r2_key || '';
    if (!trackId) {
      const u = s.link || s.url || '';
      try {
        const parsed = new URL(u, window.location.origin);
        trackId = parsed.searchParams.get('id') || '';
      } catch (_) {}
    }
    return __canonTrackIdLocal(trackId);
  }

  // ---- render list (bubbles) ----
  const qEl = header.querySelector('#ps_search');
  const cancelBtn = header.querySelector('#ps_cancel');
  const newBtn = header.querySelector('#ps_new');

  function renderBubbleList(filterText) {
    const needle = String(filterText || '').toLowerCase().trim();
    items.innerHTML = '';

        const plsAllRaw = [
      ...(Array.isArray(window.cloudPlaylists) ? window.cloudPlaylists : []),
      ...(Array.isArray(window.playlists) ? window.playlists : []),
    ].filter(Boolean);

    // de-dupe by playlist id (prefer later entries)
    const __plById = new Map();
    plsAllRaw.forEach(p => {
      const id = (p && (p.id || p.playlistId || p.playlist_id)) || '';
      if (id) __plById.set(String(id), p);
    });
    const plsAll = Array.from(__plById.values());

    const rows = plsAll
      .filter(p => {
        const name = String(p?.name || '');
        return !needle || name.toLowerCase().includes(needle);
      })
      .map(p => ({
        pid: (p && (p.id || p.playlistId || p.playlist_id)) || '',
        name: String(p?.name || 'Untitled'),
      }))
      .filter(x => !!x.pid);


    rows.forEach(({ pid, name }) => {
  const row = document.createElement('div');
  row.style.setProperty('display', 'flex', 'important');

  row.style.alignItems = 'center';
  row.style.justifyContent = 'flex-start';
   row.style.gap = '14px';
  row.style.padding = '12px 14px';

  row.style.color = '#fff';
  row.style.cursor = 'pointer';

    // --- cover (left) ---
  const pObj = (plsAll || []).find(p => {
    const id = (p && (p.id || p.playlistId || p.playlist_id)) || '';
    return String(id) === String(pid);
  }) || null;

  let coverSrc = '';
  try {
    if (pObj && typeof window.getEffectivePlaylistCover === 'function') {
      coverSrc = String(window.getEffectivePlaylistCover(pObj) || '').trim();
    }
  } catch (e) {}

  if (!coverSrc) {
    coverSrc =
      (pObj && (pObj.cover || pObj.coverUrl || pObj.image || pObj.img || pObj.art)) || '';
    coverSrc = String(coverSrc || '').trim();
  }

  const cover = document.createElement('img');
  cover.alt = '';
  cover.draggable = false;
    cover.style.width = '56px';
  cover.style.height = '56px';
  cover.style.borderRadius = '10px';

  cover.style.objectFit = 'cover';
  cover.style.flex = '0 0 auto';
  cover.style.background = 'rgba(255,255,255,.10)';
  cover.style.border = '1px solid rgba(255,255,255,.10)';

    // IMPORTANT: do NOT append cache-busters to data: URLs
  if (coverSrc) {
    cover.src = coverSrc.startsWith('data:')
      ? coverSrc
      : (coverSrc + (coverSrc.includes('?') ? '&' : '?') + 'cb=' + Date.now());
  }



   // --- text (middle) ---
  const textWrap = document.createElement('div');
  textWrap.style.display = 'flex';
  textWrap.style.flexDirection = 'column';
  textWrap.style.minWidth = '0';
  textWrap.style.gap = '4px';
  textWrap.style.flex = '1 1 auto';
  textWrap.style.textAlign = 'left';

  const titleEl = document.createElement('div');
  titleEl.textContent = name;
  titleEl.style.fontWeight = '900';
  titleEl.style.fontSize = '18px';
  titleEl.style.color = '#fff';
  titleEl.style.whiteSpace = 'nowrap';
  titleEl.style.overflow = 'hidden';
  titleEl.style.textOverflow = 'ellipsis';

  const subEl = document.createElement('div');
  subEl.style.fontWeight = '700';
  subEl.style.fontSize = '14px';
  subEl.style.color = 'rgba(255,255,255,.55)';
  subEl.style.whiteSpace = 'nowrap';
  subEl.style.overflow = 'hidden';
  subEl.style.textOverflow = 'ellipsis';

  // subtitle: "[folder] • N songs" (best-effort)
  let subtitle = '';
  try {
    const pl = pObj;
    let n =
      (Array.isArray(pl?.trackIds) ? pl.trackIds.length : null) ??
      (Array.isArray(pl?.tracks) ? pl.tracks.length : null) ??
      (typeof pl?.trackCount === 'number' ? pl.trackCount : null) ??
      (typeof pl?.count === 'number' ? pl.count : null);

    const folderId = (pl?.folderId || pl?.folder_id || pl?.folder || '');
    let folderName = '';
    if (folderId) {
      try {
        const folders = JSON.parse(localStorage.getItem('folders') || '[]');
        if (Array.isArray(folders)) {
          const f = folders.find(x => String(x?.id || '') === String(folderId));
          folderName = String(f?.name || '');
        }
      } catch (e) {}
    }

    if (folderName && typeof n === 'number' && isFinite(n)) subtitle = `📁 ${folderName} • ${n} songs`;
    else if (folderName) subtitle = `📁 ${folderName}`;
    else if (typeof n === 'number' && isFinite(n)) subtitle = `${n} songs`;
  } catch (e) {}

  subEl.textContent = subtitle;

  textWrap.appendChild(titleEl);
  if (subtitle) textWrap.appendChild(subEl);


  const bubble = document.createElement('div');
  bubble.style.width = '26px';
  bubble.style.height = '26px';
  bubble.style.borderRadius = '50%';
  bubble.style.border = '2px solid rgba(255,255,255,.4)';
  bubble.style.setProperty('display', 'grid', 'important');
bubble.style.setProperty('visibility', 'visible', 'important');
bubble.style.setProperty('opacity', '1', 'important');

  bubble.style.placeItems = 'center';
  bubble.style.flex = '0 0 auto';
  bubble.style.marginLeft = 'auto';

  row.appendChild(cover);
    row.appendChild(textWrap);

  row.appendChild(bubble);

  function paint() {

        const on = sub.__selectedPlaylistIds.has(pid);
        if (on) {
          bubble.style.background = '#1db954';
          bubble.style.borderColor = '#1db954';
          bubble.innerHTML = '<span style="color:#000;font-weight:950;">✓</span>';
        } else {
          bubble.style.background = 'transparent';
          bubble.style.borderColor = 'rgba(255,255,255,.4)';
          bubble.innerHTML = '';
        }
      }
      paint();

      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (sub.__selectedPlaylistIds.has(pid)) sub.__selectedPlaylistIds.delete(pid);
        else sub.__selectedPlaylistIds.add(pid);
        paint();
      }, true);

                  // ✅ Append row (cover + label + bubble were already built above)
      items.appendChild(row);


    });
  }

  try { if (qEl) qEl.value = ''; } catch (e) {}
  renderBubbleList('');

  if (qEl && !qEl.__psBound) {
    qEl.__psBound = true;
    qEl.addEventListener('input', () => renderBubbleList(qEl.value), true);
  }

  if (cancelBtn && !cancelBtn.__psBound) {
    cancelBtn.__psBound = true;
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { if (typeof window.closeContextMenu === 'function') window.closeContextMenu(); } catch (err) {}
    }, true);
  }

  if (newBtn && !newBtn.__psBound) {
    newBtn.__psBound = true;
    newBtn.addEventListener('click', (e) => {
      e.preventDefault(); e.stopPropagation();
      try { if (typeof window.createNewPlaylist === 'function') window.createNewPlaylist(); } catch (err) {}
    }, true);
  }

  if (doneBtn && !doneBtn.__psBound) {
    doneBtn.__psBound = true;
    doneBtn.addEventListener('click', async (e) => {
      e.preventDefault(); e.stopPropagation();

      const ids = Array.from(sub.__selectedPlaylistIds || []);
      if (!ids.length) {
        try { if (typeof window.closeContextMenu === 'function') window.closeContextMenu(); } catch (err) {}
        return;
      }

            // ✅ Resolve trackIds:
      // - If song-multiselect is ON, use the selected set
      // - Else fallback to the single menuTargetSong
      let trackIds = [];

      try {
        const multiOn = document.body && document.body.classList.contains('song-multiselect');
        const picked = (multiOn && typeof window.getSelectedSongUrls === 'function')
          ? (window.getSelectedSongUrls() || [])
          : [];

        if (multiOn && picked.length) {
          trackIds = picked.map(__canonTrackIdLocal).filter(Boolean);
        }
      } catch (e) {}

      if (!trackIds.length) {
        const one = __resolveTrackIdForMenu();
        if (one) trackIds = [one];
      }

      if (!trackIds.length) return alert('Missing trackId(s) for this add.');

      // Optional: reflect count on the button while it runs
      try { doneBtn.textContent = (trackIds.length > 1) ? `Add ${trackIds.length} songs` : 'Add 1 song'; } catch (e) {}


      const pls = Array.isArray(window.playlists) ? window.playlists : [];

      for (const pid of ids) {
        const pl = pls.find(p => (p && (p.id || p.playlistId || p.playlist_id)) === pid);
        if (!pl) continue;

        const playlistId =
          pl.id || pl.playlistId || pl.playlist_id || pl.playlistID || '';

        // 1) CLOUD FIRST
        try {
          if (typeof window.addTrackToPlaylistInCloud !== 'function') {
            throw new Error('addTrackToPlaylistInCloud is missing');
          }
                    for (const tid of trackIds) {
            await window.addTrackToPlaylistInCloud(playlistId, tid);
          }

        } catch (err) {
          console.warn('❌ cloud add failed:', pl?.name, err);
          alert("Couldn’t add to playlist (cloud sync failed).");
          return;
        }

        // 2) LOCAL UPDATE (IDs-only) + SAVE (best-effort)
        try {
          if (!Array.isArray(pl.trackIds)) pl.trackIds = [];
                    const set = new Set(pl.trackIds.map(__canonTrackIdLocal));
          for (const tid of trackIds) {
            if (!set.has(tid)) {
              pl.trackIds.push(tid);
              set.add(tid);
            }
          }

          try { if (typeof window.savePlaylists === 'function') window.savePlaylists(); } catch (e2) {}
          try { if (typeof window.updatePlaylistAutoCoverById === 'function') await window.updatePlaylistAutoCoverById(playlistId); } catch (e3) {}

          pl.songCount = pl.trackIds.length;
          pl.updated_at = new Date().toISOString();
        } catch (err) {
          console.warn('local update failed:', pl?.name, err);
        }
      }

// ✅ UNDO: adding track(s) to playlist(s)
try{
  if (typeof window.__pushUndo === "function") {
    const __pids = Array.isArray(ids) ? ids.slice() : [];
    const __tids = Array.isArray(trackIds) ? trackIds.slice() : [];

    if (__pids.length && __tids.length) {
      window.__pushUndo({
        type: "playlist:addTracks",
        playlistIds: __pids,
        trackIds: __tids,
        undo: async () => {
          try{
            // try cloud remove first (keeps devices in sync)
            if (typeof window.removeTrackFromPlaylistInCloud === "function") {
              for (const pid of __pids) {
                for (const tid of __tids) {
                  try{ await window.removeTrackFromPlaylistInCloud(pid, tid); }catch(e){}
                }
              }
            }

            // best-effort refresh UI
            try { if (typeof window.loadPlaylistsFromCloud === "function") await window.loadPlaylistsFromCloud(); } catch(e) {}
            try { if (typeof window.renderPlaylists === "function") window.renderPlaylists(); } catch(e) {}
            try { if (typeof window.renderHome === "function") window.renderHome(); } catch(e) {}
          }catch(e){}
        }
      });
    }
  }
}catch(e){}

try { if (typeof window.renderPlaylists === 'function') window.renderPlaylists(); } catch (e4) {}
try { if (typeof window.forceCloudPlaylistPull === 'function') window.forceCloudPlaylistPull(); } catch (e5) {}
try { if (typeof window.closeContextMenu === 'function') window.closeContextMenu(); } catch (e6) {}
    }, true);
  }

  // ✅ closeContextMenu() may have hidden this sheet with inline styles — undo that


  // ✅ closeContextMenu() may have hidden this sheet with inline styles — undo that
 sub.style.display = 'block';

/* ✅ MUST be above #context-menu-backdrop (yours is ~199999) */
sub.style.zIndex = '200500';
sub.style.pointerEvents = 'auto';

/* ✅ only the inner list scrolls (prevents double scrollbars) */
sub.style.overflow = 'hidden';
if (items) {
  items.style.overflowY = 'auto';
  items.style.webkitOverflowScrolling = 'touch';
}

sub.classList.add('open');



}

function closePlaylistSubmenu(event){
  try{
    if (event) {
      event.preventDefault?.();
      event.stopPropagation?.();
      event.stopImmediatePropagation?.();
    }
  }catch(e){}

  const sub = document.getElementById('playlist-submenu');
  if (!sub) return;

  // ✅ animate down (matches the open/close sheet feel)
  sub.style.display = 'block';
  sub.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 220ms ease';
  sub.classList.remove('open');
  sub.style.transform = 'translateY(100%)';
  sub.style.opacity = '0';

  // ✅ then fully hide so background refresh can't "replace" it while visible
  setTimeout(() => {
    try{
      sub.style.display = 'none';
      sub.style.transition = '';
      sub.style.transform = '';
      sub.style.opacity = '';
    }catch(e){}
  }, 240);
}




function createNewPlaylist() {


  // Spotify-style in-submenu "Give your playlist a name" modal
  const sub = document.getElementById('playlist-submenu');
  if (!sub) {
    // fallback (shouldn't happen)
    const name = prompt("Enter Playlist Name:");
    if (!name || !name.trim()) return;
    (async () => {
      try {
        await window.createPlaylistInCloud(name.trim());
        await window.loadPlaylistsFromCloud();
        try { renderPlaylists(); } catch (e) {}
        try { if (typeof renderHome === "function") renderHome(); } catch (e) {}
      } catch (e) {
        console.error(e);
        alert("Could not create playlist.");
      }
    })();
    return;
  }

  // remove any existing overlay
  try { sub.querySelector('#ps_create_overlay')?.remove(); } catch (e) {}

  // ensure submenu can position children
  try { if (getComputedStyle(sub).position === 'static') sub.style.position = 'relative'; } catch (e) {}

  const overlay = document.createElement('div');
  overlay.id = 'ps_create_overlay';
  overlay.style.position = 'absolute';
  overlay.style.inset = '0';
  overlay.style.zIndex = '999999';
  overlay.style.display = 'flex';
  overlay.style.flexDirection = 'column';
  overlay.style.background = 'rgba(0,0,0,.55)';
  overlay.style.backdropFilter = 'blur(10px)';
  overlay.style.webkitBackdropFilter = 'blur(10px)';

  overlay.innerHTML = `
    <div style="position:absolute;top:18px;right:18px;">
      <button id="ps_create_close" type="button"
        style="width:44px;height:44px;border-radius:999px;border:none;background:transparent;color:#fff;font-size:28px;line-height:44px;opacity:.9;">
        ×
      </button>
    </div>

    <div style="flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px 18px;">
      <div style="color:#fff;font-weight:900;font-size:34px;line-height:1.15;text-align:center;max-width:92%;">
        Give your playlist a name
      </div>

      <div style="margin-top:22px;width:min(520px,92%);">
        <input id="ps_create_name" autocomplete="off" autocapitalize="sentences" spellcheck="false"
          placeholder="My playlist"
          style="
            width:100%;
            background:transparent;
            border:none;
            outline:none;
            color:#fff;
            font-weight:900;
            font-size:56px;
            line-height:1.05;
            text-align:left;
          ">
        <div style="height:2px;background:rgba(255,255,255,.35);margin-top:14px;"></div>
      </div>

      <button id="ps_create_btn" type="button"
        style="
          margin-top:26px;
          background:#1db954;
          color:#000;
          font-weight:950;
          border:none;
          border-radius:999px;
          padding:14px 26px;
          font-size:18px;
          min-width:140px;
        ">
        Create
      </button>
    </div>
  `;

  sub.appendChild(overlay);

  const closeBtn = overlay.querySelector('#ps_create_close');
  const nameEl = overlay.querySelector('#ps_create_name');
  const createBtn = overlay.querySelector('#ps_create_btn');

  const closeOverlay = () => { try { overlay.remove(); } catch(e) {} };

  // focus + select
  try {
    setTimeout(() => {
      try { nameEl.focus(); } catch (e) {}
      try { nameEl.select(); } catch (e) {}
    }, 50);
  } catch (e) {}

  if (closeBtn) closeBtn.addEventListener('click', (e) => {
    try { e.preventDefault(); e.stopPropagation(); } catch (_) {}
    closeOverlay();
  }, true);

  // clicking the dark backdrop closes too (but NOT clicks inside the centered card)
  overlay.addEventListener('click', (e) => {
    try {
      if (e.target === overlay) closeOverlay();
    } catch (_) {}
  }, true);

  if (createBtn) createBtn.addEventListener('click', async (e) => {
    try { e.preventDefault(); e.stopPropagation(); } catch (_) {}

    const name = String(nameEl?.value || '').trim();
    if (!name) {
      try { nameEl.focus(); } catch (e) {}
      return;
    }

    try {
      createBtn.disabled = true;
      createBtn.textContent = 'Creating…';
    } catch (e) {}

    try {
      await window.createPlaylistInCloud(name);

      // Pull cloud playlists and repaint
      await window.loadPlaylistsFromCloud();
      try { renderPlaylists(); } catch (e) {}
      try { if (typeof renderHome === "function") renderHome(); } catch (e) {}

            // Find the newly-created playlist index (prefer last match by name)
      const pls = Array.isArray(window.playlists) ? window.playlists : [];
      let idx = -1;
      for (let i = pls.length - 1; i >= 0; i--) {
        if (String(pls[i]?.name || '').trim() === name) { idx = i; break; }
      }

      // ✅ NEW: auto-add the current menuTargetSong to this new playlist
      try {
        const __canon = (v) => {
          let s = String(v || '').trim();
          if (!s) return '';
          try {
            if (s.includes('://')) {
              const u = new URL(s);
              const id = u.searchParams.get('id');
              if (id) s = id;
            }
          } catch (e) {}
          if (s.includes('?id=')) {
            try { s = (s.split('?id=')[1] || '').split('&')[0] || s; } catch (e) {}
          }
          try { s = decodeURIComponent(s); } catch (e) {}
          return s.replace(/^\/+/, '').trim();
        };

        const __resolveTid = () => {
          const s = window.menuTargetSong;
          if (!s) return '';
          let tid = s.id || s.r2Path || s.track_id || s.trackId || s.key || s.r2_key || '';
          if (!tid) {
            const u = s.link || s.url || '';
            try {
              const parsed = new URL(u, window.location.origin);
              tid = parsed.searchParams.get('id') || '';
            } catch (_) {}
          }
          return __canon(tid);
        };

        const __tid = __resolveTid();
        const __pid = (idx >= 0)
          ? String(pls[idx]?.id || pls[idx]?.playlistId || pls[idx]?.playlist_id || '').trim()
          : '';

        if (__pid && __tid && typeof window.addTrackToPlaylistInCloud === 'function') {
          // 1) cloud add
          await window.addTrackToPlaylistInCloud(__pid, __tid);

          // 2) local UI update so it shows "1 song" immediately
          try {
            const pl = pls.find(p => String(p?.id || p?.playlistId || p?.playlist_id || '').trim() === __pid);
            if (pl) {
              if (!Array.isArray(pl.trackIds)) pl.trackIds = [];
              const set = new Set(pl.trackIds.map(__canon));
              if (!set.has(__tid)) pl.trackIds.push(__tid);
              pl.songCount = pl.trackIds.length;
              pl.updated_at = new Date().toISOString();
              try { if (typeof window.savePlaylists === 'function') window.savePlaylists(); } catch (e2) {}
              try { if (typeof window.updatePlaylistAutoCoverById === 'function') await window.updatePlaylistAutoCoverById(__pid); } catch (e3) {}
            }
          } catch (e4) {}

          try { renderPlaylists(); } catch (e5) {}
          try { if (typeof renderHome === "function") renderHome(); } catch (e6) {}
        }
      } catch (e) {}

try{
  if (idx >= 0 && typeof window.__pushUndo === "function") {
    const __pid = String(pls[idx]?.id || pls[idx]?.playlistId || pls[idx]?.playlist_id || "").trim();
    const __name = String(name || "").trim();

    if (__pid) {
      window.__pushUndo({
        type: "playlist:create",
        playlistId: __pid,
        name: __name,
        undo: async () => {
          try{
            try{
              if (typeof window.deletePlaylistFromCloud === "function") {
                await window.deletePlaylistFromCloud(__pid);
              } else if (typeof window.deletePlaylistInCloud === "function") {
                await window.deletePlaylistInCloud(__pid);
              }
            }catch(e){}

            try{ await window.loadPlaylistsFromCloud(); }catch(e){}
            try{ renderPlaylists(); }catch(e){}
            try{ if (typeof renderHome === "function") renderHome(); }catch(e){}
          }catch(e){}
        }
      });
    }
  }
}catch(e){}

// Close overlay + menu and open playlist view

      closeOverlay();
      try { if (typeof window.closeContextMenu === 'function') window.closeContextMenu(); } catch (e) {}

      if (idx >= 0) {
        try { showView('playlist', idx); } catch (e) {}
      }
    } catch (err) {
      console.error(err);
      alert("Could not create playlist.");
      try { createBtn.disabled = false; createBtn.textContent = 'Create'; } catch (e) {}
    }
  }, true);

}

// ---------------- PINNED PLAYLISTS ----------------
function loadPinnedPlaylists() {
  let stored = [];
  try { stored = JSON.parse(localStorage.getItem('pinnedPlaylists') || "[]"); }
  catch { stored = []; }

  const validIds = new Set(playlists.map(pl => pl.id));
  const unique = [];
  if (Array.isArray(stored)) {
    stored.forEach(id => {
      if (validIds.has(id) && !unique.includes(id)) unique.push(id);
    });
  }
  const normalized = unique.slice(0, 4);
  if (JSON.stringify(normalized) !== JSON.stringify(stored)) {
    savePinnedPlaylists(normalized);
  }
  return normalized;
}

// ✅ Expose for codepaths that call window.loadPinnedPlaylists() / window.savePinnedPlaylists()
window.loadPinnedPlaylists = loadPinnedPlaylists;
window.savePinnedPlaylists = savePinnedPlaylists;

function savePinnedPlaylists(ids) {
  localStorage.setItem('pinnedPlaylists', JSON.stringify(ids));
    syncPinnedPlaylists(ids);
}

// ✅ Expose pinned helpers globally (Home startup calls window.loadPinnedPlaylists)
try {
  window.loadPinnedPlaylists = loadPinnedPlaylists;
  window.savePinnedPlaylists = savePinnedPlaylists;
} catch (e) {}

function getPinnedPlaylistNamesFromIds(ids) {

  const names = [];
  const idList = Array.isArray(ids) ? ids : [];
  idList.forEach((id) => {
    const match = playlists.find(pl => pl.id === id);
    const name = String(match?.name || "").trim();
    if (name && !names.includes(name)) {
      names.push(name);
    }
  });
  return names.slice(0, 4);
}

async function syncPinnedPlaylists(ids) {
  try {
    await fetch('/api/pinned-playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ names: getPinnedPlaylistNamesFromIds(ids) })
    });
  } catch (e) {
    console.warn('Failed to sync pinned playlists:', e);
  }
}

async function reconcilePinnedPlaylistsFromServer() {
  try {
    const response = await fetch('/api/pinned-playlists');
    if (!response.ok) return;
    const data = await response.json();
    const names = Array.isArray(data?.names) ? data.names : [];
    const ids = [];
    names.forEach((name) => {
      const match = playlists.find(pl => String(pl.name || '').trim() === String(name || '').trim());
      if (match && !ids.includes(match.id)) {
        ids.push(match.id);
      }
    });
    if (ids.length) {
      localStorage.setItem('pinnedPlaylists', JSON.stringify(ids.slice(0, 4)));
    }
  } catch (e) {
    console.warn('Failed to load pinned playlists:', e);
  }
}

function isPinnedPlaylist(id) {
  return loadPinnedPlaylists().includes(id);
}

function pinPlaylist(id) {
  const pinned = loadPinnedPlaylists();
  if (pinned.includes(id)) return;

  if (pinned.length >= 4) {
    alert("You can only pin 4 playlists max.");
    return;
  }
  pinned.unshift(id);
  savePinnedPlaylists(pinned);
  renderPlaylists();
}

function unpinPlaylist(id) {
  const pinned = loadPinnedPlaylists().filter(x => x !== id);
  savePinnedPlaylists(pinned);
  renderPlaylists();
}

function ensurePlaylistIds() {
  let changed = false;
  playlists.forEach(pl => {
    if (!pl.id) { pl.id = crypto.randomUUID(); changed = true; }
  });
  if (changed) savePlaylists();
}
function savePlaylists() {
  localStorage.setItem('playlists', JSON.stringify(playlists));
}

/* -----------------------
   PLAYLIST AUTO COVERS
   Rules:
   - If pl.cover exists => use it (manual cover)
   - Else if 0 songs => ""
   - Else if 1-3 songs => first song cover
   - Else 4+ songs => 2x2 of first 4 covers (stored as dataURL in pl.autoCover)
------------------------ */

function getSongCoverFromPlaylistSong(s) {
  if (!s) return "";

  // 1) If the song already has a cover field, use it
  const direct =
    s.cover_url ||
    s.coverURL ||
    s.cover ||
    s.coverArt ||
    s.cover_art ||
    (s.track && (s.track.cover_url || s.track.cover)) ||
    "";

  const directClean = String(direct || "").trim();
  if (directClean) return directClean;

  // --- Canonical resolver (Artist/File.mp3 -> Artist/Album/File.mp3) ---
  // Built lazily from /api/get-songs (your canonical truth)
  try {
    if (!window.__canonByArtistFile && !window.__canonByArtistFileLoading) {
      window.__canonByArtistFileLoading = true;
      fetch("/api/get-songs", { cache: "no-store" })
        .then((r) => r.json())
        .then((albums) => {
          const m = Object.create(null);
          for (const a of (Array.isArray(albums) ? albums : [])) {
            for (const t of (Array.isArray(a?.songs) ? a.songs : [])) {
              const tid = String(t?.r2Path || t?.id || "").trim();
              const p = tid.split("/").filter(Boolean);
              if (p.length >= 3) {
                const k = `${p[0]}||${p[p.length - 1]}`; // artist||filename
                if (m[k] === undefined) m[k] = tid;
                else if (m[k] !== tid) m[k] = null; // collision -> don't guess
              }
            }
          }
          window.__canonByArtistFile = m;
        })
        .catch(() => {})
        .finally(() => {
          window.__canonByArtistFileLoading = false;
        });
    }
  } catch (e) {}

  // 2) Otherwise, compute album/parent-folder cover from track id/path
    const rawId =
    s.id ||
    s.key ||
    s.r2_key ||
    s.track_id ||
    s.trackId ||
    s.link ||
    s.url ||
    "";

  let tid = String(rawId || "").trim();
  if (!tid) return "";

  // ✅ If we were handed a Worker URL, extract the real R2 key from ?id=
  if (tid.includes("?id=")) {
    try { tid = decodeURIComponent(tid.split("?id=")[1].split("&")[0]); } catch (e) {}
  }

  // strip My Collection prefix if present
  if (tid.startsWith("My Collection/Artists/")) tid = tid.slice("My Collection/Artists/".length);
  if (tid.startsWith("My Collection/")) tid = tid.slice("My Collection/".length);

  // ✅ If playlist stored short ids like "Artist/Track.mp3", try to expand using library index maps
  try {
    const p0 = tid.split("/").filter(Boolean);
    if (p0.length === 2) {
      const shortId = `${p0[0]}/${p0[1]}`;

      // Prefer the explicit short->full map if present
      if (window.__shortTrackIdToFullId && typeof window.__shortTrackIdToFullId.get === "function") {
        const full = window.__shortTrackIdToFullId.get(shortId);
        if (full) tid = String(full).trim();
      }

      // Fallback: trackShortIndexMap (entry.id is the full canonical id)
      if (p0.length === 2 && window.__trackShortIndexMap && typeof window.__trackShortIndexMap.get === "function") {
        const hit = window.__trackShortIndexMap.get(shortId);
        if (hit && hit.id) tid = String(hit.id).trim();
      }
    }
  } catch (e) {}

  const parts = tid.split("/").filter(Boolean);

  if (parts.length < 1) return "";

  // If it ends in a filename (has a dot), drop it to get the parent folder
  const last = parts[parts.length - 1];
  const lastClean = String(last || "").split("?")[0].split("#")[0];
      // ✅ If we only have "Artist" (meaning original was "Artist/File.mp3"),
  // we *can* use Artist/cover.jpg as a fallback (ONLY for these orphan tracks).
  if (parts.length < 2) {
    const artistOnly = parts[0] || "";
    if (!artistOnly) return "";
    const coverPath = `${artistOnly}/cover.jpg`;
    return `https://music-streamer.jacetbaum.workers.dev/?id=${encodeURIComponent(coverPath)}`;
  }



    // ✅ If tid is Artist/Album/Track.mp3, cover must be Artist/Album/cover.jpg (NOT Track.mp3/cover.jpg)
  const looksAudioFile = (name) => /\.(mp3|m4a|flac|wav|aac|ogg)$/i.test(String(name || ""));
    let folderParts = looksAudioFile(lastClean) ? parts.slice(0, -1) : parts;

  // ✅ If tid is 2-part ("Artist/Track.mp3"), treat it as Singles for cover + album
  if (looksAudioFile(lastClean) && folderParts.length === 1 && folderParts[0]) {
    folderParts = [folderParts[0], "Singles"];
    try { if (!s.album) s.album = "Singles"; } catch (e) {}
  }

  // ✅ Mutate once derived (so playlist row text + now playing can use it)
  try {
    if (folderParts[0] && !s.artist) s.artist = folderParts[0];
    if (folderParts[1]) s.album = folderParts[1];
  } catch (e) {}

  const coverPath = `${folderParts.join("/")}/cover.jpg`;

  return `https://music-streamer.jacetbaum.workers.dev/?id=${encodeURIComponent(coverPath)}`;

}


function getPlaylistManualCover(pl) {

  return (pl && pl.cover && String(pl.cover).trim()) ? String(pl.cover).trim() : "";
}

function getPlaylistAutoCover(pl) {
  return (pl && pl.autoCover && String(pl.autoCover).trim()) ? String(pl.autoCover).trim() : "";
}

function getEffectivePlaylistCover(pl) {
  if (!pl) return '';
  // Manual cover wins
  if (pl.cover && String(pl.cover).trim()) return String(pl.cover).trim();
  // Cloud field wins if present
  if (pl.cover_url && String(pl.cover_url).trim()) return String(pl.cover_url).trim();
  // Auto cover
  if (pl.autoCover && String(pl.autoCover).trim()) return String(pl.autoCover).trim();
  return '';
}

/**
 * ✅ Returns HTML markup for a playlist cover that matches your rules:
 * - If playlist has a manual/explicit cover => single image
 * - Else if >= 4 songs with covers => 2x2 grid of first 4 covers
 * - Else if >= 1 song with a cover => single image of first song cover
 * - Else => music icon
 *
 * sizeClass should be something like: "w-12 h-12" or "w-16 h-16"
 */
function getPlaylistCoverMarkup(pl, sizeClass) {
  const sc = sizeClass || "w-12 h-12";

  // ✅ Only treat MANUAL or CLOUD cover as "explicit".
  // (Do NOT treat pl.autoCover as explicit, or it blocks the 2x2 grid.)
  const manual = (pl && pl.cover && String(pl.cover).trim()) ? String(pl.cover).trim() : "";
  if (manual) {
    return `
      <div class="${sc} bg-zinc-800 bg-cover bg-center" style="background-image:url('${manual.replace(/'/g, "%27")}')"></div>
    `;
  }

  const cloud = (pl && pl.cover_url && String(pl.cover_url).trim()) ? String(pl.cover_url).trim() : "";
  if (cloud) {
    return `
      <div class="${sc} bg-zinc-800 bg-cover bg-center" style="background-image:url('${cloud.replace(/'/g, "%27")}')"></div>
    `;
  }

  // ✅ Build from song covers (this is what enables the 2x2 grid reliably)
  const songs = resolveTrackIdsToSongs(
  Array.isArray(pl?.trackIds) ? pl.trackIds : []
);


    // ✅ Build cover list from songs (NO dedupe — your rule is first 4 songs)
  const covers = [];

  for (const s of (songs || [])) {
    const c = (typeof getSongCoverFromPlaylistSong === "function")
      ? String(getSongCoverFromPlaylistSong(s) || "").trim()
      : "";

    if (!c) continue;

    covers.push(c);

    // we only need enough for a 2x2
    if (covers.length >= 4) break;
  }


  // helper: safe for single quotes in URLs
  const safeUrl = (u) => String(u || "").replace(/'/g, "%27");

  if (covers.length >= 4) {
    const c0 = safeUrl(covers[0]), c1 = safeUrl(covers[1]), c2 = safeUrl(covers[2]), c3 = safeUrl(covers[3]);
    return `
      <div class="${sc} grid grid-cols-2 grid-rows-2 overflow-hidden bg-zinc-800">
        <div class="w-full h-full bg-zinc-800 bg-cover bg-center" style="background-image:url('${c0}')"></div>
        <div class="w-full h-full bg-zinc-800 bg-cover bg-center" style="background-image:url('${c1}')"></div>
        <div class="w-full h-full bg-zinc-800 bg-cover bg-center" style="background-image:url('${c2}')"></div>
        <div class="w-full h-full bg-zinc-800 bg-cover bg-center" style="background-image:url('${c3}')"></div>
      </div>
    `;
  }

  if (covers.length >= 1) {
    const c0 = safeUrl(covers[0]);
    return `
      <div class="${sc} bg-zinc-800 bg-cover bg-center" style="background-image:url('${c0}')"></div>
    `;
  }

  return `
    <div class="${sc} flex items-center justify-center bg-zinc-800">
      <i class="fas fa-music text-zinc-600"></i>
    </div>
  `;
}


function playlistAutoCoverSignature(pl) {

    // Signature determines when we need to rebuild the auto cover
  const songs =
    (Array.isArray(pl?.songs) && pl.songs.length)
      ? pl.songs
      : resolveTrackIdsToSongs(Array.isArray(pl?.trackIds) ? pl.trackIds : []);

  const covers = songs.map(getSongCoverFromPlaylistSong).filter(Boolean);

  if (covers.length === 0) return "none";
  if (covers.length < 4) return `single:${covers[0]}`;
  return `grid:${covers.slice(0,4).join('|')}`;
}

function loadImageForCanvas(url) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

async function build2x2CoverDataURL(urls) {
  // urls length must be 4
  const size = 512;
  const cell = size / 2;

  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) return "";

  // background
  ctx.fillStyle = "#111";
  ctx.fillRect(0, 0, size, size);

  try {
    const imgs = await Promise.all(urls.map(u => loadImageForCanvas(u)));

    // draw 4 squares: [0]=top-left, [1]=top-right, [2]=bottom-left, [3]=bottom-right
    const positions = [
      [0, 0],
      [cell, 0],
      [0, cell],
      [cell, cell],
    ];

    imgs.forEach((img, i) => {
      const [x, y] = positions[i];

      // cover-crop to square
      const iw = img.naturalWidth || img.width;
      const ih = img.naturalHeight || img.height;
      const side = Math.min(iw, ih);
      const sx = Math.floor((iw - side) / 2);
      const sy = Math.floor((ih - side) / 2);

      ctx.drawImage(img, sx, sy, side, side, x, y, cell, cell);
    });

    // NOTE: this can fail if ANY image host blocks CORS (tainted canvas).
    return canvas.toDataURL('image/jpeg', 0.92);
  } catch (e) {
    return "";
  }
}

async function updatePlaylistAutoCoverById(playlistId) {
  const idx = playlists.findIndex(p => p.id === playlistId);
  if (idx === -1) return;

  const pl = playlists[idx];

  // If user has a manual cover, we do NOT overwrite it.
  if (getPlaylistManualCover(pl)) {
    pl.autoCoverSig = playlistAutoCoverSignature(pl); // still track sig
    savePlaylists(); // persist autoCover + autoCoverSig exactly once

    return;
  }

  const sig = playlistAutoCoverSignature(pl);
  if (pl.autoCoverSig === sig && getPlaylistAutoCover(pl)) {
    return; // already up to date
  }

      // Prefer real song objects if present, else resolve ids -> songs
  let songs =
    (Array.isArray(pl?.songs) && pl.songs.length)
      ? pl.songs
      : resolveTrackIdsToSongs(Array.isArray(pl?.trackIds) ? pl.trackIds : []);

  // ✅ CRITICAL: If the library isn't loaded yet, resolveTrackIdsToSongs can return empty.
  // In that case, fall back to stubs made from trackIds so getSongCoverFromPlaylistSong()
  // can still compute "Artist/Album/cover.jpg" from the path.
  if ((!Array.isArray(songs) || songs.length === 0) && Array.isArray(pl?.trackIds) && pl.trackIds.length) {
    songs = pl.trackIds.map((tid) => ({ id: tid, trackId: tid, key: tid, track_id: tid, r2_key: tid }));
  }

  const covers = songs.map(getSongCoverFromPlaylistSong).filter(Boolean);


  if (covers.length === 0) {
    pl.autoCover = "";
    pl.autoCoverSig = sig;
    savePlaylists();
    return;
  }

  if (covers.length < 4) {
    pl.autoCover = covers[0] || "";
    pl.autoCoverSig = sig;
    savePlaylists();
    return;
  }

  // 4+ => build 2x2 (try)
 let gridUrl = "";
try {
  gridUrl = await build2x2CoverDataURL(covers.slice(0, 4));
} catch (e) {
  gridUrl = "";
}

// ✅ Only store if we actually built a grid.
// If it fails (CORS/tainted canvas/etc), leave autoCover blank so UI can still compute 2x2 from song covers.
pl.autoCover = gridUrl || "";
pl.autoCoverSig = sig;

  savePlaylists();
}



// Menu plumbing
var playlistMenuTargetId = null;

function hidePlaylistMenu() {
  const m = document.getElementById('playlist-menu');
  const b = document.getElementById('playlist-menu-backdrop');

  // Mobile sheet close animation
  try {
    if (typeof isMobile === 'function' && isMobile() && m) {
      m.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      m.style.transform = 'translateY(100%)';
      if (b) b.style.opacity = '0';
      setTimeout(() => { try { m.classList.add('hidden'); } catch(_){} }, 210);
      setTimeout(() => { try { if (b) b.classList.add('hidden'); } catch(_){} }, 210);
    } else {
      if (m) m.classList.add('hidden');
      if (b) b.classList.add('hidden');
    }
  } catch (e) {
    if (m) m.classList.add('hidden');
    if (b) b.classList.add('hidden');
  }

  playlistMenuTargetId = null; try { window.playlistMenuTargetId = null; } catch (e) {}
}

function showPlaylistMenuAt(x, y, playlistId) {
  // ✅ prevent the global "click outside closes menu" from instantly closing this
  try { suppressPlaylistMenuCloseUntil = Date.now() + 350; } catch (e) {}

  // ✅ playlists use the unified #context-menu system (no #playlist-menu)
  try {
    const ctxFn =
      (typeof window.showContextMenuAt === 'function') ? window.showContextMenuAt :
      (typeof showContextMenuAt === 'function') ? showContextMenuAt :
      null;

    if (ctxFn) {
      let pl = null;
      try {
        const arr =
          (Array.isArray(window.playlists) ? window.playlists :
          (typeof playlists !== 'undefined' ? playlists : [])) || [];
        pl = arr.find(p => p && p.id === playlistId) || null;
      } catch (e) {}

      const pseudo = {
        type: 'playlist',
        id: playlistId,
        playlistId: playlistId,
        title: pl ? (pl.name || pl.title || 'Playlist') : 'Playlist',
        name:  pl ? (pl.name || pl.title || 'Playlist') : 'Playlist',
        cover: pl ? (pl.cover || pl.autoCover || '') : ''
      };

      ctxFn(x, y, pseudo, null);
      return;
    }
  } catch (err) {
    console.warn('showPlaylistMenuAt → context-menu failed:', err);
  }

  let m = document.getElementById('playlist-menu');


  // ✅ If the menu got removed from DOM, recreate it on demand
  if (!m) {
    try {
      const tmp = document.createElement('div');
      tmp.innerHTML = `
<div id="playlist-menu-backdrop" class="hidden fixed inset-0 z-[999998]" style="background: rgba(0,0,0,0.55);"></div>

<div id="playlist-menu" class="hidden fixed z-[999999] bg-[#232323] border border-white/10 rounded-2xl shadow-2xl overflow-hidden" style="width: min(560px, 92vw); left: 50%; transform: translate(-50%, 100%); bottom: 16px;">

  <div class="cm-handle"></div>

  <div style="padding: 12px 16px; border-bottom: 1px solid rgba(255,255,255,0.10); font-weight: 900; color: #fff;">
    Playlist options
  </div>

  <div class="menu-item" id="pm-add-to-folder">Add to folder</div>
  <div class="menu-item" id="pm-new-folder">Make new folder</div>

  <div style="height: 1px; background: rgba(255,255,255,0.08); margin: 6px 0;"></div>

  <div class="menu-item" id="pm-pin">Pin playlist</div>
  <div class="menu-item" id="pm-unpin">Unpin playlist</div>

  <div style="height: 1px; background: rgba(255,255,255,0.08); margin: 6px 0;"></div>

  <div class="menu-item" id="pm-cover-url">Change cover (paste image link)</div>
  <div class="menu-item" id="pm-cover-upload">Change cover (upload file)</div>
  <div class="menu-item" id="pm-cover-clear">Remove custom cover</div>

  <div style="height: 1px; background: rgba(255,255,255,0.08); margin: 6px 0;"></div>

  <div class="menu-item text-red-400" id="pm-delete">Delete playlist</div>
</div>
`.trim();

      document.body.appendChild(tmp.firstElementChild);

      // file input used by upload
      if (!document.getElementById('playlist-cover-file')) {
        const inp = document.createElement('input');
        inp.id = 'playlist-cover-file';
        inp.type = 'file';
        inp.accept = 'image/*';
        inp.className = 'hidden';
        document.body.appendChild(inp);
      }

      m = document.getElementById('playlist-menu');
    } catch (e) {}
  }

  if (!m) return;

  // ✅ Prevent “open click” from immediately closing it
  window.__playlistMenuSuppressCloseUntil = Date.now() + 350;



  playlistMenuTargetId = playlistId; try { window.playlistMenuTargetId = playlistId; } catch (e) {}



  const pinBtn   = document.getElementById('pm-pin');
  const unpinBtn = document.getElementById('pm-unpin');

  const pinned = isPinnedPlaylist(playlistId);
  if (pinBtn)   pinBtn.classList.toggle('hidden', pinned);
  if (unpinBtn) unpinBtn.classList.toggle('hidden', !pinned);

  if (!m.__playlistMenuBound) {

    m.__playlistMenuBound = true;


    const safeClose = () => { try { hidePlaylistMenu(); } catch (e) {} };

    const pin = document.getElementById('pm-pin');
    if (pin) {
      pin.addEventListener('click', () => {
        if (!playlistMenuTargetId) return;
        try { pinPlaylist(playlistMenuTargetId); } catch (e) {}
        safeClose();
        try { renderPlaylists(); } catch (e) {}
        try { renderHome(); } catch (e) {}
      });
    }

    const unpin = document.getElementById('pm-unpin');
    if (unpin) {
      unpin.addEventListener('click', () => {
        if (!playlistMenuTargetId) return;
        try { unpinPlaylist(playlistMenuTargetId); } catch (e) {}
        safeClose();
        try { renderPlaylists(); } catch (e) {}
        try { renderHome(); } catch (e) {}
      });
    }

    const coverUrl = document.getElementById('pm-cover-url');
    if (coverUrl) {
      coverUrl.addEventListener('click', async () => {
        if (!playlistMenuTargetId) return;
        const url = prompt('Paste image URL for playlist cover:');
        if (!url) return;
        try { await setPlaylistManualCover(playlistMenuTargetId, url); } catch (e) {}
        safeClose();
        try { renderPlaylists(); } catch (e) {}
        try { renderHome(); } catch (e) {}
        try { if (activePlaylistId === playlistMenuTargetId) showView('playlist', playlists.findIndex(p => p.id === playlistMenuTargetId)); } catch (e) {}
      });
    }

    const coverUpload = document.getElementById('pm-cover-upload');
    if (coverUpload) {
      coverUpload.addEventListener('click', () => {
        if (!playlistMenuTargetId) return;
        // Use your existing upload flow if present
        try { openPlaylistCoverUpload(playlistMenuTargetId); } catch (e) {}
        safeClose();
      });
    }

    const coverClear = document.getElementById('pm-cover-clear');
    if (coverClear) {
      coverClear.addEventListener('click', async () => {
        if (!playlistMenuTargetId) return;
        try { await clearPlaylistManualCover(playlistMenuTargetId); } catch (e) {}
        safeClose();
        try { renderPlaylists(); } catch (e) {}
        try { renderHome(); } catch (e) {}
        try { if (activePlaylistId === playlistMenuTargetId) showView('playlist', playlists.findIndex(p => p.id === playlistMenuTargetId)); } catch (e) {}
      });
    }

    const delBtn = document.getElementById('pm-delete');
    if (delBtn) {
      delBtn.addEventListener('click', async () => {
        const id = playlistMenuTargetId;
        if (!id) return;

        const pl = playlists.find(p => p.id === id);
        const name = pl ? (pl.name || 'this playlist') : 'this playlist';
        if (!confirm(`Delete "${name}"?\n\nThis will move it to Recently Deleted for 30 days.`)) return;


                // Close menu immediately so it feels responsive
        safeClose();

        // ✅ Save snapshot into Recently Deleted (30 days)
        try {
          const snapshot = pl ? JSON.parse(JSON.stringify(pl)) : null;
          if (snapshot) {
            window.addToRecentlyDeleted({
              kind: "playlist",
              playlistId: id,
              name: String(snapshot.name || snapshot.title || "Playlist"),
              data: snapshot,
              deletedAt: new Date().toISOString(),
              expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString()
            });
          }
        } catch (e) {}

        // Delete in cloud first so the other device sees it too

        try {
          if (typeof window.deletePlaylistFromCloud === 'function') {
            await window.deletePlaylistFromCloud(id);
          } else if (typeof window.deletePlaylistInCloud === 'function') {
            await window.deletePlaylistInCloud(id);
          }
        } catch (e) {
          console.warn(e);
          // still continue locally so UI doesn't get stuck
        }

        // Remove locally
        try { playlists = playlists.filter(p => p.id !== id); } catch (e) {}
        try { localStorage.setItem('playlists', JSON.stringify(playlists)); } catch (e) {}

        // Remove from recents/history so it doesn't keep showing
        try {
          let history = JSON.parse(localStorage.getItem('historyLog') || '[]');
          if (!Array.isArray(history)) history = [];
          history = history.filter(h => !(h && h.type === 'playlist' && h.id === id));
          localStorage.setItem('historyLog', JSON.stringify(history));
        } catch (e) {}

        // Re-pull from cloud to be safe + re-render
        try { if (typeof window.loadPlaylistsFromCloud === 'function') await window.loadPlaylistsFromCloud(); } catch (e) {}
        try { renderPlaylists(); } catch (e) {}
        try { renderHome(); } catch (e) {}
        try { renderHistory(); } catch (e) {}

        // If you were inside that playlist, navigate away
        try {
          if (activePlaylistId === id) {
            activePlaylistId = null;
            activePlaylistIndex = null;
            showView('library');
          }
        } catch (e) {}
      });
    }
  }

  // Position + show menu
  const b = document.getElementById('playlist-menu-backdrop');

  // Mobile: open as bottom sheet (same vibe as Add to playlist)
  if (typeof isMobile === 'function' && isMobile()) {
    if (b) {
      b.classList.remove('hidden');
      b.style.opacity = '0';
      b.onclick = () => { try { hidePlaylistMenu(); } catch(e){} };
    }

    m.classList.remove('hidden');
    m.style.left = '50%';
    m.style.top = 'auto';
    m.style.bottom = '16px';

    // start hidden (off-screen), then animate up
    m.style.transition = 'transform 220ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    m.style.transform = 'translate(-50%, 100%)';
    requestAnimationFrame(() => {
      try { if (b) b.style.opacity = '1'; } catch(e){}
      try { m.style.transform = 'translate(-50%, 0)'; } catch(e){}
    });

    return;
  }

  // Desktop: popover at pointer
  m.style.left = `${x}px`;
  m.style.top = `${y}px`;
  m.classList.remove('hidden');
}


// -----------------------
// HERO 3-DOTS MENU (playlist OR album)
// -----------------------

function openPlaylistPinMenuFromHero(e) {
  try {
        // Prefer global playlist state, but fall back to the current view
    let id = (typeof activePlaylistId !== 'undefined') ? activePlaylistId : null;

    // Fallback 1: navCurrent (you already expose window.navCurrent)
    if (!id && window.navCurrent && window.navCurrent.type === 'playlist' && window.navCurrent.playlistId) {
      id = window.navCurrent.playlistId;
    }

// Fallback 2: dataset on the hero root (if present)

    if (!id) {
      const hero = document.getElementById('hero');
      const pid = hero ? hero.getAttribute('data-playlist-id') : null;
      if (pid) id = pid;
    }

    if (!id) {
      // Album fallback: hero 3-dots should open album cover menu when not in a playlist
      if (
        typeof activeAlbumName !== 'undefined' &&
        typeof activeAlbumArtist !== 'undefined' &&
        activeAlbumName &&
        activeAlbumArtist
      ) {
        const rect = e?.currentTarget?.getBoundingClientRect?.();
        const x = rect ? (rect.left + rect.width / 2) : (e?.clientX || 16);
        const y = rect ? (rect.bottom + 8) : (e?.clientY || 16);

        try {
          showAlbumCoverMenuAt(Math.round(x), Math.round(y), activeAlbumArtist, activeAlbumName);
        } catch (err) {}
      }
      return;
    }

    const rect = e?.currentTarget?.getBoundingClientRect?.();


    const x = rect ? (rect.left + rect.width / 2) : (e?.clientX || 16);
    const y = rect ? (rect.bottom + 8) : (e?.clientY || 16);

    // open the same playlist menu used everywhere else
    showPlaylistMenuAt(Math.round(x), Math.round(y), id);
  } catch (err) {
    console.warn(err);
  }
}

(function bindHeroMoreButtonOnce() {

  const btn = document.getElementById('hero-more-btn');
  // ✅ If the button already has an inline onclick, do NOT add a second listener.
  if (!btn || btn.__bound || typeof btn.onclick === 'function') return;
  btn.__bound = true;

    btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    // ✅ Mobile: if song multi-select is on, hero 3-dots opens the multi-select action sheet
    try {
      if (window.innerWidth <= 768 && window.__songSelect && window.__songSelect.enabled) {
        const urls = (typeof getSelectedSongUrls === 'function') ? getSelectedSongUrls() : [];
        if (urls && urls.length) {
          try { showMultiSelectContextMenuFromHero(btn); } catch (err) {}
          return;
        }
      }
    } catch (err) {}

    // If inside a playlist → open playlist menu

    if (typeof activePlaylistId !== 'undefined' && activePlaylistId) {
      try { openPlaylistPinMenuFromHero(e); } catch (err) {}
      return;
    }

    // Otherwise → album menu
    if (!activeAlbumName || !activeAlbumArtist) return;

    const r = btn.getBoundingClientRect();
    try {
      showAlbumCoverMenuAt(
        r.left,
        r.bottom + 8,
        activeAlbumArtist,
        activeAlbumName
      );
    } catch (err) {}
  }, { passive: false });
})();

function attachPlaylistPressHandlers(el, playlistId) {
  if (!el) return;

  // Desktop: right-click
  el.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopPropagation();

  // ✅ Prevent the very next "click" from auto-closing the menu (Chrome fires a click after right-click)
  window.__playlistMenuSuppressCloseUntil = Date.now() + 500;

  try { hidePlaylistMenu(); } catch (err) {}
  try { contextMenu.style.display = 'none'; } catch (err) {}

  showPlaylistMenuAt(e.clientX, e.clientY, playlistId);
});


  // Mobile: press-and-hold (long press)
  let pressTimer = null;
  el.addEventListener('touchstart', (e) => {
    if (!e.touches || !e.touches[0]) return;
    const t = e.touches[0];
    pressTimer = setTimeout(() => {
      showPlaylistMenuAt(t.clientX, t.clientY, playlistId);
    }, 500);
  }, { passive: true });

  const cancel = () => { if (pressTimer) clearTimeout(pressTimer); pressTimer = null; };
  el.addEventListener('touchend', cancel, { passive: true });
  el.addEventListener('touchmove', cancel, { passive: true });
}

// Menu buttons + outside click (run AFTER the page HTML exists)
window.addEventListener('DOMContentLoaded', () => {
  // ✅ Disabled: playlist menu buttons are bound inside showPlaylistMenuAt() (m.__playlistMenuBound)
  // This block causes duplicate bindings (ex: duplicate delBtn) and breaks the 3-dots menu.
  return;

  // ✅ Make sure queue clear buttons get wired when DOM exists
  try { if (typeof wireQueueClearButtons === 'function') wireQueueClearButtons(); } catch (e) {}

  const pinBtn = document.getElementById('pm-pin');
  const unpinBtn = document.getElementById('pm-unpin');
  const menu = document.getElementById('playlist-menu');

  const coverUrlBtn = document.getElementById('pm-cover-url');
  const coverUploadBtn = document.getElementById('pm-cover-upload');
  const coverClearBtn = document.getElementById('pm-cover-clear');
  const fileInput = document.getElementById('playlist-cover-file');

  const delBtn = document.getElementById('pm-delete');

  // If the menu HTML isn't on the page, do nothing (prevents crashes)
  if (!pinBtn || !unpinBtn || !menu) return;

  function findPlaylistIndexById(id) {
    return playlists.findIndex(pl => pl.id === id);
  }

  function setPlaylistCover(playlistId, coverValue) {
    const idx = findPlaylistIndexById(playlistId);
    if (idx === -1) return;

    playlists[idx].cover = coverValue || "";
    savePlaylists();
    renderPlaylists();

    // If currently viewing this playlist, re-render the page hero
    if (activePlaylistId === playlistId && activePlaylistIndex != null) {
      showView('playlist', activePlaylistIndex);
    }
  }

  pinBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!playlistMenuTargetId) return;
    pinPlaylist(playlistMenuTargetId);
    hidePlaylistMenu();
  };

  unpinBtn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!playlistMenuTargetId) return;
    unpinPlaylist(playlistMenuTargetId);
    hidePlaylistMenu();
  };

    // ✅ DELETE PLAYLIST (local + cloud if your cloud delete function exists)
  if (delBtn && !delBtn.__bound) {
    delBtn.__bound = true;

    delBtn.onclick = async (e) => {
      e.preventDefault();
      e.stopPropagation();

      const id = playlistMenuTargetId;
      if (!id) { hidePlaylistMenu(); return; }

      // 1) Cloud delete MUST succeed (otherwise it will reappear on refresh)
      if (typeof deletePlaylistFromCloud === 'function') {
        try {
          await deletePlaylistFromCloud(id);
        } catch (err) {
          console.warn('Cloud delete failed:', err);
          alert('Cloud delete failed. Playlist was NOT deleted.\n\n' + (err?.message || String(err)));
          hidePlaylistMenu();
          return;
        }
      } else {
        alert('Cloud delete function is missing (deletePlaylistFromCloud). Playlist was NOT deleted.');
        hidePlaylistMenu();
        return;
      }

      // 2) Delete locally so UI updates immediately
      const idx = findPlaylistIndexById(id);
      if (idx !== -1) playlists.splice(idx, 1);

      savePlaylists();

      // 3) Refresh every place playlists appear
      try { renderPlaylists(); } catch (e) {}
      try { renderHome(); } catch (e) {}

      // 4) If you were inside that playlist, kick back to home/library
      if (activePlaylistId === id) {
        activePlaylistId = null;
        activePlaylistIndex = null;
        try { showView('home'); } catch (e) {}
      }

      hidePlaylistMenu();
    };
  }
});



  // -----------------------
// PLAYLIST MENU compatibility wrappers (so BOTH menu wiring systems work)
window.setPlaylistManualCover = async function (playlistId, url) {
  try { setPlaylistManualCoverById(playlistId, url); } catch (e) { console.warn(e); }
};

window.clearPlaylistManualCover = async function (playlistId) {
  try { clearPlaylistManualCoverById(playlistId); } catch (e) { console.warn(e); }
};

window.openPlaylistCoverUpload = function (playlistId) {
  try {
    // keep target consistent with the rest of your menu logic
    window.playlistMenuTargetId = playlistId;

    const fileInput = document.getElementById('playlist-cover-file');
    if (!fileInput) return;

    fileInput.value = "";
    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      try {
        const reader = new FileReader();
        reader.onload = () => {
          try { setPlaylistManualCoverById(window.playlistMenuTargetId, String(reader.result || '')); } catch (err) {}
          try { renderPlaylists(); } catch (err) {}
          try { hidePlaylistMenu(); } catch (err) {}
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.warn(err);
      }
    };

    fileInput.click();
  } catch (e) {
    console.warn(e);
  }
};

// PLAYLIST MENU buttons (bind once, after DOM exists)
window.addEventListener('DOMContentLoaded', () => {

  const menu = document.getElementById('playlist-menu');
  const coverUrlBtn = document.getElementById('pm-cover-url');
  const coverUploadBtn = document.getElementById('pm-cover-upload');
    const coverClearBtn = document.getElementById('pm-cover-clear');
  const addToFolderBtn = document.getElementById('pm-add-to-folder');
  const newFolderBtn  = document.getElementById('pm-new-folder');
  const delBtn = document.getElementById('pm-delete');
  const fileInput = document.getElementById('playlist-cover-file');


    // If menu isn't in DOM, nothing to bind
  if (!menu) return;

  // ✅ Folder prototype (no backend yet)
  if (addToFolderBtn) addToFolderBtn.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    alert("Prototype: Add to folder (coming next).");
    try { hidePlaylistMenu(); } catch (err) {}
  };

  if (newFolderBtn) newFolderBtn.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    alert("Prototype: Make new folder (coming next).");
    try { hidePlaylistMenu(); } catch (err) {}
  };

  // ✅ Cover URL

  if (coverUrlBtn) coverUrlBtn.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!window.playlistMenuTargetId) return;

    const url = prompt("Paste an image URL for this playlist cover:");
    if (!url) return;

    try { setPlaylistManualCoverById(window.playlistMenuTargetId, url); } catch (err) { console.warn(err); }
    try { renderPlaylists(); } catch (err) {}
    try { hidePlaylistMenu(); } catch (err) {}
  };

  // ✅ Cover upload (use the hidden input already in your HTML)
  if (coverUploadBtn && fileInput) coverUploadBtn.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!window.playlistMenuTargetId) return;

    fileInput.value = "";
    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;

      try {
        const reader = new FileReader();
        reader.onload = () => {
          try { setPlaylistManualCoverById(window.playlistMenuTargetId, String(reader.result || '')); } catch (err) {}
          try { renderPlaylists(); } catch (err) {}
          try { hidePlaylistMenu(); } catch (err) {}
        };
        reader.readAsDataURL(file);
      } catch (err) {
        console.warn(err);
      }
    };
    fileInput.click();
  };

  // ✅ Clear cover
  if (coverClearBtn) coverClearBtn.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!window.playlistMenuTargetId) return;

    try { clearPlaylistManualCoverById(window.playlistMenuTargetId); } catch (err) { console.warn(err); }
    try { renderPlaylists(); } catch (err) {}
    try { hidePlaylistMenu(); } catch (err) {}
  };

  // ✅ Delete playlist
  if (delBtn) delBtn.onclick = async (e) => {
    e.preventDefault(); e.stopPropagation();
    const id = window.playlistMenuTargetId;
    if (!id) return;

    const pl = (Array.isArray(playlists) ? playlists.find(p => p.id === id) : null);
    const name = pl?.name || "this playlist";
if (!confirm(`Delete "${name}"?\n\nThis will move it to Recently Deleted for 30 days.`)) return;


    try {
      // remove locally
      const idx = playlists.findIndex(p => p.id === id);
      if (idx !== -1) playlists.splice(idx, 1);
      try { savePlaylists(); } catch (err) {}
      try { renderPlaylists(); } catch (err) {}

      // best-effort: also remove from cloud if helper exists
      try { if (typeof window.deletePlaylistFromCloud === 'function') await window.deletePlaylistFromCloud(id); } catch (err) {}

      // if viewing it, go back
      try {
        if (activePlaylistId === id) {
          activePlaylistId = null;
          activePlaylistIndex = null;
          showView('library');
        }
      } catch (err) {}
    } catch (err) {
      console.warn(err);
    }

    try { hidePlaylistMenu(); } catch (err) {}
    try { closeContextMenu(); } catch (err) {}
  };

  // Outside click closes the menu
  document.addEventListener('click', (e) => {
    // ✅ If we just opened via right-click, ignore the follow-up click that Chrome fires
    if (window.__playlistMenuSuppressCloseUntil && Date.now() < window.__playlistMenuSuppressCloseUntil) {
      return;
    }

    if (menu.classList.contains('hidden')) return;
    if (menu.contains(e.target)) return;
    try { hidePlaylistMenu(); } catch (err) {}
  });

  // Scroll closes the menu
  window.addEventListener('scroll', () => {
    try { hidePlaylistMenu(); } catch (err) {}
  }, true);
});




// ✅ Canonical track id helper (global)
// Turns URLs or encoded ids into the stable R2 path: "Artist/Album/Song.mp3"
function canonTrackId(v) {
  let s = String(v || "").trim();
  if (!s) return "";

  // If we were given a full URL, pull out ?id=
  try {
    if (s.includes("://")) {
      const u = new URL(s);
      const id = u.searchParams.get("id");
      if (id) s = id;
    }
  } catch (e) {}

  // If we were given just a query-ish string
  if (s.includes("?id=")) {
    try {
      const part = s.split("?id=")[1] || "";
      s = part.split("&")[0] || part;
    } catch (e) {}
  }

  // Decode %2F etc
  try { s = decodeURIComponent(s); } catch (e) {}

  // Strip leading slash if present
  s = s.replace(/^\/+/, "").trim();

  return s;
}

function renderPlaylists() {
  const list = document.getElementById('dynamic-playlists-list');

  const sub = document.getElementById('playlist-submenu');
  if (!list || !sub) return;

    list.innerHTML = '';

  // ✅ CRITICAL: do NOT wipe submenu while it's open (it erases the playlist list we append)
  if (!sub.classList.contains('open') && sub.style.display !== 'block') {
    sub.innerHTML = `
      <div class="cm-handle"></div>

      <div class="cm-submenu-header">
        <div class="cm-back" onclick="closePlaylistSubmenu(event)">
          <i class="fas fa-arrow-left"></i>
        </div>
        <div class="cm-submenu-title">Add song to playlist</div>
      </div>

      <div class="menu-item border-b border-zinc-700" onclick="createNewPlaylist()"><b>+ New Playlist</b></div>

      <!-- playlists get appended here by JS -->
      <div id="playlist-submenu-items"></div>
    `;
  }


  // ---------
  // Sort playlists by most-recent first (updated_at, else created_at)
  // ---------
  const sorted = (Array.isArray(playlists) ? playlists.slice() : []).sort((a, b) => {
    const ta = Date.parse(a.updated_at || a.created_at || '') || 0;
    const tb = Date.parse(b.updated_at || b.created_at || '') || 0;
    return tb - ta;
  });

  // Sidebar should show ONLY 4 playlists
  const sidebarPlaylists = sorted.slice(0, 4);

  // Render the left sidebar rows (only 4)
  sidebarPlaylists.forEach((pl) => {
    const div = document.createElement('div');
    div.className = "flex items-center gap-3 p-2 rounded hover:bg-zinc-900 cursor-pointer group";

    // Find the real index inside playlists[] for showView('playlist', index)
    const i = playlists.findIndex(p => p.id === pl.id);
    div.onclick = () => showView('playlist', i);

    const cover = getEffectivePlaylistCover(pl);

        // Count: prefer canonical trackIds, else loaded songs, else stored fallback, else 0
    const count =
      (Array.isArray(pl.trackIds) ? pl.trackIds.length : null) ??
      (Array.isArray(pl.songs) ? pl.songs.length : null) ??
      (Number.isFinite(pl.songCount) ? pl.songCount : 0);

    div.innerHTML = `
            ${getPlaylistCoverMarkup(pl, "playlist-cover w-12 h-12 rounded overflow-hidden")}

      <div class="flex-1 truncate">

        <div class="text-sm font-bold truncate flex items-center gap-2">
          <span class="truncate">${pl.name}</span>
        </div>
        <div class="text-xs text-zinc-400">${count} songs</div>
      </div>
    `;

    // Keep your existing right-click + mobile long-press menu for the whole row
    attachPlaylistPressHandlers(div, pl.id);

    // DESKTOP ONLY: press-and-hold on the COVER opens the playlist menu
    const coverEl = div.querySelector('.playlist-cover');
    if (coverEl) {
      let holdTimer = null;

      coverEl.addEventListener('pointerdown', (e) => {
        if (window.innerWidth <= 768) return;

        e.preventDefault();
        e.stopPropagation();

        holdTimer = setTimeout(() => {
          try { hidePlaylistMenu(); } catch (err) {}
          try { closeContextMenu(); } catch (err) {}
          showPlaylistMenuAt(e.clientX, e.clientY, pl.id);
        }, 450);
      });

      const cancelHold = () => {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;
      };

      coverEl.addEventListener('pointerup', cancelHold);
      coverEl.addEventListener('pointercancel', cancelHold);
      coverEl.addEventListener('pointerleave', cancelHold);

      coverEl.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try { hidePlaylistMenu(); } catch (err) {}
        try { closeContextMenu(); } catch (err) {}
        showPlaylistMenuAt(e.clientX, e.clientY, pl.id);
      });
    }

    list.appendChild(div);
  });

    // Build the “Add to playlist” submenu (ALL playlists, not limited to 4)

  // ✅ CRITICAL: If the Add-to-playlist sheet is already open, DO NOT touch its DOM.
  // Background cloud refresh calls renderPlaylists() and was wiping bubbles/covers.
  if (sub && sub.classList && sub.classList.contains('open')) {
    return;
  }

  const psItems = document.getElementById('playlist-submenu-items');

  // ✅ Always clear the scroll list first (prevents duplicates)
  if (psItems) psItems.innerHTML = '';

  // ✅ Remove any stray menu-item children that got appended directly to #playlist-submenu
  if (sub && sub.children) {
    [...sub.children].forEach((n) => {
      try {
        if (n && n.classList && n.classList.contains('menu-item') && n.id !== 'playlist-submenu-items') {
          n.remove();
        }
      } catch (e) {}
    });
  }

  playlists.forEach((pl, i) => {


    const item = document.createElement('div');
    item.className = "menu-item";
    item.innerText = pl.name;

    item.onclick = async () => {
  const s = menuTargetSong;
  if (!s) return;

  // Resolve trackId robustly (canonical ID is the R2 path)
  let trackId =
    s.id ||
    s.r2Path ||
    s.track_id ||
    s.trackId ||
    s.key ||
    s.r2_key ||
    "";

  // If still missing, try extracting ?id=... from the song URL
  if (!trackId) {
    const u = s.link || s.url || "";
    try {
      const parsed = new URL(u, window.location.origin);
      trackId = parsed.searchParams.get("id") || "";
    } catch (_) {}
  }

  trackId = canonTrackId(trackId);

  if (!trackId) {
    alert("Missing trackId for this song.");
    return;
  }

   // 1) CLOUD FIRST (so refresh + other devices match)
  try {
    if (typeof window.addTrackToPlaylistInCloud === "function") {
      await window.addTrackToPlaylistInCloud(pl.id, trackId);
    } else {
      throw new Error("addTrackToPlaylistInCloud is missing");
    }
  } catch (e) {
    console.warn("Cloud add failed:", e);
    alert("Couldn’t add to playlist (cloud sync failed). Try again.");
    return;
  }

  // 2) LOCAL UPDATE (IDs-only) + SAVE (so a refresh keeps it immediately too)
  if (!Array.isArray(pl.trackIds)) pl.trackIds = [];

  const existingCanon = new Set(pl.trackIds.map(canonTrackId));


  if (!existingCanon.has(trackId)) {
    pl.trackIds.push(trackId);
  }

    // ✅ Playlists are IDs-only: do NOT store song objects on playlist
  savePlaylists();

  // Update auto cover after adding
  try { await updatePlaylistAutoCoverById(pl.id); } catch (e) {}

  // keep a fallback count even if songs later get replaced by cloud
  pl.songCount = pl.trackIds.length;
  pl.updated_at = new Date().toISOString();

    renderPlaylists();

  // ✅ If you are currently viewing THIS playlist, force the playlist view to re-render
  try {
    if (typeof activePlaylistId !== "undefined" && activePlaylistId === pl.id) {
      const idx = (Array.isArray(playlists) ? playlists.findIndex(p => p && p.id === pl.id) : -1);
      if (idx >= 0 && typeof showView === "function") {
        showView("playlist", idx);
      }
    }
  } catch (e) {}

  closeContextMenu();

  // ✅ Spotify-style confirmation toast

  try {
    const rawTitle = (s && (s.title || s.name || s.fileName)) ? (s.title || s.name || s.fileName) : "";
    const songLabel = rawTitle ? String(rawTitle).replace(/\.[^/.]+$/, "") : "Song";
    const plName = pl?.name || "playlist";
    showActionToast(`"${songLabel}" added to ${plName}`);
  } catch (e) {}


  // ✅ Pull latest cloud playlist meta soon (counts/covers/other devices)
  try { if (typeof window.forceCloudPlaylistPull === "function") window.forceCloudPlaylistPull(); } catch (e) {}
};


    if (psItems) psItems.appendChild(item);

  });
} // This closes renderPlaylists



// --- Expose playlist globals ---
window.playlists = (typeof playlists !== 'undefined') ? playlists : window.playlists;
window.renderPlaylists = renderPlaylists;
window.createNewPlaylist = createNewPlaylist;
window.openPlaylistSubmenu = openPlaylistSubmenu;
window.closePlaylistSubmenu = closePlaylistSubmenu;
window.playPlaylistById = playPlaylistById;
window.savePlaylists = savePlaylists;
window.ensurePlaylistIds = ensurePlaylistIds;
window.getEffectivePlaylistCover = getEffectivePlaylistCover;
window.getPlaylistCoverMarkup = getPlaylistCoverMarkup;
window.updatePlaylistAutoCoverById = updatePlaylistAutoCoverById;
window.hidePlaylistMenu = hidePlaylistMenu;
window.showPlaylistMenuAt = showPlaylistMenuAt;
window.attachPlaylistPressHandlers = attachPlaylistPressHandlers;
window.openPlaylistPinMenuFromHero = openPlaylistPinMenuFromHero;
window.isPinnedPlaylist = isPinnedPlaylist;
window.pinPlaylist = pinPlaylist;
window.unpinPlaylist = unpinPlaylist;
