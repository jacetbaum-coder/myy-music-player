/* -----------------------
   SETTINGS + RECENTLY DELETED UI
------------------------ */

function __effectiveUserId() {
  return String((window.APP_USER_ID || localStorage.getItem("app_user_id") || "")).trim();
}

let __rdType = "playlist"; // "playlist" | "album"
let __rdItems = [];

function __setRdTab(type) {
  __rdType = (type === "album") ? "album" : "playlist";

  const a = document.getElementById("rd-tab-albums");
  const p = document.getElementById("rd-tab-playlists");

  if (p) {
    const on = (__rdType === "playlist");
    p.classList.toggle("bg-[#1db954]", on);
    p.classList.toggle("text-black", on);
    p.classList.toggle("bg-white/10", !on);
    p.classList.toggle("text-white", !on);
  }

  if (a) {
    const on = (__rdType === "album");
    a.classList.toggle("bg-[#1db954]", on);
    a.classList.toggle("text-black", on);
    a.classList.toggle("bg-white/10", !on);
    a.classList.toggle("text-white", !on);
  }

  __renderRecentlyDeleted();
}

async function __fetchRecentlyDeleted(type) {
  const uid = __effectiveUserId();
  if (!uid) throw new Error("Missing userId");
  const t = (type === "album") ? "album" : "playlist";

  const url =
    "https://music-streamer.jacetbaum.workers.dev/api/recently-deleted?userId=" +
    encodeURIComponent(uid) +
    "&type=" + encodeURIComponent(t);

  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.ok) throw new Error(data?.error || "Failed to load Recently Deleted");

  return Array.isArray(data.items) ? data.items : [];
}

function __formatDaysLeft(expiresAt) {
  const now = Date.now();
  const ms = Number(expiresAt || 0) - now;
  if (!Number.isFinite(ms)) return "";
  const days = Math.max(0, Math.ceil(ms / (24 * 3600 * 1000)));
  if (days === 1) return "1 day left";
  return days + " days left";
}

async function __restoreRecentlyDeletedItem(item) {
  const uid = __effectiveUserId();
  if (!uid) throw new Error("Missing userId");
  const type = item?.type || __rdType;
  const id = item?.id;
  if (!id) throw new Error("Missing id");

  // Worker route name can vary; try a couple safe options.
  const tryUrls = [
    {
      url: "https://music-streamer.jacetbaum.workers.dev/api/recently-deleted/restore?userId=" +
        encodeURIComponent(uid) + "&type=" + encodeURIComponent(type) + "&id=" + encodeURIComponent(id),
      method: "POST",
      body: null
    },
    {
      url: "https://music-streamer.jacetbaum.workers.dev/api/recently-deleted/restore",
      method: "POST",
      body: JSON.stringify({ userId: uid, type, id })
    }
  ];

  let lastErr = null;
  for (const t of tryUrls) {
    try {
      const res = await fetch(t.url, {
        method: t.method,
        headers: t.body ? { "Content-Type": "application/json" } : undefined,
        body: t.body
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data && data.ok) return data;
      lastErr = new Error(data?.error || "Restore failed");
    } catch (e) {
      lastErr = e;
    }
  }

  throw lastErr || new Error("Restore failed");
}

async function __deleteRecentlyDeletedForever(item) {
  const uid = __effectiveUserId();
  if (!uid) throw new Error("Missing userId");
  const type = item?.type || __rdType;
  const id = item?.id;
  if (!id) throw new Error("Missing id");

  // Your console error proved this endpoint wants userId present.
  // We include it in querystring AND body to be extra safe.
  const url =
    "https://music-streamer.jacetbaum.workers.dev/api/recently-deleted/forever?userId=" +
    encodeURIComponent(uid) +
    "&type=" + encodeURIComponent(type) +
    "&id=" + encodeURIComponent(id);

  const res = await fetch(url, {
    method: "DELETE",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ userId: uid, type, id })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data || !data.ok) throw new Error(data?.error || "Delete forever failed");
  return data;
}

async function __renderRecentlyDeleted() {
  const status = document.getElementById("rd-status");
  const list = document.getElementById("rd-list");
  const q = String(document.getElementById("rd-search")?.value || "").trim().toLowerCase();

  if (status) { status.classList.remove("hidden"); status.textContent = "Loading…"; }
  if (list) list.innerHTML = "";

  try {
    __rdItems = await __fetchRecentlyDeleted(__rdType);
  } catch (e) {
    console.warn(e);
    if (status) status.textContent = "Couldn’t load Recently Deleted.";
    return;
  }

  let filtered = __rdItems.filter(it => {
    const name = String(it?.name || "").toLowerCase();
    if (!q) return true;
    return name.includes(q);
  });

  // ✅ Sort (newest/oldest) by deletedAt (fallback to expiresAt)
  try {
    const mode = String(document.getElementById("rd-sort")?.value || "newest");
    const tms = (it) => {
      const a = Date.parse(String(it?.deletedAt || it?.deleted_at || it?.expiresAt || it?.expires_at || ""));
      return Number.isFinite(a) ? a : 0;
    };
    filtered.sort((a,b) => (mode === "oldest") ? (tms(a) - tms(b)) : (tms(b) - tms(a)));
  } catch (e) {}

  if (status) {
    status.textContent = filtered.length ? (filtered.length + " item(s)") : "Nothing here.";
  }

  if (!list) return;

  filtered.forEach((it) => {
    const row = document.createElement("div");
    row.className = "flex items-center justify-between gap-3 px-4 py-3 rounded-2xl bg-white/10";

    const left = document.createElement("div");
    left.className = "min-w-0";

    const title = document.createElement("div");
    title.className = "font-extrabold truncate";
    title.textContent = String(it?.name || it?.id || "Untitled");

    const sub = document.createElement("div");
    sub.className = "text-xs text-white/60";
    sub.textContent = __formatDaysLeft(it?.expiresAt);

    left.appendChild(title);
    left.appendChild(sub);

    const right = document.createElement("div");
    right.className = "flex items-center gap-2";

    const restore = document.createElement("button");
    restore.type = "button";
    restore.className = "px-3 py-2 rounded-full bg-[#1db954] text-black font-extrabold text-xs active:scale-95";
    restore.textContent = "Restore";

    restore.onclick = async () => {
      try {
        await __restoreRecentlyDeletedItem(it);
        await __renderRecentlyDeleted();
        // best-effort: refresh playlists UI if needed
        try { if (typeof window.loadPlaylistsFromCloud === "function") await window.loadPlaylistsFromCloud(); } catch (e) {}
        try { renderPlaylists(); } catch (e) {}
        try { renderHome(); } catch (e) {}
      } catch (e) {
        console.warn(e);
        alert("Restore failed.");
      }
    };

    const forever = document.createElement("button");
    forever.type = "button";
    forever.className = "px-3 py-2 rounded-full bg-white/10 text-white font-extrabold text-xs active:scale-95";
    forever.textContent = "Delete forever";

    forever.onclick = async () => {
      const name = String(it?.name || "this item");
      if (!confirm(`Delete "${name}" forever? This cannot be undone.`)) return;

      try {
        await __deleteRecentlyDeletedForever(it);
        await __renderRecentlyDeleted();
      } catch (e) {
        console.warn(e);
        alert("Delete forever failed.");
      }
    };

    right.appendChild(restore);
    right.appendChild(forever);

    row.appendChild(left);
    row.appendChild(right);

    list.appendChild(row);
  });
}

(function bindSettingsAndRDViews() {
  const backSettings = document.getElementById("settings-back");
  const openSync = document.getElementById("settings-open-sync");
  const openRD = document.getElementById("settings-open-recently-deleted");

  const rdBack = document.getElementById("rd-back");

  // Vertical tabs (new)
  const rdTabAlbums    = document.getElementById("rd-tab-albums");
  const rdTabPlaylists = document.getElementById("rd-tab-playlists");

  const rdSearch = document.getElementById("rd-search");
  const rdSort   = document.getElementById("rd-sort");

  if (backSettings) backSettings.addEventListener("click", () => {
    try { showView("home"); } catch (e) {}
  });

  if (openSync) openSync.addEventListener("click", async () => {
    try {
      if (typeof window.openSyncDevicesModal === "function") {
        await window.openSyncDevicesModal();
      } else {
        alert("Sync modal missing.");
      }
    } catch (e) {
      console.warn(e);
      alert("Could not open Sync Devices.");
    }
  });

  // ✅ Settings -> Recently Deleted (route you proved works)
  if (openRD) openRD.addEventListener("click", () => {
    try { showView("recently-deleted"); } catch (e) {}

    // ✅ Default to Albums when you arrive
    try { if (typeof window.__setRdTab === "function") window.__setRdTab("album"); } catch (e) {}
    try { if (typeof window.__renderRecentlyDeleted === "function") window.__renderRecentlyDeleted(); } catch (e) {}
  });

  if (rdBack) rdBack.addEventListener("click", () => {
    try { showView("settings"); } catch (e) {}
  });

  // Tabs
  if (rdTabAlbums)    rdTabAlbums.addEventListener("click",    () => { try { __setRdTab("album"); } catch (e) {} });
  if (rdTabPlaylists) rdTabPlaylists.addEventListener("click", () => { try { __setRdTab("playlist"); } catch (e) {} });

  // Search + sort
  if (rdSearch) rdSearch.addEventListener("input", () => { try { __renderRecentlyDeleted(); } catch (e) {} });
  if (rdSort)   rdSort.addEventListener("change", () => { try { __renderRecentlyDeleted(); } catch (e) {} });

  // expose for console debugging
  window.renderRecentlyDeleted = __renderRecentlyDeleted;
  window.setRecentlyDeletedTab = __setRdTab;
})();
