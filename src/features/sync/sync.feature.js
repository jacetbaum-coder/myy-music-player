// =============================================================================
// SYNC FEATURE — src/features/sync/sync.feature.js
// Cross-device sync identity, cloud refresh orchestration, and sync modal UI.
// =============================================================================

// -----------------------
// CLOUD PLAYLIST SYNC (D1 via Worker)
// -----------------------

// A stable "account id" is REQUIRED for cross-device sync.
// localStorage is NOT shared across devices, so we support pairing via URL (?userId=...)
// or manually via window.setSyncCode("u_...").

// Base URL for the Cloudflare Worker (used by deleteAlbumFromCloud and others)
const CLOUDFLARE_WORKER_URL = "https://music-streamer.jacetbaum.workers.dev/";
window.CLOUDFLARE_WORKER_URL = CLOUDFLARE_WORKER_URL;

function makeUserId() {
  return "u_" + Date.now() + "_" + Math.random().toString(16).slice(2);
}

function readUserIdFromUrl() {
  try {
    const sp = new URLSearchParams(window.location.search || "");
    return (
      sp.get("userId") ||
      sp.get("uid") ||
      sp.get("sync") ||
      ""
    ).trim();
  } catch (e) {
    return "";
  }
}

function normalizeUserId(id) {
  return String(id || "").trim();
}

// Priority:
// 1) URL userId (pairing link)
// 2) localStorage app_user_id
// 3) DEFAULT user (stable cross-device)
// 4) (never by default) generate new
const DEFAULT_USER_ID = "23";

let userId =
  normalizeUserId(readUserIdFromUrl()) ||
  normalizeUserId(localStorage.getItem("app_user_id")) ||
  DEFAULT_USER_ID;

// Persist so reloads keep the same id on THIS device
localStorage.setItem("app_user_id", userId);

window.APP_USER_ID = userId;


// Helpers you can use from console (or wire to UI later)
window.getSyncCode = function () {
  return window.APP_USER_ID || localStorage.getItem("app_user_id") || "";
};

window.setSyncCode = function (code) {
  const next = normalizeUserId(code);
  if (!next) return false;
  localStorage.setItem("app_user_id", next);
  window.APP_USER_ID = next;
  // Force a clean reload so everything rebinds using the new account id
  try { window.location.reload(); } catch (e) {}
  return true;
};

// Optional: log once so you can copy it easily
try { console.log("SYNC CODE (share across devices):", window.getSyncCode()); } catch (e) {}

// -----------------------
// SYNC DEVICES UI (Home profile button)
// -----------------------
(function bindSyncDevicesUI() {
  // Prevent double-binding if this runs more than once
  if (window.__syncDevicesUIDelegateBound) return;
  window.__syncDevicesUIDelegateBound = true;

  const modal = document.getElementById('sync-devices-modal');
  const closeBtn = document.getElementById('sync-devices-close');
  const copyBtn = document.getElementById('sync-devices-copy');
  const codeEl = document.getElementById('sync-devices-code');
  const pasteInput = document.getElementById('sync-devices-paste');
  const pasteBtn = document.getElementById('sync-devices-paste-btn');

  const openModal = async () => {
    try {
      let uid = String((window.APP_USER_ID || localStorage.getItem("app_user_id") || "")).trim();
      if (!uid) {
        uid = String(makeUserId()).trim();
        localStorage.setItem("app_user_id", uid);
        window.APP_USER_ID = uid;
      }
      if (codeEl) codeEl.textContent = uid;
    } catch (e) {}

    if (modal) modal.classList.remove('hidden');
  };

  const closeModal = () => {
    if (modal) modal.classList.add('hidden');
  };

  // ✅ expose so Settings can open the modal
  window.openSyncDevicesModal = openModal;

  // ✅ Delegated click so it works even after Home re-renders
  document.addEventListener('click', (e) => {
    const hit = e.target && e.target.closest
      ? e.target.closest('#sync-devices-btn')
      : null;

    if (!hit) return;

    // Person icon should open Settings
    try { showView('settings'); } catch (err) {}
  }, true);

  if (closeBtn) closeBtn.addEventListener('click', closeModal);
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) closeModal(); });

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        const txt = (codeEl ? codeEl.textContent : "") || "";
        if (!txt) return;
        await navigator.clipboard.writeText(txt);
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy"; }, 900);
      } catch (e) {}
    });
  }

  if (pasteBtn) {
    pasteBtn.addEventListener('click', async () => {
      try {
        const val = String(pasteInput ? pasteInput.value : "").trim();
        if (!val) return;

        if (typeof window.setSyncCode === "function") {
          await window.setSyncCode(val);
        } else {
          localStorage.setItem("app_user_id", val);
          window.APP_USER_ID = val;
        }

        closeModal();
        alert("Device linked.");
      } catch (e) {
        console.warn(e);
        alert("Could not link. Try again.");
      }
    });
  }
})();

// -----------------------
// SYNC BUTTON — Profile menu (opens Settings → sync modal)
// -----------------------
(function bindSyncProfileMenuButton() {
  const syncBtn = document.getElementById('profile-menu-sync');
  if (!syncBtn) return;

  syncBtn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    e.stopImmediatePropagation();

    // Close the profile menu
    try {
      const m = document.getElementById('profile-menu-modal');
      if (m) m.classList.add('hidden');
    } catch (e) {}

    try { showView('settings'); } catch (e) {}

    setTimeout(() => {
      const btn = document.getElementById('settings-open-sync');
      try { btn && btn.click(); } catch (e) {}
    }, 60);
  }, true);
})();

// -----------------------
// CLOUD OPERATIONS
// -----------------------

// ✅ Delete album in cloud (R2 folder delete)
window.deleteAlbumFromCloud = async function (artistName, albumName) {
  if (!artistName || !albumName) throw new Error("Missing artistName/albumName");

  const url = new URL(CLOUDFLARE_WORKER_URL);
  url.searchParams.set("path", "/api/delete-album");
  url.searchParams.set("userId", userId);
  url.searchParams.set("artistName", artistName);
  url.searchParams.set("albumName", albumName);

  const res = await fetch(url.toString(), { method: "POST" });

  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error("Delete album failed: " + res.status + " " + t);
  }

    const data = await res.json().catch(() => ({}));
  return data;
};

// ✅ Cross-device Now Playing (cloud)

window.syncNowPlayingToCloud = async function (payload) {
  if (!payload || !payload.userId || !payload.trackId) return;
  try {
    await fetch("https://music-streamer.jacetbaum.workers.dev/api/now-playing", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    console.warn("now-playing sync failed", e);
  }
};

window.loadNowPlayingFromCloud = async function () {
  try {
    const uid = window.APP_USER_ID || localStorage.getItem("app_user_id");
    if (!uid) return null;

    const res = await fetch(
      "https://music-streamer.jacetbaum.workers.dev/api/now-playing?userId=" + encodeURIComponent(uid)
    );
    const data = await res.json().catch(() => ({}));
    if (res.ok && data && data.ok) return data.data || null;
    return null;
  } catch (e) {
    console.warn("load now-playing failed", e);
    return null;
  }
};

// -----------------------
// CLOUD HISTORY LOG SYNC
// -----------------------

window.loadHistoryFromCloud = async function () {
  try {
    const uid = window.APP_USER_ID || localStorage.getItem("app_user_id");
    if (!uid) return null;

    const res = await fetch(
      "https://music-streamer.jacetbaum.workers.dev/api/history-log?userId=" + encodeURIComponent(uid)
    );
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data || !data.ok) return null;

    const arr = Array.isArray(data.history) ? data.history : [];
        try { localStorage.setItem("historyLog", JSON.stringify(arr)); } catch (e) {}

    // ✅ If Home is currently on screen, re-render the Home recents grid after history arrives
    try {
      const grid = document.getElementById("home-recents-grid");
      if (grid && typeof window.renderHomeRecents === "function") {
        window.renderHomeRecents("home-recents-grid");
      }
    } catch (e) {}

    return arr;

  } catch (e) {
    console.warn("load history-log failed", e);
    return null;
  }
};

window.saveHistoryToCloud = async function (arr) {
  try {
    const uid = window.APP_USER_ID || localStorage.getItem("app_user_id");
    if (!uid) return false;

    const body = { userId: uid, history: Array.isArray(arr) ? arr : [] };

    const res = await fetch("https://music-streamer.jacetbaum.workers.dev/api/history-log", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body)
    });

    const data = await res.json().catch(() => ({}));
    return !!(res.ok && data && data.ok);
  } catch (e) {
    console.warn("save history-log failed", e);
    return false;
  }
};

// -----------------------
// ALBUM COVER CLOUD SYNC
// -----------------------

async function syncAlbumCoverOverride(artistName, albumName, coverUrlOrDataUrl) {
  try {
    await fetch('https://music-streamer.jacetbaum.workers.dev/api/get-songs', {

      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        artistName,
        albumName,
        coverUrl: String(coverUrlOrDataUrl || "").trim()
      })
    });
  } catch (e) {
    console.warn('Failed to sync album cover override:', e);
  }
}
