// =============================================================================
// SEARCH FEATURE (extracted from index.html)
// - Library search (desktop + mobile overlay)
// - Global search (main Search tab)
// - Search recents (term-based + click-based)
// - Search gestures (swipe-down close, swipe-to-dismiss keyboard)
// - Search state persistence
//
// Dependencies (must be defined before this script loads):
//   libraryData[], playlists[], fuzzyScore(), playSpecificSong(),
//   openAlbumByName(), highlightSongInAlbum(), openArtistByName(),
//   openPlaylistById(), showView(), goBack(), pushNavCurrent(),
//   showContextMenuAt(), getAlbumCover(), getSongCoverFromPlaylistSong(),
//   getEffectivePlaylistCover(), showSwipeBackUnderlay(), hideSwipeBackUnderlay(),
//   navCurrent, navStack, playContext, resolveTrackIdsToSongs()
// =============================================================================

// -----------------------
// LIBRARY SEARCH
// -----------------------

function getLibraryRecentSearches() {
  try {
    const arr = JSON.parse(localStorage.getItem('libraryRecentSearches') || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function saveLibraryRecentSearches(arr) {
  localStorage.setItem('libraryRecentSearches', JSON.stringify(arr.slice(0, 8)));
}

function addLibraryRecentSearch(term) {
  const t = String(term || '').trim();
  if (!t) return;
  const rec = getLibraryRecentSearches().filter(x => String(x || '').toLowerCase() !== t.toLowerCase());
  rec.unshift(t);
  saveLibraryRecentSearches(rec);
}

function removeLibraryRecentSearch(term) {
  const t = String(term || '').trim().toLowerCase();
  const rec = getLibraryRecentSearches().filter(x => String(x || '').toLowerCase() !== t);
  saveLibraryRecentSearches(rec);
}

function getLibraryInputForBox(boxId) {
  return document.getElementById(
    boxId === 'library-search-results-overlay'
      ? 'library-search-overlay-input'
      : (boxId === 'library-search-results-mobile' ? 'library-search-mobile' : 'library-search')
  );
}

function renderLibraryRecentSearches(boxId) {
  const box = document.getElementById(boxId);
  if (!box) return;

  const rec = getLibraryRecentSearches();
  if (!rec.length) {
    // Overlay wants Spotify-style empty state
    if (boxId === 'library-search-results-overlay') {
      box.classList.remove('hidden');
      box.innerHTML = `
        <div class="flex flex-col items-center justify-center text-center px-6"
             style="min-height: calc(100vh - 140px);">
          <div class="text-white text-3xl font-black mb-2">Find your favorites</div>
          <div class="text-zinc-400 text-base font-semibold">Search everything you've saved, followed, or created.</div>
        </div>
      `;
      return;
    }

    // Non-overlay behavior stays the same
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  let html = `<div class="px-4 pt-4 pb-2 text-xs font-black text-zinc-400 uppercase tracking-widest">Recent searches</div>`;

  rec.forEach(term => {
    const safe = String(term).replace(/</g, '&lt;').replace(/"/g, '&quot;');
    html += `
      <div class="flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/10">
        <button class="flex-1 text-left min-w-0"
                type="button"
                data-recent-pick="1"
                data-term="${safe}">
          <div class="text-white text-sm font-bold truncate">${safe}</div>
        </button>
        <button class="text-zinc-400 hover:text-white"
                type="button"
                aria-label="Remove recent search"
                data-recent-remove="1"
                data-term="${safe}">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
  });

  box.innerHTML = html;
  box.classList.remove('hidden');

  box.querySelectorAll('button[data-recent-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const term = btn.getAttribute('data-term') || '';
      const input = getLibraryInputForBox(boxId);
      if (input) {
        input.value = term;
        handleLibrarySearch(term, boxId);
        input.focus();
      }
    });
  });

  box.querySelectorAll('button[data-recent-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const term = btn.getAttribute('data-term') || '';
      removeLibraryRecentSearch(term);
      renderLibraryRecentSearches(boxId);
    });
  });
}

function renderLibrarySearchResults(items, query, boxId = 'library-search-results') {
  const box = document.getElementById(boxId);
  if (!box) return;

  const q = String(query || '').trim();

  // Empty query = show Recent searches
  if (!q) {
    renderLibraryRecentSearches(boxId);
    return;
  }

  if (!items.length) {
    box.innerHTML = `<div class="px-4 py-4 text-sm text-zinc-400">No results for "${q.replace(/</g,'&lt;')}"</div>`;
    box.classList.remove('hidden');
    return;
  }

  const section = (title) => `<div class="px-4 pt-1 pb-2 text-xs font-black text-zinc-400 uppercase tracking-widest">${title}</div>`;

  let html = '';
  const byType = {
    song: items.filter(x => x.type === 'song').slice(0, 5),
    album: items.filter(x => x.type === 'album').slice(0, 5),
    artist: items.filter(x => x.type === 'artist').slice(0, 5),
    playlist: items.filter(x => x.type === 'playlist').slice(0, 5),
  };

  if (byType.song.length) {
    html += section('Songs');
    byType.song.forEach(x => {
      html += `
        <button class="w-full text-left px-4 py-3 hover:bg-white/10 flex items-center gap-3"
                type="button"
                data-action="song"
                data-album="${String(x.album).replace(/"/g,'&quot;')}"
                data-title="${String(x.title).replace(/"/g,'&quot;')}"
                data-query="${q.replace(/"/g,'&quot;')}">
          <div class="w-10 h-10 rounded-md overflow-hidden flex-shrink-0 bg-white/10 flex items-center justify-center">${x.coverArt ? `<img src="${x.coverArt.replace(/"/g,'&quot;')}" class="w-full h-full object-cover" alt="" loading="lazy">` : '<i class="fas fa-music text-zinc-400"></i>'}</div>
          <div class="min-w-0">
            <div class="text-white text-sm font-bold truncate">${x.title}</div>
            <div class="text-zinc-400 text-xs truncate">${x.artist} • ${x.album}</div>
          </div>
        </button>
      `;
    });
  }

  if (byType.album.length) {
    html += section('Albums');
    byType.album.forEach(x => {
      html += `
        <button class="w-full text-left px-4 py-3 hover:bg-white/10 flex items-center gap-3"
                type="button"
                data-action="album"
                data-album="${String(x.album).replace(/"/g,'&quot;')}"
                data-query="${q.replace(/"/g,'&quot;')}">
          <div class="w-10 h-10 rounded-md overflow-hidden flex-shrink-0 bg-white/10 flex items-center justify-center">${x.coverArt ? `<img src="${x.coverArt.replace(/"/g,'&quot;')}" class="w-full h-full object-cover" alt="" loading="lazy">` : '<i class="fas fa-compact-disc text-zinc-400"></i>'}</div>
          <div class="min-w-0">
            <div class="text-white text-sm font-bold truncate">${x.album}</div>
            <div class="text-zinc-400 text-xs truncate">${x.artist}</div>
          </div>
        </button>
      `;
    });
  }

  if (byType.artist.length) {
    html += section('Artists');
    byType.artist.forEach(x => {
      const artistName = String(x.artist || '');
      const safeArtistAttr = artistName
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
      const avatarHtml = (typeof window.getArtistAvatarMarkup === 'function')
        ? window.getArtistAvatarMarkup(artistName, 'w-10 h-10 rounded-full overflow-hidden flex-shrink-0')
        : '<div class="w-10 h-10 rounded-full overflow-hidden bg-white/10 flex items-center justify-center flex-shrink-0"><i class="fas fa-user text-zinc-400"></i></div>';
      html += `
        <button class="w-full text-left px-4 py-3 hover:bg-white/10 flex items-center gap-3"
                type="button"
                data-action="artist"
                data-artist="${safeArtistAttr}"
                data-query="${q.replace(/"/g,'&quot;')}">
          ${avatarHtml}
          <div class="min-w-0">
            <div class="text-white text-sm font-bold truncate">${artistName.replace(/</g,'&lt;')}</div>
            <div class="text-zinc-400 text-xs truncate">${x.count} album${x.count === 1 ? '' : 's'}</div>
          </div>
        </button>
      `;
    });
  }

  if (byType.playlist.length) {
    html += section('Playlists');
    byType.playlist.forEach(x => {
      html += `
        <button class="w-full text-left px-4 py-3 hover:bg-white/10 flex items-center gap-3"
                type="button"
                data-action="playlist"
                data-playlist-id="${String(x.id)}"
                data-query="${q.replace(/"/g,'&quot;')}">
          <i class="fas fa-list-ul text-zinc-400"></i>
          <div class="min-w-0">
            <div class="text-white text-sm font-bold truncate">${x.name}</div>
            <div class="text-zinc-400 text-xs truncate">Playlist</div>
          </div>
        </button>
      `;
    });
  }

  box.innerHTML = html;
  box.classList.remove('hidden');

  box.querySelectorAll('button[data-action]').forEach(btn => {
    btn.addEventListener('click', () => {
      const action = btn.getAttribute('data-action');
      const q0 = btn.getAttribute('data-query') || '';
     addLibraryRecentSearch(q0);

      if (boxId === 'library-search-results-overlay') closeLibrarySearchOverlay();
      box.classList.add('hidden');

      if (action === 'song') {
        const album = btn.getAttribute('data-album') || '';
        const title = btn.getAttribute('data-title') || '';
        openAlbumByName(album);
        highlightSongInAlbum(title);
        return;
      }
      if (action === 'album') {
        const album = btn.getAttribute('data-album') || '';
        openAlbumByName(album);
        return;
      }
      if (action === 'artist') {
        const artist = btn.getAttribute('data-artist') || '';
        // Mark this as an explicit artist-intent action for recents logic.
        try { window.__fromArtistView = String(artist || '').trim(); } catch (e) {}
        openArtistByName(artist);
        return;
      }
      if (action === 'playlist') {
        const id = btn.getAttribute('data-playlist-id') || '';
        const idx = playlists.findIndex(p => p.id === id);
        if (idx !== -1) showView('playlist', idx);
        return;
      }
    });
  });

  if (typeof window.hydrateArtistPortraits === 'function') {
    window.hydrateArtistPortraits(box);
  }
}

function handleLibrarySearch(query, boxId = 'library-search-results') {

  const q = String(query || '').trim();
  const box = document.getElementById(boxId);
  if (!box) return;

  if (!q) {
    box.classList.add('hidden');
    box.innerHTML = '';
    return;
  }

  const items = [];

  // Songs
  (Array.isArray(libraryData) ? libraryData : []).forEach(album => {
    const albumName = album.albumName || '';
    const artistName = album.artistName || '';
    (Array.isArray(album.songs) ? album.songs : []).forEach(song => {
      const songName = String(song.name || '').replace('.mp3', '');
      const score = Math.max(
        fuzzyScore(q, songName),
        Math.round(fuzzyScore(q, albumName) * 0.85),
        Math.round(fuzzyScore(q, artistName) * 0.90)
      );
      if (score >= 60) {
        items.push({ type: 'song', _score: score, title: songName, album: albumName, artist: artistName, coverArt: album.coverArt || '' });
      }
    });
  });

  // Albums
  (Array.isArray(libraryData) ? libraryData : []).forEach(album => {
    const albumName = album.albumName || '';
    const artistName = album.artistName || '';
    const score = Math.max(fuzzyScore(q, albumName), Math.round(fuzzyScore(q, artistName) * 0.75));
    if (score >= 60) items.push({ type: 'album', _score: score, album: albumName, artist: artistName, coverArt: album.coverArt || '' });
  });

  // Artists (unique)
  const artistMap = new Map();
  (Array.isArray(libraryData) ? libraryData : []).forEach(a => {
    const artist = a.artistName || '';
    if (!artist) return;
    artistMap.set(artist, (artistMap.get(artist) || 0) + 1);
  });
  [...artistMap.entries()].forEach(([artist, count]) => {
    const score = fuzzyScore(q, artist);
    if (score >= 60) items.push({ type: 'artist', _score: score, artist, count });
  });

  // Playlists
  (Array.isArray(playlists) ? playlists : []).forEach(pl => {
    const score = fuzzyScore(q, pl.name || '');
    if (score >= 60) items.push({ type: 'playlist', _score: score, id: pl.id, name: pl.name || 'Playlist' });
  });

  items.sort((a, b) => (b._score || 0) - (a._score || 0));
  renderLibrarySearchResults(items, q, boxId);
}
function openLibrarySearchOverlay() {
  // Mobile only
  if (window.innerWidth > 768) return;

  const overlay = document.getElementById('library-search-overlay');
  const input = document.getElementById('library-search-overlay-input');
  const box = document.getElementById('library-search-results-overlay');

  if (!overlay || !input || !box) return;

  overlay.classList.remove('hidden');

  // Prevent background scroll while overlay is open
  document.body.style.overflow = 'hidden';

  const q = String(input.value || '').trim();

  // ✅ Preserve existing query/results:
  // If there's a query, re-render results. If empty, show recents.
  if (q) {
    try { box.classList.remove('hidden'); } catch (e) {}
    try { handleLibrarySearch(q, 'library-search-results-overlay'); } catch (e) {}
   } else {
    // ✅ show click-recents (has data in localStorage: searchClickRecents:v1)
    try { loadSearchClickRecents(); } catch (e) {}
    try { renderSearchClickRecents('library-search-results-overlay'); } catch (e) {}

    // fallback (if click-recents render fails for any reason)
    try {
      const boxEl = document.getElementById('library-search-results-overlay');
      if (boxEl && boxEl.children && boxEl.children.length === 0) {
        renderLibraryRecentSearches('library-search-results-overlay');
      }
    } catch (e) {}
  }


  // Focus for keyboard + blinking caret (do NOT clear value)
  setTimeout(() => {
    try { input.focus({ preventScroll: true }); } catch (e) { input.focus(); }
  }, 0);
}


function closeLibrarySearchOverlay() {
  const overlay = document.getElementById('library-search-overlay');
  const input = document.getElementById('library-search-overlay-input');

  if (overlay) overlay.classList.add('hidden');

  // Restore background scroll
  document.body.style.overflow = '';

  if (input) input.blur();

  // ✅ Do NOT clear results box or query.
  // This preserves your scroll + results until you fully exit search.
}

function initLibrarySearchBox() {
  const desktopInput = document.getElementById('library-search');
  const desktopBox = document.getElementById('library-search-results');

  const overlayInput = document.getElementById('library-search-overlay-input');
  const overlayBox = document.getElementById('library-search-results-overlay');

  function bind(input, box, boxId) {
    if (!input || !box) return;

    input.addEventListener('input', () => handleLibrarySearch(input.value, boxId));

    // show Recent searches when you focus with empty query
    input.addEventListener('focus', () => {
      if (!String(input.value || '').trim()) renderLibraryRecentSearches(boxId);
    });
  }

  // Desktop search stays exactly as you had it
  bind(desktopInput, desktopBox, 'library-search-results');

  // Mobile: bind overlay
  bind(overlayInput, overlayBox, 'library-search-results-overlay');

  // Mobile: magnifying glass opens overlay
  const openBtn = document.getElementById('library-search-icon-btn');
  if (openBtn) openBtn.addEventListener('click', openLibrarySearchOverlay);

  // Mobile: Cancel closes overlay
  const cancelBtn = document.getElementById('library-search-overlay-cancel');
  if (cancelBtn) cancelBtn.addEventListener('click', closeLibrarySearchOverlay);

  // ESC closes overlay (helpful when testing with a keyboard)
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeLibrarySearchOverlay();
  });
}

// -----------------------
// SEARCH SWIPE-DOWN CLOSE (mobile)
// -----------------------

function initSearchSwipeDownClose() {
  // Mobile only
  if (window.innerWidth > 768) return;

  const area = document.getElementById('main-scroll-area');
  const searchView = document.getElementById('search-view');
  if (!area || !searchView) return;

  if (searchView.dataset.searchSwipeDownBound === "1") return;
  searchView.dataset.searchSwipeDownBound = "1";

  let active = false;
  let decided = false;
  let isVertical = false;
  let startX = 0;
  let startY = 0;
  let lastDy = 0;
  let lastMoveY = 0;
  let prevMoveY = 0;
  let lastMoveAt = 0;
  let prevMoveAt = 0;
  let currentTranslateY = 0;
  let rafId = 0;

  const MOVE_DECIDE_PX = 2;
  const OPACITY_DROP = 0.20;

  const getXY = (e) => {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    return { x: e.clientX, y: e.clientY };
  };

  function queueTranslate(nextY) {
    currentTranslateY = Math.max(0, nextY);
    if (rafId) return;
    rafId = requestAnimationFrame(() => {
      rafId = 0;
      area.style.transform = `translate3d(0, ${currentTranslateY}px, 0)`;
      const maxShift = Math.max(180, Math.floor(window.innerHeight * 0.82));
      const p = Math.min(1, currentTranslateY / maxShift);
      area.style.opacity = String(1 - (p * OPACITY_DROP));
    });
  }

  function reset(animated = true) {
    if (rafId) {
      try { cancelAnimationFrame(rafId); } catch (e) {}
      rafId = 0;
    }
    if (animated) {
      const snapDur = Math.round(Math.max(80, Math.min(260, 60 + currentTranslateY * 0.9)));
      area.style.transition = `transform ${snapDur}ms cubic-bezier(0.22, 1, 0.36, 1), opacity ${snapDur}ms ease`;
      setTimeout(() => { area.style.transition = ''; }, snapDur + 20);
    } else {
      area.style.transition = '';
    }
    area.style.transform = 'translateY(0px)';
    area.style.opacity = '1';
    lastDy = 0;
    lastMoveY = 0;
    prevMoveY = 0;
    lastMoveAt = 0;
    prevMoveAt = 0;
    currentTranslateY = 0;

    hideSwipeBackUnderlay();
  }

  searchView.addEventListener('pointerdown', (e) => {
    // Only when we're actually on Search
    if (!navCurrent || navCurrent.type !== 'search') return;
    if (navStack.length === 0) return;

    // Start only BELOW the search bar area (so typing/cursor selection doesn't trigger)
    const input = document.getElementById('global-search');
    if (input) {
      const r = input.getBoundingClientRect();
      const { y } = getXY(e);
      if (y <= (r.bottom + 8)) return;
    }

    active = true;
    decided = false;
    isVertical = false;

    const { x, y } = getXY(e);
    startX = x;
    startY = y;
    lastDy = 0;
    lastMoveY = y;
    prevMoveY = y;
    lastMoveAt = performance.now();
    prevMoveAt = lastMoveAt;

  }, { passive: true });

  searchView.addEventListener('pointermove', (e) => {
    if (!active) return;

    const { x, y } = getXY(e);
    const dx = x - startX;
    const dy = y - startY;

    if (!decided) {
      if (Math.abs(dx) < MOVE_DECIDE_PX && Math.abs(dy) < MOVE_DECIDE_PX) return;
      decided = true;
      isVertical = Math.abs(dy) > Math.abs(dx);
      if (isVertical) {
        try { searchView.setPointerCapture(e.pointerId); } catch (err) {}
      }
    }

    if (!isVertical) return;

    // Only downward pull should move it
    if (dy <= 0) {
      lastDy = 0;
      area.style.transform = `translateY(0px)`;
      area.style.opacity = '1';
      return;
    }

    // ✅ passive move listener: no preventDefault needed (we're only translating the view)

    prevMoveY = lastMoveY;
    prevMoveAt = lastMoveAt;
    lastMoveY = y;
    lastMoveAt = performance.now();

    // Rubber-band tension — hyperbolic curve gives resistance that increases with pull distance
    const vh = window.innerHeight || 800;
    const dampedDown = dy / (1 + dy / (vh * 0.38));
    lastDy = dampedDown;
    queueTranslate(dampedDown);
  }, { passive: true });

  searchView.addEventListener('pointerup', () => {
    if (!active) return;
    active = false;

    const now = performance.now();
    const dt = Math.max(1, lastMoveAt > 0 ? (now - prevMoveAt) : 1);
    const dyRecent = lastMoveY - prevMoveY;
    const velocity = dyRecent / dt; // px/ms

    const vh = Math.max(window.innerHeight || 0, 1);
    const distanceThreshold = Math.max(90, vh * 0.18);
    const velocityThreshold = 0.55;
    const shouldCommit = (lastDy > distanceThreshold) || (velocity > velocityThreshold && lastDy > 20);

    if (rafId) {
      try { cancelAnimationFrame(rafId); } catch (e) {}
      rafId = 0;
    }

    if (shouldCommit) {
      area.style.transition = 'transform 120ms cubic-bezier(0.22, 1, 0.36, 1), opacity 100ms ease';
      area.style.transform = `translateY(${window.innerHeight}px)`;
      area.style.opacity = String(1 - OPACITY_DROP);

      const done = () => {
        area.removeEventListener('transitionend', done);
        reset(false);
        goBack();
      };
      area.addEventListener('transitionend', done);
      setTimeout(() => {
        try { done(); } catch (e) {}
      }, 140);
      return;
    }

    reset(true);
  }, { passive: true });


  searchView.addEventListener('pointercancel', () => {
    if (!active) return;
    active = false;
    reset(true);
  }, { passive: true });
}

// -----------------------
// FOCUS GLOBAL SEARCH + SWIPE-TO-DISMISS
// -----------------------

function focusGlobalSearch() {
  try {
    const input = document.getElementById('global-search');
    if (!input) return;
    // Needs a slight delay so the view is visible before focus
    setTimeout(() => {
      try { input.focus(); } catch (e) {}
    }, 80);
  } catch (e) {}
}


function initSearchSwipeToDismissOnce(){
  if (window.__searchSwipeDismissBound) return;
  window.__searchSwipeDismissBound = true;

  const view = document.getElementById('search-view');
  const area = document.getElementById('main-scroll-area');
  const input = document.getElementById('global-search');
  if (!view || !area || !input) return;

  let startY = 0;
  let tracking = false;

  view.addEventListener('touchstart', (e) => {
    // Only when Search is visible + the input is focused
    if (view.classList.contains('hidden')) return;
    if (document.activeElement !== input) return;

    // Only when you're already at the top (so it feels like "pull down to dismiss")
    if (area.scrollTop > 0) return;

    const t = e.touches && e.touches[0];
    if (!t) return;
    startY = t.clientY;
    tracking = true;
  }, { passive: true });

  view.addEventListener('touchmove', (e) => {
    if (!tracking) return;
    const t = e.touches && e.touches[0];
    if (!t) return;

    const dy = t.clientY - startY;

    // swipe down threshold
    if (dy > 35) {
      tracking = false;
      try { input.blur(); } catch (e) {}
    }
  }, { passive: true });

  view.addEventListener('touchend', () => { tracking = false; }, { passive: true });
}

// -----------------------
// SEARCH: RECENTS (mobile + desktop)
// -----------------------
const __SEARCH_RECENTS_KEY = 'searchRecents:v1';

function loadSearchRecents(){
  try {
    const arr = JSON.parse(localStorage.getItem(__SEARCH_RECENTS_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch (e) { return []; }
}

function saveSearchRecents(arr){
  try { localStorage.setItem(__SEARCH_RECENTS_KEY, JSON.stringify(arr.slice(0, 12))); } catch (e) {}
}

function pushSearchRecent(term){
  const t = String(term || '').trim();
  if (!t) return;
  const arr = loadSearchRecents().filter(x => String(x).toLowerCase() !== t.toLowerCase());
  arr.unshift(t);
  saveSearchRecents(arr);
}

function removeSearchRecent(term){
  const t = String(term || '').trim().toLowerCase();
  const arr = loadSearchRecents().filter(x => String(x).toLowerCase() !== t);
  saveSearchRecents(arr);
}

function renderSearchRecents(){
  const results = document.getElementById('search-results');
  if (!results) return;

  const rec = loadSearchRecents();
  if (!rec.length) {
    results.innerHTML = '';
    return;
  }

  let html = `
    <div class="px-4 pt-4 pb-2 text-xs font-black text-zinc-400 uppercase tracking-widest">Recently searched</div>
  `;

  rec.forEach(term => {
    const safe = String(term).replace(/</g, '&lt;').replace(/"/g, '&quot;');
    html += `
      <div class="flex items-center justify-between gap-3 px-4 py-3 hover:bg-white/10">
        <button class="flex-1 text-left min-w-0"
                type="button"
                data-search-recent-pick="1"
                data-term="${safe}">
          <div class="text-white text-sm font-bold truncate">${safe}</div>
        </button>
        <button class="text-zinc-400 hover:text-white"
                type="button"
                aria-label="Remove recent search"
                data-search-recent-remove="1"
                data-term="${safe}">
          <i class="fas fa-times"></i>
        </button>
      </div>
    `;
  });

  results.innerHTML = html;

  results.querySelectorAll('button[data-search-recent-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      const term = btn.getAttribute('data-term') || '';
      const input = document.getElementById('global-search');
      if (input) {
        input.value = term;
        handleSearch(term);
        try { input.focus(); } catch (e) {}
      }
    });
  });

  results.querySelectorAll('button[data-search-recent-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const term = btn.getAttribute('data-term') || '';
      removeSearchRecent(term);
      renderSearchRecents();
    });
  });
}

// ✅ Recent clicks (albums/playlists/songs you opened from Search)
const __SEARCH_CLICK_RECENTS_KEY = 'searchClickRecents:v1';

function loadSearchClickRecents(){
  try {
    const arr = JSON.parse(localStorage.getItem(__SEARCH_CLICK_RECENTS_KEY) || '[]');
    return Array.isArray(arr) ? arr.filter(Boolean) : [];
  } catch (e) { return []; }
}

function saveSearchClickRecents(arr){
  try { localStorage.setItem(__SEARCH_CLICK_RECENTS_KEY, JSON.stringify(arr.slice(0, 12))); } catch (e) {}
}

// ✅ used by the Search "Recent" X button
function __removeSearchClickRecent(match){
  try {
    const type = String(match?.type || '').trim();
    const id   = String(match?.id || '').trim();
    const link = String(match?.link || '').trim();

    const arr = loadSearchClickRecents();
    const out = arr.filter(it => {
      const t = String(it?.type || '').trim();
      const i = String(it?.id || '').trim();
      const l = String(it?.link || '').trim();

      // Prefer link for songs, fallback to (type+id)
      if (link && l) return l !== link;
      if (type && id) return !(t === type && i === id);
      return true;
    });

    saveSearchClickRecents(out);
  } catch (e) {}
}

function pushSearchClickRecent(item){
  try {
    if (!item) return;

    const type = String(item.type || '').trim();
    const id = String(item.id || '').trim();
    const link = String(item.link || '').trim();

    const key = type + '|' + (id || link);
    if (!type || !key || key === '|') return;

    const arr = loadSearchClickRecents().filter(x => {
      const k = String(x.type || '') + '|' + (String(x.id || '') || String(x.link || ''));
      return k !== key;
    });

    arr.unshift(item);
    saveSearchClickRecents(arr);
  } catch (e) {}
}

function renderSearchClickRecents(targetId){
  const results = document.getElementById(targetId || 'search-results');
  if (!results) return;


  // ✅ make sure the results container is actually visible
  try { results.classList.remove('hidden'); } catch (e) {}
  try { results.style.display = 'block'; } catch (e) {}

  const rec = loadSearchClickRecents();

  if (!rec.length) {
    // fallback to the old term-based recent searches (if any)
    try { renderSearchRecents(); } catch (e) {
      results.innerHTML = '';
    }
    return;
  }

  const header = `
    <div style="padding:24px 16px 8px;font-size:22px;font-weight:900;color:#fff;">Recent searches</div>
  `;

  const rows = rec.map(item => {
    const title = String(item.title || item.name || item.album || item.playlist || '').replace(/</g,'&lt;');
    const subtitle = String(item.subtitle || item.artist || '').replace(/</g,'&lt;');
    const cover = String(item.cover || '').trim();
    const type = String(item.type || '').trim().replace(/"/g,'&quot;');
    const id = String(item.id || '').trim().replace(/"/g,'&quot;');
    const link = String(item.link || '').trim().replace(/"/g,'&quot;');

    return `
      <div class="flex items-center gap-4 p-3 rounded-lg hover:bg-zinc-900 cursor-pointer group"
           data-search-click-recent="1"
           data-type="${type}"
           data-id="${id}"
           data-link="${link}">
        <img src="${cover}" class="w-12 h-12 rounded object-cover" onerror="this.style.opacity='0';" />
         <div class="flex-1 overflow-hidden search-recent-row-inner">
          <div class="search-recent-left">
            <div class="text-white font-bold truncate">${title}</div>
            <div class="text-sm text-zinc-400 truncate">${subtitle}</div>
          </div>

          <div class="search-recent-actions">
            <button type="button" class="search-recent-btn search-recent-x" aria-label="Remove from recents">✕</button>
                        <button type="button" class="search-recent-btn search-recent-dots" aria-label="More">⋯</button>
          </div>
        </div>
      </div>

    `;
	  
  }).join('');

  results.innerHTML = header + rows;

    // ✅ Force LIST view (no grid columns)
  try {
    results.classList.remove('grid','grid-cols-2','grid-cols-3','gap-2','gap-3','gap-4');
    results.classList.remove('space-y-2');
  } catch (e) {}
  try { results.style.display = 'block'; } catch (e) {}
  try { results.style.gridTemplateColumns = 'none'; } catch (e) {}
  try { results.style.columnCount = 'unset'; results.style.columns = 'unset'; } catch (e) {}

  // ✅ Delegate clicks so buttons/rows always work (even after re-render)
  if (!results.__searchRecentDelegated) {
    results.__searchRecentDelegated = true;

    results.addEventListener('click', (e) => {
      const t = e && e.target;
      const row = (t && t.closest) ? t.closest('[data-search-click-recent="1"]') : null;
      if (!row) return;

      // ✅ X: permanently remove from recent-clicked list
      if (t.closest('.search-recent-x')) {
        try { e.preventDefault(); e.stopPropagation(); } catch (err) {}
        const type = row.getAttribute('data-type') || '';
        const id = row.getAttribute('data-id') || '';
        const link = row.getAttribute('data-link') || '';
        try { if (typeof window.__removeSearchClickRecent === 'function') window.__removeSearchClickRecent({ type, id, link }); } catch (err) {}
        try { row.remove(); } catch (err) {}
        return;
      }

            // ✅ ⋯ : open your EXISTING track context menu (bottom half-sheet)
      if (t && t.closest && t.closest('.search-recent-dots')) {
        try { e.preventDefault(); e.stopPropagation(); } catch (err) {}

        try {
          const dotsBtn = t.closest('.search-recent-dots');
          const link = row.getAttribute('data-link') || '';
          if (!link) return;

          const title = row.querySelector('.text-white.font-bold.truncate')?.textContent || '';
          const subtitle = row.querySelector('.text-sm.text-zinc-400.truncate')?.textContent || '';
          const cover = row.querySelector('img')?.getAttribute('src') || '';

          const songObj = {
            type: 'song',
            url: link,      // ✅ what the dock/menu expect
            link: link,     // keep for compatibility
            title: title,
            artist: subtitle,
            cover: cover
          };

          if (typeof window.showContextMenuAt === 'function' && dotsBtn && dotsBtn.getBoundingClientRect) {
            const r = dotsBtn.getBoundingClientRect();
            const fake = {
              clientX: Math.round(r.left + r.width/2),
              clientY: Math.round(r.top + r.height/2),
              preventDefault() {},
              stopPropagation() {}
            };
            window.showContextMenuAt(fake.clientX, fake.clientY, songObj, row);
          }
        } catch (err) {
          console.warn("recent dots failed", err);
        }

        return;
      }

      // ✅ Row click: keep existing behavior (play/open)
      // X / … should NOT trigger row click
      try {
        if (t && t.closest) {
          if (t.closest('.search-recent-actions')) return;
          if (t.closest('.search-recent-btn')) return;
        }
      } catch (err) {}

      // dismiss keyboard / blinking cursor
      try { const input = document.getElementById('global-search'); if (input) input.blur(); } catch (err) {}

      const type = row.getAttribute('data-type') || '';
      const id = row.getAttribute('data-id') || '';
      const link = row.getAttribute('data-link') || '';

      if (type === 'album' && id) {
        try { openAlbumByName(id); } catch (err) {}
        return;
      }
      if (type === 'playlist' && id) {
        try { openPlaylistById(id); } catch (err) {}
        return;
      }
      if (type === 'song' && link) {
        try { playContext = { type: 'search', label: 'Recent' }; } catch (err) {}

        // ✅ Pull visible metadata from the row so the dock can render
        let title = '';
        let artist = '';
        try {
          title = row.querySelector('.text-white.font-bold.truncate')?.textContent?.trim() || '';
          const subtitle = row.querySelector('.text-sm.text-zinc-400.truncate')?.textContent?.trim() || '';
          artist = (subtitle.split('•')[0] || '').trim();
        } catch (err) {}

        // ✅ If missing, derive a readable title from the stream link
        if (!title) {
          try {
            const u = new URL(link);
            const id = decodeURIComponent(u.searchParams.get('id') || '');
            title = (id.split('/').pop() || '').replace(/\.mp3$/i, '').trim();
          } catch (err) {}
        }

        try { playSpecificSong(link, title, '', artist, ''); } catch (err) {}
        return;
      }
    }, true);
  }

	
}
		
// ✅ Fix the X button crash + use it to show recent clicked items

function clearSearch(){
  const input = document.getElementById('global-search');
  if (input) input.value = '';
  try { if (input) input.blur(); } catch (e) {}
  try { renderSearchClickRecents(); } catch (e) {}
}

// Some older markup calls exitSearch(); keep it from crashing too.
function exitSearch(){
  clearSearch();
}

// ✅ Swipe-down on Search: dismiss keyboard + show recent clicked items
function initSearchSwipeDownDismiss(){
  if (window.__searchSwipeDownDismissInstalled) return;
  window.__searchSwipeDownDismissInstalled = true;

  const root = document.getElementById('search-view');
  if (!root) return;

  let startX = 0, startY = 0, active = false;

  root.addEventListener('touchstart', (e) => {
    if (!e.touches || !e.touches[0]) return;

    // only trigger when the main scroll area is already at the top
    try {
      const sc = document.getElementById('main-scroll-area');
      if (sc && sc.scrollTop > 0) { active = false; return; }
    } catch (err) {}

    active = true;
    startX = e.touches[0].clientX;
    startY = e.touches[0].clientY;
  }, { passive: true });

  root.addEventListener('touchend', (e) => {
    if (!active) return;
    active = false;

    const t = (e.changedTouches && e.changedTouches[0]) ? e.changedTouches[0] : null;
    if (!t) return;

    const dx = t.clientX - startX;
    const dy = t.clientY - startY;

    if (dy > 70 && Math.abs(dx) < 40) {
      clearSearch();
    }
  }, { passive: true });
}

// ✅ Dismiss keyboard as soon as user starts scrolling Search results
function initSearchSwipeToDismissOnce(){
  if (window.__searchSwipeToDismissOnceInstalled) return;
  window.__searchSwipeToDismissOnceInstalled = true;

  const sc = document.getElementById('main-scroll-area');
  if (!sc) return;

  const blurIfSearch = () => {
    try {
      if (!window.navCurrent || window.navCurrent.type !== 'search') return;
      const input = document.getElementById('global-search');
      if (input && document.activeElement === input) input.blur();
    } catch (e) {}
  };

  // iOS: touchmove is the earliest reliable signal
  sc.addEventListener('touchmove', blurIfSearch, { passive: true });

  // Also handle normal scroll
  sc.addEventListener('scroll', blurIfSearch, { passive: true });
}

try { setTimeout(initSearchSwipeDownDismiss, 0); } catch (e) {}


function handleSearch(query) {

          const results = document.getElementById('search-results');
          if (!results) return;

          const raw = String(query || "");
                    if (!raw.trim()) {
  // ✅ make sure the Search page results box is visible
  try { results.classList.remove('hidden'); } catch (e) {}
  try { results.style.display = 'block'; } catch (e) {}

  try { loadSearchClickRecents(); } catch (e) {}
  renderSearchClickRecents();
  return;
}

         const q = raw.trim();

          // 1-2 chars: fast includes(); 3+ chars: fuzzy with threshold 55
          const qNorm = (typeof normalizeForSearch === 'function') ? normalizeForSearch(q) : q.toLowerCase();
          const isShort = qNorm.length <= 2;
          const scoreThreshold = isShort ? 0 : 55;

          const quickMatch = (field) => {
            const f = (typeof normalizeForSearch === 'function') ? normalizeForSearch(field) : String(field || '').toLowerCase();
            return f.includes(qNorm);
          };
          const startsMatch = (field) => {
            const f = (typeof normalizeForSearch === 'function') ? normalizeForSearch(field) : String(field || '').toLowerCase();
            return f.startsWith(qNorm);
          };

          let matches = [];
            const albumMatches = new Map();
          const artistMatches = new Map();

          // Search across song title, artist, album
          libraryData.forEach(album => {
            const albumName = album.albumName || '';
            const artistName = album.artistName || '';

            album.songs.forEach(song => {
              const songName = song.name || '';

              let score;
              if (isShort) {
                if (quickMatch(songName)) score = startsMatch(songName) ? 95 : 85;
                else if (quickMatch(artistName) || quickMatch(albumName)) score = 65;
                else score = 0;
              } else {
              const sTitle = fuzzyScore(q, songName);
              const sArtist = fuzzyScore(q, artistName);
              const sAlbum = fuzzyScore(q, albumName);
              // Let title be strongest; artist/album slightly weaker
              score = Math.max(sTitle, Math.round(sArtist * 0.90), Math.round(sAlbum * 0.85));
              }

              // Threshold: typo-tolerant but avoids junk
              if (score >= scoreThreshold) {
                matches.push({
                    type: 'song',
                  ...song,
                 album: (albumName && albumName !== 'Unknown Album') ? albumName : '',

artist: artistName,
                  cover: (typeof getSongCoverFromPlaylistSong === 'function' ? getSongCoverFromPlaylistSong(song) : '') || album.coverArt || '',

coverArt: album.coverArt || '',
_score: score

                });
              }
            });

              let albumScore;
              if (isShort) {
                if (quickMatch(albumName)) albumScore = startsMatch(albumName) ? 95 : 85;
                else if (quickMatch(artistName)) albumScore = 65;
                else albumScore = 0;
              } else {
              albumScore = Math.max(fuzzyScore(q, albumName), Math.round(fuzzyScore(q, artistName) * 0.75));
              }
            if (albumScore >= scoreThreshold && albumName) {
              const existing = albumMatches.get(albumName);
              if (!existing || (existing._score || 0) < albumScore) {
                albumMatches.set(albumName, {
                  type: 'album',
                  album: albumName,
                  artist: artistName,
                  cover: album.coverArt,
                  _score: albumScore
                });
              }
            }

            if (artistName) {
              const artistScore = isShort ? (quickMatch(artistName) ? (startsMatch(artistName) ? 100 : 90) : 0) : fuzzyScore(q, artistName);
              if (artistScore >= scoreThreshold) {
                const existingArtist = artistMatches.get(artistName);
                if (!existingArtist || (existingArtist._score || 0) < artistScore) {
                  artistMatches.set(artistName, {
                    type: 'artist',
                    artist: artistName,
                    _score: artistScore
                  });
                }
              }
            }
          });
            
 const playlistMatches = (Array.isArray(playlists) ? playlists : [])
  .map(pl => {
    const score = isShort ? (quickMatch(pl.name || '') ? (startsMatch(pl.name || '') ? 100 : 90) : 0) : fuzzyScore(q, pl.name || '');
    if (score < scoreThreshold) return null;

    // ✅ include cover so the row renderer can show an image
    const cover = (typeof getEffectivePlaylistCover === 'function')
      ? String(getEffectivePlaylistCover(pl) || '').trim()
      : (pl && pl.cover ? String(pl.cover).trim() : '');

    return {
      type: 'playlist',
      id: pl.id,
      name: pl.name || 'Playlist',
      cover,
      _score: score
    };
  })
  .filter(Boolean);

          // ✅ Also allow searching songs that only exist inside playlists (trackIds),
          // even if they are not present in libraryData yet.
          try {
            const playlistSongMatches = [];
            const seenIds = new Set();

            for (const pl of (Array.isArray(playlists) ? playlists : [])) {
              const ids = Array.isArray(pl?.trackIds) ? pl.trackIds : [];
              for (const rawId of ids) {
                const id = String(rawId || "").trim();
                if (!id || seenIds.has(id)) continue;
                seenIds.add(id);

                const parts = id.split('/').filter(Boolean);
                const artistGuess = parts[0] || "";
                const albumGuess = (parts.length >= 3) ? parts[1] : "";
                const file = parts[parts.length - 1] || "";
                const titleGuess = file.replace(/\.[^/.]+$/, "");

                const sTitle = fuzzyScore(q, titleGuess);
                const sArtist = fuzzyScore(q, artistGuess);
                const sAlbum = albumGuess ? fuzzyScore(q, albumGuess) : 0;
                const score = Math.max(sTitle, Math.round(sArtist * 0.90), Math.round(sAlbum * 0.85));

                if (score < 55) continue;

                let resolved = null;
                try {
                  if (typeof resolveTrackIdsToSongs === 'function') {
                    const arr = resolveTrackIdsToSongs([id]);
                    if (arr && arr[0]) resolved = arr[0];
                  }
                } catch (_) {}

                const songObj = resolved || {};
                playlistSongMatches.push({
                  type: 'song',
                  _score: score,
                  id: songObj.id || id,
                  r2Path: songObj.r2Path || songObj.id || id,
                  name: songObj.title || songObj.name || titleGuess,
                  title: songObj.title || songObj.name || titleGuess,
                  artist: songObj.artistName || songObj.artist || artistGuess,
                  album: songObj.albumName || songObj.album || albumGuess || '',
                  cover: (typeof getSongCoverFromPlaylistSong === 'function' ? getSongCoverFromPlaylistSong(songObj && Object.keys(songObj).length ? songObj : { id }) : '') || songObj.coverArt || songObj.cover || '',
                  coverArt: (typeof getSongCoverFromPlaylistSong === 'function' ? getSongCoverFromPlaylistSong(songObj && Object.keys(songObj).length ? songObj : { id }) : '') || songObj.coverArt || songObj.cover || '',

                  link: songObj.link || songObj.url || ((window.WORKER_ORIGIN || location.origin) + "/?id=" + encodeURIComponent(id)),
                });
              }
            }

            if (playlistSongMatches.length) {
              const have = new Set(matches.map(m => String(m.id || m.r2Path || '').trim()).filter(Boolean));
              for (const m of playlistSongMatches) {
                const k = String(m.id || m.r2Path || '').trim();
                if (!k || have.has(k)) continue;
                have.add(k);
                matches.push(m);
              }
            }
          } catch (_) {}



          const albumResults = [...albumMatches.values()];
          const artistResults = [...artistMatches.values()];

          // Best first
matches.sort((a, b) => b._score - a._score);

// ✅ De-dupe song matches by link/url (prevents repeated rows)
try {
  const seen = new Set();
  matches = matches.filter(s => {
    const k = String(s.link || s.url || s.songUrl || '').trim();
    if (!k) return true;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
} catch (e) {}

             albumResults.sort((a, b) => b._score - a._score);
          artistResults.sort((a, b) => b._score - a._score);
          playlistMatches.sort((a, b) => b._score - a._score);

          if (matches.length === 0 && albumResults.length === 0 && artistResults.length === 0 && playlistMatches.length === 0) {
            results.innerHTML = `<p class="text-zinc-500">No results found for "${q}"</p>`;
            return;
          }

          results.innerHTML = '';

          // --- Typeahead suggestions (appear above results) ---
          try {
            const __sugSeen = new Set();
            const __sugs = [];
            // from recent typed searches
            for (const __term of loadSearchRecents()) {
              const __t = String(__term || '').trim();
              if (__t && __t.toLowerCase().startsWith(qNorm) && !__sugSeen.has(__t.toLowerCase())) {
                __sugSeen.add(__t.toLowerCase());
                __sugs.push(__t);
              }
            }
            // from recently clicked items (artist/playlist/album names)
            for (const __r of loadSearchClickRecents()) {
              const __t = String(__r.title || __r.name || '').trim();
              if (__t && __t.toLowerCase().startsWith(qNorm) && !__sugSeen.has(__t.toLowerCase())) {
                __sugSeen.add(__t.toLowerCase());
                __sugs.push(__t);
              }
            }
            __sugs.slice(0, 4).forEach(__sug => {
              const __row = document.createElement('div');
              __row.className = 'flex items-center gap-4 px-4 py-3 rounded-lg cursor-pointer hover:bg-zinc-900';
              const __icon = document.createElement('div');
              __icon.className = 'w-10 h-10 rounded-full bg-zinc-800 flex items-center justify-center flex-shrink-0';
              __icon.innerHTML = '<i class="fas fa-search text-zinc-400 text-sm"></i>';
              const __txt = document.createElement('div');
              __txt.className = 'text-base flex-1 truncate';
              const __typedPart = String(q).replace(/</g, '&lt;');
              const __restPart = __sug.slice(q.length).replace(/</g, '&lt;');
              __txt.innerHTML = `<span style="color:#71717a">${__typedPart}</span><span style="color:#fff;font-weight:600">${__restPart}</span>`;
              __row.appendChild(__icon);
              __row.appendChild(__txt);
              __row.addEventListener('click', () => {
                const __inp = document.getElementById('global-search');
                if (__inp) { __inp.value = __sug; }
                handleSearch(__sug);
              });
              results.appendChild(__row);
            });
          } catch (__e) {}

            const appendSection = (title) => {
            const section = document.createElement('div');
            section.className = 'px-2 pt-2 pb-1 text-xs font-black text-zinc-400 uppercase tracking-widest';
            section.textContent = title;
            results.appendChild(section);
          };

          const appendSongRow = (s) => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-4 p-2 rounded-lg hover:bg-zinc-900 cursor-pointer group';

            row.addEventListener('click', () => {
              // Mobile top label: ".... in Search"
              playContext = { type: 'search', label: q };

              {
  // ✅ Compute a real cover for playlist/search edge cases
  let cover = "";
  try {
    if (typeof getSongCoverFromPlaylistSong === "function") {
      cover = String(getSongCoverFromPlaylistSong(s) || "").trim();
    }
  } catch (e) {}

  // keep s.cover in sync for anything else that reads it later
  try { s.cover = cover || s.cover; } catch (e) {}

  try {
    pushSearchClickRecent({
      type: 'song',
      link: String(s.link || ''),
      title: String(s.name || ''),
      subtitle: String((s.artist || '') + (s.album ? (' • ' + s.album) : '')),
      cover: String(cover || s.cover || '')
    });
  } catch (e) {}

  playSpecificSong(s.link, s.name, s.album, s.artist, cover);

}

            });

            const img = document.createElement('img');

const cover = (typeof getAlbumCover === 'function')
  ? getAlbumCover(s.artist || '', s.album || '', s.coverArt || s.cover || '')
  : (s.coverArt || s.cover || '');

// ✅ Never leave src empty (empty src becomes your site URL)

img.src = cover || 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%20viewBox%3D%220%200%2048%2048%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20rx%3D%2212%22%20fill%3D%22%23272a2f%22%2F%3E%3Cpath%20d%3D%22M20%2018h8v12h-8z%22%20fill%3D%22%234a4f57%22%2F%3E%3Cpath%20d%3D%22M22%2020h4v8h-4z%22%20fill%3D%22%23666c76%22%2F%3E%3C%2Fsvg%3E';
img.onerror = () => {
  img.onerror = null;
  img.src = 'data:image/svg+xml;charset=utf-8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%20width%3D%2248%22%20height%3D%2248%22%20viewBox%3D%220%200%2048%2048%22%3E%3Crect%20width%3D%2248%22%20height%3D%2248%22%20rx%3D%2212%22%20fill%3D%22%23272a2f%22%2F%3E%3Cpath%20d%3D%22M20%2018h8v12h-8z%22%20fill%3D%22%234a4f57%22%2F%3E%3Cpath%20d%3D%22M22%2020h4v8h-4z%22%20fill%3D%22%23666c76%22%2F%3E%3C%2Fsvg%3E';
};

img.className = 'w-12 h-12 rounded object-cover';


            const info = document.createElement('div');
            info.className = 'flex-1 overflow-hidden';

            const title = document.createElement('div');
            title.className = 'text-white font-bold truncate';
            title.textContent = (String(s.name || s.title || s.track || s.filename || s.file || s.path || '')).replace(/\.mp3$/i,'');


                        const meta = document.createElement('div');
            meta.className = 'text-sm text-zinc-400 truncate';

            // 🔧 derive real album name when "Unknown Album"
let albumLabel = String(s.album || '').trim();

if (!albumLabel || albumLabel === 'Unknown Album') {
  try {
    const link = String(s.link || '');
    const m = link.match(/[?&]id=([^&]+)/);
    if (m && m[1]) {
      const decoded = decodeURIComponent(m[1]);
      const parts = decoded.split('/').filter(Boolean);
      if (parts.length >= 3) {
        albumLabel = parts[1]; // Artist / Album / Track
        s.album = albumLabel;  // keep it in sync everywhere
      }
    }
  } catch (e) {}
}

meta.textContent =
  s.artist
    ? `Song \u2022 ${s.artist}`
    : 'Song';


            const icon = document.createElement('i');
            icon.className = 'fas fa-play opacity-0 group-hover:opacity-100 text-zinc-400';


            info.appendChild(title);
            info.appendChild(meta);
            row.appendChild(img);
            row.appendChild(info);
            // ✅ stable key for de-dupe + menu
            try { row.setAttribute('data-song-url', String(s.link || s.url || s.songUrl || '')); } catch (e) {}

            // ✅ add ⋯ menu button (same menu system as recents)
            try {
              const dotsBtn = document.createElement('button');
              dotsBtn.type = 'button';
              dotsBtn.className = 'search-recent-btn search-recent-dots';
              dotsBtn.setAttribute('aria-label','More');
              dotsBtn.textContent = '⋯';

              dotsBtn.addEventListener('click', (ev) => {
                try { ev.preventDefault(); ev.stopPropagation(); } catch (err) {}
                try {
                  if (typeof window.showContextMenuAt !== 'function') return;
                  const r = dotsBtn.getBoundingClientRect();
                  const x = Math.round(r.left + r.width/2);
                  const y = Math.round(r.top + r.height/2);

                  const songObj = {
                    type: 'song',
                    url: String(s.link || s.url || ''),
                    link: String(s.link || s.url || ''),
                    title: String(s.name || s.title || '').replace(/\.mp3$/i,''),
                    artist: String((s.artist || '') + (s.album ? (' • ' + s.album) : '')),
                    cover: String(s.cover || s.coverArt || '')
                  };

                  window.showContextMenuAt(x, y, songObj, row);
                } catch (err) { console.warn('dots failed', err); }
              });

              // right-side actions (⋯ then play icon)
              row.appendChild(dotsBtn);
            } catch (e) {}

            row.appendChild(icon);
            results.appendChild(row);

          };

          const appendAlbumRow = (album) => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-4 p-2 rounded-lg hover:bg-zinc-900 cursor-pointer group';
                        row.addEventListener('click', () => {
              // save as a "recent clicked" item
              let c = '';
              try {
                c = (typeof getAlbumCover === 'function')
                  ? String(getAlbumCover(album.artist || '', album.album || '', album.cover || album.coverArt || '') || '')
                  : String(album.cover || album.coverArt || '');
              } catch (e) {}

              pushSearchClickRecent({
                type: 'album',
                id: String(album.album || ''),
                title: String(album.album || ''),
                subtitle: String(album.artist || ''),
                cover: String(c || '')
              });

              openAlbumByName(album.album);
            });


            const img = document.createElement('img');
            const cover = (typeof getAlbumCover === 'function')
  ? getAlbumCover(album.artist || '', album.album || '', album.cover || album.coverArt || '')
  : (album.cover || album.coverArt || '');

img.src = cover || '';

            img.className = 'w-12 h-12 rounded object-cover';

            const info = document.createElement('div');
            info.className = 'flex-1 overflow-hidden';

            const title = document.createElement('div');
            title.className = 'text-white font-bold truncate';
            title.textContent = album.album;

            const meta = document.createElement('div');
            meta.className = 'text-sm text-zinc-400 truncate';
            meta.textContent = album.artist ? `Album \u2022 ${album.artist}` : 'Album';

            info.appendChild(title);
            info.appendChild(meta);
            row.appendChild(img);
            row.appendChild(info);
            results.appendChild(row);
          };

          const appendArtistRow = (artist) => {
  const row = document.createElement('div');
  row.className = 'flex items-center gap-4 p-2 rounded-lg hover:bg-zinc-900 cursor-pointer group';
  row.addEventListener('click', () => {
    // Mark this as explicit artist engagement (searched/clicked artist row).
    try { window.__fromArtistView = String(artist.artist || '').trim(); } catch (e) {}
    openArtistByName(artist.artist);
  });

  const iconWrap = document.createElement('div');
  iconWrap.className = 'w-12 h-12 rounded-full bg-zinc-800 flex items-center justify-center overflow-hidden flex-shrink-0';
  if (typeof window.hydrateArtistPortraitElement === 'function') {
    window.hydrateArtistPortraitElement(iconWrap, artist.artist);
  } else {
    iconWrap.innerHTML = '<span class="w-full h-full rounded-full bg-white/10 flex items-center justify-center"><i class="fas fa-user text-zinc-400"></i></span>';
  }


            const info = document.createElement('div');
            info.className = 'flex-1 overflow-hidden';

            const title = document.createElement('div');
            title.className = 'text-white font-bold truncate';
            title.textContent = artist.artist;

            const meta = document.createElement('div');
            meta.className = 'text-sm text-zinc-400 truncate';
            meta.textContent = 'Artist';

            info.appendChild(title);
            info.appendChild(meta);
            row.appendChild(iconWrap);
            row.appendChild(info);
            results.appendChild(row);
          };

          const appendPlaylistRow = (playlist) => {
            const row = document.createElement('div');
            row.className = 'flex items-center gap-4 p-2 rounded-lg hover:bg-zinc-900 cursor-pointer group';
            row.addEventListener('click', () => {
              // save as a "recent clicked" item
              let c = '';
              try {
                c = String(playlist.cover || playlist.coverUrl || playlist.cover_url || '') || '';
              } catch (e) {}

              pushSearchClickRecent({
                type: 'playlist',
                id: String(playlist.id || ''),
                title: String(playlist.name || ''),
                subtitle: 'Playlist',
                cover: String(c || '')
              });

              const idx = playlists.findIndex(p => p.id === playlist.id);
              if (idx !== -1) showView('playlist', idx);
            });

            const iconWrap = document.createElement('div');
iconWrap.className = 'w-12 h-12 rounded overflow-hidden flex-shrink-0';

const fullPl = (Array.isArray(playlists) ? playlists : []).find(p => p.id === playlist.id) || playlist;
if (typeof getPlaylistCoverMarkup === 'function') {
  iconWrap.innerHTML = getPlaylistCoverMarkup(fullPl, 'w-full h-full');
} else {
  const cover = String(playlist.cover || '').trim();
  if (cover) {
    const img = document.createElement('img');
    img.src = cover;
    img.alt = '';
    img.className = 'w-full h-full object-cover';
    iconWrap.appendChild(img);
  } else {
    const icon = document.createElement('i');
    icon.className = 'fas fa-list-ul text-zinc-400 text-lg';
    iconWrap.appendChild(icon);
  }
}


const info = document.createElement('div');

            info.className = 'flex-1 overflow-hidden';

            const title = document.createElement('div');
            title.className = 'text-white font-bold truncate';
            title.textContent = playlist.name;

            const meta = document.createElement('div');
            meta.className = 'text-sm text-zinc-400 truncate';
            meta.textContent = 'Playlist';

            info.appendChild(title);
            info.appendChild(meta);
            row.appendChild(iconWrap);
            row.appendChild(info);
            results.appendChild(row);
          };

         // Remember latest typed query for recents
window.__lastSearchQuery = q;

// Decide primary result type (best top score)
const topAlbum = albumResults[0] || null;
const topArtist = artistResults[0] || null;
const topPlaylist = playlistMatches[0] || null;

const topType = (() => {
  const a = topAlbum?._score || 0;
  const ar = topArtist?._score || 0;
  const p = topPlaylist?._score || 0;
  const best = Math.max(a, ar, p);
  if (best === 0) return null;

  // tie-break: playlist > album > artist (feels best for "big booty bitches" type queries)
  if (p === best) return 'playlist';
  if (a === best) return 'album';
  return 'artist';
})();

// Helper to push recents ONLY when user clicks something
const markSearched = () => {
  try { pushSearchRecent(window.__lastSearchQuery || q); } catch (e) {}
};

// Build "related" ordering for songs based on primary
let songsOrdered = matches.slice(0);
if (topType === 'album' && topAlbum?.album) {
  const name = String(topAlbum.album);
  songsOrdered.sort((s1, s2) => {
    const a1 = (String(s1.album || '') === name) ? 1 : 0;
    const a2 = (String(s2.album || '') === name) ? 1 : 0;
    if (a1 !== a2) return a2 - a1;
    return (s2._score || 0) - (s1._score || 0);
  });
} else if (topType === 'artist' && topArtist?.artist) {
  const name = String(topArtist.artist);
  songsOrdered.sort((s1, s2) => {
    const a1 = (String(s1.artist || '') === name) ? 1 : 0;
    const a2 = (String(s2.artist || '') === name) ? 1 : 0;
    if (a1 !== a2) return a2 - a1;
    return (s2._score || 0) - (s1._score || 0);
  });
} else if (topType === 'playlist' && topPlaylist?.id) {
  // For playlist-first: prioritize songs that are in that playlist (if we can resolve them)
  const pl = (Array.isArray(playlists) ? playlists : []).find(x => x.id === topPlaylist.id);
  const ids = Array.isArray(pl?.trackIds) ? pl.trackIds : [];
  const idSet = new Set(ids.map(x => String(x)));
  songsOrdered.sort((s1, s2) => {
    const a1 = idSet.has(String(s1.id || s1.track_id || s1.r2Path || s1.link || '')) ? 1 : 0;
    const a2 = idSet.has(String(s2.id || s2.track_id || s2.r2Path || s2.link || '')) ? 1 : 0;
    if (a1 !== a2) return a2 - a1;
    return (s2._score || 0) - (s1._score || 0);
  });
}

// If nothing matched at all, show empty state
if (!songsOrdered.length && !albumResults.length && !artistResults.length && !playlistMatches.length) {
  results.innerHTML = `<div class="px-4 py-4 text-sm text-zinc-400">No results for "${String(q).replace(/</g,'&lt;')}"</div>`;
} else {
  // --- Personalization signals ---

  // 1. Playlist membership: songs in more of your playlists rank higher
  const plMembership = new Map();
  try {
    for (const pl of (Array.isArray(playlists) ? playlists : [])) {
      for (const rawId of (Array.isArray(pl.trackIds) ? pl.trackIds : [])) {
        const k = String(rawId || '').trim();
        if (k) plMembership.set(k, (plMembership.get(k) || 0) + 1);
      }
    }
  } catch (e) {}

  // 2. Recently clicked in search = strong familiarity signal
  const recentClickSet = new Set();
  const recentClickArtists = new Set();
  try {
    for (const r of loadSearchClickRecents()) {
      const id = String(r.id || r.link || '').trim();
      if (id) recentClickSet.add(id);
      if (r.type === 'artist' && r.title) recentClickArtists.add(String(r.title).trim().toLowerCase());
    }
  } catch (e) {}

  // Personal relevance bonus for a song (0-40 extra points)
  const songBonus = (s) => {
    let bonus = 0;
    const ids = [s.id, s.r2Path, s.track_id, s.link].map(x => String(x || '').trim()).filter(Boolean);
    const memberCount = Math.max(0, ...ids.map(k => plMembership.get(k) || 0));
    bonus += Math.min(memberCount * 5, 20); // up to +20 for playlist membership
    if (ids.some(k => recentClickSet.has(k))) bonus += 20; // +20 for recently clicked
    return bonus;
  };

  const allItems = [
    ...artistResults.map(x => {
      let r = (x._score || 0) * 1.4;
      if (recentClickArtists.has(String(x.artist || '').trim().toLowerCase())) r += 28;
      return { ...x, _type: 'artist', _ranked: r };
    }),
    ...albumResults.map(x => ({ ...x, _type: 'album',    _ranked: (x._score || 0) * 1.2 })),
    ...playlistMatches.map(x => ({ ...x, _type: 'playlist', _ranked: (x._score || 0) * 1.1 })),
    ...songsOrdered.map(x => ({ ...x, _type: 'song',     _ranked: (x._score || 0) + songBonus(x) }))
  ];
  allItems.sort((a, b) => (b._ranked || 0) - (a._ranked || 0));

  // Diversity cap: max 3 artists, 3 albums, 2 playlists — songs fill the rest
  const typeCaps = { artist: 3, album: 3, playlist: 4, song: Infinity };
  const typeCounts = { artist: 0, album: 0, playlist: 0, song: 0 };
  const shown = [];
  for (const item of allItems) {
    if (shown.length >= 40) break;
    const t = item._type;
    if ((typeCounts[t] || 0) < typeCaps[t]) {
      shown.push(item);
      typeCounts[t] = (typeCounts[t] || 0) + 1;
    }
  }
  // Second pass: fill remaining slots with any skipped items
  if (shown.length < 40) {
    for (const item of allItems) {
      if (shown.length >= 40) break;
      if (!shown.includes(item)) shown.push(item);
    }
  }

  shown.forEach(item => {
    if (item._type === 'artist') appendArtistRow(item);
    else if (item._type === 'album') appendAlbumRow(item);
    else if (item._type === 'playlist') appendPlaylistRow(item);
    else appendSongRow(item);
  });
}

        }
function clearSearch() {
  const input = document.getElementById('global-search');
  if (input) {
    input.value = '';
    try { input.focus(); } catch (e) {}
  }

  // ✅ when search is empty, show Search-click recents immediately
  try { handleSearch(''); } catch (e) {}
  try { renderSearchClickRecents(); } catch (e) {}

  // Also clear saved search state
  try {
    window.__globalSearchState = { q: "", scrollTop: 0 };
  } catch (e) {}
}

// Back-compat (in case any older button still calls this)
function exitSearch() { clearSearch(); }


// ------------------------------
// ✅ SEARCH PERSIST + BLUR ON SCROLL (MOBILE)
// ------------------------------
(function installGlobalSearchPersistAndBlur(){
  if (window.__globalSearchPersistInstalled) return;
  window.__globalSearchPersistInstalled = true;

  // Saved state for Search tab
  window.__globalSearchState = window.__globalSearchState || { q: "", scrollTop: 0 };

  const getMain = () => document.getElementById('main-scroll-area');
  const getInput = () => document.getElementById('global-search');

  const saveState = (why) => {
    try {
      if (!window.navCurrent || window.navCurrent.type !== 'search') return;
      const input = getInput();
      const main = getMain();
      window.__globalSearchState.q = input ? String(input.value || '') : '';
      window.__globalSearchState.scrollTop = main ? Number(main.scrollTop || 0) : 0;
      // console.log("✅ saved search state:", why, window.__globalSearchState);
    } catch (e) {}
  };

  const restoreState = () => {
    try {
      const st = window.__globalSearchState || { q: "", scrollTop: 0 };
      const input = getInput();

      // Re-run search so results render again (fixes "blank page with query still shown")
      if (input && st.q) {
        input.value = st.q;
        try { handleSearch(st.q); } catch (e) {}
      }

      // Restore scroll after results render (do it twice to beat late DOM mutations)
      setTimeout(() => {
        const main = getMain();
        if (main) main.scrollTop = Number(st.scrollTop || 0);
      }, 0);

      setTimeout(() => {
        const main = getMain();
        if (main) main.scrollTop = Number(st.scrollTop || 0);
      }, 120);
    } catch (e) {}
  };

  // 1) Hide keyboard when user starts scrolling results (mobile)
  // (Blur only if Search input is currently focused)
  const bindBlurOnScroll = () => {
    const main = getMain();
    if (!main || main.__searchBlurBound) return;
    main.__searchBlurBound = true;

    main.addEventListener('scroll', () => {
      try {
        if (!window.navCurrent || window.navCurrent.type !== 'search') return;
        const input = getInput();
        if (input && document.activeElement === input) input.blur();
      } catch (e) {}
    }, { passive: true });
  };

  // 2) Persist search when navigating away + restore when coming back
  const installWraps = () => {
    if (typeof window.showView !== 'function') {
      setTimeout(installWraps, 50);
      return;
    }
    if (window.showView.__searchPersistWrapped) return;

    const origShowView = window.showView;
    window.showView = function(...args) {
      const target = args[0];

      // Save *before* leaving search
      try {
        if (window.navCurrent && window.navCurrent.type === 'search' && target !== 'search') {
          saveState('leaving search');
        }
      } catch (e) {}

      const out = origShowView.apply(this, args);

      // Restore *after* entering search
      try {
        if (target === 'search') {
          bindBlurOnScroll();
          restoreState();
        }
      } catch (e) {}

      return out;
    };

    window.showView.__searchPersistWrapped = true;

    // Also bind blur-on-scroll immediately if you're already in search
    bindBlurOnScroll();
  };

  installWraps();

  // Extra: save on taps inside search (before navigation handlers fire)
  if (!document.__globalSearchSaveTapBound) {
    document.__globalSearchSaveTapBound = true;
    document.addEventListener('click', () => saveState('click'), true);
    document.addEventListener('pointerdown', () => saveState('pointerdown'), true);
  }
})();


// ✅ Persist Search: keep query + scroll position when opening a result and going back
(function installSearchPersistenceFinal(){
  if (window.__searchPersistFinalInstalled) return;
  window.__searchPersistFinalInstalled = true;

  window.__searchState = window.__searchState || { q: "", scrollTop: 0 };

  const getSearchInput = () => document.getElementById('global-search');

  const getSearchScrollEl = () => {
    const seen = new Set();
    const list = [];

    const push = (el) => {
      if (!el || !el.nodeType) return;
      if (seen.has(el)) return;
      seen.add(el);
      list.push(el);
    };

    // Common candidates
    push(document.getElementById('main-scroll-area'));
    push(document.getElementById('search-view'));
    push(document.getElementById('search-results'));
    push(document.getElementById('search-results-inner'));

    // Any obvious scroll containers inside search
    try {
      document.querySelectorAll('#search-view .overflow-auto, #search-view .overflow-y-auto, #search-view [data-scroll], #search-view .scroll')
        .forEach(push);
    } catch (e) {}

    // Pick a real scroll container (largest scrollHeight that can scroll)
    let best = null;
    let bestScore = -1;

    for (const el of list) {
      try {
        const sh = el.scrollHeight || 0;
        const ch = el.clientHeight || 0;
        const canScroll = (sh - ch) > 50;
        if (!canScroll) continue;
        if (sh > bestScore) { bestScore = sh; best = el; }
      } catch (e) {}
    }

    return best || document.getElementById('main-scroll-area');
  };

  const saveSearchStateNow = (why) => {
    try {
      if (!window.navCurrent || window.navCurrent.type !== 'search') return;
      const q = String(getSearchInput()?.value || "");
      const scroller = getSearchScrollEl();
      const st = scroller ? Number(scroller.scrollTop || 0) : 0;
      window.__searchState.q = q;
      window.__searchState.scrollTop = st;
      // console.log("✅ saved search (" + why + "):", { q, scrollTop: st });
    } catch (e) {}
  };

  const restoreSearchState = (label) => {
    try {
      const st = window.__searchState || { q: "", scrollTop: 0 };
      const input = getSearchInput();

      if (input && st.q) {
        input.value = st.q;
        try { window.handleSearch(st.q); } catch (e) {}
      }

      const scroller = getSearchScrollEl();
      if (scroller) scroller.scrollTop = Number(st.scrollTop || 0);

      // console.log("✅ restored search (" + label + "):", { ...st, scroller: scroller && scroller.id });
    } catch (e) {}
  };

  // Save BEFORE navigation (capture phase)
  if (!document.__searchPersistSaveClickBound) {
    document.__searchPersistSaveClickBound = true;
    document.addEventListener('click', () => saveSearchStateNow('click'), true);
  }

  // Save while scrolling in search (capture phase)
  if (!document.__searchPersistSaveScrollBound) {
    document.__searchPersistSaveScrollBound = true;
    document.addEventListener('scroll', () => saveSearchStateNow('scroll'), true);
  }

    // Wrap showView so Search restore happens AFTER re-render (multiple passes)
  const origShowView = window.showView;
  if (typeof origShowView === 'function' && !origShowView.__wrappedSearchPersistFinal) {
    window.showView = function(...args) {
      const out = origShowView.apply(this, args);

      // ✅ Keep album grid from leaking into Search / other views
      try {
        const ag = document.getElementById('album-grid');
        if (ag) {
          if (ag.__oldDisplay == null) ag.__oldDisplay = ag.style.display;
          const v = String(args[0] || '').toLowerCase();
          const isDesktopHome = (v === 'home' && window.innerWidth > 768);
          const isLibrary = isDesktopHome || v.includes('grid') || v.includes('library') || v.includes('albums');
          ag.style.display = isLibrary ? (ag.__oldDisplay ?? '') : 'none';
        }
      } catch (e) {}

      const target = args[0];
            if (target === 'search') {
        // ✅ Always show the Search page results container
        try {
          const results = document.getElementById('search-results');
          if (results) {
            results.classList.remove('hidden');
            results.style.display = 'block';
          }
        } catch (e) {}

        // ✅ If query is empty, show click-recents immediately (persisted in localStorage)
        try {
          const input = document.getElementById('global-search');
          const q = String(input?.value || '').trim();
          if (!q && typeof handleSearch === 'function') {
            handleSearch('');
          }
        } catch (e) {}

        // Restore late to beat DOM mutations that reset scrollTop
        setTimeout(() => restoreSearchState('t0'), 0);
        setTimeout(() => restoreSearchState('t120'), 120);
        setTimeout(() => restoreSearchState('t400'), 400);
        setTimeout(() => restoreSearchState('t900'), 900);
      }


      return out;
    };
    window.showView.__wrappedSearchPersistFinal = true;
  }
	
})();
