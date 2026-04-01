// Extracted Player feature from index.html

// VOLUME CONTROL
// -----------------------


const volumeContainer = document.getElementById('volume-container');
const volumeFill = document.getElementById('volume-fill');
const volumeIcon = document.getElementById('volume-icon');

// Default volume
player.volume = 0.66;
volumeFill.style.width = "66%";

function setVolumeFromClientX(clientX) {
    const rect = volumeContainer.getBoundingClientRect();
    const pct = (clientX - rect.left) / rect.width;
    const clamped = Math.max(0, Math.min(1, pct));

    player.volume = clamped;
    volumeFill.style.width = (clamped * 100) + "%";

    // Icon state
    if (clamped === 0) {
        volumeIcon.className = "fas fa-volume-mute text-zinc-400 text-sm";
    } else if (clamped < 0.5) {
        volumeIcon.className = "fas fa-volume-down text-zinc-400 text-sm";
    } else {
        volumeIcon.className = "fas fa-volume-up text-zinc-400 text-sm";
    }
}

if (volumeContainer) {
    volumeContainer.addEventListener('click', (e) => {
        setVolumeFromClientX(e.clientX);
    });

    volumeContainer.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        setVolumeFromClientX(e.clientX);

        const move = (ev) => setVolumeFromClientX(ev.clientX);
        const up = () => {
            window.removeEventListener('pointermove', move);
            window.removeEventListener('pointerup', up);
        };

        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', up);
    });
}

// dock and rightSidebar are declared in index.html's inline script (shared global scope)
const nowPlayingOverlay = document.getElementById('now-playing-overlay');
const npCloseBtn = document.getElementById('np-close');


function openNowPlaying() {
  if (!currentSong) return;

  setupNowPlayingCoverSwipeOnce();


  updateNowPlayingUI();

  nowPlayingOverlay.classList.remove('hidden');

  // ✅ Ensure Now Playing captures taps/clicks (main view was intercepting)
  try { document.getElementById('main-scroll-area').style.pointerEvents = 'none'; } catch (e) {}

  nowPlayingOverlay.classList.remove('np-dragging');
  try { checkDockVisibility(); } catch (e) {}


  // start off-screen (same state as swipe-down logic)
  nowPlayingOverlay.style.transition = 'none';
  nowPlayingOverlay.style.transform = 'translateY(100%)';

  // animate up on next frame
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      nowPlayingOverlay.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      nowPlayingOverlay.style.transform = 'translateY(0)';
    });
  });
}

// Open Now Playing when tapping the dock on mobile.
// This was previously inline in index.html and must live here after extraction.
(function bindDockOpenNowPlaying(){
  if (window.__dockOpenNowPlayingBound) return;
  window.__dockOpenNowPlayingBound = true;

  const dock = document.getElementById('main-dock');
  if (!dock) return;

  const isMobile = () => {
    try { return window.matchMedia('(max-width: 768px)').matches; } catch (e) { return window.innerWidth <= 768; }
  };

  const shouldIgnoreTap = (target) => {
    if (!target || !target.closest) return false;
    return !!target.closest(
      '#mobile-play-btn, #mobile-play-icon, #dock-heart, #dock-lyrics-btn, #dock-menu-btn, #dock-play-btn, #volume-container, #btn-shuffle, #btn-repeat, #np-close, #np-more, .fa-step-backward, .fa-step-forward'
    );
  };

  let lastPointerUp = 0;

  const openFromDockTap = (e) => {
    if (!isMobile()) return;
    if (!currentSong) return;
    if (shouldIgnoreTap(e.target)) return;

    const np = document.getElementById('now-playing-overlay');
    if (np && !np.classList.contains('hidden')) return;

    try { e.preventDefault(); } catch (err) {}
    openNowPlaying();
  };

  // iOS Safari can be inconsistent with click on transformed/fixed bars.
  dock.addEventListener('pointerup', (e) => {
    lastPointerUp = Date.now();
    openFromDockTap(e);
  }, true);

  dock.addEventListener('touchend', openFromDockTap, true);

  dock.addEventListener('click', (e) => {
    if (Date.now() - lastPointerUp < 450) return;
    openFromDockTap(e);
  }, true);
})();

// ✅ Now Playing top 3-dots should open the SAME context menu as tracklist dots
(function bindNowPlayingDotsMenu(){
  if (window.__npDotsMenuBound) return;
  window.__npDotsMenuBound = true;

  function getDotsBtn(){
    return (
      document.getElementById('np-more') ||
      document.querySelector('#now-playing-overlay button#np-more') ||
      document.querySelector('#now-playing-overlay button[aria-label="More options"]') ||
      document.querySelector('#now-playing-overlay button[aria-label="More"]')
    );
  }

  document.addEventListener('click', (e) => {
    const btn = getDotsBtn();
    if (!btn) return;
    if (e.target !== btn && !(e.target && e.target.closest && e.target.closest('#' + btn.id))) {
      // also allow clicking an icon inside the button
      if (!(btn.contains && btn.contains(e.target))) return;
    }

    try { e.preventDefault(); } catch (err) {}
    try { e.stopPropagation(); } catch (err) {}

    // If nothing is playing, do nothing
    const song = (window.currentSong || currentSong);
    if (!song) return;

    const r = btn.getBoundingClientRect();
    const x = (r.left + r.right) / 2;
    const y = (r.top + r.bottom) / 2;

    // Make sure menu has url/link if available
	const songForMenu = {
	  ...song,
	  url: (song && (song.url || song.link)) ? (song.url || song.link) : "",
	  link: (song && (song.link || song.url)) ? (song.link || song.url) : ""
	};

    // ✅ Prevent immediate "outside click" dismissal on mobile
    try { window.__outsideDismissSkipUntil = Date.now() + 400; } catch (err) {}
    try { window.suppressContextMenuCloseUntil = Date.now() + 400; } catch (err) {}

	showContextMenuAt(x, y, songForMenu, btn);


    showContextMenuAt(x, y, songForMenu, btn);
  }, true);
})();


// -----------------------
// TRACK MISSING MODAL
// -----------------------
let __trackMissingLastDebugText = "";

function showTrackMissingModal(payload) {
  try {
    const modal = document.getElementById('track-missing-modal');
    const sub = document.getElementById('track-missing-sub');
    const pre = document.getElementById('track-missing-debug');
    const moreBtn = document.getElementById('track-missing-more-btn');

    if (!modal || !sub || !pre || !moreBtn) return;

    const title = payload?.title ? String(payload.title) : "Unknown title";
    const artist = payload?.artist ? String(payload.artist) : "Unknown artist";
    sub.textContent = `Missing: ${title} — ${artist}`;

    __trackMissingLastDebugText = JSON.stringify(payload || {}, null, 2);
    pre.textContent = __trackMissingLastDebugText;

    // reset to collapsed
    pre.classList.add('hidden');
    moreBtn.textContent = "Show more";

    modal.classList.remove('hidden');
  } catch (e) {}
}

function hideTrackMissingModal() {
  try { document.getElementById('track-missing-modal')?.classList.add('hidden'); } catch (e) {}
}

(function bindTrackMissingModal() {
  const modal = document.getElementById('track-missing-modal');
  const closeBtn = document.getElementById('track-missing-close');
  const moreBtn = document.getElementById('track-missing-more-btn');
  const copyBtn = document.getElementById('track-missing-copy-btn');
  const pre = document.getElementById('track-missing-debug');

  if (closeBtn) closeBtn.addEventListener('click', hideTrackMissingModal);
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) hideTrackMissingModal(); });

  if (moreBtn && pre) {
    moreBtn.addEventListener('click', () => {
      const isHidden = pre.classList.contains('hidden');
      if (isHidden) {
        pre.classList.remove('hidden');
        moreBtn.textContent = "Show less";
      } else {
        pre.classList.add('hidden');
        moreBtn.textContent = "Show more";
      }
    });
  }

  if (copyBtn) {
    copyBtn.addEventListener('click', async () => {
      try {
        const txt = __trackMissingLastDebugText || "";
        if (!txt) return;
        await navigator.clipboard.writeText(txt);
        copyBtn.textContent = "Copied!";
        setTimeout(() => { copyBtn.textContent = "Copy debug"; }, 900);
      } catch (e) {
        // fallback: select text in the <pre>
        try {
          const el = document.getElementById('track-missing-debug');
          if (el) {
            const range = document.createRange();
            range.selectNodeContents(el);
            const sel = window.getSelection();
            sel.removeAllRanges();
            sel.addRange(range);
          }
        } catch (e2) {}
      }
    });
  }
})();


		// ✅ Now Playing: horizontal cover swipe (Spotify-like)
let __npCoverSwipeReady = false;
let __npCoverSwipeAnimating = false;

function __npGetCoverSrc(s){
  if (!s) return '';
  return String(s.cover || s.image || s.artwork || s.coverUrl || '');
}

function updateNPCoverNeighbors(){
  try {
    const prevEl = document.getElementById('np-cover-prev');
    const nextEl = document.getElementById('np-cover-next');

    if (!prevEl || !nextEl) return;
    if (!Array.isArray(currentQueue) || !currentQueue.length) return;

    const prevSongObj = currentQueue[currentIndex - 1] || null;
    const nextSongObj = currentQueue[currentIndex + 1] || null;

    prevEl.src = __npGetCoverSrc(prevSongObj) || __npGetCoverSrc(currentSong) || '';
    nextEl.src = __npGetCoverSrc(nextSongObj) || __npGetCoverSrc(currentSong) || '';
  } catch (e) {}
}

function __npApplyCoverTransforms(dx){
  const wrap = document.getElementById('np-cover-swipe');
  const cur = document.getElementById('np-cover');
  const prev = document.getElementById('np-cover-prev');
  const next = document.getElementById('np-cover-next');
  if (!wrap || !cur || !prev || !next) return;

  const w = Math.max(1, wrap.clientWidth);
  const gap = w * 1.05;

  prev.style.transform = `translate3d(${dx - gap}px, 0, 0)`;
  cur.style.transform  = `translate3d(${dx}px, 0, 0)`;
  next.style.transform = `translate3d(${dx + gap}px, 0, 0)`;
}

function __npResetCoverTransforms(withAnimation = true){
  const cur = document.getElementById('np-cover');
  const prev = document.getElementById('np-cover-prev');
  const next = document.getElementById('np-cover-next');
  if (!cur || !prev || !next) return;

  const transition = withAnimation ? 'transform 230ms cubic-bezier(0.22, 1, 0.36, 1)' : 'none';
  prev.style.transition = transition;
  cur.style.transition  = transition;
  next.style.transition = transition;

  __npApplyCoverTransforms(0);

  if (withAnimation) {
    setTimeout(() => {
      prev.style.transition = '';
      cur.style.transition  = '';
      next.style.transition = '';
    }, 260);
  }
}

function setupNowPlayingCoverSwipeOnce(){
  if (__npCoverSwipeReady) return;

  const wrap = document.getElementById('np-cover-swipe');
  const cur = document.getElementById('np-cover');
  const prev = document.getElementById('np-cover-prev');
  const next = document.getElementById('np-cover-next');

  if (!wrap || !cur || !prev || !next) return;

  __npCoverSwipeReady = true;

  try {
    wrap.style.willChange = 'transform';
    cur.style.willChange = 'transform';
    prev.style.willChange = 'transform';
    next.style.willChange = 'transform';
  } catch (e) {}

  updateNPCoverNeighbors();
  __npResetCoverTransforms(false);

  let dragging = false;
  let isHorizontal = false;
  let pointerId = null;
  let startX = 0;
  let startY = 0;
  let dx = 0;
  let lastX = 0;
  let lastT = 0;
  let vx = 0;

  function hasPrev(){
    return Array.isArray(currentQueue) && currentQueue.length > 0 && currentIndex > 0;
  }

  function hasNext(){
    return Array.isArray(currentQueue) && currentQueue.length > 0 && currentIndex < (currentQueue.length - 1);
  }

  function applyDrag(dxRaw){
    const w = Math.max(1, wrap.clientWidth);
    const max = w * 0.92;
    let out = Math.max(-max, Math.min(max, dxRaw));

    if ((out > 0 && !hasPrev()) || (out < 0 && !hasNext())) {
      out *= 0.32;
    }

    dx = out;
    __npApplyCoverTransforms(dx);
  }

  function animateCommit(direction){
    if (__npCoverSwipeAnimating) return;
    __npCoverSwipeAnimating = true;

    const w = Math.max(1, wrap.clientWidth);
    const settleX = direction === 'next' ? -w * 1.05 : w * 1.05;

    prev.style.transition = 'transform 210ms cubic-bezier(0.22, 1, 0.36, 1)';
    cur.style.transition  = 'transform 210ms cubic-bezier(0.22, 1, 0.36, 1)';
    next.style.transition = 'transform 210ms cubic-bezier(0.22, 1, 0.36, 1)';
    __npApplyCoverTransforms(settleX);

    setTimeout(() => {
      try {
        if (direction === 'next') nextSong();
        else prevSong();
      } catch (e) {}

      prev.style.transition = 'none';
      cur.style.transition  = 'none';
      next.style.transition = 'none';
      __npApplyCoverTransforms(0);

      requestAnimationFrame(() => {
        prev.style.transition = '';
        cur.style.transition  = '';
        next.style.transition = '';
        updateNPCoverNeighbors();
        __npCoverSwipeAnimating = false;
      });
    }, 220);
  }

  function endSwipe(){
    if (__npCoverSwipeAnimating) return;

    const w = Math.max(1, wrap.clientWidth);
    const distanceThreshold = w * 0.50; // user-visible rule: >= 50% drag commits
    const velocityThreshold = 0.62;     // px/ms; fast flick can still commit under 50%
    const minFlickDistance = Math.max(20, w * 0.08);
    const projectedDx = dx + (vx * 220); // predict where momentum would naturally settle

    const fastFlickNext = (vx < -velocityThreshold) && (dx <= -minFlickDistance || projectedDx <= -distanceThreshold);
    const fastFlickPrev = (vx >  velocityThreshold) && (dx >=  minFlickDistance || projectedDx >=  distanceThreshold);

    const goNext = (dx <= -distanceThreshold || fastFlickNext) && hasNext();
    const goPrev = (dx >=  distanceThreshold || fastFlickPrev) && hasPrev();

    if (goNext) {
      animateCommit('next');
      return;
    }
    if (goPrev) {
      animateCommit('prev');
      return;
    }

    __npResetCoverTransforms(true);
    setTimeout(() => {
      updateNPCoverNeighbors();
    }, 80);
  }

  wrap.addEventListener('pointerdown', (e) => {
    if (__npCoverSwipeAnimating) return;
    if (!Array.isArray(currentQueue) || !currentQueue.length) return;

    dragging = true;
    isHorizontal = false;
    pointerId = e.pointerId;
    startX = e.clientX;
    startY = e.clientY;
    dx = 0;
    lastX = e.clientX;
    lastT = performance.now();
    vx = 0;

    try { wrap.setPointerCapture(e.pointerId); } catch (err) {}

    prev.style.transition = 'none';
    cur.style.transition  = 'none';
    next.style.transition = 'none';
  });

  wrap.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    if (pointerId != null && e.pointerId !== pointerId) return;

    const mx = e.clientX - startX;
    const my = e.clientY - startY;

    if (!isHorizontal) {
      if (Math.abs(mx) < 4 && Math.abs(my) < 4) return;
      if (Math.abs(my) > Math.abs(mx)) {
        dragging = false;
        pointerId = null;
        __npResetCoverTransforms(true);
        return;
      }
      isHorizontal = true;
    }

    const now = performance.now();
    const dt = Math.max(1, now - lastT);
    vx = (e.clientX - lastX) / dt;
    lastX = e.clientX;
    lastT = now;

    try { e.preventDefault(); } catch (err) {}
    applyDrag(mx);
  });

  wrap.addEventListener('pointerup', (e) => {
    if (!dragging) return;
    if (pointerId != null && e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    endSwipe();
  });

  wrap.addEventListener('pointercancel', (e) => {
    if (!dragging) return;
    if (pointerId != null && e.pointerId !== pointerId) return;
    dragging = false;
    pointerId = null;
    __npResetCoverTransforms(true);
  });
}


function closeNowPlaying() {
  // animate down, then hide
  nowPlayingOverlay.classList.remove('np-dragging');
  nowPlayingOverlay.style.transform = 'translateY(100%)';

  const done = () => {
    nowPlayingOverlay.classList.add('hidden');

    // ✅ Restore main view interactivity after closing Now Playing
    try { document.getElementById('main-scroll-area').style.pointerEvents = 'auto'; } catch (e) {}

    nowPlayingOverlay.style.transform = 'translateY(0)';
        nowPlayingOverlay.classList.add('hidden');
    try { checkDockVisibility(); } catch (e) {}
    nowPlayingOverlay.style.transform = 'translateY(0)';
    nowPlayingOverlay.removeEventListener('transitionend', done);

  };

  nowPlayingOverlay.addEventListener('transitionend', done);
}


// close button
if (npCloseBtn) npCloseBtn.addEventListener('click', closeNowPlaying);

// ESC closes
// Spacebar handler is bound in initGlobalKeys()

// Re-evaluate marquee on resize (desktop window changes, mobile rotation)
window.addEventListener('resize', () => {
  if (!currentSong) return;
  setMarqueeTitle('p-title', (currentSong.title || '').replace('.mp3', ''));
  setMarqueeTitle('np-title', (currentSong.title || '').replace('.mp3', ''));
});

// ✅ Now Playing top 3-dots should open the SAME context menu as song rows
(function bindNowPlayingDotsMenu() {
  if (window.__npDotsMenuBound) return;
  window.__npDotsMenuBound = true;

  const btn = document.getElementById('np-more');
  if (!btn) return;

  function openMenu(e) {
    try { e.preventDefault(); } catch (err) {}
    try { e.stopPropagation(); } catch (err) {}

        // ✅ currentSong is a plain global in this file (not always on window)
    const s = (typeof currentSong !== 'undefined' && currentSong) ? currentSong : window.currentSong;
    if (!s) return;

    const songForMenu = {
      url: s.url || s.link || "",
      link: s.url || s.link || "",
      title: s.title || s.name || "",
      name: s.title || s.name || "",
      artist: s.artist || s.artistName || "",
      album: s.album || s.albumName || "",
      albumName: s.album || s.albumName || "",
      cover: s.cover || s.coverArt || "",
      coverArt: s.cover || s.coverArt || ""
    };

        const pt = (typeof npGetXY === 'function')
      ? npGetXY(e)
      : { x: (e && e.clientX) || 0, y: (e && e.clientY) || 0 };

    (typeof showContextMenuAt === 'function')
      ? showContextMenuAt(pt.x, pt.y, songForMenu, btn)
      : console.warn("❌ showContextMenuAt is missing");


  }

  // Use pointer/touch so iOS doesn’t lose the click
  btn.addEventListener('pointerup', openMenu, true);
  btn.addEventListener('touchend', openMenu, true);
  btn.addEventListener('click', openMenu, true);
})();


// clicking the black backdrop closes (but not clicking inside content)
// ✅ NOTE: removed duplicate swipe handler here (it was preventing taps like the down-arrow).
// The single swipe-to-close handler is defined below in the "SWIPE DOWN TO CLOSE (mobile)" section.


/* -----------------------
   /* -----------------------
   /* -----------------------
   SWIPE DOWN TO CLOSE (mobile)
   - Swipe from anywhere in the UPPER HALF
   - No close on tap
------------------------ */
const npSheet = document.getElementById('np-sheet');

/* ✅ Mobile: ensure ••• works even when iOS doesn't generate "click" */
(function bindNpMoreTapFix(){
  const btn = document.getElementById('np-more');
  if (!btn || btn.__npMoreTapFixBound) return;
  btn.__npMoreTapFixBound = true;

  let lastFire = 0;

  const fire = (e) => {
    // De-dupe (iOS can fire multiple event types per tap)
    const now = Date.now();
    if (now - lastFire < 350) return;
    lastFire = now;

    try { e.preventDefault(); } catch (err) {}
    try { e.stopPropagation(); } catch (err) {}

    try {
      const r = btn.getBoundingClientRect();
      const x = r.left + (r.width / 2);
      const y = r.top + r.height;

      const song =
        (typeof currentSong !== 'undefined' && currentSong) ? currentSong :
        (window.currentSong || null);

      showContextMenuAt(x, y, song, btn);
    } catch (err) {
      console.warn(err);
    }
  };

  // pointerup covers most modern mobile browsers; touchend covers iOS quirks
  btn.addEventListener('pointerup', fire, { passive: false });
  btn.addEventListener('touchend', fire, { passive: false });
})();
 
let npDragActive = false;

let npStartY = 0;
let npStartX = 0;
let npLastDown = 0;
let npStartFromControls = false;
let npLastMoveY = 0;
let npLastMoveAt = 0;
let npPrevMoveY = 0;
let npPrevMoveAt = 0;
let npCurrentTranslateY = 0;
let npRafId = 0;

let npDecided = false;
let npIsVertical = false;

function npGetXY(e) {
  if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function npResetDrag() {
  npDragActive = false;
  npDecided = false;
  npIsVertical = false;
  npLastDown = 0;
  npLastMoveY = 0;
  npLastMoveAt = 0;
  npPrevMoveY = 0;
  npPrevMoveAt = 0;
  npCurrentTranslateY = 0;
  if (npRafId) {
    try { cancelAnimationFrame(npRafId); } catch (e) {}
    npRafId = 0;
  }
  if (npSheet) npSheet.style.overflowY = '';
  nowPlayingOverlay.classList.remove('np-dragging');
  nowPlayingOverlay.style.transform = 'translateY(0)';
}

function npQueueTranslate(nextY) {
  npCurrentTranslateY = Math.max(0, nextY);
  if (npRafId) return;
  npRafId = requestAnimationFrame(() => {
    npRafId = 0;
    nowPlayingOverlay.style.transform = `translate3d(0, ${npCurrentTranslateY}px, 0)`;
  });
}

function npStartAllowed(e) {
  // ✅ Spotify-ish: allow swipe-to-close from basically anywhere
  return true;
}



if (nowPlayingOverlay) {
  nowPlayingOverlay.addEventListener('pointerdown', (e) => {
  if (nowPlayingOverlay.classList.contains('hidden')) return;

  // ✅ If tapping close or more buttons, let the click happen (don't start swipe gesture)
  if (e.target && (e.target.closest('#np-close') || e.target.closest('#np-more'))) return;

  if (!npStartAllowed(e)) return;

  const { x, y } = npGetXY(e);
  npDragActive = true;
  npStartY = y;
  npStartX = x;
  npLastDown = 0;
  npLastMoveY = y;
  npLastMoveAt = performance.now();
  npPrevMoveY = y;
  npPrevMoveAt = npLastMoveAt;
  npStartFromControls = !!(e.target && e.target.closest && e.target.closest('#np-controls, #np-sheet'));

    npDecided = false;
  npIsVertical = false;

  // ✅ Don't enter drag-mode yet.
  // We'll only start dragging once we know it's a DOWNWARD vertical swipe.
});

  nowPlayingOverlay.addEventListener('pointermove', (e) => {
    if (!npDragActive) return;

    const { x, y } = npGetXY(e);
    const dy = y - npStartY;
    const dx = x - npStartX;

        // Don’t decide until it actually moves (prevents taps closing)
    if (!npDecided) {
      if (Math.abs(dy) < 1 && Math.abs(dx) < 1) return;
      npDecided = true;
      npIsVertical = Math.abs(dy) > Math.abs(dx);

            // ✅ Take over if it's a DOWN vertical swipe and:
      //   - we're at top of scroll, OR
      //   - the swipe started near the top area (feels Spotify-ish)
      const startNearTop = npStartY <= 160;

      if (npIsVertical && dy > 0 && (!npSheet || npSheet.scrollTop <= 0 || startNearTop)) {
        nowPlayingOverlay.classList.add('np-dragging');
        nowPlayingOverlay.style.transition = 'none';
        try { nowPlayingOverlay.setPointerCapture(e.pointerId); } catch (err) {}
      }

    }


                if (!npIsVertical) return;

    // ✅ Allow normal scrolling unless we've actually entered "drag to close" mode
    if (!nowPlayingOverlay.classList.contains('np-dragging')) return;

    if (npSheet) npSheet.style.overflowY = 'hidden';
    try { e.preventDefault(); } catch (err) {}

    npPrevMoveY = npLastMoveY;
    npPrevMoveAt = npLastMoveAt;
    npLastMoveY = y;
    npLastMoveAt = performance.now();


    // Only drag downward
    const down = Math.max(0, dy);
    npLastDown = down;
    npQueueTranslate(down);
  });

  nowPlayingOverlay.addEventListener('pointerup', () => {
    if (!npDragActive) return;

    const now = performance.now();
    const dt = Math.max(1, npLastMoveAt > 0 ? (now - npPrevMoveAt) : 1);
    const dyRecent = npLastMoveY - npPrevMoveY;
    const v = dyRecent / dt; // px/ms

    const vh = Math.max(window.innerHeight || 0, 1);
    const distanceThreshold = Math.max(90, vh * 0.18);
    const velocityThreshold = 0.55;

    const shouldClose = (npLastDown > distanceThreshold) || (v > velocityThreshold && npLastDown > 22);

    if (npRafId) {
      try { cancelAnimationFrame(npRafId); } catch (e) {}
      npRafId = 0;
    }

    if (shouldClose) {
      if (npSheet) npSheet.style.overflowY = '';
      nowPlayingOverlay.classList.remove('np-dragging');
      nowPlayingOverlay.style.transition = 'transform 190ms cubic-bezier(0.22, 1, 0.36, 1)';
      closeNowPlaying();
      setTimeout(() => {
        try { nowPlayingOverlay.style.transition = ''; } catch (e) {}
      }, 260);
      npDragActive = false;
      return;
    }

    nowPlayingOverlay.classList.remove('np-dragging');
    nowPlayingOverlay.style.transition = 'transform 240ms cubic-bezier(0.22, 1, 0.36, 1)';
    npResetDrag();
    setTimeout(() => {
      try { nowPlayingOverlay.style.transition = ''; } catch (e) {}
    }, 280);

    npDragActive = false;
  });


  nowPlayingOverlay.addEventListener('pointercancel', () => {
    if (!npDragActive) return;
    npResetDrag();
  });
}

/* -----------------------
   PROGRESS BAR SEEKING (Dock + Now Playing)
------------------------ */

let pendingSeekPct = null;
let pendingSeekBarId = null; // "progress-container" or "np-progress-container"

function getSeekDuration() {
  if (Number.isFinite(player.duration) && player.duration > 0) return player.duration;
  if (player.seekable && player.seekable.length) {
    const end = player.seekable.end(player.seekable.length - 1);
    if (Number.isFinite(end) && end > 0) return end;
  }
  return null;
}


function getClientX(e) {
  if (e.touches && e.touches[0]) return e.touches[0].clientX;
  if (e.changedTouches && e.changedTouches[0]) return e.changedTouches[0].clientX;
  return e.clientX;
}

function seekOnBar(barEl, clientX) {
  if (!barEl) return;

  const rect = barEl.getBoundingClientRect();

  // rect.width can be 0 in some layouts/zoom states; avoid NaN -> currentTime=0
  const width = rect.width || barEl.clientWidth || 0;
  if (!Number.isFinite(width) || width <= 0) return;

  const x = clientX - rect.left;
  const pct = x / width;
  if (!Number.isFinite(pct)) return;

  const clamped = Math.max(0, Math.min(1, pct));
  const duration = getSeekDuration();

  // If duration isn't ready yet, store and apply later
  if (!duration) {
    pendingSeekPct = clamped;
    pendingSeekBarId = barEl.id || null;
    return;
  }

  const target = clamped * duration;
  if (!Number.isFinite(target)) return;

  // ✅ Chrome can throw if you seek "too early" or during certain states.
  // If it throws, keep it pending and apply on canplay/metadata.
  try {
    player.currentTime = target;
  } catch (err) {
    pendingSeekPct = clamped;
    pendingSeekBarId = barEl.id || null;
  }
}

        
function applyPendingSeek() {
  if (pendingSeekPct == null) return;

  const duration = getSeekDuration();
  if (!duration) return;

  const target = pendingSeekPct * duration;
  if (!Number.isFinite(target)) return;

  try {
    player.currentTime = target;
    // Only clear pending AFTER a successful seek
    pendingSeekPct = null;
    pendingSeekBarId = null;
  } catch (err) {
    // keep pending; we'll try again on the next canplay/metadata tick
  }
}


player.addEventListener('loadedmetadata', applyPendingSeek);
player.addEventListener('durationchange', applyPendingSeek);
player.addEventListener('canplay', applyPendingSeek);

function bindSeekBar(barId) {
  const bar = document.getElementById(barId);
  if (!bar) return;

  // Helps pointer/touch devices not treat dragging as scrolling
  try { bar.style.touchAction = 'none'; } catch (e) {}

    let scrubbing = false;
  let suppressClick = false; // prevents the post-mousedown "click" from seeking again (Mac/Safari fix)


  // -----------------------
  // CLICK / TAP to jump
  // -----------------------
      bar.addEventListener('click', (e) => {
    // If we already sought on pointerdown/mousedown, ignore the synthetic click
    if (suppressClick) {
      suppressClick = false;
      return;
    }

    e.preventDefault();
    e.stopPropagation();
    seekOnBar(bar, getClientX(e));
    try { player.play(); } catch (err) {}
  });


    bar.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    e.stopPropagation();
        scrubbing = true;
    suppressClick = true;

    seekOnBar(bar, getClientX(e));
    try { player.play(); } catch (err) {}
    try { bar.setPointerCapture(e.pointerId); } catch (err) {}
  });

  bar.addEventListener('pointermove', (e) => {

    if (!scrubbing) return;
    seekOnBar(bar, getClientX(e));
  });

  bar.addEventListener('pointerup', () => {
    scrubbing = false;
  });

  bar.addEventListener('pointercancel', () => {
    scrubbing = false;
  });

  // -----------------------
  // MOUSE EVENTS (desktop fallback; fixes “desktop won’t scrub”)
  // -----------------------
    bar.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
        scrubbing = true;
    suppressClick = true;

    seekOnBar(bar, e.clientX);
    try { player.play(); } catch (err) {}

    const onMove = (ev) => {
      if (!scrubbing) return;
      seekOnBar(bar, ev.clientX);
    };

    const onUp = () => {
      scrubbing = false;
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };

    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  });

}

// Bind BOTH progress bars
bindSeekBar('progress-container');     // dock bar
bindSeekBar('np-progress-container');  // now playing overlay bar


// Keep the fill + time text updated
player.addEventListener('timeupdate', () => {
    if (!Number.isFinite(player.duration) || player.duration <= 0) return;
    if (nowPlayingOverlay && !nowPlayingOverlay.classList.contains('hidden')) updateNowPlayingUI();

    const pct = (player.currentTime / player.duration) * 100;
    document.getElementById('progress-fill').style.width = pct + "%";
    document.getElementById('t-curr').innerText = formatTime(player.currentTime);
    document.getElementById('t-total').innerText = formatTime(player.duration);
      // Light throttled persistence (once every ~5s)
  const now = Date.now();
  if (!window.__lastPersistTick) window.__lastPersistTick = 0;
  if (now - window.__lastPersistTick > 5000) {
    window.__lastPersistTick = now;
    persistPlayerState(null);
  }

});

function formatTime(s) {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec < 10 ? '0' + sec : sec}`;
}

/* -----------------------
   MARQUEE HELPERS (Dock + Now Playing title)
------------------------ */
function setMarqueeTitle(containerId, rawText) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;

  const a = wrap.querySelector('[data-marquee="a"]');
  const b = wrap.querySelector('[data-marquee="b"]');

  const text = (rawText || '').trim();

  // Fallback if markup isn't present
  if (!a || !b) {
    // Only change if different (prevents animation resets)
    if (wrap.dataset.marqueeText !== text) {
      wrap.textContent = text;
      wrap.dataset.marqueeText = text;
    }
    return;
  }

  // If text is unchanged AND container width unchanged, do nothing
  const w = wrap.clientWidth || 0;
  const lastText = wrap.dataset.marqueeText || '';
  const lastW = Number(wrap.dataset.marqueeW || 0);

  if (text === lastText && w === lastW) {
    return;
  }

  // Update stored values
  wrap.dataset.marqueeText = text;
  wrap.dataset.marqueeW = String(w);

  // Only set DOM text if it actually changed
  if (a.textContent !== text) a.textContent = text;
  const bText = `   •   ${text}`;
  if (b.textContent !== bText) b.textContent = bText;

  // Decide if marquee is needed (after layout)
  requestAnimationFrame(() => {
    const needs = (a.scrollWidth > wrap.clientWidth + 2) && text.length > 0;

    const isOn = wrap.classList.contains('is-marquee');

    // Only toggle if state changed (prevents “restart every tick”)
    if (needs && !isOn) {
      wrap.classList.add('is-marquee');
    } else if (!needs && isOn) {
      wrap.classList.remove('is-marquee');
    }
  });
}


function persistPlayerState(isPlayingOverride = null) {
  // If we have no song, clear saved state
  if (!currentSong) {
    localStorage.removeItem('lastSongState');
    return;
  }

  const isPlaying = (isPlayingOverride === null) ? !player.paused : !!isPlayingOverride;

  const state = {
    song: currentSong,                       // {url,title,album,artist,cover}
    currentTime: player.currentTime || 0,
    isPlaying: isPlaying,
    updatedAt: Date.now()
  };

  localStorage.setItem('lastSongState', JSON.stringify(state));

  // Also keep your existing lastPlayedTime “freshness” timestamp aligned
  lastPlayedTime = state.updatedAt;
  localStorage.setItem('lastPlayedTime', lastPlayedTime);

    // ✅ Make dock appear immediately on first play (no waiting for intervals)
  try { checkDockVisibility(); } catch (e) {}

  // ✅ Clear any inline display:none / pointer-events:none written by updateMainDockVisibility()
  // (This is the exact manual console call that instantly restores the dock.)
  try { updateMainDockVisibility(); } catch (e) {}

  // ✅ Cloud sync (cross-device dock) — best-effort


  try {
    const uid = window.APP_USER_ID || localStorage.getItem("app_user_id");
    if (uid && typeof window.syncNowPlayingToCloud === "function") {
      // convert currentSong.url -> trackId (id param) when possible
      let trackId = "";
      try {
        const u = new URL(currentSong.url, window.location.origin);
        trackId = String(u.searchParams.get("id") || "").trim();
      } catch (e) {
        trackId = "";
      }

      if (trackId) {
        window.syncNowPlayingToCloud({
          userId: uid,
          trackId: trackId,
          contextType: null,
          contextId: null,
          positionSec: Number(state.currentTime || 0)
        });
      }
    }
  } catch (e) {}
}

function restorePlayerStateIfRecent() {

  const oneHour = 3600000;

  let state = null;
  try {
    state = JSON.parse(localStorage.getItem('lastSongState') || "null");
  } catch (e) {
    state = null;
  }

   // If no saved state, hide dock (desktop only). Mobile always keeps dock visible.
  if (!state) {

    currentSong = null;
    toggleRightSidebar(false);

    if (window.innerWidth <= 768) {
      dock.classList.remove('dock-hidden');
    } else {
      dock.classList.add('dock-hidden');
    }
    return;
  }

  // If older than 1 hour, wipe it and hide dock (desktop only). Mobile always keeps dock visible.
  const ONE_HOUR = 60 * 60 * 1000;
  if (!state || !state.lastPlayedTime || (Date.now() - state.lastPlayedTime) > ONE_HOUR) {
    localStorage.removeItem('reson_player_state');
    currentSong = null;
    toggleRightSidebar(false);

    if (window.innerWidth <= 768) {
      dock.classList.remove('dock-hidden');
    } else {
      dock.classList.add('dock-hidden');
    }
    return;
  }


        currentSong = state.song;

    // ✅ keep global in sync (Now Playing menu relies on this fallback)
    try { window.currentSong = currentSong; } catch (e) {}

  // ✅ Ensure cover is always present (playlist/queue/search restore safety)

  try {
    if (currentSong && !currentSong.cover && window.tracksById && currentSong.url) {
      const u = new URL(currentSong.url, window.location.origin);
      const id = String(u.searchParams.get("id") || "").trim();
      const hit = id ? window.tracksById.get(id) : null;
      if (hit && hit.cover) currentSong.cover = hit.cover;
    }
  } catch (e) {}

  // Restore audio source + time (do NOT autoplay)
  player.src = currentSong.url;

  player.currentTime = Number(state.currentTime || 0);

    updateMediaSessionMetadata();

  // Update dock UI
  dock.classList.remove('dock-hidden');
    {
    const PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%20viewBox%3D%220%200%2048%2048%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20rx%3D%2212%22%20fill%3D%22%23272a2f%22%2F%3E%3C%2Fsvg%3E';
    let finalCover = String(currentSong.cover || '').trim();

    // If missing, try infer from ?id=
    try {
      if (!finalCover) {
        const rawUrl = String(currentSong.url || currentSong.link || '').trim();
        let id = '';
        try {
          const u = new URL(rawUrl, window.location.origin);
          id = u.searchParams.get('id') || '';
        } catch (e) {
          if (rawUrl.includes('?id=')) id = (rawUrl.split('?id=')[1] || '').split('&')[0] || '';
        }
        try { id = decodeURIComponent(id); } catch (e) {}
        id = id.replace(/^\/+/, '').trim();

        const parts = String(id || '').split('/').filter(Boolean);
        if (parts.length >= 2) {
          const artist = parts[0];
          const album = (parts.length >= 3 ? parts[1] : 'Singles');
          const r2Base = "https://music-streamer.jacetbaum.workers.dev/?id=";
          finalCover = r2Base + encodeURIComponent(`${artist}/${album}/cover.jpg`);
        }
      }
    } catch (e) {}

    document.getElementById('p-cover').src = finalCover || PLACEHOLDER;
  }

updateAccentFromCover(currentSong.cover || "");

setMarqueeTitle('p-title', (currentSong.title || "").replace('.mp3', ''));
document.getElementById('p-artist').innerText = currentSong.artist || "";


  // Ensure icons show PAUSED state on refresh
  setAllPlayIconsToPlay();

    // Right sidebar metadata (safe)
  document.getElementById('right-cover').src = currentSong.cover || "";
  document.getElementById('right-title').innerText = (currentSong.title || "").replace('.mp3', '');
  document.getElementById('right-artist').innerText = currentSong.artist || "";

  // Lyrics (desktop right sidebar)
  updateRightLyricsForSong(currentSong);
  updateCenterLyricsForSong(currentSong);

  updateHeartUI();


  // Keep lastPlayedTime consistent with restored state
  lastPlayedTime = state.updatedAt || Date.now();
  localStorage.setItem('lastPlayedTime', lastPlayedTime);
}

function checkDockVisibility() {
  const dock = document.getElementById('main-dock');
  if (!dock) return;

   // ✅ Mobile: dock visible everywhere EXCEPT while Now Playing is open
  if (window.innerWidth <= 768) {
    const np = document.getElementById('now-playing-overlay');
    const npOpen = !!(np && !np.classList.contains('hidden'));
    dock.classList.toggle('dock-hidden', npOpen);
document.body.classList.toggle('np-open', npOpen);

    return;
  }

  // Desktop behavior (unchanged): only show dock when something is loaded / recently played
  const lastPlayedTime = parseInt(localStorage.getItem('lastPlayedTime'), 10);
  const currentTime = Date.now();

  // If nothing is loaded / no current song => NO dock
  if (!currentSong) {
    dock.classList.add('dock-hidden');
    return;
  }

  // If last played time exists and is within 1 hour => show dock
  if (!isNaN(lastPlayedTime) && currentTime - lastPlayedTime < 3600000) {
    dock.classList.remove('dock-hidden');
  } else {
    dock.classList.add('dock-hidden');
  }
}


       function toggleRightSidebar(show) {
  if (window.innerWidth < 1024) return;
  if (!rightSidebar) return;

  if (show) {
    rightSidebar.classList.remove('sidebar-hidden');
  } else {
    rightSidebar.classList.add('sidebar-hidden');
  }
}

// [MOVED TO src/features/lyrics/lyrics.feature.js] Center lyrics block


function setRightSidebarNowPlaying({ title, artist, cover }) {
  if (window.innerWidth < 1024) return;

  // Ensure panel is visible on desktop
  toggleRightSidebar(true);

  const rc = document.getElementById('right-cover');
  const rt = document.getElementById('right-title');
  const ra = document.getElementById('right-artist');

  if (rc && cover) rc.src = cover;
  if (rt) rt.innerText = title || '—';
  if (ra) ra.innerText = artist || '—';
}

// [MOVED TO src/features/lyrics/lyrics.feature.js] loadRightLyrics
// [MOVED TO src/features/artist/artist.feature.js] Artist bio (bindRightBioExpandOnce, toggleNpBioExpanded, loadRightBio, openArtistFromNowPlayingCard, loadNpBio)
// [MOVED TO src/features/lyrics/lyrics.feature.js] Mobile lyrics: toggleNpLyricsExpanded, bindNpLyricsCollapse, shareNpLyrics, loadNpLyrics

// --- Playback navigation (Next/Prev + Shuffle) ---

       // --- Shuffle "no repeats" state ---
// (State variables are declared in GLOBAL APP STATE near the top)
// Ensure they are sane in case anything loaded from old sessions:
shuffleOrder = Array.isArray(shuffleOrder) ? shuffleOrder : [];
shufflePos = Number.isFinite(shufflePos) ? shufflePos : 0;
playedStack = Array.isArray(playedStack) ? playedStack : [];
isAutoNav = !!isAutoNav;
isShuffle = !!isShuffle;

function buildShuffleOrder(len, startIndex) {

    // Makes a shuffled list of indexes that does NOT start with the current song
    const arr = [];
    for (let i = 0; i < len; i++) {
        if (i !== startIndex) arr.push(i);
    }

    // Fisher–Yates shuffle
    for (let i = arr.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
}

function toggleShuffle() {
  const btn = document.getElementById('btn-shuffle');
  const npIcon = document.getElementById('np-shuffle-icon');
  const albumIcon = document.getElementById('album-shuffle-icon');
  const artistIcon = document.getElementById('artist-shuffle-icon');

  const els = [btn, npIcon, albumIcon, artistIcon].filter(Boolean);
  if (!els.length) return;

  const isOn = els.some(el => el.classList.contains('active-green'));
  const turnOn = !isOn;

  els.forEach(el => el.classList.toggle('active-green', turnOn));

  // If a song is currently selected, reset shuffle order + history
  if (turnOn && currentQueue && currentQueue.length > 0 && currentIndex >= 0) {
    try { resetShuffleForQueue(); } catch (e) {}
    try { playedStack = [currentIndex]; } catch (e) {}
    try { shufflePos = 0; } catch (e) {}
  }
}

function bindActionShuffleButton() {

  const actionButtons = Array.from(document.querySelectorAll('.action-btn'));
  const shuffleBtn = actionButtons.find(btn => btn.querySelector('.fa-shuffle'));
  if (!shuffleBtn || shuffleBtn.dataset.shuffleBound === '1') return;

  shuffleBtn.dataset.shuffleBound = '1';
  shuffleBtn.addEventListener('click', (e) => {
    e.preventDefault();
    toggleShuffle();
  });
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', bindActionShuffleButton);
} else {
  bindActionShuffleButton();
}

function isShuffleOn() {
  return (
    document.getElementById('btn-shuffle')?.classList.contains('active-green') ||
    document.getElementById('np-shuffle-icon')?.classList.contains('active-green') ||
    document.getElementById('album-shuffle-icon')?.classList.contains('active-green') ||
    document.getElementById('artist-shuffle-icon')?.classList.contains('active-green')
  );
}


        // --- Repeat mode (Spotify-style): off -> all -> one -> off ---
let repeatMode = 'off'; // 'off' | 'all' | 'one'

function syncRepeatUI() {
  try { void repeatMode; } catch (e) { console.warn("repeatMode not initialized yet; skipping syncRepeatUI"); return; }

  const d = document.getElementById('btn-repeat');
  const mIcon = document.getElementById('np-repeat-icon');
  const mDot = document.getElementById('np-repeat-dot');

  // Clear state classes
  if (d) {
    d.classList.remove('active-green', 'repeat-one', 'repeat-all');
  }
  if (mIcon) {
    mIcon.classList.remove('active-green', 'repeat-one', 'repeat-all');
  }
  if (mDot) {
    mDot.classList.add('hidden');
  }

  if (repeatMode === 'off') return;

  // repeat all OR one => green
  if (d) d.classList.add('active-green');
  if (mIcon) mIcon.classList.add('active-green');

  if (repeatMode === 'all') {
    if (d) d.classList.add('repeat-all');
    if (mIcon) mIcon.classList.add('repeat-all');
    // no dot
  }

  if (repeatMode === 'one') {
    if (d) d.classList.add('repeat-one');
    if (mIcon) mIcon.classList.add('repeat-one');
    if (mDot) mDot.classList.remove('hidden');
  }
}

function cycleRepeat() {
  if (repeatMode === 'off') repeatMode = 'all';
  else if (repeatMode === 'all') repeatMode = 'one';
  else repeatMode = 'off';

  try { syncRepeatUI(); } catch (e) { console.warn("syncRepeatUI failed:", e); }

}

function isRepeatAllOn() {
  return repeatMode === 'all';
}

function isRepeatOneOn() {
  return repeatMode === 'one';
}

function setAllPlayIconsToPlay() {
  const desktopIcon = document.getElementById('play-icon');
  const mobileIcon = document.getElementById('mobile-play-icon');
  const npIcon = document.getElementById('np-play-icon');

  if (desktopIcon) desktopIcon.className = "fas fa-play ml-1";
  if (mobileIcon) mobileIcon.className = "fas fa-play text-white text-xl";
  if (npIcon) npIcon.className = "fas fa-play text-black text-2xl";
}

function nextSong() {

    const manualSong = takeNextManualQueueSong();
  if (manualSong) {
    isAutoNav = true;
    playSpecificSong(manualSong.url, manualSong.title, manualSong.album, manualSong.artist, manualSong.cover);
    isAutoNav = false;
    return;
  }

  if (!currentQueue || currentQueue.length === 0) return;
    
  const len = currentQueue.length;

  // SHUFFLE ON (no repeats, stop when done)
  if (isShuffleOn()) {
    const expectedLen = (currentIndex === -1) ? len : (len - 1);
    if (!shuffleOrder || shuffleOrder.length !== expectedLen) {
      resetShuffleForQueue();
    }

        // If we've used up all shuffled songs:
    // - Repeat ALL => reshuffle and keep going
    // - Otherwise => STOP
    if (shufflePos >= shuffleOrder.length) {
      if (isRepeatAllOn()) {
        resetShuffleForQueue();
        shufflePos = 0;
        playedStack = [currentIndex];
      } else {
                // ✅ Autoplay (if enabled) instead of stopping at end
        if (__tryAutoplayFromCurrent()) return;

        player.pause();
        player.currentTime = 0;
                // ✅ Autoplay: if enabled, build a new queue from current context instead of stopping
        try {
          if (window.isFeatureOn && window.isFeatureOn('autoplay')) {
            if (typeof __tryAutoplayFromCurrent === 'function' && __tryAutoplayFromCurrent()) return;
          }
        } catch (e) {}

        setAllPlayIconsToPlay();
        return;

      }
    }


    // Pick next index
    if (currentIndex === -1) {
      currentIndex = shuffleOrder[0];
      shufflePos = 1;
    } else {
      currentIndex = shuffleOrder[shufflePos];
      shufflePos += 1;
    }

    // Track history so Prev works in shuffle
    if (!playedStack.length) playedStack = [];
    playedStack.push(currentIndex);
  }
  // SHUFFLE OFF (normal order, stop at end)
  else {
    if (currentIndex === -1) {
      currentIndex = 0; // start at first song
    } else {
      // If we're at the last song:
      // - Repeat ALL => loop back to start
      // - Otherwise => STOP
      if (currentIndex >= len - 1) {
        if (isRepeatAllOn()) {
          currentIndex = 0;
        } else {
                    // ✅ Autoplay (if enabled) instead of stopping at end
          if (__tryAutoplayFromCurrent()) return;

          player.pause();
                    // ✅ Autoplay: if enabled, build a new queue from current context instead of stopping
          try {
            if (window.isFeatureOn && window.isFeatureOn('autoplay')) {
              if (typeof __tryAutoplayFromCurrent === 'function' && __tryAutoplayFromCurrent()) return;
            }
          } catch (e) {}

          setAllPlayIconsToPlay();
          return;

          setAllPlayIconsToPlay();
          return;

        }
      } else {
        currentIndex = currentIndex + 1;
      }
    }
  }


  const s = currentQueue[currentIndex];
  isAutoNav = true;
  playSpecificSong(s.url, s.title, s.album, s.artist, s.cover);
  isAutoNav = false;
}

function normalizeSong(song, fallback = {}) {
  const url = song.link || song.url;
  if (!url) return null;

  const rawTitle = song.name || song.title || "Unknown Title";

  const album = song.album || song.albumName || fallback.album || "Unknown Album";
  const artist = song.artist || song.artistName || fallback.artist || "Unknown Artist";
  const cover = song.cover || song.coverArt || fallback.cover || "";

  // ✅ Display fix:
  // If rawTitle starts with the artist name (e.g. "Simon & Garfunkel - Old Friends"),
  // strip "Artist - " so the title line shows only the song.
  let title = String(rawTitle || "");

  try {
    const a = String(artist || "").trim();
    if (a) {
      const esc = a.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp("^\\s*" + esc + "\\s*[-–—:]\\s*", "i");
      title = title.replace(re, "");
    }
  } catch (e) {}

  // Strip file extension if it somehow made it through
  title = String(title || "").replace(/\.[^/.]+$/, "").trim() || String(rawTitle || "").trim();

  return { url, title, album, artist, cover };
}

// ✅ Autoplay helper: build a “next up” pool from same artist
function __buildAutoplayQueueFromCurrent() {
  try {
    if (!currentSong) return null;

    const artist = String(currentSong.artist || "").trim();
    if (!artist) return null;

    if (!Array.isArray(libraryData)) return null;

    const pool = [];

    for (const a of libraryData) {
      if (!a) continue;
      if (String(a.artistName || "").trim() !== artist) continue;

      const cover = getAlbumCover(a.artistName, a.albumName, a.coverArt);
      const songs = Array.isArray(a.songs) ? a.songs : [];

      for (const s of songs) {
        const norm = normalizeSong(s, { album: a.albumName, artist: a.artistName, cover });
        if (!norm) continue;
        pool.push(norm);
      }
    }

    if (!pool.length) return null;

    // light shuffle so it doesn’t feel repetitive
    for (let i = pool.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      const tmp = pool[i]; pool[i] = pool[j]; pool[j] = tmp;
    }

    return pool;
  } catch (e) {
    return null;
  }
}

function __tryAutoplayFromCurrent() {
  try {
    if (!window.isFeatureOn || !window.isFeatureOn('autoplay')) return false;

    const q = __buildAutoplayQueueFromCurrent();
    if (!q || !q.length) return false;

    currentQueue = q;
    currentIndex = 0;

    const s = currentQueue[0];
    isAutoNav = true;
    playSpecificSong(s.url, s.title, s.album, s.artist, s.cover);
    isAutoNav = false;

    return true;
  } catch (e) {
    return false;
  }
}

/* ---------------------------------------------------------------------
   - Turns trackIds like "Artist/Album/Track.mp3" into full song objects
   - Prefers real metadata from libraryData when possible
--------------------------------------------------------------------- */

// [RETAINED IN index.html] track-id resolution and collection rendering helpers


function prevSong() {
    if (!currentQueue || currentQueue.length === 0) return;

    // Shuffle ON: go back through actual history
    if (isShuffleOn()) {
        if (playedStack.length <= 1) return; // no previous

        playedStack.pop(); // remove current
        currentIndex = playedStack[playedStack.length - 1];

        const s = currentQueue[currentIndex];
        isAutoNav = true;
        playSpecificSong(s.url, s.title, s.album, s.artist, s.cover);
        isAutoNav = false;
        return;
    }

    // Shuffle OFF: go back one, but STOP at the start (no looping)
    if (currentIndex <= 0) return;
    currentIndex = currentIndex - 1;

    const s = currentQueue[currentIndex];
    isAutoNav = true;
    playSpecificSong(s.url, s.title, s.album, s.artist, s.cover);
    isAutoNav = false;
}


// Auto-advance when a song ends
player.addEventListener('ended', () => {
  // Repeat ONE: loop the same track forever
  if (isRepeatOneOn()) {
    player.currentTime = 0;
    player.play();

    setAllPlayIcons(true);
    return;
  }

  // Otherwise advance.
  // Repeat ALL behavior is handled inside nextSong() (it loops instead of stopping).
  const shouldStopAtEnd =
    typeof sleepTimerEndOfTrack !== 'undefined' && sleepTimerEndOfTrack;

  if (shouldStopAtEnd) {
    sleepTimerEndOfTrack = false;
    if (typeof npUpdateSleepTimerUI === 'function') {
      npUpdateSleepTimerUI();
    }
    return;
  }

  // ✅ Guard: if queue/index is invalid, do NOT fall into any random/autoplay fallback
  if (!Array.isArray(currentQueue) || currentQueue.length === 0) {
    console.warn("⛔ ended(): no currentQueue — stopping (no random)");
    return;
  }
  if (!Number.isFinite(currentIndex) || currentIndex < -1 || currentIndex >= currentQueue.length) {
    console.warn("⛔ ended(): bad currentIndex =", currentIndex, "— clamping");
    currentIndex = Math.max(-1, Math.min(currentQueue.length - 1, Number(currentIndex) || -1));
  }

  nextSong();
});




        // ✅ Auto-skip unavailable tracks ONLY when auto-advancing.
// - If user clicked the song: show the error.
// - If the app is auto-nav (Next/ended/shuffle): silently skip.
player.addEventListener('error', () => {
  try {
    const src = String(player.currentSrc || "");
    if (isAutoNav) {
      console.warn("⏭️ autoplay skip (audio error):", src);
      // try the next track without surfacing an error UI
      try { nextSong(); } catch (e) {}
      return;
    }

    // User-initiated click: show error
    console.warn("⚠️ user-click audio error:", src);
    try {
      showTrackMissingModal({
        reason: "audio_error",
        requestedUrl: src,
        title: currentSong ? currentSong.title : "",
        artist: currentSong ? currentSong.artist : "",
        album: currentSong ? currentSong.album : "",
        when: new Date().toISOString()
      });
    } catch (e) { try { alert("This track is unavailable."); } catch (_) {} }
  } catch (e) {}
});

// Auto-hide dock interval
setInterval(checkDockVisibility, 30000);

// -----------------------
// MISSING CORE FUNCTIONS (restored from inline script)
// -----------------------

function setAllPlayIcons(isPlaying){
  const desktopIcon = document.getElementById('play-icon');
  const mobileIcon  = document.getElementById('mobile-play-icon');
  const npIcon      = document.getElementById('np-play-icon');
  const heroBtn     = document.getElementById('hero-play-btn');

  const on = !!isPlaying;

  if (desktopIcon) desktopIcon.className = on ? "fas fa-pause" : "fas fa-play ml-1";
  if (mobileIcon)  mobileIcon.className  = on ? "fas fa-pause text-white text-xl" : "fas fa-play text-white text-xl";
  if (npIcon)      npIcon.className      = on ? "fas fa-pause text-black text-2xl" : "fas fa-play text-black text-2xl";

  if (heroBtn) {
    heroBtn.setAttribute('aria-label', on ? 'Pause' : 'Play');

    if (!heroBtn.__heroToggleInstalled && !heroBtn.onclick) {
      heroBtn.__heroToggleInstalled = true;
      heroBtn.addEventListener('click', (e) => {
        try { e.preventDefault(); } catch (err) {}
        try { e.stopPropagation(); } catch (err) {}
        const audio = document.getElementById('audio-player') || window.player || (typeof player !== 'undefined' ? player : null);
        if (!audio) return;
        if (audio.paused) {
          const p = audio.play();
          if (p && typeof p.catch === "function") p.catch(() => {});
        } else {
          audio.pause();
        }
        try { if (typeof window.__kickHeroPaint__ === "function") window.__kickHeroPaint__(); } catch (err) {}
      }, false);
    }

    if (!heroBtn.__cssIconInstalled) {
      heroBtn.__cssIconInstalled = true;
      if (!document.getElementById('hero-css-icon-style')) {
        const style = document.createElement('style');
        style.id = 'hero-css-icon-style';
        style.textContent = `
          #hero-play-btn .hero-css-icon { width:22px; height:22px; display:inline-block; position:relative; }
          #hero-play-btn .hero-css-play { width:0; height:0; border-top:7px solid transparent; border-bottom:7px solid transparent; border-left:12px solid #000; position:absolute; left:6px; top:4px; }
          #hero-play-btn .hero-css-pause { position:absolute; left:6px; top:4px; width:12px; height:14px; }
          #hero-play-btn .hero-css-pause::before, #hero-play-btn .hero-css-pause::after { content:""; position:absolute; top:0; width:4px; height:14px; background:#000; border-radius:1px; }
          #hero-play-btn .hero-css-pause::before { left:0; }
          #hero-play-btn .hero-css-pause::after { right:0; }
          #hero-play-btn.is-playing .hero-css-play { display:none; }
          #hero-play-btn:not(.is-playing) .hero-css-pause { display:none; }
        `;
        document.head.appendChild(style);
      }
      heroBtn.innerHTML = `
        <span class="hero-css-icon" aria-hidden="true">
          <span class="hero-css-pause"></span>
          <span class="hero-css-play"></span>
        </span>
      `;
    }

    heroBtn.classList.toggle('is-playing', on);
  }
}

// Bind icon updates to the real audio state
(function bindPlayIconSync(){
  if (window.__playIconSyncBound) return;
  window.__playIconSyncBound = true;
  try {
    if (typeof player !== 'undefined' && player) {
      player.addEventListener('play',  () => setAllPlayIcons(true),  true);
      player.addEventListener('pause', () => setAllPlayIcons(false), true);
      player.addEventListener('ended', () => setAllPlayIcons(false), true);
    }
  } catch (e) {}
})();

function updateNowPlayingUI() {
  if (!currentSong) return;
  try { window.currentSong = currentSong; } catch (e) {}

  const cover  = document.getElementById('np-cover');
  const title  = document.getElementById('np-title');
  const artist = document.getElementById('np-artist');
  const ctx    = document.getElementById('np-context');

  if (cover) {
    const PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%20viewBox%3D%220%200%2048%2048%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20rx%3D%2212%22%20fill%3D%22%23272a2f%22%2F%3E%3C%2Fsvg%3E';
    let resolvedCover = String(currentSong.cover || '').trim();
    try {
      if (!resolvedCover && typeof getSongCoverFromPlaylistSong === 'function') {
        resolvedCover = String(getSongCoverFromPlaylistSong(currentSong) || '').trim();
      }
    } catch (e) {}
    try {
      if (!resolvedCover) {
        const rawUrl = String(currentSong.url || currentSong.link || '').trim();
        let id = '';
        try { const u = new URL(rawUrl); id = u.searchParams.get('id') || ''; } catch (e) {
          if (rawUrl.includes('?id=')) id = (rawUrl.split('?id=')[1] || '').split('&')[0] || '';
        }
        try { id = decodeURIComponent(id); } catch (e) {}
        id = id.replace(/^\/+/, '').trim();
        const parts = String(id || '').split('/').filter(Boolean);
        if (parts.length >= 2) {
          const a = parts[0];
          const al = (parts.length >= 3 ? parts[1] : 'Singles');
          resolvedCover = "https://music-streamer.jacetbaum.workers.dev/?id=" + encodeURIComponent(`${a}/${al}/cover.jpg`);
        }
      }
    } catch (e) {}
    cover.src = resolvedCover || PLACEHOLDER;
    try { updateNPCoverNeighbors(); } catch (e) {}
  }

  setMarqueeTitle('np-title', (currentSong.title || "").replace('.mp3', ''));
  if (artist) artist.textContent = currentSong.artist || "";
  try { loadNpBio(currentSong.artist); } catch (e) {}
  try { loadNpLyrics((currentSong.title || currentSong.name || '').replace('.mp3',''), currentSong.artist); } catch (e) {}

  if (ctx) {
    let label = "";
    if (!playContext || !playContext.type) {
      label = "NOW PLAYING";
    } else if (playContext.type === "album") {
      label = (playContext.album || playContext.name || playContext.label || "").trim() || "ALBUM";
    } else if (playContext.type === "playlist") {
      label = (playContext.playlist || playContext.name || playContext.label || "").trim() || "PLAYLIST";
    } else if (playContext.type === "artist") {
      label = (playContext.artist || playContext.name || playContext.label || "").trim() || "ARTIST";
    } else if (playContext.type === "search") {
      const q = (playContext.label || playContext.query || "").trim();
      label = q ? `"${q}" IN SEARCH` : "SEARCH";
    } else {
      label = (playContext.label || playContext.name || "").trim() || "NOW PLAYING";
    }
    ctx.textContent = String(label).toUpperCase();
  }

  const curr  = document.getElementById('np-t-curr');
  const total = document.getElementById('np-t-total');
  const fill  = document.getElementById('np-progress-fill');
  if (curr)  curr.textContent  = formatTime(player.currentTime || 0);
  if (total) total.textContent = Number.isFinite(player.duration) ? formatTime(player.duration) : "0:00";
  if (fill && Number.isFinite(player.duration) && player.duration > 0) {
    fill.style.width = ((player.currentTime / player.duration) * 100) + "%";
  }
}

async function playSpecificSong(url, title, album, artist, cover) {

  const titleClean = String(title || "").split("/").pop().replace(/\.[^/.]+$/, "");
  const albumRaw = String(album || "").trim();

  let inferredAlbum = "";
  try {
    const u0 = new URL(url, window.location.origin);
    const id0 = String(u0.searchParams.get("id") || "").trim();
    const decoded0 = id0 ? decodeURIComponent(id0) : "";
    const parts0 = decoded0.split("/").filter(Boolean);
    if (parts0.length >= 3) inferredAlbum = parts0[1] || "";
  } catch (e) {}

  const albumCandidate = (!albumRaw || albumRaw === "Unknown Album") ? (inferredAlbum || "") : albumRaw;
  const albumIsFile = /\.[a-z0-9]{2,5}$/i.test(String(albumCandidate || "").trim());
  const albumFolder = albumIsFile ? "Singles" : (String(albumCandidate || "").trim() || "Singles");

  let resolvedCover = String(cover || "").trim();
  if (!resolvedCover) {
    const a = String(artist || "").trim();
    if (a && albumFolder) {
      resolvedCover = "https://music-streamer.jacetbaum.workers.dev/?id=" + encodeURIComponent(a + "/" + albumFolder + "/cover.jpg");
    } else if (a) {
      resolvedCover = "https://music-streamer.jacetbaum.workers.dev/?id=" + encodeURIComponent(a + "/Singles/cover.jpg");
    }
  }

  currentSong = { url, title: titleClean, album: albumFolder, artist, cover: resolvedCover };
  window.currentSong = currentSong;
  try { window.__pendingTouchSongUrl = String(url || ''); } catch (e) {}

  try { player.pause(); } catch (e) {}
  player.src = url;
  player.load();

  const __crossfadeOn = (window.isFeatureOn && window.isFeatureOn('crossfade'));
  if (__crossfadeOn) { try { player.volume = 0; } catch (e) {} }

  let started = false;
  try {
    const p = player.play();
    if (p && typeof p.then === 'function') await p;
    started = !player.paused;
    if (started && __crossfadeOn) {
      try {
        const ms = 350, stepMs = 25, steps = Math.max(1, Math.round(ms / stepMs));
        let i = 0;
        const t = setInterval(() => {
          i++;
          try { player.volume = Math.min(1, i / steps); } catch (e) {}
          if (i >= steps) clearInterval(t);
        }, stepMs);
      } catch (e) {}
    }
  } catch (err) {
    console.warn('Playback did not start automatically:', err);
    started = false;
    if (err && err.name === 'AbortError') {
      try {
        const btn = document.getElementById('hero-play-btn');
        const hero = btn && btn.parentElement;
        if (hero) { hero.style.transform = 'translateZ(0)'; void hero.offsetHeight; requestAnimationFrame(() => { hero.style.transform = ''; void hero.offsetHeight; }); }
      } catch (e) {}
    }
  }

  try { updateMediaSessionMetadata(); } catch (e) {}

  lastPlayedTime = Date.now();
  localStorage.setItem('lastPlayedTime', lastPlayedTime);
  persistPlayerState(started);

  dock.classList.remove('dock-hidden');
  {
    const PLACEHOLDER = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%20viewBox%3D%220%200%2048%2048%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20rx%3D%2212%22%20fill%3D%22%23272a2f%22%2F%3E%3C%2Fsvg%3E';
    const finalCover = String(resolvedCover || '').trim();
    document.getElementById('p-cover').src = finalCover || PLACEHOLDER;
  }

  try { updateAccentFromCover(resolvedCover || ""); } catch (e) {}
  setMarqueeTitle('p-title', titleClean);
  document.getElementById('p-artist').innerText = artist;

  setAllPlayIcons(!!started);

  if (window.innerWidth >= 1024) {
    const cleanTitle = String(title || '').replace(/\.mp3$/i, '');
    toggleRightSidebar(true);
    setRightSidebarNowPlaying({ title: cleanTitle, artist, cover });
    try { loadRightLyrics(artist, cleanTitle); } catch (e) {}
    try { loadRightBio(artist); } catch (e) {}
  }

  try { updateRightLyricsForSong(currentSong); } catch (e) {}
  try { updateCenterLyricsForSong(currentSong); } catch (e) {}
  try { updateHeartUI(); } catch (e) {}
  try { addToHistory(album, artist, cover); } catch (e) {}

  try {
    const key = "reson_play_events_v1";
    const raw = localStorage.getItem(key);
    const arr = raw ? (JSON.parse(raw) || []) : [];
    arr.push({ ts: Date.now(), title: titleClean, artist: String(artist || ""), album: String(albumFolder || ""), url: String(url || ""), started: !!started });
    while (arr.length > 500) arr.shift();
    localStorage.setItem(key, JSON.stringify(arr));
  } catch (e) {}

  try { updateTrackListActiveState(); } catch (e) {}

  if (nowPlayingOverlay && !nowPlayingOverlay.classList.contains('hidden')) {
    try { updateNowPlayingUI(); } catch (e) {}
  }
}

function togglePlay() {
  if (!currentSong) {
    if (Array.isArray(currentQueue) && currentQueue.length) {
      if (typeof playQueue === 'function') playQueue(currentQueue, 0);
    }
    return;
  }

  if (window.__togglePlayLock) return;
  window.__togglePlayLock = true;
  const unlock = () => { window.__togglePlayLock = false; };

  if (player.paused) {
    let p = null;
    try { p = player.play(); } catch (e) {}
    try { updateMediaSessionMetadata(); } catch (e) {}
    try { persistPlayerState(true); } catch (e) {}

    if (p && typeof p.then === "function") {
      p.then(() => setAllPlayIcons(true))
       .catch(() => setAllPlayIcons(!player.paused))
       .finally(unlock);
    } else {
      setTimeout(() => { setAllPlayIcons(!player.paused); unlock(); }, 0);
    }
  } else {
    try { player.pause(); } catch (e) {}
    try { persistPlayerState(false); } catch (e) {}
    setAllPlayIcons(false);
    unlock();
  }
}

               // ✅ Export dock/Now Playing controls to global scope
        // (Your dock buttons / inline onclick need these on window)
        window.nextSong = nextSong;
        window.prevSong = prevSong;
        window.cycleRepeat = cycleRepeat;

                // ✅ Bottom nav taps (your HTML uses onclick="onNavTap('home')" etc)
        window.onNavTap = onNavTap;



// Ensure player controls are reachable by inline handlers and other features.
window.togglePlay = window.togglePlay || togglePlay;
window.openNowPlaying = window.openNowPlaying || openNowPlaying;
window.closeNowPlaying = window.closeNowPlaying || closeNowPlaying;
window.playSpecificSong = window.playSpecificSong || playSpecificSong;
window.toggleShuffle = window.toggleShuffle || toggleShuffle;
