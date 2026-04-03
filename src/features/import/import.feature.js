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
    dlBtn.addEventListener('click', importStartDownload);
  }

  const reviewBtn = document.getElementById('import-goto-review');
  if (reviewBtn && !reviewBtn.__importBound) {
    reviewBtn.__importBound = true;
    reviewBtn.addEventListener('click', () => importShowPanel('review'));
  }
}

function importDetectUrlType(url) {
  return (url.includes('spotify.com') || url.startsWith('spotify:')) ? 'spotify' : 'youtube';
}

async function importStartDownload() {
  const urlInput = document.getElementById('import-url');
  const url = (urlInput?.value || '').trim();
  if (!url) { alert('Please enter a URL.'); return; }

  const logsEl = document.getElementById('import-logs');
  const statusEl = document.getElementById('import-download-status');
  const reviewBtn = document.getElementById('import-goto-review');
  const dlBtn = document.getElementById('import-download-btn');

  if (logsEl) logsEl.textContent = '';
  if (statusEl) statusEl.textContent = 'Starting download…';
  if (reviewBtn) reviewBtn.classList.add('hidden');
  if (dlBtn) { dlBtn.disabled = true; dlBtn.textContent = 'Downloading…'; }

  const settings = importLoadSettings();
  const serverUrl = importGetServerUrl();

  const body = {
    url,
    outputFormat: '{artist}/{album}/{title}.{output-ext}',
    spotifyClientId: settings.spotifyClientId || undefined,
    spotifyClientSecret: settings.spotifySecret || undefined,
  };

  // Clear undefined keys
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
    if (dlBtn) { dlBtn.disabled = false; dlBtn.textContent = 'Download'; }
    return;
  }

  importPollJob(jobId);
}

function importPollJob(jobId) {
  if (__importPollTimer) { clearInterval(__importPollTimer); __importPollTimer = null; }

  const serverUrl = importGetServerUrl();
  const logsEl = document.getElementById('import-logs');
  const statusEl = document.getElementById('import-download-status');
  const reviewBtn = document.getElementById('import-goto-review');
  const dlBtn = document.getElementById('import-download-btn');

  let lastLogCount = 0;

  __importPollTimer = setInterval(async () => {
    try {
      const res = await fetch(serverUrl + '/job/' + jobId);
      const data = await res.json();

      // Append new log lines
      if (logsEl && Array.isArray(data.logs)) {
        const newLines = data.logs.slice(lastLogCount);
        lastLogCount = data.logs.length;
        if (newLines.length) {
          logsEl.textContent += newLines.join('\n') + '\n';
          logsEl.scrollTop = logsEl.scrollHeight;
        }
      }

      if (data.status === 'done') {
        clearInterval(__importPollTimer);
        __importPollTimer = null;
        const fileCount = Array.isArray(data.files) ? data.files.length : '?';
        if (statusEl) statusEl.textContent = `✓ Done — ${fileCount} file(s) ready`;
        if (dlBtn) { dlBtn.disabled = false; dlBtn.textContent = 'Download Another'; }
        if (reviewBtn) reviewBtn.classList.remove('hidden');
      }

      if (data.status === 'error') {
        clearInterval(__importPollTimer);
        __importPollTimer = null;
        if (statusEl) statusEl.textContent = '✗ Download failed — see logs above';
        if (dlBtn) { dlBtn.disabled = false; dlBtn.textContent = 'Try Again'; }
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
    r2Key: importComputeR2Key(f),
  }));

  const body = {
    files,
    r2AccountId:          settings.r2AccountId,
    r2AccessKeyId:        settings.r2AccessKeyId,
    r2SecretAccessKey:    settings.r2SecretAccessKey,
    r2Bucket:             settings.r2Bucket,
  };

  try {
    const res = await fetch(serverUrl + '/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await res.json().catch(() => ({}));

    if (!res.ok) throw new Error(data.detail || 'Upload request failed');

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
    doneBtn.addEventListener('click', () => {
      // Reload the library
      try {
        if (typeof window.applyLibraryAndRender === 'function') {
          window.applyLibraryAndRender();
        } else {
          window.location.reload();
        }
      } catch (e) {
        window.location.reload();
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
  const total = checks.length;

  for (const cb of checks) {
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
        }),
        signal: AbortSignal.timeout(180000),
      });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.ok) done++; else failed++;
    } catch (e) {
      failed++;
    }
  }

  if (statusEl) statusEl.textContent = `✓ Copied ${done} / ${total}. ${failed > 0 ? failed + ' failed.' : ''}`;
  if (startBtn) { startBtn.disabled = false; startBtn.textContent = 'Copy Selected to My Library'; }
  if (done > 0) importShowSaveToast(`Copied ${done} track${done !== 1 ? 's' : ''} to your library`);
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
  importShowPanel('setup');
  importInitSetupPanel();
  importInitDownloadPanel();

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
}

function __importGotoReviewHandler() {
  importShowPanel('review');
  importInitReviewPanel();
}

window.initImportView = initImportView;
