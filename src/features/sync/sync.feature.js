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
function getDefaultPersonalDataApiBase() {
  try {
    const host = String(window.location?.hostname || "").trim().toLowerCase();
    const origin = String(window.location?.origin || "").trim();
    if (origin && host && host !== "localhost" && host !== "127.0.0.1") {
      return origin;
    }
  } catch (e) {}
  return "https://music-streamer.jacetbaum.workers.dev";
}

const DEFAULT_PERSONAL_DATA_API_BASE = getDefaultPersonalDataApiBase();
window.CLOUDFLARE_WORKER_URL = CLOUDFLARE_WORKER_URL;

function normalizeApiBaseUrl(value) {
  const raw = String(value || "").trim();
  const resolved = raw || DEFAULT_PERSONAL_DATA_API_BASE;
  return resolved.replace(/\/+$/, "");
}

window.getPersonalDataApiBase = function () {
  try {
    const stored = localStorage.getItem("reson_personal_api_base");
    return normalizeApiBaseUrl(window.RESON_PERSONAL_API_BASE || stored || DEFAULT_PERSONAL_DATA_API_BASE);
  } catch (e) {
    return normalizeApiBaseUrl(window.RESON_PERSONAL_API_BASE || DEFAULT_PERSONAL_DATA_API_BASE);
  }
};

window.setPersonalDataApiBase = function (value) {
  const next = normalizeApiBaseUrl(value);
  window.RESON_PERSONAL_API_BASE = next;
  try { localStorage.setItem("reson_personal_api_base", next); } catch (e) {}
  return next;
};

window.personalDataApiUrl = function (path, params) {
  const safePath = String(path || "/").trim() || "/";
  const url = new URL(safePath.startsWith("/") ? safePath : `/${safePath}`, window.getPersonalDataApiBase());
  if (params && typeof params === "object") {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
};

window.RESON_PERSONAL_API_BASE = window.getPersonalDataApiBase();

const ACCOUNT_USER_ID_KEY = "reson_account_user_id";
const LEGACY_ACCOUNT_USER_ID_KEY = "app_user_id";
const GUEST_PLAYLISTS_KEY = "reson_guest_playlists_v1";
const ACCOUNT_PLAYLISTS_KEY_PREFIX = "reson_account_playlists_v1:";
const GUEST_CRATE_KEY = "reson_guest_crate_doc_v1";
const ACCOUNT_CRATE_KEY_PREFIX = "reson_account_crate_doc_v1:";

function normalizeUserId(id) {
  return String(id || "").trim();
}

function getStoredAccountUserId() {
  const primary = normalizeUserId(localStorage.getItem(ACCOUNT_USER_ID_KEY));
  if (primary) return primary;

  const legacy = normalizeUserId(localStorage.getItem(LEGACY_ACCOUNT_USER_ID_KEY));
  if (legacy) {
    try { localStorage.setItem(ACCOUNT_USER_ID_KEY, legacy); } catch (e) {}
    return legacy;
  }

  return "";
}

function setStoredAccountUserId(userId) {
  const next = normalizeUserId(userId);

  try {
    if (next) {
      localStorage.setItem(ACCOUNT_USER_ID_KEY, next);
      localStorage.setItem(LEGACY_ACCOUNT_USER_ID_KEY, next);
    } else {
      localStorage.removeItem(ACCOUNT_USER_ID_KEY);
      localStorage.removeItem(LEGACY_ACCOUNT_USER_ID_KEY);
    }
  } catch (e) {}

  window.APP_USER_ID = next || null;
  window.APP_ACCOUNT_USER_ID = next || null;
  return next;
}

function toggleAccountOnlyControl(controlId, enabled) {
  const el = document.getElementById(controlId);
  if (!el) return;

  el.classList.toggle('hidden', !enabled);
  el.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  if ('disabled' in el) el.disabled = !enabled;

  const next = el.nextElementSibling;
  if (next && next.classList && next.classList.contains('h-px')) {
    next.classList.toggle('hidden', !enabled);
    next.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  }
}

function toggleGuestOnlyControl(controlId, enabled) {
  const el = document.getElementById(controlId);
  if (!el) return;

  el.classList.toggle('hidden', !enabled);
  el.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  if ('disabled' in el) el.disabled = !enabled;

  const next = el.nextElementSibling;
  if (next && next.classList && next.classList.contains('h-px')) {
    next.classList.toggle('hidden', !enabled);
    next.setAttribute('aria-hidden', enabled ? 'false' : 'true');
  }
}

window.getCloudUserId = function () {
  return normalizeUserId(window.APP_ACCOUNT_USER_ID || window.APP_USER_ID || getStoredAccountUserId());
};

window.isGuestMode = function () {
  return !window.getCloudUserId();
};

window.getPlaylistStorageKey = function () {
  const uid = window.getCloudUserId();
  return uid ? ACCOUNT_PLAYLISTS_KEY_PREFIX + uid : GUEST_PLAYLISTS_KEY;
};

window.readStoredPlaylists = function () {
  try {
    const raw = localStorage.getItem(window.getPlaylistStorageKey()) || "[]";
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (e) {
    return [];
  }
};

window.writeStoredPlaylists = function (items) {
  try {
    const out = Array.isArray(items) ? items : [];
    localStorage.setItem(window.getPlaylistStorageKey(), JSON.stringify(out));
    window.__PLAYLIST_STORAGE_KEY__ = window.getPlaylistStorageKey();
    return true;
  } catch (e) {
    return false;
  }
};

window.getCrateStorageKey = function () {
  const uid = window.getCloudUserId();
  return uid ? ACCOUNT_CRATE_KEY_PREFIX + uid : GUEST_CRATE_KEY;
};

window.setAccountIdentity = function (userId) {
  const next = setStoredAccountUserId(userId);
  window.__PLAYLIST_STORAGE_KEY__ = window.getPlaylistStorageKey();
  try { window.refreshAccountOnlyUi(); } catch (e) {}
  return next;
};

window.clearAccountIdentity = function () {
  setStoredAccountUserId("");
  window.APP_USER_EMAIL = null;
  window.__PLAYLIST_STORAGE_KEY__ = window.getPlaylistStorageKey();
  try { window.refreshAccountOnlyUi(); } catch (e) {}
};

window.requireAccount = function (message) {
  if (!window.isGuestMode()) return true;

  try {
    if (typeof window.openAuthModal === 'function') {
      window.openAuthModal('signin');
    } else {
      const modal = document.getElementById('auth-modal');
      if (modal) modal.classList.remove('hidden');
    }
  } catch (e) {}

  if (message) {
    try { console.warn(message); } catch (e) {}
  }

  return false;
};

window.refreshAccountOnlyUi = function () {
  const enabled = !window.isGuestMode();
  [
    'settings-open-sync',
    'settings-open-recently-deleted',
    'profile-menu-sync',
    'profile-menu-recently-deleted',
    'profile-menu-profile',
    'crate-open-import',
    'profile-menu-upload-photo'
  ].forEach((controlId) => toggleAccountOnlyControl(controlId, enabled));

  [
    'profile-menu-signin',
    'profile-menu-register'
  ].forEach((controlId) => toggleGuestOnlyControl(controlId, !enabled));
};

window.migrateGuestDataToAccount = async function (userId) {
  const uid = normalizeUserId(userId || window.getCloudUserId());
  if (!uid) return { ok: false, migrated: false, reason: 'missing-user-id' };

  if (window.__guestMigrationPromise) {
    return window.__guestMigrationPromise;
  }

  window.__guestMigrationPromise = (async function () {
    const summary = {
      ok: true,
      migrated: false,
      playlistsMigrated: 0,
      crateMigrated: false,
      errors: []
    };

    try {
      if (typeof window.migrateGuestPlaylistsToAccount === 'function') {
        const playlistResult = await window.migrateGuestPlaylistsToAccount(uid);
        summary.playlistsMigrated = Number(playlistResult?.migrated || 0);
        summary.migrated = summary.migrated || summary.playlistsMigrated > 0;
        if (Array.isArray(playlistResult?.errors) && playlistResult.errors.length) {
          summary.errors.push.apply(summary.errors, playlistResult.errors);
        }
      }

      if (typeof window.migrateGuestCrateToAccount === 'function') {
        const crateResult = await window.migrateGuestCrateToAccount(uid);
        summary.crateMigrated = !!crateResult?.migrated;
        summary.migrated = summary.migrated || summary.crateMigrated;
        if (crateResult?.error) summary.errors.push(crateResult.error);
      }
    } catch (e) {
      summary.ok = false;
      summary.errors.push(e);
    } finally {
      window.__guestMigrationPromise = null;
    }

    return summary;
  })();

  return window.__guestMigrationPromise;
};

const initialAccountUserId = getStoredAccountUserId();
window.APP_USER_ID = initialAccountUserId || null;
window.APP_ACCOUNT_USER_ID = initialAccountUserId || null;
window.__PLAYLIST_STORAGE_KEY__ = window.getPlaylistStorageKey();
window.refreshAccountOnlyUi();


// Helpers you can use from console (or wire to UI later)
window.getSyncCode = function () {
  return window.getCloudUserId();
};

window.setSyncCode = function (code) {
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
  const pasteBtn = document.getElementById('sync-devices-apply');

  const openModal = async () => {
    try {
      const uid = window.getCloudUserId();
      if (codeEl) codeEl.textContent = uid || 'Sign in to sync account-owned data';
      if (copyBtn) copyBtn.disabled = !uid;
      if (pasteInput) pasteInput.disabled = true;
      if (pasteBtn) pasteBtn.disabled = true;
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
        alert("Manual sync codes are disabled while personal data is account-owned.");
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

  const uid = window.getCloudUserId();
  if (!uid) throw new Error("Sign in required");

  const url = new URL(window.getPersonalDataApiBase() + "/");
  url.searchParams.set("path", "/api/delete-album");
  url.searchParams.set("userId", uid);
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
  const uid = window.getCloudUserId();
  if (!payload || !uid || !payload.trackId) return;
  try {
    await fetch(window.personalDataApiUrl("/api/now-playing"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...payload,
        userId: uid,
      }),
    });
  } catch (e) {
    console.warn("now-playing sync failed", e);
  }
};

window.loadNowPlayingFromCloud = async function () {
  try {
    const uid = window.getCloudUserId();
    if (!uid) return null;

    const res = await fetch(window.personalDataApiUrl("/api/now-playing", { userId: uid }));
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
    const uid = window.getCloudUserId();
    if (!uid) return null;

    const res = await fetch(window.personalDataApiUrl("/api/history-log", { userId: uid }));
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
    const uid = window.getCloudUserId();
    if (!uid) return false;

    const body = { userId: uid, history: Array.isArray(arr) ? arr : [] };

    const res = await fetch(window.personalDataApiUrl("/api/history-log"), {
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
