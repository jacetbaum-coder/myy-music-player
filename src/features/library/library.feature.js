// =============================================================================
// LIBRARY FEATURE (extracted from index.html)
// - Sort/view controls (per-tab sort, grid/list toggle, grid columns)
// - Library tabs (Albums/Playlists/Artists/All)
// - Library rendering (renderLibraryPlaylists, renderLibraryArtists, renderLibraryAll, renderLibraryMain)
// - renderGrid/showView patches for library list view & controls visibility
// - highlightSongInAlbum
//
// Dependencies (must be defined before this script loads):
//   libraryData[], libraryDataOriginal[], playlists[], history[],
//   navCurrent, navStack, renderGrid(), showView(), openAlbumByName(),
//   openArtistByName(), getAlbumCover(), getEffectivePlaylistCover(),
//   renderHistory(), renderMobileRecents(), setHomeSortMode(), setHomeViewMode()
// =============================================================================

        // -----------------------
// LIBRARY: Sort + View + Desktop "Search in Your Library"
// -----------------------
const LIB_SORT_BY_TAB_KEY = 'librarySortByTab';

(function migrateOldLibrarySortOnce(){

  try {
    const old = localStorage.getItem('librarySortMode');
    const hasNew = localStorage.getItem(LIB_SORT_BY_TAB_KEY);
    if (old && !hasNew) {
      const obj = { all: old, playlists: old, albums: old, artists: old };
      localStorage.setItem(LIB_SORT_BY_TAB_KEY, JSON.stringify(obj));
    }
  } catch (e) {}
})();

function normalizeLibraryTabKey(tab) {
  const t = String(tab || '').toLowerCase();
  if (t === 'all' || t === 'playlists' || t === 'albums' || t === 'artists') return t;
  return 'all';
}

function normalizeLibrarySortMode(mode){
  const m = String(mode || '').trim();

  // ✅ Only 3 supported
  if (m === 'Recent' || m === 'Recently added' || m === 'Alphabetical') return m;

  // Back-compat (your current/older UI strings)
  if (m === 'Recents') return 'Recent';
  if (m === 'Alphabetical by artist') return 'Alphabetical';
  if (m === 'Alphabetical by album') return 'Alphabetical';

  return 'Alphabetical';
}

function getLibrarySortModeForTab(tab) {
  const t = normalizeLibraryTabKey(tab);
  try {
    const obj = JSON.parse(localStorage.getItem(LIB_SORT_BY_TAB_KEY) || '{}') || {};
    return normalizeLibrarySortMode(obj[t] || 'Alphabetical');
  } catch (e) {
    return 'Alphabetical';
  }
}

function setLibrarySortModeForTab(tab, mode) {
  const t = normalizeLibraryTabKey(tab);
  const m = normalizeLibrarySortMode(mode);
  try {
    const obj = JSON.parse(localStorage.getItem(LIB_SORT_BY_TAB_KEY) || '{}') || {};
    obj[t] = m;
    localStorage.setItem(LIB_SORT_BY_TAB_KEY, JSON.stringify(obj));
  } catch (e) {}
}

var librarySortMode = getLibrarySortModeForTab('all');

var libraryViewMode = localStorage.getItem('libraryViewMode') || 'grid';

// Used for "Recently added"
libraryDataOriginal = window.libraryDataOriginal || libraryDataOriginal || [];

function setLibrarySortMode(mode) {
  const tab = normalizeLibraryTabKey(libraryTopTab || 'all');

  // ✅ persist per-tab
  setLibrarySortModeForTab(tab, mode);

  // keep this var in sync for any older code paths
  librarySortMode = String(mode || 'Alphabetical');

  // ✅ update label + keep menu options visible
  updateLibrarySortUIForTopTab();

  // If you're currently in Library, re-render the CURRENT tab (Playlists/Albums/Artists/All)
  if (navCurrent && navCurrent.type === 'library') {
    renderLibraryMain();
  }
}


function setLibraryViewMode(mode) {
  libraryViewMode = mode;
  localStorage.setItem('libraryViewMode', mode);

  // If you're currently in Library, re-render the grid
    if (navCurrent && navCurrent.type === 'library') {
    renderLibraryMain(); // ✅ respects Playlists/Albums/Artists/All
    applyLibraryGridCols(); // ✅ re-apply columns after render
  } else {

    // Still keep the slider UI correct if menu is opened later
    applyLibraryGridCols();
  }
}

// ✅ Mobile-only: control how many albums per row in Library grid view
function applyLibraryGridCols() {
  const wrap = document.getElementById('library-grid-cols-wrap');
  const slider = document.getElementById('library-grid-cols');
  const grid = document.getElementById('album-grid');

  const isMobile = window.innerWidth <= 768;
  const isGridMode = (libraryViewMode === 'grid');

// ✅ Toggle list styling on the grid container
if (grid) {
  if (isGridMode) grid.classList.remove('library-list');
  else grid.classList.add('library-list');
}

// Show slider only on mobile + grid view

  if (wrap) wrap.classList.add('hidden'); // always hidden (fixed 3-per-row on mobile)



  if (!isMobile) {
    // desktop: let your tailwind grid-cols classes handle it
    if (grid) grid.style.gridTemplateColumns = '';
    return;
  }

  // mobile list mode: clear any inline grid override
  if (!isGridMode) {
    if (grid) grid.style.gridTemplateColumns = '';
    return;
  }

      // Fixed: always 3 per row on mobile
  let cols = 3;


   // Apply inline grid columns (beats tailwind classes on mobile)
if (grid) {
  grid.style.gridTemplateColumns = 'repeat(3, minmax(0, 1fr))';
}



}

function getLibraryRecentsRank() {

  // history is already most-recent-first; build a rank map so we can sort albums by last listened
  const rank = new Map();
  (Array.isArray(history) ? history : []).forEach((h, idx) => {
    const key = `${h.artist || ''}__${h.album || ''}`;
    if (!rank.has(key)) rank.set(key, idx);
  });
  return rank;
}

function getLibraryGridData() {
  const base = Array.isArray(libraryData) ? libraryData.slice() : [];
  const original = Array.isArray(libraryDataOriginal) && libraryDataOriginal.length
    ? libraryDataOriginal.slice()
    : base.slice();

  // Back-compat for older stored values
  const mode = (function normalize(m) {
    if (m === 'Recents') return 'Recent';
    if (m === 'Alphabetical') return 'Alphabetical by album';
    return m;
  })(librarySortMode);


  if (mode === 'Recently added') {
    return original;
  }

  if (mode === 'Alphabetical by album') {
    return base.sort((a, b) => String(a.albumName || '').localeCompare(String(b.albumName || '')));
  }

  if (mode === 'Alphabetical by artist') {
    return base.sort((a, b) => {
      const aa = String(a.artistName || '').localeCompare(String(b.artistName || ''));
      if (aa !== 0) return aa;
      return String(a.albumName || '').localeCompare(String(b.albumName || ''));
    });
  }

  if (mode === 'Creator') {
    return base.sort((a, b) => {
      const aa = String(a.artistName || '').localeCompare(String(b.artistName || ''));
      if (aa !== 0) return aa;
      return String(a.albumName || '').localeCompare(String(b.albumName || ''));
    });
  }

  if (mode === 'Recent') {
    const rank = getLibraryRecentsRank();
    return base.sort((a, b) => {
      const ka = `${a.artistName || ''}__${a.albumName || ''}`;
      const kb = `${b.artistName || ''}__${b.albumName || ''}`;
      const ra = rank.has(ka) ? rank.get(ka) : 999999;
      const rb = rank.has(kb) ? rank.get(kb) : 999999;
      if (ra !== rb) return ra - rb;
      return String(a.albumName || '').localeCompare(String(b.albumName || ''));
    });
  }

  if (mode === 'Custom order') {
    const stored = JSON.parse(localStorage.getItem('libraryCustomOrder') || 'null');
    if (Array.isArray(stored) && stored.length) {
      const map = new Map(stored.map((name, i) => [name, i]));
      return base.sort((a, b) => {
        const ia = map.has(a.albumName) ? map.get(a.albumName) : 999999;
        const ib = map.has(b.albumName) ? map.get(b.albumName) : 999999;
        if (ia !== ib) return ia - ib;
        return String(a.albumName || '').localeCompare(String(b.albumName || ''));
      });
    } else {
      const names = original.map(a => a.albumName);
      localStorage.setItem('libraryCustomOrder', JSON.stringify(names));
      return original;
    }
  }

  return original;
}

function setLibraryControlsVisibility() {
  const controls = document.getElementById('library-controls');
  if (!controls) return;

  // Show controls only in Library view (both desktop + mobile)
  const isLibrary = (navCurrent && navCurrent.type === 'library');
  controls.classList.toggle('hidden', !isLibrary);

  const hint = document.getElementById('library-controls-hint');
  if (hint) hint.textContent = isLibrary ? '' : '';
}

function initLibraryControls() {
  // Sort dropdown
  const btn = document.getElementById('library-sort-btn');
  const menu = document.getElementById('library-sort-menu');
  const backdrop = document.getElementById('library-sort-backdrop');

  const openSortMenu = () => {
    if (!menu) return;
    menu.classList.remove('hidden');
    menu.classList.add('open');
    if (backdrop) {
      backdrop.classList.remove('hidden');
      backdrop.classList.add('open');
    }
  };

  const closeSortMenu = () => {
    if (!menu) return;
    menu.classList.remove('open');
    menu.classList.add('hidden');
    if (backdrop) {
      backdrop.classList.remove('open');
      backdrop.classList.add('hidden');
    }
  };

  const toggleSortMenu = () => {
    if (!menu) return;
    const isOpen = menu.classList.contains('open') || !menu.classList.contains('hidden');
    if (isOpen) closeSortMenu();
    else openSortMenu();
  };

  // Slider bits
  const colsWrap = document.getElementById('library-grid-cols-wrap');
  const colsSlider = document.getElementById('library-grid-cols');

  // Initialize slider value from storage
  if (colsSlider) {
        let cols = 3;

    try {
            const stored = parseInt(localStorage.getItem('libraryGridCols') || '3', 10);

      if (!Number.isNaN(stored)) cols = Math.min(6, Math.max(1, stored));
    } catch (e) {}
    colsSlider.value = String(cols);

    if (!colsSlider.__bound) {
      colsSlider.__bound = true;
      colsSlider.addEventListener('input', () => {
        const v = Math.min(6, Math.max(1, parseInt(colsSlider.value || '2', 10) || 2));
        localStorage.setItem('libraryGridCols', String(v));
        applyLibraryGridCols(); // live update while dragging
      });
    }
  }

  // Keep it correct on resize / rotation
  if (!window.__libraryGridColsResizeBound) {
    window.__libraryGridColsResizeBound = true;
    window.addEventListener('resize', () => applyLibraryGridCols());
  }

  if (btn && menu) {
    if (!btn.__boundLibrarySortToggle) {
      btn.__boundLibrarySortToggle = true;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        toggleSortMenu();

        // When menu opens, make sure slider visibility + value is correct
        applyLibraryGridCols();
      });
    }

    if (!menu.__boundLibrarySortInside) {
      menu.__boundLibrarySortInside = true;
      menu.addEventListener('click', (e) => e.stopPropagation());
    }

    if (backdrop && !backdrop.__boundLibrarySortClose) {
      backdrop.__boundLibrarySortClose = true;
      backdrop.addEventListener('click', closeSortMenu);
    }

    menu.querySelectorAll('.lib-sort-item').forEach(el => {
      if (el.__boundLibrarySortItem) return;
      el.__boundLibrarySortItem = true;
      el.addEventListener('click', () => {
        const mode = el.getAttribute('data-sort') || 'Recently added';
        if (navCurrent && navCurrent.type === 'home') {
  setHomeSortMode(mode);
} else {
  setLibrarySortMode(mode);
}

        closeSortMenu();
      });
    });

    menu.querySelectorAll('.lib-view-btn').forEach(el => {
      if (el.__boundLibraryViewItem) return;
      el.__boundLibraryViewItem = true;
      el.addEventListener('click', () => {
        const mode = el.getAttribute('data-view') || 'grid';
        if (navCurrent && navCurrent.type === 'home') {
  setHomeViewMode(mode);
} else {
  setLibraryViewMode(mode);
}

        // setLibraryViewMode already calls applyLibraryGridCols()
        closeSortMenu();
      });
    });

    if (!window.__librarySortGlobalCloseBound) {
      window.__librarySortGlobalCloseBound = true;
      window.addEventListener('click', (e) => {
        const target = e && e.target ? e.target : null;
        if (!target) return closeSortMenu();
        if ((btn && btn.contains(target)) || (menu && menu.contains(target))) return;
        closeSortMenu();
      });
      window.addEventListener('keydown', (e) => {
        if (e && e.key === 'Escape') closeSortMenu();
      });
    }
  }

  // Set initial label
  const label = document.getElementById('library-sort-label');
  updateLibrarySortUIForTopTab();


  // Ensure slider state is correct on startup
  applyLibraryGridCols();
}

function updateLibrarySortUIForTopTab() {
  const label = document.getElementById('library-sort-label');
  const menu = document.getElementById('library-sort-menu');

  const tab = normalizeLibraryTabKey(libraryTopTab || 'all');
  const mode = getLibrarySortModeForTab(tab);

  // ✅ Label always shows the saved sort for the CURRENT tab
  if (label) label.textContent = mode;

  if (!menu) return;

  // ✅ Never hide sort options anymore (each tab has its own saved mode)
  const sortItems = menu.querySelectorAll('.lib-sort-item');
  sortItems.forEach(btn => {
    btn.classList.remove('hidden');
    const itemMode = String(btn.getAttribute('data-sort') || '').trim();
    btn.classList.toggle('active', itemMode === mode);
  });
  const headers = menu.querySelectorAll('div.px-4.py-3.text-xs');
  const sortHeader = headers && headers[0] ? headers[0] : null;
  if (sortHeader) sortHeader.classList.remove('hidden');
  const divider = menu.querySelector('div.h-px.bg-white\\/10.my-2');
  if (divider) divider.classList.remove('hidden');
}

function highlightSongInAlbum(songTitle) {

  const wanted = String(songTitle || '').replace('.mp3', '').trim().toLowerCase();
  if (!wanted) return;

  // Wait a tick for the track list to render
  setTimeout(() => {
    const rows = document.querySelectorAll('#track-list .track-row');
    let target = null;

    rows.forEach(r => {
      r.classList.remove('active-track');
      const titleEl = r.querySelector('.track-title') || r.querySelector('[data-title]');
      const text = (titleEl ? titleEl.textContent : r.textContent) || '';
      const clean = text.replace('.mp3', '').trim().toLowerCase();
      if (!target && clean.includes(wanted)) target = r;
    });

    if (target) {
      target.classList.add('active-track');
      target.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }, 60);
}


// Patch renderGrid to support Library "List" view (only when you're in Library)
const __renderGridOriginal = renderGrid;
renderGrid = function(data) {
  const isLibrary = (navCurrent && navCurrent.type === 'library');

  // If not library, keep your existing behavior
  if (!isLibrary || libraryViewMode === 'grid') {
    return __renderGridOriginal(data);
  }

  // Library list view
  const grid = document.getElementById('album-grid');
  if (!grid) return;

  grid.className = 'space-y-2'; // list
  grid.innerHTML = (Array.isArray(data) ? data : []).map((album) => {
    const safeName = String(album.albumName || '').replace(/'/g, "\\'");
    const cover = getAlbumCover(album.artistName, album.albumName, album.coverArt);

    return `
      <div class="flex items-center gap-4 p-3 rounded-lg hover:bg-white/10 cursor-pointer"
           onclick="openAlbumByName('${safeName}')">
        <img src="${cover}" class="w-12 h-12 rounded object-cover">
        <div class="min-w-0 flex-1">
          <div class="text-white font-bold truncate">${(album.tagAlbum || album.albumName || '')}</div>

          <div class="text-zinc-400 text-sm truncate">${album.artistName || ''}</div>
        </div>
        <i class="fas fa-chevron-right text-zinc-500"></i>
      </div>
    `;
  }).join('');
};

const __showViewOriginal = showView;
showView = function(viewType, playlistIndex = null) {
  __showViewOriginal(viewType, playlistIndex);

  // Toggle library controls visibility after view switch
  setLibraryControlsVisibility();

  // If we entered Library, apply sort immediately
  if (navCurrent && navCurrent.type === 'library' && !window.__isBackNav) {
        renderLibraryMain();

  }
};

function renderLibraryPlaylists() {
  const grid = document.getElementById('album-grid');
  if (!grid) return;

  const sortMode = normalizeLibrarySortMode(
    (typeof getLibrarySortModeForTab === 'function')
      ? getLibrarySortModeForTab('playlists')
      : librarySortMode
  );

  let list = Array.isArray(playlists) ? playlists.slice() : [];

  if (sortMode === 'Alphabetical') {
    list.sort((a, b) => {
      const an = String(a?.name || a?.title || '').trim();
      const bn = String(b?.name || b?.title || '').trim();
      return an.localeCompare(bn);
    });
  } else if (sortMode === 'Recent') {
    // historyLog entries include playlists like: { type:'playlist', id, name, cover }
    const rank = new Map();
    try {
      const hist = JSON.parse(localStorage.getItem('historyLog') || '[]') || [];
      (Array.isArray(hist) ? hist : []).forEach((h, i) => {
        if (String(h?.type || '').toLowerCase() !== 'playlist') return;
        const pid = h?.id;
        if (pid != null && !rank.has(String(pid))) rank.set(String(pid), i);
      });
    } catch (e) {}

    list.sort((a, b) => {
      const aid = (a?.id != null) ? String(a.id) : '';
      const bid = (b?.id != null) ? String(b.id) : '';
      const ra = rank.has(aid) ? rank.get(aid) : 1e9;
      const rb = rank.has(bid) ? rank.get(bid) : 1e9;
      if (ra !== rb) return ra - rb;

      const an = String(a?.name || a?.title || '').trim();
      const bn = String(b?.name || b?.title || '').trim();
      return an.localeCompare(bn);
    });
  } else {
    // Recently added: keep existing order
  }

  if (!list.length) {

    grid.innerHTML = `
      <div class="text-zinc-400 font-bold p-4">
        No playlists yet.
      </div>
    `;
    return;
  }

      const isList = (libraryViewMode === 'list');

  grid.innerHTML = list.map((pl, idx) => {
    const name = String(pl?.name || pl?.title || "Untitled Playlist");
    const safeName = name.replace(/</g, "&lt;").replace(/>/g, "&gt;");
    const idOrIdx = (pl && pl.id != null) ? String(pl.id) : String(idx);

    const cover =
      (typeof getEffectivePlaylistCover === "function")
        ? String(getEffectivePlaylistCover(pl) || "").trim()
        : String(pl?.cover || pl?.autoCover || "").trim();

    const coverMarkup = cover
      ? `<img src="${cover}" class="w-full h-full object-cover">`
      : `<i class="fas fa-music text-white/50 text-2xl"></i>`;

    if (isList) {
      return `
        <div class="album-card p-3 flex items-center gap-3 bg-white/5 hover:bg-white/10 rounded-xl"
             data-pl="${idOrIdx}">
          <div class="w-14 h-14 rounded-lg overflow-hidden bg-white/10 flex items-center justify-center flex-shrink-0">
            ${coverMarkup}
          </div>
          <div class="min-w-0">
            <div class="font-bold text-white truncate text-base">
              ${safeName}
            </div>
            <div class="text-sm text-zinc-400 truncate">
              Playlist
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="album-card rounded-lg overflow-hidden"
           data-pl="${idOrIdx}">
        <div class="p-4">
          ${cover ? `<img src="${cover}" style="border-radius:5px;width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">` : `<div style="aspect-ratio:1/1;" class="bg-white/10 rounded-md flex items-center justify-center"><i class="fas fa-music text-white/50 text-2xl"></i></div>`}
        </div>
        <div class="playlist-card-info">
          <h3>${safeName}</h3>
          <p>Playlist</p>
        </div>
      </div>
    `;
  }).join('');



  [...grid.querySelectorAll('.album-card')].forEach(card => {
    card.addEventListener('click', () => {
      const plKey = card.getAttribute('data-pl');
      if (!plKey) return;
      showView('playlist', plKey); // supports id OR index
    });
  });
}


// -----------------------
// LIBRARY: Mobile top tabs (Playlists / Albums / Artists / All)
// -----------------------

// ✅ Always default to "all" on a fresh app open (ignore saved tab)
var libraryTopTab = 'all';
try { localStorage.setItem('libraryTopTab', 'all'); } catch (e) {}
window.libraryTopTab = libraryTopTab;

function getLibraryTabLabel(tab) {

  if (tab === 'playlists') return 'Playlists';
  if (tab === 'albums') return 'Albums';
  if (tab === 'artists') return 'Artists';
  if (tab === 'all') return 'All';
  return 'Albums';
}

function updateMobileLibrarySectionTitle() {
  if (window.innerWidth > 768) return;

  const titleEl = document.getElementById('mobile-library-section-title');
  if (titleEl) {
    titleEl.textContent = getLibraryTabLabel(libraryTopTab);
  }
}

function updateMobileLibraryTabUI() {
  const btnP = document.getElementById('mobile-lib-tab-playlists');
  const btnA = document.getElementById('mobile-lib-tab-albums');
  const btnR = document.getElementById('mobile-lib-tab-artists');
  const btnAll = document.getElementById('mobile-lib-tab-all');
  if (!btnP || !btnA || !btnR || !btnAll) return;

  const base = "px-4 py-2 rounded-full font-extrabold text-sm whitespace-nowrap";
  const onCls = "bg-[#1db954] text-black";
  const offCls = "bg-white/10 text-white";

  btnP.className   = base + " " + (libraryTopTab === 'playlists' ? onCls : offCls);
  btnA.className   = base + " " + (libraryTopTab === 'albums' ? onCls : offCls);
  btnR.className   = base + " " + (libraryTopTab === 'artists' ? onCls : offCls);
  btnAll.className = base + " " + (libraryTopTab === 'all' ? onCls : offCls);
}

function setLibraryTopTab(tab) {
  const nextTab = String(tab || 'all');
  const sameTab = (String(libraryTopTab || '') === nextTab);

  libraryTopTab = nextTab;
  localStorage.setItem('libraryTopTab', nextTab);
window.libraryTopTab = nextTab;
updateMobileLibraryTabUI();

  updateMobileLibrarySectionTitle();

  // During back-nav restore, preserve existing Library DOM to avoid flicker/jump.
  if (window.__isBackNav && sameTab) return;

  // ✅ Always re-render immediately on mobile when a top Library tab is clicked.
  // This avoids getting "stuck" when navCurrent / __rootTab is stale.
  if (window.innerWidth <= 768) {
    try { renderLibraryMain(); } catch (e) {}
  }
}



function initMobileLibraryTabsOnce() {
  if (window.__mobileLibTabsInit) return;
  window.__mobileLibTabsInit = true;

  document.getElementById('mobile-lib-tab-playlists')
    ?.addEventListener('click', () => setLibraryTopTab('playlists'));

  document.getElementById('mobile-lib-tab-albums')
    ?.addEventListener('click', () => setLibraryTopTab('albums'));

  document.getElementById('mobile-lib-tab-artists')
    ?.addEventListener('click', () => setLibraryTopTab('artists'));

  document.getElementById('mobile-lib-tab-all')
    ?.addEventListener('click', () => setLibraryTopTab('all'));

  updateMobileLibraryTabUI();
  updateMobileLibrarySectionTitle();
}

function renderLibraryArtists() {
  const grid = document.getElementById('album-grid');
  if (!grid) return;

  const albums = Array.isArray(libraryData) ? libraryData : [];

  // Build unique artist list (artistName -> first album object)
  const firstAlbumByArtist = new Map();
  albums.forEach(a => {
    const artist = String(a?.artistName || '').trim();
    if (!artist) return;
    if (!firstAlbumByArtist.has(artist)) firstAlbumByArtist.set(artist, a);
  });

  const sortMode = normalizeLibrarySortMode(
  (typeof getLibrarySortModeForTab === 'function')
    ? getLibrarySortModeForTab('artists')
    : librarySortMode
);

let artists = [...firstAlbumByArtist.keys()];

if (sortMode === 'Alphabetical') {
  artists.sort((a, b) => a.localeCompare(b));
} else if (sortMode === 'Recently added') {
  // preserve existing order (insertion order)
} else {
  // Recent (recently listened)
  const rank = new Map();
  try {
    const hist = JSON.parse(localStorage.getItem('historyLog') || '[]') || [];
    hist.forEach((h, i) => {
      const name = String(h?.artistName || '').trim();
      if (!rank.has(name)) rank.set(name, i);
    });
  } catch (e) {}

  artists.sort((a, b) => {
    const ra = rank.has(a) ? rank.get(a) : 1e9;
    const rb = rank.has(b) ? rank.get(b) : 1e9;
    if (ra !== rb) return ra - rb;
    return a.localeCompare(b);
  });
}


  if (!artists.length) {
    grid.innerHTML = `
      <div class="text-zinc-400 font-bold p-4">
        No artists found yet.
      </div>
    `;
    return;
  }

    const isList = (libraryViewMode === 'list');

  grid.innerHTML = artists.map((artistName) => {
    const a = firstAlbumByArtist.get(artistName);
    const cover = a ? getAlbumCover(a.artistName, a.albumName, a.coverArt) : "";

    const safeArtist = String(artistName)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const coverHtml = cover
      ? `<img src="${cover}" class="w-full h-full object-cover">`
      : `<i class="fas fa-user text-white/50 text-2xl"></i>`;

    if (isList) {
      return `
        <div class="album-card p-3 flex items-center gap-3 bg-white/5 hover:bg-white/10 rounded-xl"
             data-artist="${safeArtist}">
          <div class="w-14 h-14 rounded-lg overflow-hidden bg-white/10 flex items-center justify-center flex-shrink-0">
            ${coverHtml}
          </div>
          <div class="min-w-0">
            <div class="font-bold text-white truncate text-base">
              ${safeArtist}
            </div>
            <div class="text-sm text-zinc-400 truncate">
              Artist
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="album-card rounded-lg overflow-hidden"
           data-artist="${safeArtist}">
        <div class="p-4">
          ${cover ? `<img src="${cover}" style="border-radius:5px;width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">` : `<div style="aspect-ratio:1/1;" class="bg-white/10 rounded-md flex items-center justify-center"><i class="fas fa-user text-white/50 text-2xl"></i></div>`}
        </div>
        <div class="playlist-card-info">
          <h3>${safeArtist}</h3>
          <p>Artist</p>
        </div>
      </div>
    `;
  }).join('');


  [...grid.querySelectorAll('.album-card')].forEach(card => {
    card.addEventListener('click', () => {
      const artist = card.getAttribute('data-artist');
      if (!artist) return;
      openArtistByName(artist);
    });
  });
}

function renderLibraryAll() {
  const grid = document.getElementById('album-grid');
  if (!grid) return;

  const items = [];

  // 1) Playlists
  const pls = Array.isArray(playlists) ? playlists : [];
  pls.forEach((pl, idx) => {
    const name = String(pl?.name || pl?.title || "Untitled Playlist");
    const idOrIdx = (pl && pl.id != null) ? String(pl.id) : String(idx);
        const cover =
      (typeof getEffectivePlaylistCover === "function")
        ? String(getEffectivePlaylistCover(pl) || "").trim()
        : String(pl?.cover || pl?.autoCover || "").trim();

    items.push({
      kind: "playlist",
      key: idOrIdx,
      title: name,
      sub: "Playlist",
      cover: cover
    });

  });

  // 2) Albums
  const albums = Array.isArray(libraryData) ? libraryData : [];
  albums.forEach((a) => {
    const albumName = String(a?.albumName || "").trim();
    if (!albumName) return;
    items.push({
      kind: "album",
      key: albumName,
      title: albumName,
      sub: a?.artistName ? String(a.artistName) : "Album",
      cover: getAlbumCover(a.artistName, a.albumName, a.coverArt)
    });
  });

  if (!items.length) {
    grid.innerHTML = `
      <div class="text-zinc-400 font-bold p-4">
        Nothing to show yet.
      </div>
    `;
    return;
  }

    const sortMode = normalizeLibrarySortMode(
    (typeof getLibrarySortModeForTab === 'function')
      ? getLibrarySortModeForTab('all')
      : librarySortMode
  );

  if (sortMode === 'Alphabetical') {
    items.sort((a, b) => String(a?.title || '').localeCompare(String(b?.title || '')));
  } else if (sortMode === 'Recent') {
    // Rank items by most recent matching history entry (playlist id OR album name)
    const rank = new Map();
    try {
      const hist = JSON.parse(localStorage.getItem('historyLog') || '[]') || [];
      (Array.isArray(hist) ? hist : []).forEach((h, i) => {
        // playlist signals
        const pid = (h?.playlistId != null) ? String(h.playlistId) : (h?.id != null ? String(h.id) : '');
        if (pid && !rank.has('playlist:' + pid)) rank.set('playlist:' + pid, i);

        // album signals
        const alb = String(h?.albumName || '').trim();
        if (alb && !rank.has('album:' + alb)) rank.set('album:' + alb, i);
      });
    } catch (e) {}

    items.sort((a, b) => {
      const ka = String(a?.kind || '') + ':' + String(a?.key || '');
      const kb = String(b?.kind || '') + ':' + String(b?.key || '');

      const ra = rank.has(ka) ? rank.get(ka) : 1e9;
      const rb = rank.has(kb) ? rank.get(kb) : 1e9;
      if (ra !== rb) return ra - rb;

      return String(a?.title || '').localeCompare(String(b?.title || ''));
    });
  } else {
    // Recently added: keep current build order
  }

    const isList = (libraryViewMode === 'list');

  grid.innerHTML = items.map((it) => {

    const safeTitle = String(it.title)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const safeSub = String(it.sub || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const safeKey = String(it.key)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

    const coverHtml = (it.cover)
      ? `<img src="${it.cover}" class="w-full h-full object-cover">`
      : `<i class="fas fa-music text-white/50 ${isList ? 'text-2xl' : 'text-3xl'}"></i>`;

    if (isList) {
      return `
        <div class="album-card p-3 flex items-center gap-3 bg-white/5 hover:bg-white/10 rounded-xl"
             data-kind="${it.kind}"
             data-key="${safeKey}">
          <div class="w-14 h-14 rounded-lg overflow-hidden bg-white/10 flex items-center justify-center flex-shrink-0">
            ${coverHtml}
          </div>

          <div class="min-w-0">
            <div class="font-bold text-white truncate text-base">
              ${safeTitle}
            </div>
            <div class="text-sm text-zinc-400 truncate">
              ${safeSub}
            </div>
          </div>
        </div>
      `;
    }

    return `
      <div class="album-card rounded-lg overflow-hidden"
           data-kind="${it.kind}"
           data-key="${safeKey}">
        <div class="p-4">
          ${it.cover ? `<img src="${it.cover}" style="border-radius:5px;width:100%;aspect-ratio:1/1;object-fit:cover;display:block;">` : `<div style="aspect-ratio:1/1;" class="bg-white/10 rounded-md flex items-center justify-center"><i class="fas fa-music text-white/50 text-3xl"></i></div>`}
        </div>
        <div class="playlist-card-info">
          <h3>${safeTitle}</h3>
          <p>${safeSub}</p>
        </div>
      </div>
    `;
  }).join('');


  [...grid.querySelectorAll('.album-card')].forEach(card => {
    card.addEventListener('click', () => {
      const kind = card.getAttribute('data-kind');
      const key = card.getAttribute('data-key');
      if (!kind || !key) return;

      if (kind === "playlist") {
        showView('playlist', key);
      } else {
        openAlbumByName(key);
      }
    });
  });
}

function renderLibraryMain() {
  initMobileLibraryTabsOnce();

  // ✅ If Library hasn't changed, do NOT rebuild the DOM (prevents cover "pop-in" reload)
  try {
       const tab = String(libraryTopTab || '');
    const sortForTab =
      (typeof getLibrarySortModeForTab === 'function')
        ? getLibrarySortModeForTab(tab)
        : String(librarySortMode || '');

    const key =
      tab + '|' +
      String(sortForTab || '') + '|' +
      String(Array.isArray(libraryData) ? libraryData.length : 0) + '|' +
      String(Array.isArray(playlists) ? playlists.length : 0) + '|' +
      String(Array.isArray(allSongs) ? allSongs.length : 0);

    window.__libraryRenderKey = key;

  } catch (e) {}


  // ✅ Sort is stored per-tab (Playlists/Albums/Artists/All)
window.__librarySortModeOverride = null;


  // ✅ Update dropdown label + which sort options are visible
  updateLibrarySortUIForTopTab();

  if (libraryTopTab === 'playlists') {
    renderLibraryPlaylists();
  } else if (libraryTopTab === 'artists') {
    renderLibraryArtists();
  } else if (libraryTopTab === 'all') {
    renderLibraryAll();
  } else {
    // albums
    renderGrid(getLibraryGridData());
  }

  renderHistory();

  if (window.innerWidth <= 768) {
    renderMobileRecents();
  }
}
