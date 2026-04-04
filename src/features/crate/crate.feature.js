// -----------------------
// CRATE (Notes-like + checklist + cloud sync)
// -----------------------
const CRATE_LS_KEY = "reson_guest_crate_doc_v1";
const CRATE_API_PATH = "/api/crate";
const CRATE_PENDING_MIGRATION_PREFIX = "reson_pending_guest_crate_v1:";
const CRATE_COOKIE_BACKUP_KEY = "reson_guest_crate_backup";

let crateDoc = null;
window.__crateLastCloudSync = { ok: false, reason: "not-started" };
window.__crateLastCloudPull = { ok: false, reason: "not-started" };

function crateApiUrl(params) {
  if (typeof window.personalDataApiUrl === "function") {
    return window.personalDataApiUrl(CRATE_API_PATH, params);
  }
  const url = new URL(CRATE_API_PATH, "https://music-streamer.jacetbaum.workers.dev");
  if (params && typeof params === "object") {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
}

function resolveCrateStorageKey() {
  if (typeof window.getCrateStorageKey === "function") {
    return window.getCrateStorageKey();
  }
  return CRATE_LS_KEY;
}

function getCrateCloudUserId() {
  if (typeof window.getCloudUserId === "function") {
    return String(window.getCloudUserId() || "").trim();
  }
  return String(window.APP_USER_ID || "").trim();
}

function loadCrateDocFromKey(storageKey) {
  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return defaultCrateDoc();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultCrateDoc();
    return {
      title: String(parsed.title || "Crate"),
      items: Array.isArray(parsed.items) ? parsed.items : [],
      updatedAt: Number(parsed.updatedAt || Date.now()) || Date.now()
    };
  } catch (e) {
    return defaultCrateDoc();
  }
}

function cloneCrateDoc(doc) {
  const parsed = doc && typeof doc === "object" ? doc : defaultCrateDoc();
  return {
    title: String(parsed.title || "Crate"),
    items: Array.isArray(parsed.items)
      ? parsed.items.map((item) => ({
          kind: String(item?.kind || "check").trim() || "check",
          checked: !!item?.checked,
          text: String(item?.text || "")
        }))
      : [],
    updatedAt: Number(parsed.updatedAt || Date.now()) || Date.now()
  };
}

function getCookieValue(name) {
  try {
    const cookie = String(document.cookie || "");
    const parts = cookie.split(/;\s*/);
    for (const part of parts) {
      if (!part) continue;
      const eq = part.indexOf("=");
      const key = eq >= 0 ? part.slice(0, eq) : part;
      if (key === name) {
        return eq >= 0 ? decodeURIComponent(part.slice(eq + 1)) : "";
      }
    }
  } catch (e) {}
  return "";
}

function setCookieValue(name, value, maxAgeSeconds) {
  try {
    const safeValue = encodeURIComponent(String(value || ""));
    const maxAge = Number(maxAgeSeconds || 0);
    document.cookie = `${name}=${safeValue}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
    return true;
  } catch (e) {
    return false;
  }
}

function clearCookieValue(name) {
  try {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax`;
  } catch (e) {}
}

function loadGuestCrateBackupCookie() {
  try {
    const raw = getCookieValue(CRATE_COOKIE_BACKUP_KEY);
    if (!raw) return defaultCrateDoc();
    return cloneCrateDoc(JSON.parse(raw));
  } catch (e) {
    return defaultCrateDoc();
  }
}

function syncGuestCrateBackupCookie(doc) {
  const next = cloneCrateDoc(doc);
  if (!crateDocHasMeaningfulContent(next)) {
    clearCookieValue(CRATE_COOKIE_BACKUP_KEY);
    return false;
  }
  return setCookieValue(CRATE_COOKIE_BACKUP_KEY, JSON.stringify(next), 7 * 24 * 60 * 60);
}

function clearGuestCrateBackupCookie() {
  clearCookieValue(CRATE_COOKIE_BACKUP_KEY);
}

function crateDocHasMeaningfulContent(doc) {
  if (!doc || typeof doc !== "object") return false;
  const title = String(doc.title || "").trim();
  const items = Array.isArray(doc.items) ? doc.items : [];
  return (title && title !== "Crate") || items.some((item) => String(item?.text || "").trim().length > 0);
}

function mergeCrateDocs(accountDoc, guestDoc) {
  const base = accountDoc && typeof accountDoc === "object" ? accountDoc : defaultCrateDoc();
  const guest = guestDoc && typeof guestDoc === "object" ? guestDoc : defaultCrateDoc();
  const merged = {
    title: String(base.title || "Crate"),
    items: Array.isArray(base.items) ? base.items.slice() : [],
    updatedAt: Math.max(Number(base.updatedAt || 0), Number(guest.updatedAt || 0), Date.now())
  };

  const guestTitle = String(guest.title || "").trim();
  if ((!merged.title || merged.title === "Crate") && guestTitle && guestTitle !== "Crate") {
    merged.title = guestTitle;
  }

  const seen = new Set(merged.items.map((item) => {
    const kind = String(item?.kind || "check").trim();
    const text = String(item?.text || "").trim().toLowerCase();
    return `${kind}|${text}`;
  }));

  (Array.isArray(guest.items) ? guest.items : []).forEach((item) => {
    const next = {
      kind: String(item?.kind || "check").trim() || "check",
      checked: !!item?.checked,
      text: String(item?.text || "")
    };
    const normalizedText = next.text.trim().toLowerCase();
    if (!normalizedText) return;
    const key = `${next.kind}|${normalizedText}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.items.push(next);
  });

  return merged;
}

function defaultCrateDoc() {
  return {
    title: "Crate",
    items: [],
    updatedAt: Date.now()
  };
}

function loadCrateLocal() {
  try {
    const raw = localStorage.getItem(resolveCrateStorageKey());
    if (!raw) {
      if (resolveCrateStorageKey() === CRATE_LS_KEY) {
        return loadGuestCrateBackupCookie();
      }
      return defaultCrateDoc();
    }
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return defaultCrateDoc();
    if (!Array.isArray(parsed.items)) parsed.items = [];
    if (!parsed.title) parsed.title = "Crate";
    if (!parsed.updatedAt) parsed.updatedAt = Date.now();
    return parsed;
  } catch (e) {
    return defaultCrateDoc();
  }
}

function saveCrateLocal(options) {
  const strict = !!(options && options.strict);
  try {
    if (!crateDoc) return false;
    crateDoc.updatedAt = Date.now();
    localStorage.setItem(resolveCrateStorageKey(), JSON.stringify(crateDoc));
    if (resolveCrateStorageKey() === CRATE_LS_KEY) {
      syncGuestCrateBackupCookie(crateDoc);
    }
    return true;
  } catch (e) {
    if (strict) throw e;
    try { console.warn("Failed to save crate locally:", e); } catch (_) {}
    return false;
  }
}

function getPendingCrateMigrationKey(userId) {
  const uid = String(userId || "").trim();
  return uid ? `${CRATE_PENDING_MIGRATION_PREFIX}${uid}` : "";
}

function loadPendingCrateMigrationDoc(userId) {
  const storageKey = getPendingCrateMigrationKey(userId);
  if (!storageKey) return defaultCrateDoc();
  return loadCrateDocFromKey(storageKey);
}

function savePendingCrateMigrationDoc(userId, doc) {
  const storageKey = getPendingCrateMigrationKey(userId);
  if (!storageKey) return false;
  try {
    localStorage.setItem(storageKey, JSON.stringify(cloneCrateDoc(doc)));
    return true;
  } catch (e) {
    try { console.warn("Failed to save pending crate migration doc:", e); } catch (_) {}
    return false;
  }
}

function clearPendingCrateMigrationDoc(userId) {
  const storageKey = getPendingCrateMigrationKey(userId);
  if (!storageKey) return;
  try { localStorage.removeItem(storageKey); } catch (e) {}
}

function extractCrateDocFromResponse(data) {
  if (!data || typeof data !== "object") return null;

  const direct = [data.doc, data.crate, data.data, data.item, data.result]
    .find((value) => value && typeof value === "object" && !Array.isArray(value));
  if (direct) return cloneCrateDoc(direct);

  if (Array.isArray(data.items) || typeof data.title !== "undefined") {
    return cloneCrateDoc({
      title: data.title,
      items: data.items,
      updatedAt: data.updatedAt || data.updated_at
    });
  }

  const nestedData = data.data && typeof data.data === "object" ? data.data : null;
  if (nestedData && (Array.isArray(nestedData.items) || typeof nestedData.title !== "undefined")) {
    return cloneCrateDoc({
      title: nestedData.title,
      items: nestedData.items,
      updatedAt: nestedData.updatedAt || nestedData.updated_at
    });
  }

  return null;
}

function countMeaningfulCrateItems(doc) {
  const items = Array.isArray(doc?.items) ? doc.items : [];
  return items.filter((item) => String(item?.text || "").trim()).length;
}

function crateDocContainsExpectedContent(remoteDoc, expectedDoc) {
  if (!remoteDoc || !expectedDoc) return false;

  const expectedItems = Array.isArray(expectedDoc.items) ? expectedDoc.items : [];
  const remoteItems = Array.isArray(remoteDoc.items) ? remoteDoc.items : [];

  const remoteKeys = new Set(remoteItems.map((item) => {
    const kind = String(item?.kind || "check").trim();
    const text = String(item?.text || "").trim().toLowerCase();
    return `${kind}|${text}`;
  }));

  return expectedItems.every((item) => {
    const text = String(item?.text || "").trim().toLowerCase();
    if (!text) return true;
    const kind = String(item?.kind || "check").trim();
    return remoteKeys.has(`${kind}|${text}`);
  });
}

function buildCrateWritePayloads(userId, doc) {
  const safeDoc = cloneCrateDoc(doc);
  return [
    {
      method: "PUT",
      url: crateApiUrl(),
      body: {
        userId,
        doc: safeDoc
      }
    },
    {
      method: "PUT",
      url: crateApiUrl(),
      body: {
        userId,
        crate: safeDoc
      }
    },
    {
      method: "PUT",
      url: crateApiUrl({ userId }),
      body: {
        title: safeDoc.title,
        items: safeDoc.items,
        updatedAt: safeDoc.updatedAt
      }
    },
    {
      method: "POST",
      url: crateApiUrl(),
      body: {
        userId,
        doc: safeDoc,
        crate: safeDoc,
        title: safeDoc.title,
        items: safeDoc.items,
        updatedAt: safeDoc.updatedAt
      }
    }
  ];
}

async function pullCrateFromCloud() {
  try {
    const uid = getCrateCloudUserId();
    if (!uid) {
      const result = { ok: false, reason: "missing-user-id" };
      window.__crateLastCloudPull = { ...result, pulledAt: Date.now() };
      return result;
    }

    const attempts = [
      { url: crateApiUrl({ userId: uid }), init: { method: "GET", headers: { "Accept": "application/json" } } },
      { url: crateApiUrl(), init: { method: "GET", headers: { "Accept": "application/json" } } }
    ];

    let remote = null;
    let lastStatus = null;
    for (const attempt of attempts) {
      const res = await fetch(attempt.url, attempt.init);
      lastStatus = res.status;
      if (!res.ok) continue;
      const data = await res.json().catch(() => ({}));
      remote = extractCrateDocFromResponse(data);
      if (remote) break;
    }

    if (!remote) {
      const result = { ok: false, status: lastStatus, reason: "missing-remote-doc", remote: null, remoteItemCount: 0 };
      window.__crateLastCloudPull = { ...result, pulledAt: Date.now() };
      return result;
    }

    const local = crateDoc || loadCrateLocal();
    const remoteTime = Number(remote.updatedAt || 0);
    const localTime = Number(local.updatedAt || 0);
    const remoteHasContent = crateDocHasMeaningfulContent(remote);
    const localHasContent = crateDocHasMeaningfulContent(local);

    if ((remoteHasContent && !localHasContent) || remoteTime > localTime) {
      crateDoc = cloneCrateDoc({
        title: remote.title,
        items: remote.items,
        updatedAt: remoteTime || Date.now()
      });
      saveCrateLocal();
    }

    const result = { ok: true, remote: cloneCrateDoc(remote), remoteItemCount: countMeaningfulCrateItems(remote) };
    window.__crateLastCloudPull = { ...result, pulledAt: Date.now() };
    return result;
  } catch (e) {
    try { console.warn("Failed to pull crate from cloud:", e); } catch (_) {}
    const result = { ok: false, error: e, reason: String(e && e.message || e) };
    window.__crateLastCloudPull = { ...result, pulledAt: Date.now() };
    return result;
  }
}

async function verifyCrateCloudWrite(expectedDoc) {
  const snapshot = cloneCrateDoc(expectedDoc);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const pullResult = await pullCrateFromCloud();
    if (pullResult?.ok && crateDocContainsExpectedContent(pullResult.remote, snapshot)) {
      return { ok: true, pullResult };
    }
    if (attempt === 0) {
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
  return { ok: false, pullResult: window.__crateLastCloudPull || null };
}

async function pushCrateToCloud(options) {
  const strict = !!(options && options.strict);
  try {
    const uid = getCrateCloudUserId();
    if (!uid) return { ok: false, reason: "missing-user-id" };
    if (!crateDoc) return { ok: false, reason: "missing-crate-doc" };

    const attempts = buildCrateWritePayloads(uid, crateDoc);
    let lastError = null;
    let lastStatus = null;
    const expectedDoc = cloneCrateDoc(crateDoc);

    for (const attempt of attempts) {
      const res = await fetch(attempt.url, {
        method: attempt.method,
        headers: { "Content-Type": "application/json", "Accept": "application/json" },
        body: JSON.stringify(attempt.body)
      });

      lastStatus = res.status;
      if (!res.ok) {
        lastError = new Error(`Crate cloud sync failed with status ${res.status} via ${attempt.method}`);
        continue;
      }

      const verification = await verifyCrateCloudWrite(expectedDoc);
      if (!verification.ok) {
        lastError = new Error(`Crate cloud sync verification failed via ${attempt.method}`);
        continue;
      }

      window.__crateLastCloudSync = {
        ok: true,
        method: attempt.method,
        status: res.status,
        url: attempt.url,
        verified: true,
        syncedAt: Date.now()
      };
      return { ok: true, status: res.status, method: attempt.method };
    }

    const error = lastError || new Error("Crate cloud sync failed");
    window.__crateLastCloudSync = {
      ok: false,
      status: lastStatus,
      error: String(error && error.message || error),
      syncedAt: Date.now()
    };
    if (strict) throw error;
    try { console.warn(error.message); } catch (_) {}
    return { ok: false, status: lastStatus, error };
  } catch (e) {
    window.__crateLastCloudSync = {
      ok: false,
      error: String(e && e.message || e),
      syncedAt: Date.now()
    };
    if (strict) throw e;
    try { console.warn("Failed to sync crate to cloud:", e); } catch (_) {}
    return { ok: false, error: e };
  }
}

function ensureCrateLoaded() {
  if (!crateDoc) crateDoc = loadCrateLocal();
}

function formatCrateSyncState(state) {
  if (!state || typeof state !== "object") return "not-started";
  if (state.ok) {
    const method = state.method ? ` ${state.method}` : "";
    const status = state.status ? ` ${state.status}` : "";
    return `ok${method}${status}`.trim();
  }
  return String(state.reason || state.error || state.status || "failed");
}

function renderCrateSyncStatus() {
  const slots = Array.from(document.querySelectorAll(".crate-sync-status-slot"));
  if (!slots.length) return;

  const localDoc = crateDoc || loadCrateLocal();
  const localItems = Array.isArray(localDoc?.items) ? localDoc.items.filter((item) => String(item?.text || "").trim()).length : 0;
  const accountId = getCrateCloudUserId() || "guest";
  const email = String(window.APP_USER_EMAIL || "").trim() || "guest";
  const storageKey = resolveCrateStorageKey();
  const pullState = formatCrateSyncState(window.__crateLastCloudPull);
  const pushState = formatCrateSyncState(window.__crateLastCloudSync);
  const remoteItems = Number(window.__crateLastCloudPull?.remoteItemCount || 0);

  const markup = `
    <div class="rounded-2xl border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70 leading-5">
      <div><strong class="text-white/90">Crate Sync</strong></div>
      <div>Account: ${escapeHtml(email)} (${escapeHtml(accountId)})</div>
      <div>Storage: ${escapeHtml(storageKey)}</div>
      <div>Local items: ${localItems}</div>
      <div>Remote items: ${remoteItems}</div>
      <div>Last pull: ${escapeHtml(pullState)}</div>
      <div>Last push: ${escapeHtml(pushState)}</div>
    </div>
  `;

  slots.forEach((slot) => {
    slot.innerHTML = markup;
  });
}

async function ensureAccountCrateSyncedToCloud(pullResult) {
  const uid = getCrateCloudUserId();
  if (!uid) return { ok: false, reason: "missing-user-id" };

  const localDoc = crateDoc || loadCrateLocal();
  if (!crateDocHasMeaningfulContent(localDoc)) {
    return { ok: false, reason: "missing-local-doc" };
  }

  const remoteDoc = pullResult && pullResult.remote ? cloneCrateDoc(pullResult.remote) : null;
  const remoteTime = Number(remoteDoc?.updatedAt || 0);
  const localTime = Number(localDoc?.updatedAt || 0);
  const shouldPush = !pullResult?.ok || !remoteDoc || localTime >= remoteTime;

  if (!shouldPush) {
    return { ok: true, reason: "remote-newer" };
  }

  crateDoc = cloneCrateDoc(localDoc);
  return pushCrateToCloud();
}

window.hasMeaningfulCrateContent = function () {
  try {
    const current = crateDoc || loadCrateLocal();
    return crateDocHasMeaningfulContent(current);
  } catch (e) {
    return false;
  }
};

function revealCrateEditorIfNeeded() {
  // Always land on the home/menu view — do not auto-navigate into the editor.
}

window.resetCrateForIdentityChange = async function () {
  crateDoc = loadCrateLocal();
  try { renderCrate(); } catch (e) {}
  try { renderCrateSyncStatus(); } catch (e) {}
  let pullResult = { ok: false, reason: "not-run" };
  try { pullResult = await pullCrateFromCloud(); } catch (e) {}
  try {
    const uid = getCrateCloudUserId();
    const pendingDoc = uid ? loadPendingCrateMigrationDoc(uid) : defaultCrateDoc();
    if (uid && crateDocHasMeaningfulContent(pendingDoc)) {
      await window.migrateGuestCrateToAccount(pendingDoc);
    }
  } catch (e) {}
  try {
    await ensureAccountCrateSyncedToCloud(pullResult);
  } catch (e) {}
  try { renderCrate(); } catch (e) {}
  try { renderCrateSyncStatus(); } catch (e) {}
  try { revealCrateEditorIfNeeded(); } catch (e) {}
};

window.getGuestCrateSnapshot = function () {
  const guestDoc = cloneCrateDoc(loadCrateDocFromKey(CRATE_LS_KEY));
  if (crateDocHasMeaningfulContent(guestDoc)) return guestDoc;
  return loadGuestCrateBackupCookie();
};

window.seedAccountCrateFromGuestSnapshot = function (guestDocOverride) {
  const uid = getCrateCloudUserId();
  const guestDoc = cloneCrateDoc(guestDocOverride || loadCrateDocFromKey(CRATE_LS_KEY));
  if (!uid || !crateDocHasMeaningfulContent(guestDoc)) {
    return { seeded: false };
  }

  try {
    const accountDoc = loadCrateLocal();
    crateDoc = mergeCrateDocs(accountDoc, guestDoc);
    saveCrateLocal({ strict: true });
    savePendingCrateMigrationDoc(uid, guestDoc);
    return { seeded: true, itemCount: Array.isArray(crateDoc.items) ? crateDoc.items.length : 0 };
  } catch (e) {
    return { seeded: false, error: e };
  }
};

window.migrateGuestCrateToAccount = async function (guestDocOverride) {
  const uid = getCrateCloudUserId();
  const guestDoc = cloneCrateDoc(
    guestDocOverride || loadPendingCrateMigrationDoc(uid) || loadCrateDocFromKey(CRATE_LS_KEY)
  );
  if (!crateDocHasMeaningfulContent(guestDoc)) {
    return { migrated: false };
  }

  if (!uid || resolveCrateStorageKey() === CRATE_LS_KEY) {
    return { migrated: false, error: new Error("Missing account crate storage key") };
  }

  try {
    savePendingCrateMigrationDoc(uid, guestDoc);
    crateDoc = loadCrateLocal();
    await pullCrateFromCloud();

    const merged = mergeCrateDocs(crateDoc || loadCrateLocal(), guestDoc);
    crateDoc = merged;
    saveCrateLocal({ strict: true });
    await pushCrateToCloud({ strict: true });
    clearPendingCrateMigrationDoc(uid);
    try { localStorage.removeItem(CRATE_LS_KEY); } catch (e) {}
    clearGuestCrateBackupCookie();
    return { migrated: true, itemCount: merged.items.length };
  } catch (e) {
    return { migrated: false, error: e };
  }
};

function escapeHtml(s) {
  return String(s || '')
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function renderCrate() {
  ensureCrateLoaded();

  const titleEl = document.getElementById("crate-title");
  const itemsEl = document.getElementById("crate-items");
  if (!itemsEl) return;

  if (titleEl) {
    titleEl.value = String(crateDoc.title || "Crate");
  }

  const html = (crateDoc.items || []).map((it, idx) => {
    const checked = !!it.checked;
    const kind = String(it.kind || "check");
    const text = String(it.text || "");

    return `
      <div class="crate-row" data-idx="${idx}">
        <div class="crate-bubble ${checked ? "checked" : ""}" data-hit="bubble" role="button" aria-label="Toggle"></div>
        <div class="crate-text ${kind === "text" ? "muted" : ""}" data-hit="text" contenteditable="true" spellcheck="false">${escapeHtml(text)}</div>
      </div>
    `;
  }).join("");

  itemsEl.innerHTML = html || `<div class="crate-row"><div class="crate-text muted">No items yet. Add one below.</div></div>`;
  try { renderCrateSyncStatus(); } catch (e) {}
}

function addCrateItem(text, kind = "check") {
  ensureCrateLoaded();
  crateDoc.items.push({
    kind,
    checked: false,
    text: String(text || "").trim()
  });
  saveCrateLocal();
  renderCrate();
  pushCrateToCloud();
}

function addArtistToCrate(artistName) {
  const name = String(artistName || "").trim();
  if (!name) return;
  addCrateItem(name, "check");
}

function goBackFromCrate() {
  // If back stack exists, use it; otherwise return Home
  try {
    if (window.navStack && window.navStack.length) {
      goBack();
      return;
    }
  } catch (e) {}
  showView("home");
}

function refreshCrateImportUi() {
  const tile = document.getElementById("crate-open-import");
  const title = document.getElementById("crate-open-import-title");
  const sub = document.getElementById("crate-open-import-sub");
  const note = document.getElementById("crate-open-import-note");
  const signedIn = !!getCrateCloudUserId();

  if (!tile) return;

  tile.classList.toggle("disabled", !signedIn);
  tile.setAttribute("aria-disabled", signedIn ? "false" : "true");
  tile.title = signedIn
    ? "Download music into your personal library"
    : "Create an account to download music into your personal library";

  if (title) {
    title.textContent = signedIn ? "Download Your Music" : "Download Your Music";
  }

  if (sub) {
    sub.textContent = signedIn
      ? "Search, download, and save to your library"
      : "Create an account to search, download, and save music";
  }

  if (note) {
    note.classList.toggle("hidden", signedIn);
    note.textContent = signedIn ? "" : "Account required";
  }
}

function openCrateSection(which) {
  const home = document.getElementById("crate-home");
  const editor = document.getElementById("crate-editor");
  const stats = document.getElementById("crate-stats");
  const features = document.getElementById("crate-features");
  const importView = document.getElementById("crate-import");

  const w = String(which || "home");

  if (w === "import" && typeof window.requireAccount === "function" && !window.requireAccount("Create an account to download music into your library.")) {
    refreshCrateImportUi();
    return;
  }

  if (home) home.classList.toggle("hidden", w !== "home");
  if (editor) editor.classList.toggle("hidden", w !== "crate");
  if (stats) stats.classList.toggle("hidden", w !== "stats");
  if (features) features.classList.toggle("hidden", w !== "features");
  if (importView) importView.classList.toggle("hidden", w !== "import");

  // If user opens the editor, make sure it renders
  if (w === "crate") {
    try { initCrateUIOnce(); } catch (e) {}
    try { renderCrate(); } catch (e) {}
  }

  // If user opens stats, render it
  if (w === "stats") {
    try { renderCrateStats(); } catch (e) {}
  }

  // If user opens import, init the import workflow
  if (w === "import") {
    try { initImportView(); } catch (e) {}
  }

  try {
    const scrollArea = document.getElementById("main-scroll-area");
    if (scrollArea) scrollArea.scrollTop = 0;
  } catch (e) {}
}

function openCrateImportView(context) {
  if (typeof window.requireAccount === "function" && !window.requireAccount("Create an account to download music into your library.")) {
    refreshCrateImportUi();
    return;
  }
  try {
    if (typeof window.setImportLaunchContext === "function") {
      window.setImportLaunchContext(Object.assign({ preferDownloadPanel: true, source: "crate" }, context || {}));
    }
  } catch (e) {}
  try { showView("crate"); } catch (e) {}
  openCrateSection("import");
}

function initCrateUIOnce() {

  if (window.__crateUIBound) return;
  window.__crateUIBound = true;

  ensureCrateLoaded();
  refreshCrateImportUi();

  // Pull from cloud once on first init
  pullCrateFromCloud().then(() => {
    try { renderCrate(); } catch (e) {}
    try { renderCrateSyncStatus(); } catch (e) {}
    try { refreshCrateImportUi(); } catch (e) {}
    try { revealCrateEditorIfNeeded(); } catch (e) {}
  });

  document.addEventListener("click", (e) => {
    const openBtn = e.target && e.target.closest ? e.target.closest("#open-crate-btn") : null;
    if (openBtn) {
      e.preventDefault();
      showView("crate");
      return;
    }

    const addCheck = e.target && e.target.closest ? e.target.closest("#crate-add-check") : null;
    if (addCheck) {
      e.preventDefault();
      addCrateItem("", "check");
      // focus the last row
      setTimeout(() => {
        const rows = document.querySelectorAll("#crate-items .crate-row");
        const last = rows[rows.length - 1];
        const t = last && last.querySelector ? last.querySelector("[data-hit='text']") : null;
        if (t) t.focus();
      }, 0);
      return;
    }

    const addText = e.target && e.target.closest ? e.target.closest("#crate-add-text") : null;
    if (addText) {
      e.preventDefault();
      addCrateItem("", "text");
      setTimeout(() => {
        const rows = document.querySelectorAll("#crate-items .crate-row");
        const last = rows[rows.length - 1];
        const t = last && last.querySelector ? last.querySelector("[data-hit='text']") : null;
        if (t) t.focus();
      }, 0);
      return;
    }

    // bubble toggle
    const bubble = e.target && e.target.closest ? e.target.closest("#crate-items [data-hit='bubble']") : null;
    if (bubble) {
      e.preventDefault();
      const row = bubble.closest(".crate-row");
      const idx = row ? Number(row.getAttribute("data-idx")) : -1;
      if (idx >= 0 && crateDoc && crateDoc.items && crateDoc.items[idx]) {
        crateDoc.items[idx].checked = !crateDoc.items[idx].checked;
        saveCrateLocal();
        renderCrate();
        pushCrateToCloud();
      }
      return;
    }
  });

  // typing edits: update crateDoc on input
  document.addEventListener("input", (e) => {
    const t = e.target;
    if (!t) return;

    if (t.id === "crate-title") {
      ensureCrateLoaded();
      crateDoc.title = String(t.value || "Crate");
      saveCrateLocal();
      pushCrateToCloud();
      return;
    }

    const textEl = t.closest ? t.closest("#crate-items [data-hit='text']") : null;
    if (!textEl) return;

    const row = textEl.closest(".crate-row");
    const idx = row ? Number(row.getAttribute("data-idx")) : -1;
    if (idx >= 0 && crateDoc && crateDoc.items && crateDoc.items[idx]) {
      crateDoc.items[idx].text = String(textEl.textContent || "");
      saveCrateLocal();
      // push less aggressively while typing
      clearTimeout(window.__cratePushTimer);
      window.__cratePushTimer = setTimeout(() => { pushCrateToCloud(); }, 450);
    }
  });
}

// expose for menuAction and inline HTML handlers
window.addArtistToCrate = addArtistToCrate;
window.goBackFromCrate = goBackFromCrate;
window.initCrateUIOnce = initCrateUIOnce;
window.renderCrate = renderCrate;
window.openCrateSection = openCrateSection;
window.openCrateImportView = openCrateImportView;
window.refreshCrateImportUi = refreshCrateImportUi;


/* -----------------------
   STATS (reads reson_play_events_v1)
------------------------ */

const RESON_STATS_KEY = 'reson_play_events_v1';
const RESON_STATS_UI_RANGE_KEY = 'reson_stats_ui_range_v1';
const RESON_STATS_UI_GROUP_KEY = 'reson_stats_ui_group_v1';

function getStatsUIRange() {
  return String(localStorage.getItem(RESON_STATS_UI_RANGE_KEY) || 'week');
}
function getStatsUIGroup() {
  return String(localStorage.getItem(RESON_STATS_UI_GROUP_KEY) || 'artist');
}

function setStatsRange(range) {
  try { localStorage.setItem(RESON_STATS_UI_RANGE_KEY, String(range || 'week')); } catch (e) {}
  renderCrateStats();
}

function setStatsGroupBy(group) {
  try { localStorage.setItem(RESON_STATS_UI_GROUP_KEY, String(group || 'artist')); } catch (e) {}
  renderCrateStats();
}

function readPlayEvents() {
  try {
    const raw = localStorage.getItem(RESON_STATS_KEY) || "[]";
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? arr : [];
  } catch (e) {
    return [];
  }
}

function rangeToSinceMs(range) {
  const r = String(range || 'week');
  const day = 24 * 60 * 60 * 1000;
  if (r === 'week') return Date.now() - 7 * day;
  if (r === 'month') return Date.now() - 30 * day;
  if (r === '6mo') return Date.now() - 183 * day;
  if (r === 'year') return Date.now() - 365 * day;
  return 0; // all time
}

function setActiveChip(btn, isActive) {
  if (!btn) return;
  if (isActive) {
    btn.classList.remove('bg-white/10');
    btn.classList.add('bg-[var(--spotify-green)]', 'text-black');
  } else {
    btn.classList.add('bg-white/10', 'text-white');
    btn.classList.remove('bg-[var(--spotify-green)]', 'text-black');
  }
}

function updateStatsChips(range, group) {
  setActiveChip(document.getElementById('stats-range-week'), range === 'week');
  setActiveChip(document.getElementById('stats-range-month'), range === 'month');
  setActiveChip(document.getElementById('stats-range-6mo'), range === '6mo');
  setActiveChip(document.getElementById('stats-range-year'), range === 'year');
  setActiveChip(document.getElementById('stats-range-all'), range === 'all');

  setActiveChip(document.getElementById('stats-group-artist'), group === 'artist');
  setActiveChip(document.getElementById('stats-group-album'), group === 'album');
  setActiveChip(document.getElementById('stats-group-playlist'), group === 'playlist');
}

function getGroupKey(ev, group) {
  const artist = String(ev?.artistName || '').trim();
  const album = String(ev?.albumName || '').trim();
  const playlist = String(ev?.playlistName || ev?.contextName || '').trim();

  if (group === 'album') {
    if (!artist && !album) return '(Unknown album)';
    if (!artist) return album || '(Unknown album)';
    if (!album) return artist;
    return `${artist} — ${album}`;
  }

  if (group === 'playlist') {
    return playlist || '(Unknown playlist)';
  }

  return artist || '(Unknown artist)';
}

function renderCrateStats() {
  const box = document.getElementById('stats-results');
  if (!box) return;

  const range = getStatsUIRange();
  const group = getStatsUIGroup();

  updateStatsChips(range, group);

  const since = rangeToSinceMs(range);
  const events = readPlayEvents().filter(ev => Number(ev?.ts || 0) >= since);

  if (!events.length) {
    box.innerHTML = `
      <div class="text-sm text-white/60">
        No play history yet for this range.
        <div class="mt-1 text-xs text-white/40">Play a few songs, then come back here.</div>
      </div>
    `;
    return;
  }

  const counts = new Map();
  for (const ev of events) {
    const k = getGroupKey(ev, group);
    counts.set(k, (counts.get(k) || 0) + 1);
  }

  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const top = sorted.slice(0, 25);

  const totalPlays = events.length;
  const distinct = sorted.length;

  const rows = top.map(([name, plays], idx) => `
    <div class="flex items-center justify-between gap-3 py-2 border-b border-white/10">
      <div class="flex items-center gap-3 min-w-0">
        <div class="w-7 text-right text-xs text-white/40">${idx + 1}</div>
        <div class="min-w-0">
          <div class="text-sm font-extrabold text-white truncate">${escapeHtml(name)}</div>
        </div>
      </div>
      <div class="text-sm font-extrabold text-white/80">${plays}</div>
    </div>
  `).join("");

  box.innerHTML = `
    <div class="mb-3">
      <div class="text-sm text-white/80">
        <span class="font-extrabold">${totalPlays}</span> plays •
        <span class="font-extrabold">${distinct}</span> ${escapeHtml(group)}${distinct === 1 ? '' : 's'}
      </div>
      <div class="text-xs text-white/40 mt-1">Top 25</div>
    </div>
    <div class="rounded-2xl bg-black/20 border border-white/10 overflow-hidden">
      <div class="px-3">${rows}</div>
    </div>
  `;
}

// expose for inline HTML handlers
window.setStatsRange = setStatsRange;
window.setStatsGroupBy = setStatsGroupBy;
window.renderCrateStats = renderCrateStats;


/* -----------------------
   FEATURES UI WIRING
   - Crossfade slider: 0..20 seconds
   - Keeps existing toggleFeatureFlag/isFeatureOn if you already have them
------------------------ */

(function initFeaturesWiring(){
  const CROSSFADE_SECONDS_KEY = 'reson_crossfade_seconds_v1';

  function clamp(n, a, b){ n = Number(n); if (!isFinite(n)) n = 0; return Math.max(a, Math.min(b, n)); }

  function getCrossfadeSeconds(){
    const raw = localStorage.getItem(CROSSFADE_SECONDS_KEY);
    return clamp(raw == null ? 0 : raw, 0, 20);
  }

  function setCrossfadeSeconds(v){
    const sec = clamp(v, 0, 20);
    try { localStorage.setItem(CROSSFADE_SECONDS_KEY, String(sec)); } catch (e) {}

    // expose for any playback code that wants it
    try { window.__crossfadeSeconds = sec; } catch (e) {}

    // update UI
    const label = document.getElementById('crossfade-seconds');
    const slider = document.getElementById('crossfade-slider');
    if (label) label.textContent = sec + 's';
    if (slider && String(slider.value) !== String(sec)) slider.value = String(sec);
  }

  // If your app doesn't already have these, provide minimal versions.
  if (typeof window.isFeatureOn !== 'function') {
    window.isFeatureOn = function(flag){
      try {
        return localStorage.getItem('reson_feature_' + flag) === '1';
      } catch (e) { return false; }
    };
  }

  // UI refresh (button labels + colors)
  function refreshFeatureUI(){
    const crossBtn = document.getElementById('feature-toggle-crossfade');
    const autoBtn = document.getElementById('feature-toggle-autoplay');

    const crossOn = !!window.isFeatureOn('crossfade');
    const autoOn = !!window.isFeatureOn('autoplay');

    if (crossBtn) crossBtn.textContent = crossOn ? 'On' : 'Off';
    if (autoBtn) autoBtn.textContent = autoOn ? 'On' : 'Off';
  }

  // Wrap existing toggleFeatureFlag so UI always updates after toggling.
  if (typeof window.toggleFeatureFlag === 'function' && !window.__featuresToggleWrapped) {
    window.__featuresToggleWrapped = true;
    const original = window.toggleFeatureFlag;
    window.toggleFeatureFlag = function(flag){
      const out = original.apply(this, arguments);
      try { refreshFeatureUI(); } catch (e) {}
      return out;
    };
  }

  // If toggleFeatureFlag doesn't exist, create a minimal one.
  if (typeof window.toggleFeatureFlag !== 'function') {
    window.toggleFeatureFlag = function(flag){
      const key = 'reson_feature_' + String(flag || '');
      let next = '1';
      try { next = (localStorage.getItem(key) === '1') ? '0' : '1'; } catch (e) {}
      try { localStorage.setItem(key, next); } catch (e) {}
      refreshFeatureUI();
    };
  }

  // Hook slider
  function bindSlider(){
    const slider = document.getElementById('crossfade-slider');
    if (!slider || slider.__bound) return;
    slider.__bound = true;

    slider.addEventListener('input', () => {
      const sec = clamp(slider.value, 0, 20);
      setCrossfadeSeconds(sec);

      // ✅ if slider > 0 => turn crossfade ON, if 0 => OFF
      try {
        localStorage.setItem('reson_feature_crossfade', sec > 0 ? '1' : '0');
      } catch (e) {}

      refreshFeatureUI();
    });
  }

  // Initial paint (works even if you open Features later)
  function paint(){
    setCrossfadeSeconds(getCrossfadeSeconds());
    refreshFeatureUI();
    bindSlider();
  }

  // run now + shortly after (in case the view wasn't in DOM yet)
  try { paint(); } catch (e) {}
  setTimeout(() => { try { paint(); } catch (e) {} }, 250);
})();
