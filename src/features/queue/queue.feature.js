/* ==========================================================
   QUEUE FEATURE
   - Manual queue (add / remove / reorder / persist)
   - Mobile queue sheet + swipe-to-dismiss
   - Desktop right-sidebar queue
   - Queue toast ("Added to Queue")
   - Swipe-left-to-add-to-queue gesture
   - buildQueueFromSongs / playQueue helpers
   ========================================================== */

/* -----------------------
   MANUAL QUEUE (Add to queue)
   First added stays at top
------------------------ */
var manualQueue = (() => {
  try {
    const v = JSON.parse(localStorage.getItem('manualQueue') || '[]');
    return Array.isArray(v) ? v : [];
  } catch (e) {
    return [];
  }
})();

        function persistManualQueue() {
  try {
    localStorage.setItem('manualQueue', JSON.stringify(manualQueue));
  } catch (e) {}
}

/* -----------------------
   QUEUE CONTROLS:
   - Clear queue button
   - Press/hold hamburger to drag reorder
------------------------ */

function clearManualQueue() {
  // 1) Clear manual "Add to queue" list
  manualQueue = [];
  persistManualQueue();

  // 2) Clear the active play queue ("Up next") without stopping the current song
  currentQueue = [];
  currentIndex = -1;
  playContext = null;

// 3) Reset shuffle helpers
resetShuffleForQueue?.();

// These are now guaranteed globals (defined at the top), so just reset directly:
playedStack = [];
shuffleOrder = [];
shufflePos = 0;

// 4) Re-render any queue UIs that exist

  try { if (typeof renderQueueSheet === 'function') renderQueueSheet(); } catch (e) {}
  try { if (typeof renderRightQueue === 'function') renderRightQueue(); } catch (e) {}
}


function wireQueueClearButtons() {
  const btnA = document.getElementById('queue-clear');        // mobile queue sheet
  const btnB = document.getElementById('right-queue-clear');  // right sidebar queue

  const handler = (e) => {
    try { e.preventDefault(); } catch (_) {}
    try { e.stopPropagation(); } catch (_) {}

    try { clearManualQueue(); } catch (_) {}

    // ✅ Mobile: close the sheet after clearing (if it exists)
    try { if (typeof closeQueueSheet === 'function') closeQueueSheet(); } catch (_) {}
  };

  if (btnA && !btnA.__clearBound) {
    btnA.__clearBound = true;
    btnA.addEventListener('click', handler, { passive: false });
  }

  if (btnB && !btnB.__clearBound) {
    btnB.__clearBound = true;
    btnB.addEventListener('click', handler, { passive: false });
  }
}


function ensureHamburgerHandle(itemEl) {
  // If you already render a hamburger, we'll reuse it.
  let handle = itemEl.querySelector('.queue-hamburger');

  if (!handle) {
    // Create one if missing
    handle = document.createElement('button');
    handle.type = 'button';
    handle.className = 'queue-hamburger';
    handle.innerHTML = '<i class="fas fa-bars"></i>';

    // Put it at the end of the row so it matches your UI
    itemEl.appendChild(handle);
  }

  // Make it obvious it's draggable
  handle.style.cursor = 'grab';
  handle.style.touchAction = 'none';
  return handle;
}

function renumberQueueList(container) {
  const children = Array.from(container.children);
  children.forEach((el, i) => {
    el.dataset.mqIndex = String(i);
  });
}

function moveManualQueueItem(fromIndex, toIndex) {
  if (fromIndex === toIndex) return;
  if (fromIndex < 0 || toIndex < 0) return;
  if (fromIndex >= manualQueue.length || toIndex >= manualQueue.length) return;

  const [moved] = manualQueue.splice(fromIndex, 1);
  manualQueue.splice(toIndex, 0, moved);
  persistManualQueue();
}

function enablePressHoldDragReorder(container) {
  if (!container || container.__mqDnDEnabled) return;
  container.__mqDnDEnabled = true;

  container.style.userSelect = 'none';

  // Setup items + handles
  const setupItems = () => {
    const items = Array.from(container.children);
    items.forEach((item) => {
      // Mark + number items so we can map to manualQueue positions
      if (!item.dataset) return;
      // If a renderer already sets a data index, keep it; otherwise set it.
      if (typeof item.dataset.mqIndex === 'undefined') {
        // will be corrected by renumberQueueList anyway
        item.dataset.mqIndex = '0';
      }

      const handle = ensureHamburgerHandle(item);

      // Bind once per handle
      if (handle.__mqHoldBound) return;
      handle.__mqHoldBound = true;

      let holdTimer = null;
      let dragging = false;
      let draggedEl = null;

      const holdMs = 220; // "press and hold" feel

      const onPointerDown = (e) => {
        // Only left click / touch
        if (e.button != null && e.button !== 0) return;

        e.preventDefault();
        e.stopPropagation();

        draggedEl = item;

        // Start hold timer
        holdTimer = setTimeout(() => {
          dragging = true;
          handle.style.cursor = 'grabbing';
          draggedEl.classList.add('mq-dragging');
        }, holdMs);

        try { handle.setPointerCapture(e.pointerId); } catch (err) {}
      };

      const onPointerMove = (e) => {
  if (!dragging || !draggedEl) return;

  // keep the gesture owned by the drag (prevents scroll stealing it)
  e.preventDefault();

  // ---- RAF throttle so it feels smooth (not "jittery swap") ----
  onPointerMove.__lastEvent = e;
  if (onPointerMove.__raf) return;

  onPointerMove.__raf = requestAnimationFrame(() => {
    onPointerMove.__raf = null;
    const ev = onPointerMove.__lastEvent;
    if (!ev || !dragging || !draggedEl) return;

    const y = ev.clientY;

    // ---- Auto-scroll the queue while dragging near edges ----
    const cRect = container.getBoundingClientRect();
    const edge = 44;      // px from top/bottom to start scrolling
    const speed = 14;     // px per frame

    if (y < cRect.top + edge) container.scrollTop -= speed;
    else if (y > cRect.bottom - edge) container.scrollTop += speed;

    // ---- Find the "target index" by crossing row midpoints ----
    const items = Array.from(container.querySelectorAll('[data-mq-index]'));
    if (!items.length) return;

    const fromIndex = parseInt(draggedEl.dataset.mqIndex || '0', 10);
    if (Number.isNaN(fromIndex)) return;

    // Build a list excluding the dragged element
    const others = items.filter(el => el !== draggedEl);

    // Default: drop at end
    let targetEl = null;

    for (const el of others) {
      const r = el.getBoundingClientRect();
      const mid = r.top + (r.height / 2);
      if (y < mid) {
        targetEl = el;
        break;
      }
    }

    // Compute toIndex based on where we'll insert
    let toIndex;
    if (!targetEl) {
      // end
      toIndex = others.length; // last position
      container.appendChild(draggedEl);
    } else {
      toIndex = parseInt(targetEl.dataset.mqIndex || '0', 10);
      if (Number.isNaN(toIndex)) return;
      container.insertBefore(draggedEl, targetEl);
    }

    // If it didn't change, do nothing
    if (toIndex === fromIndex) {
      renumberQueueList(container);
      return;
    }

    // Sync indexes + manualQueue
    renumberQueueList(container);
    moveManualQueueItem(fromIndex, toIndex);
  });
};


      const endDrag = () => {
        if (holdTimer) clearTimeout(holdTimer);
        holdTimer = null;

        if (dragging && draggedEl) {
          draggedEl.classList.remove('mq-dragging');
        }

        dragging = false;
        draggedEl = null;
        handle.style.cursor = 'grab';

        // Re-render to keep any "next in queue" labels consistent (optional but safe)
        try { if (typeof renderQueueSheet === 'function') renderQueueSheet(); } catch (e) {}
        try { if (typeof renderRightQueue === 'function') renderRightQueue(); } catch (e) {}
      };

      handle.addEventListener('pointerdown', onPointerDown, { passive: false });
      handle.addEventListener('pointermove', onPointerMove, { passive: false });
      handle.addEventListener('pointerup', endDrag, { passive: true });
      handle.addEventListener('pointercancel', endDrag, { passive: true });
    });

    // Normalize indexes after any render
    renumberQueueList(container);
  };

  // Initial setup
  setupItems();

  // Re-setup when your renderer replaces list HTML
  const mo = new MutationObserver(() => setupItems());
  mo.observe(container, { childList: true, subtree: false });
}

function initQueueControlsOnce() {
  wireQueueClearButtons();

  // Your right sidebar queue list (if present)
  const rightList = document.getElementById('right-queue-list');
  if (rightList) enablePressHoldDragReorder(rightList);

  // Your mobile queue sheet list (if present)
  const sheetList = document.getElementById('queue-list');
  if (sheetList) enablePressHoldDragReorder(sheetList);
}

// Auto-init (safe even if called early)
if (!window.__mqControlsInit) {
  window.__mqControlsInit = true;
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initQueueControlsOnce);
  } else {
    initQueueControlsOnce();
  }
}

/* -----------------------
   MANUAL QUEUE: add + render
------------------------ */
function addSongToQueue(songObj) {
  if (!songObj) return;

  const song = (typeof normalizeSong === 'function') ? normalizeSong(songObj) : songObj;
  if (!song) return;

  manualQueue.push(song);

  try { localStorage.setItem('manualQueue', JSON.stringify(manualQueue)); } catch (e) {}

   try { if (typeof renderQueueSheet === 'function') renderQueueSheet(); } catch (e) {}
  try { if (document.body.classList.contains('queue-mode') && typeof renderRightQueue === 'function') renderRightQueue(); } catch (e) {}

  try {
    if (typeof closeContextMenu === 'function') closeContextMenu();

    else {
      const cm = document.getElementById('context-menu');
      const bd = document.getElementById('context-menu-backdrop');
      if (cm) cm.style.display = 'none';
      if (bd) bd.style.display = 'none';
    }
  } catch (e) {}

try { if (typeof showQueueToast === 'function') showQueueToast(); } catch (e) {}
}

function takeNextManualQueueSong() {
  while (Array.isArray(manualQueue) && manualQueue.length) {
    const next = manualQueue.shift();
    persistManualQueue();
        try { if (typeof renderQueueSheet === 'function') renderQueueSheet(); } catch (e) {}
    try { if (document.body.classList.contains('queue-mode') && typeof renderRightQueue === 'function') renderRightQueue(); } catch (e) {}
    const song = (typeof normalizeSong === 'function') ? normalizeSong(next) : next;
      if (song) return song;
  }
  return null;
}

/* -----------------------
   SWIPE LEFT ON TRACK ROW => Add to queue
   - green follows finger
   - fast swipe = fast animation
   - prevents "page shaking" by only preventing default once horizontal is chosen
------------------------ */
function attachSwipeAddToQueue(rowEl, songObj) {
  if (!rowEl || rowEl.__swipeQueueBound) return;
  rowEl.__swipeQueueBound = true;

  // Build DOM: underlay (green) + content wrapper (moves with finger)
  const underlay = document.createElement('div');
  underlay.className = 'swipe-underlay';
  underlay.innerHTML = `<div class="swipe-icon">≡</div>`; // simple icon; you can change later

  const content = document.createElement('div');
  content.className = 'swipe-content';

  // Move existing children into content wrapper
  while (rowEl.firstChild) content.appendChild(rowEl.firstChild);

  rowEl.appendChild(underlay);
  rowEl.appendChild(content);

  // State
  const MOVE_DECIDE_PX = 10;
  const REVEAL_MAX = 140;    // how far row can slide
  const TRIGGER_PX = 90;     // how far to trigger "add to queue"

  let active = false;
  let decided = false;
  let isHorizontal = false;
  let startX = 0;
  let startY = 0;
  let lastDx = 0;
  let consumedClick = false;

  function getXY(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function setDrag(dx) {
    // clamp to left only
    const clamped = Math.max(-REVEAL_MAX, Math.min(0, dx));
    lastDx = clamped;

    // row slides left
    content.style.transform = `translateX(${clamped}px)`;

    // underlay reveals from the right (match the distance)
    const pct = Math.min(1, Math.max(0, (-clamped) / REVEAL_MAX));
    underlay.style.transform = `translateX(${(1 - pct) * 100}%)`;
  }

  function snapBack() {
    content.style.transition = 'transform 140ms ease';
    underlay.style.transition = 'transform 140ms ease';
    setDrag(0);
    setTimeout(() => {
      content.style.transition = '';
      underlay.style.transition = '';
    }, 160);
  }

  function snapAddThenBack() {
    // quick "commit" feel, then return
    content.style.transition = 'transform 90ms ease';
    underlay.style.transition = 'transform 90ms ease';
    setDrag(-REVEAL_MAX);
    setTimeout(() => {
      content.style.transition = 'transform 160ms ease';
      underlay.style.transition = 'transform 160ms ease';
      setDrag(0);
      setTimeout(() => {
        content.style.transition = '';
        underlay.style.transition = '';
      }, 180);
    }, 95);
  }

  // Prevent accidental "play song" click after swipe
  rowEl.addEventListener('click', (e) => {
    if (!consumedClick) return;
    e.preventDefault();
    e.stopPropagation();
    consumedClick = false;
  }, true);

  rowEl.addEventListener('pointerdown', (e) => {
    // don't start if it's already hidden or disabled
    active = true;
    decided = false;
    isHorizontal = false;

    const { x, y } = getXY(e);
    startX = x;
    startY = y;
    lastDx = 0;

    try { rowEl.setPointerCapture(e.pointerId); } catch (err) {}
  }, { passive: true });

   rowEl.addEventListener('pointermove', (e) => {
    if (!active) return;

    const { x, y } = getXY(e);
    const dx = x - startX;
    const dy = y - startY;

    if (!decided) {
      if (Math.abs(dx) < MOVE_DECIDE_PX && Math.abs(dy) < MOVE_DECIDE_PX) return;
      decided = true;
      isHorizontal = Math.abs(dx) > Math.abs(dy);

      // ✅ init rAF throttle state once we "claim" a horizontal swipe
      if (isHorizontal) {
        rowEl.__swipeRafPending = false;
        rowEl.__swipeRafDx = 0;
      }
    }

    if (!isHorizontal) return;

    // we own the gesture now — stop page from "shaking"
    e.preventDefault();

    // only respond to LEFT swipes
    if (dx >= 0) {
      // schedule a frame update (still throttled)
      rowEl.__swipeRafDx = 0;
      if (!rowEl.__swipeRafPending) {
        rowEl.__swipeRafPending = true;
        requestAnimationFrame(() => {
          rowEl.__swipeRafPending = false;
          setDrag(rowEl.__swipeRafDx);
        });
      }
      return;
    }

    // ✅ Throttle setDrag to once per frame
    rowEl.__swipeRafDx = dx;
    if (!rowEl.__swipeRafPending) {
      rowEl.__swipeRafPending = true;
      requestAnimationFrame(() => {
        rowEl.__swipeRafPending = false;
        setDrag(rowEl.__swipeRafDx);
      });
    }
  }, { passive: false });


  rowEl.addEventListener('pointerup', () => {
    if (!active) return;
    active = false;

    if (isHorizontal) {
      // consume click so it doesn't open/play
      consumedClick = true;

      if (Math.abs(lastDx) >= TRIGGER_PX) {
        // Add to queue + toast (your existing function already does the toast)
        try { addSongToQueue(songObj); } catch (e) {}
        snapAddThenBack();
      } else {
        snapBack();
      }
    }
  }, { passive: true });

  rowEl.addEventListener('pointercancel', () => {
    if (!active) return;
    active = false;
    snapBack();
  }, { passive: true });
}

// --- QUEUE SHEET: swipe down to dismiss (same feel as Now Playing) ---

function initQueueSheetSwipe() {
  const sheet = document.getElementById('queue-sheet');
  if (!sheet) return;

  let qsDragActive = false;
  let qsStartY = 0;
  let qsStartX = 0;
  let qsLastDown = 0;
  let qsDecided = false;
  let qsIsVertical = false;

  function qsGetXY(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  }

  function qsResetDrag() {
    sheet.classList.remove('qs-dragging');
    sheet.style.transform = 'translateY(0)';
    qsLastDown = 0;
  }

 function qsCanStart(e) {
  // only if sheet is open
  if (sheet.classList.contains('qs-hidden')) return false;

  // ✅ If the tap is on the header (including Clear), do NOT start drag
  if (e.target && (e.target.closest('#queue-clear') || e.target.closest('.qs-head'))) return false;

  // if finger starts inside the scroll list AND the list is scrolled, don't hijack
  const list = sheet.querySelector('.qs-list') || sheet.querySelector('#queue-list');
  if (list && list.contains(e.target) && list.scrollTop > 0) return false;

  return true;
}

  sheet.addEventListener('pointerdown', (e) => {
    if (!qsCanStart(e)) return;

    const { x, y } = qsGetXY(e);
    qsDragActive = true;
    qsStartY = y;
    qsStartX = x;
    qsLastDown = 0;
    qsDecided = false;
    qsIsVertical = false;

    sheet.classList.add('qs-dragging');
    try { sheet.setPointerCapture(e.pointerId); } catch (err) {}
  });

  sheet.addEventListener('pointermove', (e) => {
    if (!qsDragActive) return;

    const { x, y } = qsGetXY(e);
    const dy = y - qsStartY;
    const dx = x - qsStartX;

    // don't decide until it actually moves
    if (!qsDecided) {
      if (Math.abs(dy) < 10 && Math.abs(dx) < 10) return;
      qsDecided = true;
      qsIsVertical = Math.abs(dy) > Math.abs(dx);
    }

    if (!qsIsVertical) return;

    // only drag downward
    const down = Math.max(0, dy);
    qsLastDown = down;

    sheet.style.transform = `translateY(${down}px)`;
  });

  sheet.addEventListener('pointerup', () => {
    if (!qsDragActive) return;

    const threshold = 140;
    const shouldClose = qsLastDown > threshold;

    if (shouldClose) closeQueueSheet();
    else qsResetDrag();

    qsDragActive = false;
  });

  sheet.addEventListener('pointercancel', () => {
    if (!qsDragActive) return;
    qsResetDrag();
    qsDragActive = false;
  });
}

// run once
function openQueueSheet() {
  const sheet = document.getElementById('queue-sheet');
  const backdrop = document.getElementById('queue-sheet-backdrop');
  if (!sheet || !backdrop) return;

  renderQueueSheet();

  backdrop.classList.remove('qs-hidden');
  sheet.classList.remove('qs-hidden');
  sheet.setAttribute('aria-hidden', 'false');

  // animate up (same "dock/overlay" feel)
  sheet.style.transition = 'none';
  sheet.style.transform = 'translateY(100%)';
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      sheet.style.transition = 'transform 120ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      sheet.style.transform = 'translateY(0)';
    });
  });
}

function closeQueueSheet() {
  const sheet = document.getElementById('queue-sheet');
  const backdrop = document.getElementById('queue-sheet-backdrop');
  if (!sheet || !backdrop) return;

  sheet.style.transition = 'transform 120ms ease';
  sheet.style.transform = 'translateY(100%)';

  const done = () => {
    sheet.classList.add('qs-hidden');
    backdrop.classList.add('qs-hidden');
    sheet.setAttribute('aria-hidden', 'true');
    sheet.style.transition = '';
    sheet.style.transform = 'translateY(0)';
    sheet.removeEventListener('transitionend', done);
  };

  sheet.addEventListener('transitionend', done);
}

function renderQueueSheet() {
  const list = document.getElementById('queue-list');
  const subtitle = document.getElementById('queue-playing-line');
  if (!list) return;

  const q = Array.isArray(manualQueue) ? manualQueue : [];
  if (subtitle) subtitle.textContent = q.length ? 'Playing' : 'Nothing queued';

  if (!q.length) {
    list.innerHTML = `<div style="padding:16px;color:rgba(255,255,255,0.65);font-size:16px;">Queue is empty</div>`;
    return;
  }

  list.innerHTML = q.map((s, idx) => {
    const title = (s.title || s.name || 'Song').toString();
    const artist = (s.artist || 'Artist').toString();
    const cover = (s.cover || s.coverUrl || s.art || s.image || '').toString();
    const coverHtml = cover
      ? `<img class="queue-cover" src="${cover}" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><div class="queue-cover queue-cover-placeholder" style="display:none"><i class="fas fa-music"></i></div>`
      : `<div class="queue-cover queue-cover-placeholder"><i class="fas fa-music"></i></div>`;

    return `
      <div class="queue-row" data-mq-index="${idx}">
        ${coverHtml}
        <div class="queue-main">
          <div class="queue-song">${title.replace(/</g,'&lt;')}</div>
          <div class="queue-artist">${artist.replace(/</g,'&lt;')}</div>
        </div>
        <div class="queue-hamburger">≡</div>
      </div>
    `;
  }).join('');

  // Make sure drag-reorder is enabled on mobile list (safe if already enabled)
  try { enablePressHoldDragReorder(list); } catch (e) {}

  // Tap a row to play (uses your existing play function if present)
  list.querySelectorAll('.queue-row').forEach(row => {
    row.addEventListener('click', () => {
      const i = parseInt(row.getAttribute('data-mq-index') || '-1', 10);
      const s = manualQueue[i];
      if (!s) return;

      // Try common play functions safely
      if (typeof playSpecificSong === 'function' && (s.link || s.url)) {
        playSpecificSong(s.link || s.url, s.title || s.name, s.album || '', s.artist || '', s.cover || s.coverUrl || '');
      } else if (typeof playSong === 'function') {
        playSong(s);
      }
    }, { passive: true });
  });
}


// Clear button
// Clear button
(function bindQueueClear() {
  const btn = document.getElementById('queue-clear');
  if (!btn) return;

  // Prevent double-binding (wireQueueClearButtons also targets #queue-clear)
  if (btn.__clearBound) return;
  btn.__clearBound = true;

  btn.addEventListener('click', () => {
    // Use the shared clear logic (updates both mobile + right sidebar)
    try { clearManualQueue(); } catch (e) {}

    // Keep your existing "close sheet after clearing" behavior
    try { closeQueueSheet(); } catch (e) {}
  }, { passive: true });
})();


// Tap backdrop closes
(function bindQueueBackdropClose() {
  const bd = document.getElementById('queue-sheet-backdrop');
  if (!bd) return;
  bd.addEventListener('click', closeQueueSheet, { passive: true });
})();

// Toast
var __queueToastTimer = null;
var __queueToastHideTimer = null;

function getQueueToastBottomOffsetPx() {
  // Keep toast above bottom tabs + mini player on mobile.
  const bar = document.querySelector('.player-bar');
  if (!bar) return 0;

  const cs = window.getComputedStyle(bar);
  const hidden = cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity || '1') === 0;
  const h = bar.getBoundingClientRect().height;
  if (hidden || h < 20) return 0;

  return Math.round(Math.max(70, h + 6));
}

function hideQueueToast(immediate) {
  const toast = document.getElementById('queue-toast');
  if (!toast) return;

  if (__queueToastHideTimer) {
    clearTimeout(__queueToastHideTimer);
    __queueToastHideTimer = null;
  }

  if (immediate) {
    toast.classList.remove('qt-show');
    toast.classList.add('qt-hidden');
    return;
  }

  toast.classList.remove('qt-show');
  __queueToastHideTimer = setTimeout(() => {
    toast.classList.add('qt-hidden');
    __queueToastHideTimer = null;
  }, 240);
}

function showQueueToast() {
  const toast = document.getElementById('queue-toast');
  if (!toast) return;

  if (window.innerWidth > 900) return;

  toast.style.bottom = `calc(var(--nav-height, 72px) + env(safe-area-inset-bottom) + ${getQueueToastBottomOffsetPx()}px)`;

  toast.classList.remove('qt-hidden');
  toast.classList.remove('qt-show');
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      toast.classList.add('qt-show');
    });
  });

  // auto-hide after 2.2s
  if (__queueToastTimer) clearTimeout(__queueToastTimer);
  __queueToastTimer = setTimeout(() => {
    hideQueueToast(false);
  }, 2200);
}

// Queue toast "Open" button
(function bindQueueToastOpen() {
  const btn = document.getElementById('queue-toast-open');
  if (!btn) return;
  btn.addEventListener('click', () => {
    try {
      if (__queueToastTimer) clearTimeout(__queueToastTimer);
      hideQueueToast(true);
    } catch (e) {}
    openQueueSheet();
  }, { passive: true });
})();

// run once
initQueueSheetSwipe();

/* -----------------------
   DESKTOP RIGHT SIDEBAR QUEUE
   (uses existing manualQueue)
------------------------ */
var isRightQueueOpen = false;

function renderRightQueue() {
  if (window.innerWidth < 1024) return;

  const list = document.getElementById('right-queue-list');
  const status = document.getElementById('right-queue-status');
  if (!list || !status) return;

  const q = Array.isArray(manualQueue) ? manualQueue : [];

  if (!q.length) {
    status.textContent = 'Nothing queued.';
    list.innerHTML = `<div style="padding:4px 0;color:rgba(255,255,255,0.65);font-size:14px;">Queue is empty</div>`;
    return;
  }

  status.textContent = 'Next in queue';

  list.innerHTML = q.map((s, idx) => {
    const title = (s.title || s.name || 'Song').toString();
    const artist = (s.artist || 'Artist').toString();
    const cover = (s.cover || s.coverUrl || s.art || s.image || '').toString();

    return `
            <div class="queue-row" data-rqi="${idx}">
        <img class="queue-cover" src="${cover}" onerror="this.style.visibility='hidden'" />
        <div class="queue-main">
          <div class="queue-song">${title.replace(/</g,'&lt;')}</div>
          <div class="queue-artist">${artist.replace(/</g,'&lt;')}</div>
        </div>
        <div class="queue-hamburger">≡</div>
      </div>
    `;
  }).join('');

  // click to play
  list.querySelectorAll('.queue-row').forEach(row => {
    row.addEventListener('click', () => {
      const i = parseInt(row.getAttribute('data-rqi') || '-1', 10);
      const s = manualQueue[i];
      if (!s) return;

      if (typeof playSpecificSong === 'function' && (s.link || s.url)) {
        playSpecificSong(s.link || s.url, s.title || s.name, s.album || '', s.artist || '', s.cover || s.coverUrl || '');
      } else if (typeof playSong === 'function') {
        playSong(s);
      }
    }, { passive: true });
  });
}

function setRightQueueOpen(open) {
  if (window.innerWidth < 1024) return;

  isRightQueueOpen = !!open;
  document.body.classList.toggle('queue-mode', isRightQueueOpen);

  const qCard = document.getElementById('right-queue-card');
  const bioCard = document.getElementById('right-bio-card');
  const lyrCard = document.getElementById('right-lyrics-card');

  if (qCard) qCard.classList.toggle('hidden', !isRightQueueOpen);
  if (bioCard) bioCard.classList.toggle('hidden', isRightQueueOpen);
  if (lyrCard) lyrCard.classList.toggle('hidden', isRightQueueOpen || isCenterLyricsOpen);

  if (isRightQueueOpen) {
    toggleRightSidebar(true);
    renderRightQueue();
  }
}

function toggleRightQueue() {
  setRightQueueOpen(!isRightQueueOpen);
}

// Clear button (right queue)
(function bindRightQueueClear(){
  const btn = document.getElementById('right-queue-clear');
  if (!btn || btn.__rqClearBound) return;
  btn.__rqClearBound = true;

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    manualQueue = [];
    try { localStorage.setItem('manualQueue', JSON.stringify(manualQueue)); } catch (e) {}
    try { renderQueueSheet(); } catch (e) {}
    try { renderRightQueue(); } catch (e) {}
  }, { passive: false });
})();

// Dock three-lines button:
// - mobile: open the existing bottom sheet
// - desktop: toggle right sidebar queue view
(function bindDockQueueButton(){
  function bind() {
    const btn = document.getElementById('dock-menu-btn');
    if (!btn || btn.__dockQueueBound) return;
    btn.__dockQueueBound = true;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (window.innerWidth < 1024) {
        if (typeof openQueueSheet === 'function') openQueueSheet();
        return;
      }
      toggleRightQueue();
    }, { passive: false });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})();

/* -----------------------
   SHUFFLE RESET FOR QUEUE
------------------------ */
function resetShuffleForQueue() {
    if (!currentQueue || currentQueue.length <= 1) {
        shuffleOrder = [];
        shufflePos = 0;
        return;
    }
    shuffleOrder = buildShuffleOrder(currentQueue.length, currentIndex);
    shufflePos = 0;
}

/* -----------------------
   QUEUE BUILDER + PLAY QUEUE
------------------------ */
function buildQueueFromSongs(songs, fallback) {
  return songs.map((song) => normalizeSong(song, fallback)).filter(Boolean);
}

function playQueue(queue, startIndex = 0) {
  if (!queue || !queue.length) return;

  currentQueue = queue;

  // If shuffle is ON and we're starting from the beginning (green Play button behavior),
  // pick a random starting song like Spotify.
  if (isShuffleOn() && startIndex === 0 && queue.length > 1) {
    currentIndex = Math.floor(Math.random() * queue.length);
  } else {
    currentIndex = startIndex;
  }

  playedStack = [currentIndex];
  resetShuffleForQueue();

  const s = currentQueue[currentIndex];
  playSpecificSong(s.url, s.title, s.album, s.artist, s.cover);
}
