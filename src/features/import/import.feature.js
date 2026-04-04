/* ==========================================================
   IMPORT / ADD MUSIC FEATURE
   3-panel workflow: Setup → Download → Review & Upload
   Backed by a local Python server (downloader/server.py)
   running on http://localhost:8765
   ========================================================== */

// ---------------------------------------------------------------------------
// Constants & state
// ---------------------------------------------------------------------------
const IMPORT_SETTINGS_KEY = 'importSettings';
const IMPORT_DEFAULT_SERVER = 'http://localhost:8765';

let __importCurrentPanel = 'setup';   // 'setup' | 'download' | 'review'
let __importCurrentJobId = null;
let __importPollTimer = null;
let __importReviewFiles = [];
let __importSearchResults = [];
let __importSelectedSource = null;
let __importLaunchContext = null;
let __importReviewContext = null;
let __importTrackSelection = [];       // Array<{ sourceUrl, title, artist, duration, checked }>
let __importBgPollOpts = null;         // opts saved so re-attach can continue the same job

const IMPORT_SEARCH_LIMIT = 8;

// ---------------------------------------------------------------------------
// Background badge + toast helpers
// ---------------------------------------------------------------------------
function importSetDownloadBadge(active) {
  const badge = document.getElementById('import-nav-badge');
  if (!badge) return;
  badge.classList.toggle('hidden', !active);
}

let __importToastTimer = null;
function importShowToast(message, durationMs) {
  const el = document.getElementById('import-toast');
  if (!el) return;
  el.textContent = message;
  el.classList.remove('hidden');
  el.style.opacity = '1';
  if (__importToastTimer) clearTimeout(__importToastTimer);
  __importToastTimer = setTimeout(() => {
    el.style.opacity = '0';
    setTimeout(() => el.classList.add('hidden'), 320);
  }, durationMs || 4000);
}

// Title noise patterns: strip "(Visualizer)", "(Lyrics)", "(Official Video)", etc.
const _IMPORT_TITLE_NOISE = /\s*[\(\[\{](official\s*(music\s*)?video|official\s*audio|official\s*lyric\s*video|lyric\s*video|lyrics?|visuali[sz]er|audio|hd|hq|4k|live|live\s*session|extended|acoustic|remix|official\s*clip|studio\s*session|full\s*album|official|video\s*clip|360°?)[\)\]\}]/gi;

function importCleanTitle(title) {
  const cleaned = String(title || '').replace(_IMPORT_TITLE_NOISE, '').trim().replace(/\s{2,}/g, ' ').replace(/[\s\-–—|]+$/, '').trim();
  return cleaned || String(title || '');
}

// ---------------------------------------------------------------------------
// Settings helpers
// ---------------------------------------------------------------------------
function importLoadSettings() {
  try {
    return JSON.parse(localStorage.getItem(IMPORT_SETTINGS_KEY) || '{}');
  } catch (e) {
    return {};
  }
}

function importSaveSettings(patch) {
  const current = importLoadSettings();
  const next = Object.assign({}, current, patch);
  try { localStorage.setItem(IMPORT_SETTINGS_KEY, JSON.stringify(next)); } catch (e) {}
  return next;
}

function importGetServerUrl() {
  return (importLoadSettings().serverUrl || IMPORT_DEFAULT_SERVER).replace(/\/$/, '');
}

function importSetLaunchContext(context) {
  __importLaunchContext = context && typeof context === 'object'
    ? Object.assign({}, context)
    : null;
}

function importConsumeLaunchContext() {
  const next = __importLaunchContext && typeof __importLaunchContext === 'object'
    ? Object.assign({}, __importLaunchContext)
    : null;
  __importLaunchContext = null;
  return next;
}

function importTrimmedInput() {
  return (document.getElementById('import-url')?.value || '').trim();
}

function importGetAccountUserId() {
  if (typeof window.getCloudUserId === 'function') {
    return String(window.getCloudUserId() || '').trim();
  }
  return String(window.APP_ACCOUNT_USER_ID || window.APP_USER_ID || '').trim();
}

function importCloneData(value) {
  try {
    return value == null ? value : JSON.parse(JSON.stringify(value));
  } catch (e) {
    return value;
  }
}

function importIsUrlLike(value) {
  const raw = String(value || '').trim();
  return /^(https?:\/\/|spotify:)/i.test(raw);
}

function importDetectInputKind(value) {
  return importIsUrlLike(value) ? 'url' : 'query';
}

function importClearSearchResults() {
  __importSearchResults = [];
  const box = document.getElementById('import-search-results');
  if (!box) return;
  box.innerHTML = '';
  box.classList.add('hidden');
}

function importResetSelectedSource() {
  __importSelectedSource = null;
  const preview = document.getElementById('import-selection-preview');
  if (preview) {
    preview.innerHTML = '';
    preview.classList.add('hidden');
  }
  const metaOpts = document.getElementById('import-meta-opts');
  if (metaOpts) metaOpts.classList.add('hidden');
  importHideTrackSelection();
}

function importResetReviewContext() {
  __importReviewContext = null;
  const preview = document.getElementById('import-review-preview');
  if (preview) {
    preview.innerHTML = '';
    preview.classList.add('hidden');
  }
}

function importResetDiscoveryState(options) {
  const preserveStatus = !!(options && options.preserveStatus);
  const preserveLogs = !!(options && options.preserveLogs);
  const hideReview = !options || options.hideReview !== false;

  importClearSearchResults();
  importResetSelectedSource();
  if (!options || !options.preserveReviewContext) {
    importResetReviewContext();
  }

  if (!preserveStatus) {
    const statusEl = document.getElementById('import-download-status');
    if (statusEl) statusEl.textContent = '';
  }

  if (!preserveLogs) {
    const logsEl = document.getElementById('import-logs');
    if (logsEl) {
      logsEl.textContent = '';
      logsEl.style.display = 'none';
    }
  }

  if (hideReview) {
    const reviewBtn = document.getElementById('import-goto-review');
    if (reviewBtn) reviewBtn.classList.add('hidden');
  }

  importUpdatePrimaryAction();
}

function importGetPrimaryActionConfig() {
  const raw = importTrimmedInput();
  const selected = __importSelectedSource;
  if (!raw) {
    return { label: 'Find Matches', disabled: false };
  }
  if (selected && selected.input === raw && selected.sourceUrl) {
    // If we have a track checklist, label reflects selected count
    const checkedCount = __importTrackSelection.filter(t => t.checked).length;
    if (__importTrackSelection.length > 0) {
      return { label: `Download ${checkedCount} track${checkedCount === 1 ? '' : 's'}`, disabled: checkedCount === 0 };
    }
    return { label: 'Download Selection', disabled: false };
  }
  if (importDetectInputKind(raw) === 'query') {
    return { label: 'Find Matches', disabled: false };
  }
  return {
    label: importDetectUrlType(raw) === 'spotify' ? 'Download Link' : 'Preview Link',
    disabled: false,
  };
}

function importUpdatePrimaryAction() {
  const btn = document.getElementById('import-download-btn');
  if (!btn) return;
  const config = importGetPrimaryActionConfig();
  btn.textContent = config.label;
  btn.disabled = !!config.disabled;
}

function importRenderSearchResults(items) {
  const box = document.getElementById('import-search-results');
  if (!box) return;

  if (!Array.isArray(items) || !items.length) {
    box.innerHTML = '';
    box.classList.add('hidden');
    return;
  }

  box.innerHTML = items.map((item, idx) => {
    const metaParts = [item.artist, item.album, item.year, item.durationLabel].filter(Boolean);
    return `
      <button type="button" class="import-result-card" data-import-result-idx="${idx}">
        <div class="import-result-top">
          <div class="min-w-0">
            <div class="import-result-title">${_escHtml(item.title || 'Untitled')}</div>
            <div class="import-result-meta">${_escHtml(metaParts.join(' • '))}</div>
          </div>
          <div class="import-result-pill">${_escHtml(item.kind || 'track')}</div>
        </div>
      </button>
    `;
  }).join('');
  box.classList.remove('hidden');

  box.querySelectorAll('[data-import-result-idx]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const idx = Number(btn.getAttribute('data-import-result-idx'));
      const item = __importSearchResults[idx];
      if (!item) return;
      await importPreviewSelection(item, { input: importTrimmedInput() });
    });
  });
}

function importIsRadioOrMixUrl(url) {
  try {
    const parsed = new URL(String(url || ''));
    const list = parsed.searchParams.get('list') || '';
    return parsed.searchParams.has('start_radio') || list.startsWith('RD') || list.startsWith('FL');
  } catch (_) {}
  return false;
}

function importRenderPreview(previewData) {
  const target = document.getElementById('import-selection-preview');
  importRenderPreviewInto(target, previewData, { emptyMessage: 'Metadata will be editable before save.' });

  const metaOpts = document.getElementById('import-meta-opts');
  if (metaOpts) metaOpts.classList.toggle('hidden', !previewData);

  if (!previewData) {
    importHideTrackSelection();
    return;
  }

  // Only show a track list for radio/mix URLs — not for single videos or regular playlists.
  const originalInput = __importSelectedSource && __importSelectedSource.input || '';
  const isRadio = importIsRadioOrMixUrl(originalInput);

  if (isRadio) {
    const statusEl = document.getElementById('import-download-status');
    if (statusEl) statusEl.textContent = 'Loading track list…';
    importFetchPlaylistTracks(originalInput).then(tracks => {
      importRenderTrackSelection(tracks);
      if (statusEl) statusEl.textContent = `${tracks.length} tracks found. Check the ones you want, then click Download.`;
    }).catch(e => {
      if (statusEl) statusEl.textContent = '✗ Could not load track list: ' + e.message;
    });
  } else {
    importHideTrackSelection();
  }
}

function importRenderPreviewInto(target, previewData, options) {
  if (!target) return;

  if (!previewData || typeof previewData !== 'object') {
    target.innerHTML = '';
    target.classList.add('hidden');
    return;
  }

  const cover = String(previewData.coverUrl || '').trim();
  const metaParts = [previewData.artist, previewData.album, previewData.year, previewData.trackCount ? `${previewData.trackCount} track${previewData.trackCount === 1 ? '' : 's'}` : ''].filter(Boolean);
  const tracks = Array.isArray(previewData.tracks) ? previewData.tracks.slice(0, 5) : [];
  const remainingCount = Math.max((previewData.trackCount || tracks.length) - tracks.length, 0);
  const emptyMessage = String(options && options.emptyMessage || 'Metadata will be editable before save.');

  target.innerHTML = `
    <div class="import-preview-card">
      ${cover
        ? `<img class="import-preview-cover" src="${_escAttr(cover)}" alt="Preview artwork">`
        : `<div class="import-preview-cover import-preview-cover-fallback"><i class="fas fa-music"></i></div>`}
      <div class="import-preview-body">
        <div class="import-preview-title">${_escHtml(importCleanTitle(previewData.title || 'Untitled'))}</div>
        <div class="import-preview-sub">${_escHtml(metaParts.join(' • ') || emptyMessage)}</div>
        ${tracks.length ? `
          <ol class="import-preview-tracks">
            ${tracks.map((track) => `<li>${_escHtml(importCleanTitle(track.title || 'Untitled'))}${track.artist ? ` <span style="color:rgba(255,255,255,0.45)">• ${_escHtml(track.artist)}</span>` : ''}</li>`).join('')}
            ${remainingCount > 0 ? `<li>+ ${remainingCount} more track${remainingCount === 1 ? '' : 's'}</li>` : ''}
          </ol>
        ` : ''}
      </div>
    </div>
  `;
  target.classList.remove('hidden');
}

function importRenderReviewContext() {
  const box = document.getElementById('import-review-preview');
  if (!box) return;
  if (!__importReviewContext || !__importReviewContext.preview) {
    box.innerHTML = '';
    box.classList.add('hidden');
    return;
  }
  importRenderPreviewInto(box, __importReviewContext.preview, { emptyMessage: 'Matched source metadata for this download.' });
}

function importNeedsMetadataDefault(value, file) {
  const raw = String(value || '').trim();
  const stem = String(file && file.fileName ? file.fileName.replace(/\.[^.]+$/, '') : '').trim();
  if (!raw) return true;
  if (stem && raw.toLowerCase() === stem.toLowerCase()) return true;
  return false;
}

async function importPatchReviewField(file, field, value) {
  const next = String(value || '').trim();
  if (!file || !next) return file;

  const serverUrl = importGetServerUrl();
  const res = await fetch(serverUrl + '/file', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ localPath: file.localPath, field, value: next }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.ok || !data.file) {
    throw new Error(data.detail || 'Could not save metadata defaults');
  }
  return data.file;
}

async function importApplyReviewPreviewDefaults() {
  if (!__importReviewContext || !__importReviewContext.preview || !Array.isArray(__importReviewFiles) || !__importReviewFiles.length) {
    return;
  }

  const metaOpts = importGetMetaOptions();
  const preview = __importReviewContext.preview;
  const tracks = Array.isArray(preview.tracks) ? preview.tracks : [];

  for (let idx = 0; idx < __importReviewFiles.length; idx += 1) {
    let file = __importReviewFiles[idx];
    const track = tracks[idx] || tracks[0] || null;
    const patchPlan = [];

    if (metaOpts.title && track && importNeedsMetadataDefault(file.title, file) && track.title) {
      patchPlan.push(['title', importCleanTitle(track.title)]);
    }
    if (metaOpts.artist && track && importNeedsMetadataDefault(file.artist, file) && track.artist) {
      patchPlan.push(['artist', track.artist]);
    }
    if (metaOpts.album && importNeedsMetadataDefault(file.album, file) && preview.title) {
      patchPlan.push(['album', preview.title]);
    }
    if (metaOpts.albumartist && importNeedsMetadataDefault(file.albumartist, file) && preview.artist) {
      patchPlan.push(['albumartist', preview.artist]);
    }

    for (const [field, value] of patchPlan) {
      try {
        file = await importPatchReviewField(file, field, value);
      } catch (e) {
        try { console.warn('[import] default metadata patch failed:', e); } catch (_) {}
      }
    }

    __importReviewFiles[idx] = file;
  }
}

async function importSearchCandidates(query) {
  const serverUrl = importGetServerUrl();
  const res = await fetch(serverUrl + '/search', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, limit: IMPORT_SEARCH_LIMIT }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Search request failed');
  return Array.isArray(data.items) ? data.items : [];
}

async function importPreviewUrl(url) {
  const serverUrl = importGetServerUrl();
  const cleanedUrl = importCleanUrl(url);
  const res = await fetch(serverUrl + '/preview', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: cleanedUrl }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Preview request failed');
  return data.preview || null;
}

async function importPreviewSelection(item, options) {
  const statusEl = document.getElementById('import-download-status');
  const inputSnapshot = String(options && options.input || importTrimmedInput());

  importRenderSearchResults(__importSearchResults);
  importRenderPreview(null);
  if (statusEl) statusEl.textContent = 'Loading preview…';

  try {
    const preview = await importPreviewUrl(item.sourceUrl);
    __importSelectedSource = {
      input: inputSnapshot,
      sourceUrl: item.sourceUrl,
      provider: item.provider || 'youtube',
      item,
      preview,
    };
    importRenderPreview(preview);
    if (statusEl) statusEl.textContent = 'Preview ready. Download when you are ready.';
  } catch (e) {
    __importSelectedSource = null;
    if (statusEl) statusEl.textContent = '✗ ' + e.message;
  }

  importUpdatePrimaryAction();
}

async function importResolvePrimaryAction() {
  const raw = importTrimmedInput();
  const statusEl = document.getElementById('import-download-status');
  const reviewBtn = document.getElementById('import-goto-review');

  if (!raw) {
    alert('Please type a search or paste a link.');
    return;
  }

  if (reviewBtn) reviewBtn.classList.add('hidden');

  const selected = __importSelectedSource;
  if (selected && selected.input === raw && selected.sourceUrl) {
    await importStartDownload(selected.sourceUrl);
    return;
  }

  if (importDetectInputKind(raw) === 'query') {
    importResetSelectedSource();
    importClearSearchResults();
    if (statusEl) statusEl.textContent = 'Searching…';
    try {
      const items = await importSearchCandidates(raw);
      __importSearchResults = items;
      importRenderSearchResults(items);
      if (!items.length) {
        if (statusEl) statusEl.textContent = 'No matches found. Try a more specific artist, album, or song.';
      } else {
        if (statusEl) statusEl.textContent = `Found ${items.length} match${items.length === 1 ? '' : 'es'}. Pick the closest one to preview.`;
      }
    } catch (e) {
      if (statusEl) statusEl.textContent = '✗ ' + e.message;
    }
    importUpdatePrimaryAction();
    return;
  }

  if (importDetectUrlType(raw) === 'spotify') {
    if (statusEl) statusEl.textContent = 'Spotify links download directly for now.';
    await importStartDownload(raw);
    return;
  }

  importClearSearchResults();
  if (statusEl) statusEl.textContent = 'Loading preview…';
  const cleanedRaw = importCleanUrl(raw);
  let preview = null;
  try {
    preview = await importPreviewUrl(cleanedRaw);
  } catch (e) {
    // If preview fails but the original URL is a radio/mix, don't give up —
    // the seed video may be geo-restricted but the playlist itself is accessible.
    if (importIsRadioOrMixUrl(raw)) {
      preview = { kind: 'playlist', title: 'Radio / Mix', artist: '', sourceUrl: raw, trackCount: 0, tracks: [] };
    } else {
      if (statusEl) statusEl.textContent = '✗ ' + e.message;
      importUpdatePrimaryAction();
      return;
    }
  }
  __importSelectedSource = {
    input: raw,
    sourceUrl: cleanedRaw,
    provider: 'youtube',
    item: null,
    preview,
  };
  importRenderPreview(preview);
  // importRenderPreview sets the status to "Loading track list…" for radio URLs,
  // so only update status here for single-track previews.
  if (!importIsRadioOrMixUrl(raw)) {
    if (statusEl) statusEl.textContent = 'Preview ready. Click Download when you are ready.';
  }
  importUpdatePrimaryAction();
}

async function importApplyLaunchContext(context) {
  const launch = context && typeof context === 'object' ? context : null;
  if (!launch) return;

  const inputEl = document.getElementById('import-url');
  const launchInput = String(launch.input || launch.query || launch.url || '').trim();

  if (inputEl && launchInput) {
    inputEl.value = launchInput;
  }

  if (launch.preview && launch.sourceUrl) {
    __importSelectedSource = {
      input: launchInput || String(launch.sourceUrl || '').trim(),
      sourceUrl: String(launch.sourceUrl || '').trim(),
      provider: String(launch.provider || 'youtube').trim() || 'youtube',
      item: launch.item || null,
      preview: launch.preview,
    };
    __importReviewContext = importCloneData(__importSelectedSource);
    importRenderPreview(launch.preview);
  }

  importUpdatePrimaryAction();

  const wantsDownloadPanel = !!(launch.preferDownloadPanel || launchInput || launch.sourceUrl || launch.preview);
  if (!wantsDownloadPanel) return;

  const serverOk = await importPingServer();
  if (serverOk) {
    importShowPanel('download');
    importUpdatePrimaryAction();
    if (launch.autoResolve) {
      await importResolvePrimaryAction();
    }
    return;
  }

  importShowPanel('setup');
  const statusEl = document.getElementById('import-download-status');
  if (statusEl && launchInput) {
    statusEl.textContent = 'Finish setup and start the local helper to continue with your selected download.';
  }
}

// ---------------------------------------------------------------------------
// Server health ping
// ---------------------------------------------------------------------------
async function importPingServer() {
  const dot = document.getElementById('import-server-dot');
  const label = document.getElementById('import-server-label');
  const url = importGetServerUrl();

  if (dot) dot.className = 'import-server-dot import-dot-checking';
  if (label) label.textContent = 'Checking…';

  try {
    const res = await fetch(url + '/health', { signal: AbortSignal.timeout(3000) });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      if (dot) dot.className = 'import-server-dot import-dot-ok';
      if (label) label.textContent = 'Connected';
      return true;
    }
    throw new Error('bad response');
  } catch (e) {
    if (dot) dot.className = 'import-server-dot import-dot-error';
    if (label) label.textContent = 'Not running — start it with: bash downloader/start.sh';
    return false;
  }
}

// ---------------------------------------------------------------------------
// Panel switching
// ---------------------------------------------------------------------------
function importShowPanel(panel) {
  __importCurrentPanel = panel;
  ['setup', 'download', 'review'].forEach(id => {
    const el = document.getElementById('import-panel-' + id);
    if (el) el.classList.toggle('hidden', id !== panel);
  });

  // Update step indicator
  const steps = ['setup', 'download', 'review'];
  steps.forEach((s, i) => {
    const el = document.getElementById('import-step-' + s);
    if (!el) return;
    if (s === panel) {
      el.classList.add('import-step-active');
      el.classList.remove('import-step-done', 'import-step-inactive');
    } else if (steps.indexOf(s) < steps.indexOf(panel)) {
      el.classList.add('import-step-done');
      el.classList.remove('import-step-active', 'import-step-inactive');
    } else {
      el.classList.add('import-step-inactive');
      el.classList.remove('import-step-active', 'import-step-done');
    }
  });
}

// ---------------------------------------------------------------------------
// Setup panel
// ---------------------------------------------------------------------------
function importInitSetupPanel() {
  const settings = importLoadSettings();

  const fields = {
    'import-server-url':       settings.serverUrl       || IMPORT_DEFAULT_SERVER,
    'import-spotify-client':   settings.spotifyClientId  || '',
    'import-spotify-secret':   settings.spotifySecret    || '',
    'import-r2-account':       settings.r2AccountId      || '',
    'import-r2-access-key':    settings.r2AccessKeyId    || '',
    'import-r2-secret':        settings.r2SecretAccessKey || '',
    'import-r2-bucket':        settings.r2Bucket         || '',
    'import-personal-url':     settings.personalUrl      || '',
  };

  Object.entries(fields).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });

  importPingServer();

  // Library mode toggle
  const modeSharedBtn   = document.getElementById('import-mode-shared');
  const modePersonalBtn = document.getElementById('import-mode-personal');
  const _updateModeBtns = () => {
    const m = localStorage.getItem('libraryMode') || 'shared';
    if (modeSharedBtn) {
      modeSharedBtn.style.background = m === 'shared' ? '#1db954' : '';
      modeSharedBtn.style.color      = m === 'shared' ? '#000' : '';
    }
    if (modePersonalBtn) {
      modePersonalBtn.style.background = m === 'personal' ? '#1db954' : '';
      modePersonalBtn.style.color      = m === 'personal' ? '#000' : '';
    }
    // Keep settings label in sync
    try {
      const lbl = document.getElementById('settings-library-source-label');
      const sw  = document.getElementById('settings-switch-library-mode');
      if (lbl) lbl.textContent = m === 'personal' ? 'Your Library' : 'Shared Library';
      if (sw)  sw.textContent  = m === 'personal' ? 'Use Shared'   : 'Use My Library';
    } catch (e) {}
  };
  _updateModeBtns();
  if (modeSharedBtn && !modeSharedBtn.__importModeBound) {
    modeSharedBtn.__importModeBound = true;
    modeSharedBtn.addEventListener('click', () => {
      localStorage.setItem('libraryMode', 'shared');
      _updateModeBtns();
      importShowSaveToast('Now using Shared Library');
    });
  }
  if (modePersonalBtn && !modePersonalBtn.__importModeBound) {
    modePersonalBtn.__importModeBound = true;
    modePersonalBtn.addEventListener('click', () => {
      localStorage.setItem('libraryMode', 'personal');
      _updateModeBtns();
      importShowSaveToast('Now using My Library');
    });
  }

  const saveBtn = document.getElementById('import-save-settings');
  if (saveBtn && !saveBtn.__importBound) {
    saveBtn.__importBound = true;
    saveBtn.addEventListener('click', () => {
      importSaveSettings({
        serverUrl:            document.getElementById('import-server-url')?.value?.trim()  || IMPORT_DEFAULT_SERVER,
        spotifyClientId:      document.getElementById('import-spotify-client')?.value?.trim() || '',
        spotifySecret:        document.getElementById('import-spotify-secret')?.value?.trim() || '',
        r2AccountId:          document.getElementById('import-r2-account')?.value?.trim()  || '',
        r2AccessKeyId:        document.getElementById('import-r2-access-key')?.value?.trim() || '',
        r2SecretAccessKey:    document.getElementById('import-r2-secret')?.value?.trim()   || '',
        r2Bucket:             document.getElementById('import-r2-bucket')?.value?.trim()   || '',
        personalUrl:          document.getElementById('import-personal-url')?.value?.trim() || '',
      });
      importShowSaveToast('Settings saved');
      importPingServer();
    });
  }

  const testBtn = document.getElementById('import-test-server');
  if (testBtn && !testBtn.__importBound) {
    testBtn.__importBound = true;
    testBtn.addEventListener('click', () => {
      // Re-read URL from input before pinging (user may have typed a new one without saving)
      const raw = document.getElementById('import-server-url')?.value?.trim();
      if (raw) importSaveSettings({ serverUrl: raw });
      importPingServer();
    });
  }

  const nextBtn = document.getElementById('import-goto-download');
  if (nextBtn && !nextBtn.__importBound) {
    nextBtn.__importBound = true;
    nextBtn.addEventListener('click', async () => {
      const ok = await importPingServer();
      if (!ok) {
        alert('Cannot reach the local server. Make sure it is running first.');
        return;
      }
      importShowPanel('download');
    });
  }
}

// ---------------------------------------------------------------------------
// Download panel
// ---------------------------------------------------------------------------
function importInitDownloadPanel() {
  const dlBtn = document.getElementById('import-download-btn');
  if (dlBtn && !dlBtn.__importBound) {
    dlBtn.__importBound = true;
    dlBtn.addEventListener('click', importResolvePrimaryAction);
  }

  const input = document.getElementById('import-url');
  if (input && !input.__importBound) {
    input.__importBound = true;
    input.addEventListener('input', () => {
      const current = importTrimmedInput();
      if (!__importSelectedSource || __importSelectedSource.input !== current) {
        importResetSelectedSource();
      }
      importClearSearchResults();
      const statusEl = document.getElementById('import-download-status');
      if (statusEl && statusEl.textContent && !current) statusEl.textContent = '';
      importUpdatePrimaryAction();
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        importResolvePrimaryAction();
      }
    });
  }

  const reviewBtn = document.getElementById('import-goto-review');
  if (reviewBtn && !reviewBtn.__importBound) {
    reviewBtn.__importBound = true;
    reviewBtn.addEventListener('click', () => importShowPanel('review'));
  }

  importUpdatePrimaryAction();
}

function importCleanUrl(url) {
  // Strip YouTube radio/mix/playlist params, keeping only ?v=VIDEO_ID
  try {
    const parsed = new URL(url);
    if (['www.youtube.com', 'youtube.com', 'm.youtube.com'].includes(parsed.hostname) && parsed.pathname === '/watch') {
      const videoId = parsed.searchParams.get('v');
      if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    }
  } catch (_) {}
  return url;
}

// ---------------------------------------------------------------------------
// Metadata options (which fields to auto-fill)
// ---------------------------------------------------------------------------
function importGetMetaOptions() {
  const opts = {};
  document.querySelectorAll('.import-meta-check').forEach(cb => {
    opts[cb.dataset.field] = cb.checked;
  });
  // default all true if checkboxes not in DOM yet
  ['title','artist','album','albumartist','year','artwork'].forEach(f => {
    if (!(f in opts)) opts[f] = true;
  });
  return opts;
}

// ---------------------------------------------------------------------------
// Track selection helpers
// ---------------------------------------------------------------------------
async function importFetchPlaylistTracks(url) {
  const serverUrl = importGetServerUrl();
  const res = await fetch(serverUrl + '/playlist-tracks', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.detail || 'Could not load track list');
  return Array.isArray(data.tracks) ? data.tracks : [];
}

function importRenderTrackSelection(tracks) {
  const wrap = document.getElementById('import-track-select');
  const listEl = document.getElementById('import-track-list');
  const label = document.getElementById('import-track-select-label');
  if (!wrap || !listEl) return;

  if (!tracks || !tracks.length) {
    wrap.classList.add('hidden');
    return;
  }

  __importTrackSelection = tracks.map(t => ({ ...t, checked: true }));

  function updateLabel() {
    const checked = __importTrackSelection.filter(t => t.checked).length;
    if (label) label.textContent = `${checked} of ${__importTrackSelection.length} tracks selected`;
    const btn = document.getElementById('import-download-btn');
    if (btn) btn.textContent = `Download ${checked} track${checked === 1 ? '' : 's'}`;
  }

  listEl.innerHTML = __importTrackSelection.map((t, idx) => `
    <label class="import-track-row" data-track-idx="${idx}">
      <input type="checkbox" class="import-track-cb" data-idx="${idx}" ${t.checked ? 'checked' : ''}>
      <span class="import-track-row-title">${_escHtml(importCleanTitle(t.title || 'Untitled'))}</span>
      <span class="import-track-row-meta">${_escHtml(t.durationLabel || t.artist || '')}</span>
    </label>
  `).join('');

  listEl.querySelectorAll('.import-track-cb').forEach(cb => {
    cb.addEventListener('change', () => {
      const idx = Number(cb.dataset.idx);
      __importTrackSelection[idx].checked = cb.checked;
      updateLabel();
    });
  });

  const allBtn = document.getElementById('import-track-check-all');
  const noneBtn = document.getElementById('import-track-check-none');
  if (allBtn && !allBtn.__trackBound) {
    allBtn.__trackBound = true;
    allBtn.addEventListener('click', () => {
      __importTrackSelection.forEach(t => { t.checked = true; });
      listEl.querySelectorAll('.import-track-cb').forEach(cb => { cb.checked = true; });
      updateLabel();
    });
  }
  if (noneBtn && !noneBtn.__trackBound) {
    noneBtn.__trackBound = true;
    noneBtn.addEventListener('click', () => {
      __importTrackSelection.forEach(t => { t.checked = false; });
      listEl.querySelectorAll('.import-track-cb').forEach(cb => { cb.checked = false; });
      updateLabel();
    });
  }

  updateLabel();
  wrap.classList.remove('hidden');
}

function importHideTrackSelection() {
  __importTrackSelection = [];
  const wrap = document.getElementById('import-track-select');
  if (wrap) wrap.classList.add('hidden');
}

function importGetSelectedTrackUrls() {
  const checked = __importTrackSelection.filter(t => t.checked);
  return checked.map(t => t.sourceUrl).filter(Boolean);
}

function importDetectUrlType(url) {
  return (url.includes('spotify.com') || url.startsWith('spotify:')) ? 'spotify' : 'youtube';
}

async function importStartDownload(sourceUrl) {
  const url = importCleanUrl(String(sourceUrl || importTrimmedInput()).trim());
  if (!url) { alert('Please enter a URL.'); return; }

  const logsEl = document.getElementById('import-logs');
  const statusEl = document.getElementById('import-download-status');
  const reviewBtn = document.getElementById('import-goto-review');
  const dlBtn = document.getElementById('import-download-btn');

  if (logsEl) logsEl.textContent = '';
  if (logsEl) logsEl.style.display = '';
  if (statusEl) statusEl.textContent = 'Starting download…';
  if (reviewBtn) reviewBtn.classList.add('hidden');
  if (dlBtn) { dlBtn.disabled = true; dlBtn.textContent = 'Downloading…'; }

  // Reset progress bar
  const progressWrap = document.getElementById('import-progress-wrap');
  const progressBar  = document.getElementById('import-progress-bar');
  const progressLabel = document.getElementById('import-progress-label');
  if (progressWrap) progressWrap.classList.remove('hidden');
  if (progressBar)  progressBar.style.width = '0%';
  if (progressLabel) progressLabel.textContent = '';

  const settings = importLoadSettings();
  const serverUrl = importGetServerUrl();
  const selected = __importSelectedSource && __importSelectedSource.sourceUrl === url
    ? importCloneData(__importSelectedSource)
    : null;

  __importReviewContext = selected || {
    input: importTrimmedInput(),
    sourceUrl: url,
    provider: importDetectUrlType(url),
    item: null,
    preview: selected ? selected.preview : null,
  };

  // If we have a per-track checklist (playlist/mix), kick off one job per selected URL.
  // Otherwise fall through to the normal single-URL job.
  const selectedUrls = importGetSelectedTrackUrls();
  const urlsToDownload = selectedUrls.length > 0 ? selectedUrls : [url];
  const totalTracks = urlsToDownload.length;
  let completedTracks = 0;

  const body = {
    url: urlsToDownload[0],
    outputFormat: '{artist}/{album}/{title}.{output-ext}',
    spotifyClientId: settings.spotifyClientId || undefined,
    spotifyClientSecret: settings.spotifySecret || undefined,
  };
  Object.keys(body).forEach(k => { if (body[k] === undefined) delete body[k]; });

  let jobId;
  try {
    const res = await fetch(serverUrl + '/download', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json();
    if (!res.ok || !data.jobId) throw new Error(data.detail || 'Server error');
    jobId = data.jobId;
    __importCurrentJobId = jobId;
  } catch (e) {
    if (statusEl) statusEl.textContent = '✗ Failed to start: ' + e.message;
    if (progressWrap) progressWrap.classList.add('hidden');
    importUpdatePrimaryAction();
    return;
  }

  const pollOpts = { totalTracks, completedTracks, remainingUrls: urlsToDownload.slice(1), settings };
  __importBgPollOpts = pollOpts;
  importPollJob(jobId, pollOpts);
}

function importPollJob(jobId, opts) {
  if (__importPollTimer) { clearInterval(__importPollTimer); __importPollTimer = null; }

  // Show the download-in-progress badge on the Crate nav tab
  importSetDownloadBadge(true);

  const serverUrl = importGetServerUrl();

  // Grab UI elements fresh — they may not exist if the user navigated away
  function ui(id) { return document.getElementById(id); }

  const totalTracks     = (opts && opts.totalTracks)     || 1;
  let   completedTracks = (opts && opts.completedTracks) || 0;
  const remainingUrls   = (opts && opts.remainingUrls)   || [];
  const settings        = (opts && opts.settings)        || importLoadSettings();

  let lastLogCount = 0;

  // Regex to parse yt-dlp progress lines like:
  // [download]  45.3% of   5.67MiB at    2.34MiB/s ETA 00:02
  const progressRe = /\[download\]\s+([\d.]+)%.*?ETA\s+([\d:]+)/i;

  function _setOverallProgress(filePercent) {
    const overall = ((completedTracks + filePercent / 100) / totalTracks) * 100;
    const bar = ui('import-progress-bar');
    if (bar) bar.style.width = Math.min(100, overall).toFixed(1) + '%';
  }

  __importPollTimer = setInterval(async () => {
    try {
      const res = await fetch(serverUrl + '/job/' + jobId);
      const data = await res.json();

      // Append new log lines + parse progress
      if (Array.isArray(data.logs)) {
        const newLines = data.logs.slice(lastLogCount);
        lastLogCount = data.logs.length;
        if (newLines.length) {
          const logsEl = ui('import-logs');
          if (logsEl) {
            logsEl.textContent += newLines.join('\n') + '\n';
            logsEl.scrollTop = logsEl.scrollHeight;
          }
          for (let i = newLines.length - 1; i >= 0; i--) {
            const match = progressRe.exec(newLines[i]);
            if (match) {
              const filePct = parseFloat(match[1]);
              const eta = match[2];
              _setOverallProgress(filePct);
              const lbl = ui('import-progress-label');
              if (lbl) {
                const trackInfo = totalTracks > 1 ? `Track ${completedTracks + 1} of ${totalTracks} — ` : '';
                lbl.textContent = `${trackInfo}${filePct.toFixed(0)}%  •  ~${eta} remaining`;
              }
              break;
            }
          }
        }
      }

      if (data.status === 'done') {
        clearInterval(__importPollTimer);
        __importPollTimer = null;
        completedTracks += 1;
        _setOverallProgress(100);

        // If there are more queued tracks, start the next one
        if (remainingUrls.length > 0) {
          const nextUrl = remainingUrls[0];
          const nextBody = {
            url: nextUrl,
            outputFormat: '{artist}/{album}/{title}.{output-ext}',
            spotifyClientId: settings.spotifyClientId || undefined,
            spotifyClientSecret: settings.spotifySecret || undefined,
          };
          Object.keys(nextBody).forEach(k => { if (nextBody[k] === undefined) delete nextBody[k]; });
          const nextOpts = { totalTracks, completedTracks, remainingUrls: remainingUrls.slice(1), settings };
          __importBgPollOpts = nextOpts;
          const statusEl = ui('import-download-status');
          const lbl = ui('import-progress-label');
          if (statusEl) statusEl.textContent = `Downloading track ${completedTracks + 1} of ${totalTracks}…`;
          if (lbl) lbl.textContent = `Track ${completedTracks + 1} of ${totalTracks}`;
          try {
            const res2 = await fetch(serverUrl + '/download', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(nextBody),
            });
            const d2 = await res2.json();
            if (!res2.ok || !d2.jobId) throw new Error(d2.detail || 'Server error');
            __importCurrentJobId = d2.jobId;
            importPollJob(d2.jobId, nextOpts);
          } catch (e) {
            if (statusEl) statusEl.textContent = '✗ Failed on track ' + (completedTracks + 1) + ': ' + e.message;
            importSetDownloadBadge(false);
          }
          return;
        }

        // All done
        __importCurrentJobId = null;
        __importBgPollOpts = null;
        importSetDownloadBadge(false);
        const fileCount = Array.isArray(data.files) ? data.files.length : 0;
        const label = totalTracks > 1 ? `${totalTracks} tracks downloaded` : 'Download complete';
        // Toast is shown regardless of which tab the user is on
        importShowToast(`✓ ${label} — tap Crate to review`, 5000);

        const statusEl = ui('import-download-status');
        const progressLbl = ui('import-progress-label');
        const progressWrap = ui('import-progress-wrap');
        const reviewBtn = ui('import-goto-review');
        if (statusEl) statusEl.textContent = `✓ Done — ${fileCount} file(s) ready`;
        if (progressLbl) progressLbl.textContent = '';
        if (progressWrap) progressWrap.classList.add('hidden');
        importResetSelectedSource();
        importClearSearchResults();
        importUpdatePrimaryAction();
        if (__importReviewContext && __importReviewContext.preview) {
          // Only auto-switch panel if user is already looking at the download panel
          if (__importCurrentPanel === 'download') {
            importShowPanel('review');
            importInitReviewPanel();
          } else if (reviewBtn) {
            reviewBtn.classList.remove('hidden');
          }
        } else if (reviewBtn) {
          reviewBtn.classList.remove('hidden');
        }
      }

      if (data.status === 'error') {
        clearInterval(__importPollTimer);
        __importPollTimer = null;
        __importCurrentJobId = null;
        __importBgPollOpts = null;
        importSetDownloadBadge(false);
        importShowToast('✗ Download failed — open Crate to see details', 5000);
        const statusEl = ui('import-download-status');
        const progressWrap = ui('import-progress-wrap');
        if (statusEl) statusEl.textContent = '✗ Download failed — see logs above';
        if (progressWrap) progressWrap.classList.add('hidden');
        importUpdatePrimaryAction();
      }
    } catch (e) {
      // network blip — keep polling
    }
  }, 1200);
}


// ---------------------------------------------------------------------------
// Review panel
// ---------------------------------------------------------------------------
async function importLoadReviewFiles() {
  const listEl = document.getElementById('import-file-list');
  const statusEl = document.getElementById('import-review-status');

  importRenderReviewContext();
  if (statusEl) statusEl.textContent = 'Loading files…';
  if (listEl) listEl.innerHTML = '';

  const serverUrl = importGetServerUrl();

  try {
    const res = await fetch(serverUrl + '/files');
    const data = await res.json();
    __importReviewFiles = Array.isArray(data.files) ? data.files : [];
  } catch (e) {
    if (statusEl) statusEl.textContent = '✗ Could not load files — is the server running?';
    return;
  }

  if (!__importReviewFiles.length) {
    if (statusEl) statusEl.textContent = 'No audio files found in output folder.';
    return;
  }

  await importApplyReviewPreviewDefaults();

  if (statusEl) statusEl.textContent = `${__importReviewFiles.length} file(s) — edit tags, then upload.`;

  importRenderFileRows();
}

function importComputeR2Key(file) {
  const artist = (file.albumartist || file.artist || 'Unknown Artist').trim();
  const album = (file.album || 'Singles').trim();
  const title = (file.title || file.fileName || 'Unknown').trim();
  const ext = file.fileName ? file.fileName.split('.').pop() : 'mp3';
  return `${artist}/${album}/${title}.${ext}`;
}

function importComputeUploadR2Key(file) {
  const baseKey = importComputeR2Key(file);
  const uid = importGetAccountUserId();
  return uid ? `users/${uid}/${baseKey}` : baseKey;
}

function importIsPersonalLibraryMode() {
  try {
    return String(localStorage.getItem('libraryMode') || 'shared').trim().toLowerCase() === 'personal';
  } catch (e) {
    return false;
  }
}

function importDescribeAuthFailure(status, fallbackMessage) {
  if (Number(status) === 401) {
    return 'Your sign-in expired. Sign in again and retry.';
  }
  return fallbackMessage;
}

async function importRefreshPersonalLibrary(options) {
  const navigateToLibrary = !options || options.navigateToLibrary !== false;
  try { localStorage.setItem('libraryMode', 'personal'); } catch (e) {}
  if (typeof window.refreshLibraryForCurrentMode === 'function') {
    await window.refreshLibraryForCurrentMode();
    if (navigateToLibrary) {
      try { showView('library'); } catch (e) {}
    }
    return;
  }

  if (typeof window.personalDataApiUrl !== 'function') {
    throw new Error('Personal library API is unavailable.');
  }

  const res = await fetch(window.personalDataApiUrl('/user/songs'), {
    credentials: 'include',
    headers: { 'Accept': 'application/json' },
  });
  const data = await res.json().catch(() => ([]));
  if (!res.ok) {
    throw new Error(importDescribeAuthFailure(
      res.status,
      data && data.error ? data.error : `Personal library request failed with status ${res.status}`
    ));
  }
  if (!Array.isArray(data)) {
    throw new Error('Personal library response was invalid.');
  }

  if (typeof window.applyLibraryAndRender === 'function') {
    window.applyLibraryAndRender(data);
  }
  if (navigateToLibrary) {
    try { showView('library'); } catch (e) {}
  }
}

async function importLoadPersonalLibraryIntoApp() {
  return importRefreshPersonalLibrary({ navigateToLibrary: true });
}

function importRenderFileRows() {
  const listEl = document.getElementById('import-file-list');
  if (!listEl) return;

  listEl.innerHTML = '';

  __importReviewFiles.forEach((file, idx) => {
    const row = document.createElement('div');
    row.className = 'import-file-row';
    row.dataset.idx = idx;

    const r2Key = importComputeR2Key(file);

    row.innerHTML = `
      <div class="import-row-top">
        <label class="import-checkbox-wrap">
          <input type="checkbox" class="import-file-check" checked data-idx="${idx}">
        </label>
        <div class="import-filename">${_escHtml(file.fileName)}</div>
        <div class="import-file-size">${_formatBytes(file.size)}</div>
      </div>
      <div class="import-row-tags">
        <div class="import-tag-group">
          <label class="import-tag-label">Title</label>
          <input type="text" class="import-tag-input" data-idx="${idx}" data-field="title" value="${_escAttr(file.title)}">
        </div>
        <div class="import-tag-group">
          <label class="import-tag-label">Artist</label>
          <input type="text" class="import-tag-input" data-idx="${idx}" data-field="artist" value="${_escAttr(file.artist)}">
        </div>
        <div class="import-tag-group">
          <label class="import-tag-label">Album</label>
          <input type="text" class="import-tag-input" data-idx="${idx}" data-field="album" value="${_escAttr(file.album)}">
        </div>
        <div class="import-tag-group">
          <label class="import-tag-label">Album Artist</label>
          <input type="text" class="import-tag-input" data-idx="${idx}" data-field="albumartist" value="${_escAttr(file.albumartist)}">
        </div>
      </div>
      <div class="import-r2-key" id="import-r2key-${idx}">R2: ${_escHtml(r2Key)}</div>
    `;

    listEl.appendChild(row);
  });

  // Bind tag input blur → save tag + update R2 key preview
  listEl.querySelectorAll('.import-tag-input').forEach(input => {
    input.addEventListener('blur', importHandleTagBlur);
    // Update R2 key preview live on input (before save)
    input.addEventListener('input', (e) => {
      const idx = parseInt(e.target.dataset.idx, 10);
      const field = e.target.dataset.field;
      // Update in-memory copy for R2 key preview
      if (__importReviewFiles[idx]) {
        __importReviewFiles[idx][field] = e.target.value;
        const keyEl = document.getElementById('import-r2key-' + idx);
        if (keyEl) keyEl.textContent = 'R2: ' + importComputeR2Key(__importReviewFiles[idx]);
      }
    });
  });
}

async function importHandleTagBlur(e) {
  const idx = parseInt(e.target.dataset.idx, 10);
  const field = e.target.dataset.field;
  const value = e.target.value;
  const file = __importReviewFiles[idx];
  if (!file) return;

  const serverUrl = importGetServerUrl();

  try {
    const res = await fetch(serverUrl + '/file', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ localPath: file.localPath, field, value }),
    });
    const data = await res.json().catch(() => ({}));
    if (res.ok && data.ok) {
      // Update in-memory record with server response
      if (data.file) __importReviewFiles[idx] = data.file;
      // Refresh R2 key preview
      const keyEl = document.getElementById('import-r2key-' + idx);
      if (keyEl) keyEl.textContent = 'R2: ' + importComputeR2Key(__importReviewFiles[idx]);
    }
  } catch (err) {
    // non-fatal — user can retry
    console.warn('[import] tag save failed:', err);
  }
}

function importGetSelectedFiles() {
  const checks = document.querySelectorAll('.import-file-check');
  const selected = [];
  checks.forEach(cb => {
    if (cb.checked) {
      const idx = parseInt(cb.dataset.idx, 10);
      if (__importReviewFiles[idx]) selected.push(__importReviewFiles[idx]);
    }
  });
  return selected;
}

// ---------------------------------------------------------------------------
// Upload
// ---------------------------------------------------------------------------
async function importUploadSelected() {
  const settings = importLoadSettings();
  const serverUrl = importGetServerUrl();
  const userId = importGetAccountUserId();

  if (!userId) {
    alert('Sign in before uploading music into your personal library.');
    return;
  }

  if (!settings.r2AccountId || !settings.r2AccessKeyId || !settings.r2SecretAccessKey || !settings.r2Bucket) {
    alert('R2 credentials are missing. Please fill them in on the Setup panel.');
    importShowPanel('setup');
    return;
  }

  const selected = importGetSelectedFiles();
  if (!selected.length) {
    alert('No files selected.');
    return;
  }

  const uploadBtn = document.getElementById('import-upload-btn');
  const progressEl = document.getElementById('import-upload-progress');
  const doneBtn = document.getElementById('import-upload-done');

  if (uploadBtn) { uploadBtn.disabled = true; uploadBtn.textContent = 'Uploading…'; }
  if (progressEl) progressEl.textContent = `Uploading 0 / ${selected.length}…`;
  if (doneBtn) doneBtn.classList.add('hidden');

  const files = selected.map(f => ({
    localPath: f.localPath,
    r2Key: importComputeUploadR2Key(f),
  }));

  const body = {
    files,
    r2AccountId:          settings.r2AccountId,
    r2AccessKeyId:        settings.r2AccessKeyId,
    r2SecretAccessKey:    settings.r2SecretAccessKey,
    r2Bucket:             settings.r2Bucket,
    userId,
  };

  try {
    const res = await fetch(serverUrl + '/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) {
      throw new Error(importDescribeAuthFailure(res.status, data.detail || 'Upload request failed'));
    }

    const results = Array.isArray(data.results) ? data.results : [];
    const succeeded = results.filter(r => r.ok).length;
    const failed = results.filter(r => !r.ok);

    if (progressEl) {
      progressEl.textContent = `✓ Uploaded ${succeeded} / ${results.length} file(s).`;
      if (failed.length) {
        const errLines = failed.map(r => `✗ ${r.r2Key}: ${r.error}`).join('\n');
        progressEl.textContent += '\n\nFailed:\n' + errLines;
      }
    }

    if (succeeded > 0 && doneBtn) doneBtn.classList.remove('hidden');

  } catch (e) {
    if (progressEl) progressEl.textContent = '✗ Upload error: ' + e.message;
  } finally {
    if (uploadBtn) { uploadBtn.disabled = false; uploadBtn.textContent = 'Upload Selected'; }
  }
}

// ---------------------------------------------------------------------------
// Init review panel
// ---------------------------------------------------------------------------
function importInitReviewPanel() {
  const selectAllBtn = document.getElementById('import-select-all');
  if (selectAllBtn && !selectAllBtn.__importBound) {
    selectAllBtn.__importBound = true;
    selectAllBtn.addEventListener('click', () => {
      document.querySelectorAll('.import-file-check').forEach(cb => { cb.checked = true; });
    });
  }

  const deselectAllBtn = document.getElementById('import-deselect-all');
  if (deselectAllBtn && !deselectAllBtn.__importBound) {
    deselectAllBtn.__importBound = true;
    deselectAllBtn.addEventListener('click', () => {
      document.querySelectorAll('.import-file-check').forEach(cb => { cb.checked = false; });
    });
  }

  const uploadBtn = document.getElementById('import-upload-btn');
  if (uploadBtn && !uploadBtn.__importBound) {
    uploadBtn.__importBound = true;
    uploadBtn.addEventListener('click', importUploadSelected);
  }

  const doneBtn = document.getElementById('import-upload-done');
  if (doneBtn && !doneBtn.__importBound) {
    doneBtn.__importBound = true;
    doneBtn.addEventListener('click', async () => {
      try {
        await importLoadPersonalLibraryIntoApp();
      } catch (e) {
        alert('Upload finished, but the personal library refresh failed: ' + e.message);
      }
    });
  }

  const clearBtn = document.getElementById('import-clear-all');
  if (clearBtn && !clearBtn.__importBound) {
    clearBtn.__importBound = true;
    clearBtn.addEventListener('click', async () => {
      if (!confirm('Delete all downloaded files in the output folder? This cannot be undone.')) return;
      const serverUrl = importGetServerUrl();
      try {
        await fetch(serverUrl + '/clear', { method: 'POST' });
        __importReviewFiles = [];
        importResetReviewContext();
        importRenderFileRows();
        const statusEl = document.getElementById('import-review-status');
        if (statusEl) statusEl.textContent = 'Output folder cleared.';
      } catch (e) {
        alert('Could not clear files: ' + e.message);
      }
    });
  }

  importLoadReviewFiles();
  importInitCloneSection();
}

// ---------------------------------------------------------------------------
// Clone from Shared Library
// ---------------------------------------------------------------------------
async function importInitCloneSection() {
  const openBtn = document.getElementById('import-clone-open');
  const section = document.getElementById('import-clone-section');
  if (!openBtn || !section) return;

  if (!openBtn.__importCloneBound) {
    openBtn.__importCloneBound = true;
    openBtn.addEventListener('click', () => {
      const isOpen = !section.classList.contains('hidden');
      section.classList.toggle('hidden', isOpen);
      if (!isOpen) importLoadCloneList();
    });
  }

  const allBtn   = document.getElementById('import-clone-all');
  const noneBtn  = document.getElementById('import-clone-none');
  const startBtn = document.getElementById('import-clone-start');

  if (allBtn && !allBtn.__importCloneBound) {
    allBtn.__importCloneBound = true;
    allBtn.addEventListener('click', () => {
      document.querySelectorAll('.import-clone-check').forEach(cb => { cb.checked = true; });
    });
  }
  if (noneBtn && !noneBtn.__importCloneBound) {
    noneBtn.__importCloneBound = true;
    noneBtn.addEventListener('click', () => {
      document.querySelectorAll('.import-clone-check').forEach(cb => { cb.checked = false; });
    });
  }
  if (startBtn && !startBtn.__importCloneBound) {
    startBtn.__importCloneBound = true;
    startBtn.addEventListener('click', importRunClone);
  }
}

async function importLoadCloneList() {
  const listEl   = document.getElementById('import-clone-list');
  const statusEl = document.getElementById('import-clone-status');
  if (!listEl || !statusEl) return;

  statusEl.textContent = 'Loading shared library…';
  listEl.innerHTML = '';

  try {
    const res = await fetch('https://music-streamer.jacetbaum.workers.dev/api/get-songs?t=' + Date.now(), {
      signal: AbortSignal.timeout(8000),
    });
    const albums = await res.json();
    if (!Array.isArray(albums) || !albums.length) {
      statusEl.textContent = 'Shared library is empty or unreachable.';
      return;
    }
    const totalTracks = albums.reduce((n, a) => n + (a.songs || []).length, 0);
    statusEl.textContent = `${totalTracks} track(s) available. Check what you want to copy.`;

    albums.forEach(album => {
      const section = document.createElement('div');
      section.className = 'mb-2';

      const header = document.createElement('div');
      header.className = 'text-xs font-extrabold text-white/70 px-1 pt-1 pb-0.5';
      header.textContent = `${album.artistName} — ${album.albumName}`;
      section.appendChild(header);

      (album.songs || []).forEach(song => {
        const row = document.createElement('label');
        row.className = 'flex items-center gap-2 py-1 px-1 cursor-pointer hover:bg-white/5 rounded';
        row.innerHTML = `
          <input type="checkbox" class="import-clone-check"
            data-link="${_escAttr(song.link)}"
            data-key="${_escAttr(song.r2Path || (album.artistName + '/' + album.albumName + '/' + song.fileName))}">
          <span class="text-xs text-white/80">${_escHtml(song.title || song.fileName)}</span>
        `;
        section.appendChild(row);
      });

      listEl.appendChild(section);
    });
  } catch (e) {
    statusEl.textContent = '✗ Could not load shared library: ' + e.message;
  }
}

async function importRunClone() {
  const settings = importLoadSettings();
  const userId = importGetAccountUserId();
  if (!userId) {
    alert('Sign in before copying tracks into your personal library.');
    return;
  }
  if (!settings.r2AccountId || !settings.r2AccessKeyId || !settings.r2SecretAccessKey || !settings.r2Bucket) {
    alert('R2 credentials are required in Setup to copy tracks to your bucket.');
    importShowPanel('setup');
    return;
  }

  const checks = Array.from(document.querySelectorAll('.import-clone-check:checked'));
  if (!checks.length) { alert('No tracks selected.'); return; }

  const startBtn = document.getElementById('import-clone-start');
  const statusEl = document.getElementById('import-clone-status');
  const serverUrl = importGetServerUrl();

  if (startBtn) { startBtn.disabled = true; startBtn.textContent = 'Copying…'; }

  let done = 0, failed = 0;
  let authExpired = false;
  const total = checks.length;

  for (const cb of checks) {
    if (authExpired) break;
    const sourceUrl = cb.dataset.link;
    const r2Key    = cb.dataset.key;
    if (statusEl) statusEl.textContent = `Copying ${done + failed + 1} / ${total}…`;
    try {
      const res = await fetch(serverUrl + '/copy-from-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceUrl,
          r2Key,
          r2AccountId:       settings.r2AccountId,
          r2AccessKeyId:     settings.r2AccessKeyId,
          r2SecretAccessKey: settings.r2SecretAccessKey,
          r2Bucket:          settings.r2Bucket,
          userId,
        }),
        signal: AbortSignal.timeout(180000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.status === 401) {
        authExpired = true;
        if (statusEl) statusEl.textContent = '✗ Your sign-in expired. Sign in again and retry copying tracks.';
        continue;
      }
      if (res.ok && data.ok) done++; else failed++;
    } catch (e) {
      failed++;
    }
  }

  if (!authExpired && statusEl) statusEl.textContent = `✓ Copied ${done} / ${total}. ${failed > 0 ? failed + ' failed.' : ''}`;
  if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Copy Selected to My Library'; }
  if (done > 0) {
    if (importIsPersonalLibraryMode()) {
      importRefreshPersonalLibrary({ navigateToLibrary: false }).catch((e) => {
        try { console.warn('[import] background personal library refresh failed:', e); } catch (_) {}
      });
    }
    importShowSaveToast(`Copied ${done} track${done !== 1 ? 's' : ''} to your library`);
  }
}

// ---------------------------------------------------------------------------
// Toast
// ---------------------------------------------------------------------------
function importShowSaveToast(msg) {
  let el = document.getElementById('import-toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'import-toast';
    el.style.cssText = [
      'position:fixed', 'left:50%', 'bottom:88px', 'transform:translateX(-50%)',
      'background:rgba(0,0,0,0.80)', 'color:#fff', 'padding:10px 18px',
      'border-radius:999px', 'font-size:14px', 'font-weight:700',
      'z-index:999998', 'pointer-events:none', 'opacity:0',
      'transition:opacity 150ms ease',
    ].join(';');
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.style.opacity = '1';
  clearTimeout(el.__timer);
  el.__timer = setTimeout(() => { el.style.opacity = '0'; }, 1800);
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------
function _escHtml(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function _escAttr(str) {
  return String(str || '').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
function _formatBytes(bytes) {
  if (!bytes) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1048576) return (bytes / 1024).toFixed(0) + ' KB';
  return (bytes / 1048576).toFixed(1) + ' MB';
}

// ---------------------------------------------------------------------------
// Main init — called by showView('import')
// ---------------------------------------------------------------------------
function initImportView() {
  const launchContext = importConsumeLaunchContext();

  // If a download is already in progress, re-attach the UI to it instead of resetting.
  if (__importCurrentJobId && __importPollTimer) {
    importShowPanel('download');
    importInitDownloadPanel();
    // Restore in-progress UI state
    const statusEl = document.getElementById('import-download-status');
    const progressWrap = document.getElementById('import-progress-wrap');
    const dlBtn = document.getElementById('import-download-btn');
    if (statusEl && !statusEl.textContent) statusEl.textContent = 'Downloading…';
    if (progressWrap) progressWrap.classList.remove('hidden');
    if (dlBtn) { dlBtn.disabled = true; dlBtn.textContent = 'Downloading…'; }
    if (launchContext) {
      // Allow launch context to override after download finishes — store but don't apply now
      importSetLaunchContext(launchContext);
    }
    return;
  }

  importShowPanel('setup');
  importInitSetupPanel();
  importInitDownloadPanel();
  importResetDiscoveryState();

  // Back button
  const backBtn = document.getElementById('import-back');
  if (backBtn && !backBtn.__importBound) {
    backBtn.__importBound = true;
    backBtn.addEventListener('click', () => {
      try { showView('settings'); } catch (e) {}
    });
  }

  // Panel nav from step indicators
  const stepSetup = document.getElementById('import-step-setup');
  const stepDl    = document.getElementById('import-step-download');
  const stepReview = document.getElementById('import-step-review');

  if (stepSetup  && !stepSetup.__importBound)  { stepSetup.__importBound  = true; stepSetup.addEventListener('click',  () => importShowPanel('setup')); }
  if (stepDl     && !stepDl.__importBound)     { stepDl.__importBound     = true; stepDl.addEventListener('click',    () => importShowPanel('download')); }
  if (stepReview && !stepReview.__importBound) { stepReview.__importBound = true; stepReview.addEventListener('click', () => { importShowPanel('review'); importInitReviewPanel(); }); }

  // Wire the "Go to Review" panel init
  const gotoReview = document.getElementById('import-goto-review');
  if (gotoReview) {
    gotoReview.removeEventListener('click', __importGotoReviewHandler);
    gotoReview.addEventListener('click', __importGotoReviewHandler);
    gotoReview.__importBound = false; // re-allow re-bind if needed
  }

  importApplyLaunchContext(launchContext).catch((err) => {
    try { console.warn('[import] failed to apply launch context:', err); } catch (e) {}
  });
}

function __importGotoReviewHandler() {
  importShowPanel('review');
  importInitReviewPanel();
}

window.initImportView = initImportView;
window.setImportLaunchContext = importSetLaunchContext;
