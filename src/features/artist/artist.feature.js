// =============================================================================
// ARTIST FEATURE (extracted from index.html)
// - Artist page (hero, album grid, featured playlists)
// - Artist bio (Wikipedia, desktop right sidebar + mobile now-playing)
// - Artist menu & crop modal (hero image crop cloud storage)
// - Artist play / dock & now-playing click handlers
//
// Dependencies (must be defined before this script loads):
//   libraryData[], playlists[], currentSong, activeArtistName,
//   pushNavCurrent(), setNavCurrent(), showView(), openAlbumByName(),
//   getAlbumCover(), getEffectivePlaylistCover(), getPlaylistCoverMarkup(),
//   buildQueueFromSongs(), playQueue(), playContext, playAlbumByName(),
//   playPlaylistById(), closeNowPlaying(), __isBackNav
// =============================================================================

// ARTIST MENU + CROP (per-artist saved)

function artistApiUrl(path, params) {
  if (typeof window.personalDataApiUrl === "function") {
    return window.personalDataApiUrl(path, params);
  }
  const url = new URL(path, "https://music-streamer.jacetbaum.workers.dev");
  if (params && typeof params === "object") {
    Object.entries(params).forEach(([key, value]) => {
      if (value === undefined || value === null || value === "") return;
      url.searchParams.set(key, String(value));
    });
  }
  return url.toString();
}

// ✅ user id helper (matches your app pattern)
function getAppUserId() {
  if (typeof window.getCloudUserId === "function") {
    return String(window.getCloudUserId() || "").trim();
  }
  return String(window.APP_USER_ID || "").trim();
}

// ✅ returns a usable URL for CSS background-image
// This pings your Worker endpoint so it will fetch from Wikipedia once,
// store to R2 forever, and then serve the cached version forever.
async function getArtistHeroImageUrl(artistName){
  try {
    if (typeof window.fetchArtistPortrait === 'function') {
      const portrait = await window.fetchArtistPortrait(artistName);
      if (portrait && portrait.ok && portrait.image) {
        return portrait.image;
      }
    }
  } catch (e) {}

  try {
    const r = await fetch(
      '/api/artist-image?name=' + encodeURIComponent(artistName)
    );
    if (!r.ok) return null;

    const j = await r.json();
    if (!j || !j.ok || !j.image) return null;

    return j.image;
  } catch (e) {
    return null;
  }
}


// ✅ Crop storage (cloud) — expects your Worker to return { ok:true, crop: ... }
// GET  /api/artist-crop?userId=...&name=...
// POST /api/artist-crop  { userId, name, crop }
async function fetchArtistCropFromCloud(artistName) {
  const uid = getAppUserId();
  if (!uid) return null;
  const u = artistApiUrl("/api/artist-crop", { userId: uid, artist: artistName });

  try {
    const res = await fetch(u, { method: "GET" });
    const data = await res.json().catch(() => null);
    if (!data || !data.ok) return null;
    return data.crop || null;
  } catch (e) {
    return null;
  }
}

async function saveArtistCropToCloud(artistName, crop) {
  const uid = getAppUserId();
  if (!uid) return false;

  // If crop is null, we treat it as "reset" by saving defaults.
  // (If you later prefer true DELETE, we can wire that too.)
  const x = crop && crop.x != null ? Number(crop.x) : 50;
  const y = crop && crop.y != null ? Number(crop.y) : 50;
  const zoom = crop && crop.zoom != null ? Number(crop.zoom) : 100;

  try {
    const res = await fetch(artistApiUrl("/api/artist-crop"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        userId: uid,
        artist: artistName,
        x,
        y,
        zoom
      }),
    });

    const data = await res.json().catch(() => null);
    return !!(data && data.ok);
  } catch (e) {
    return false;
  }
}


// ✅ Apply crop to the hero bg element
async function applyArtistCropToBg(artistName) {
  const bg = document.getElementById("artist-hero-bg");
  if (!bg) return;

  const crop = await fetchArtistCropFromCloud(artistName);
  if (!crop) {
    // default crop
    bg.style.backgroundPosition = "50% 50%";
    bg.style.backgroundSize = "cover";
    return;
  }

  const x = Number(crop.x ?? 50);
  const y = Number(crop.y ?? 50);
  const zoom = Number(crop.zoom ?? 100);

  bg.style.backgroundPosition = `${x}% ${y}%`;

  // Your modal slider is 100–170. 100 => normal cover-ish.
  // We'll use a percent size so it visually zooms.
  bg.style.backgroundSize = `${zoom}%`;
}

// ✅ 3-dots Artist menu show/hide
function hideArtistMenu() {
  const m = document.getElementById("artist-menu");
  if (m) m.classList.add("hidden");
}

function showArtistMenuFromButton(btnEl, artistName) {
  const m = document.getElementById("artist-menu");
  if (!m || !btnEl) return;

  // prevent the global outside-dismiss from instantly closing it
  window.__outsideDismissSkipUntil = Date.now() + 200;

  m.classList.remove("hidden");

  const r = btnEl.getBoundingClientRect();

  // place under the dots, aligned right
  const top = Math.round(r.bottom + 8);
  const left = Math.round(Math.min(window.innerWidth - 280, Math.max(12, r.right - 260)));

  m.style.top = top + "px";
  m.style.left = left + "px";

  // remember current artist for menu actions if needed
  try { m.setAttribute("data-artist", artistName); } catch (e) {}
}

// ✅ Crop modal show/hide + binding
function hideArtistCropModal() {
  const modal = document.getElementById("artist-crop-modal");
  if (modal) modal.classList.add("hidden");
}

function showArtistCropModal(artistName) {
  if (typeof window.requireAccount === "function" && !window.requireAccount("Sign in to customize artist artwork.")) {
    return;
  }

  const modal = document.getElementById("artist-crop-modal");
  const preview = document.getElementById("artist-crop-preview");
  const xR = document.getElementById("artist-crop-x");
  const yR = document.getElementById("artist-crop-y");
  const zR = document.getElementById("artist-crop-zoom");
  const doneBtn = document.getElementById("artist-crop-done");
  const resetBtn = document.getElementById("artist-crop-reset");
  const closeBtn = document.getElementById("artist-crop-close");

  if (!modal || !preview || !xR || !yR || !zR || !doneBtn || !resetBtn || !closeBtn) return;

  modal.classList.remove("hidden");

  // Copy the current hero image into the preview
  const bg = document.getElementById("artist-hero-bg");
  const img = bg ? bg.style.backgroundImage : "";
  preview.style.backgroundImage = img || "";
  preview.style.backgroundRepeat = "no-repeat";

  // Load saved crop defaults from cloud
  (async () => {
    const saved = await fetchArtistCropFromCloud(artistName);
    const x = Number(saved?.x ?? 50);
    const y = Number(saved?.y ?? 50);
    const zoom = Number(saved?.zoom ?? 100);

    xR.value = String(x);
    yR.value = String(y);
    zR.value = String(zoom);

    const applyPreview = () => {
      preview.style.backgroundPosition = `${xR.value}% ${yR.value}%`;
      preview.style.backgroundSize = `${zR.value}%`;
    };

    applyPreview();

    // Bind sliders once per open
    const onInput = () => applyPreview();
    xR.oninput = onInput;
    yR.oninput = onInput;
    zR.oninput = onInput;

    resetBtn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      xR.value = "50";
      yR.value = "50";
      zR.value = "100";
      applyPreview();
    };

    closeBtn.onclick = (e) => {
      e.preventDefault(); e.stopPropagation();
      hideArtistCropModal();
    };

    doneBtn.onclick = async (e) => {
      e.preventDefault(); e.stopPropagation();
      const crop = {
        x: Number(xR.value),
        y: Number(yR.value),
        zoom: Number(zR.value),
      };

      await saveArtistCropToCloud(artistName, crop);
      await applyArtistCropToBg(artistName);
      hideArtistCropModal();
    };
  })();
}

async function clearArtistCrop(artistName) {
  const uid = getAppUserId();
  if (!uid) return;

  const u = artistApiUrl("/api/artist-crop", { userId: uid, artist: artistName });

  try {
    await fetch(u, { method: "DELETE" });
  } catch (e) {}

  // also reset the hero immediately
  const bg = document.getElementById("artist-hero-bg");
  if (bg) {
    bg.style.backgroundPosition = "50% 50%";
    bg.style.backgroundSize = "cover";
  }
}


function openArtistByName(artistName) {



  // BACK STACK: push current view before entering artist
  pushNavCurrent();
  setNavCurrent({ type: 'artist', artistName: artistName });

  activeArtistName = artistName;

  // IMPORTANT: we are already switching views here, but during back-nav we don't want double pushes
  const wasBack = __isBackNav;
  __isBackNav = true;
  showView('artist');
  __isBackNav = wasBack;

  const albums = (Array.isArray(libraryData) ? libraryData : []).filter(a => a.artistName === artistName);
  if (!albums.length) return;

  const heroCover = getAlbumCover(albums[0].artistName, albums[0].albumName, albums[0].coverArt);

    // HERO (Spotify-style header: big background image + text overlay)
  (async () => {
    const heroEl = document.getElementById('artist-hero');
    if (!heroEl) return;

    // layout first (so the page doesn't jump)
    heroEl.innerHTML = `
      <div class="relative w-full overflow-hidden rounded-2xl">
        <div id="artist-hero-bg"
             class="absolute inset-0 bg-zinc-900"
             style="background-size: cover; background-position: center; background-repeat: no-repeat;">
        </div>

        <!-- Spotify-ish dark fade so text is readable -->
        <div class="absolute inset-0 bg-gradient-to-t from-black/90 via-black/35 to-black/10"></div>

        <div class="relative h-[260px] md:h-[340px] flex flex-col justify-end p-6 md:p-10">
          <div class="text-xs font-extrabold uppercase tracking-[0.35em] text-white/80">Artist</div>
          <div class="mt-2 text-5xl md:text-7xl font-black leading-[0.92] break-words whitespace-normal">
            ${artistName}
          </div>
        </div>
      </div>
    `;

    // try cached internet artist image first
    let imgUrl = await getArtistHeroImageUrl(artistName);

    // fallback: if wikipedia had nothing, use your library cover so it never looks blank
    if (!imgUrl && heroCover) imgUrl = heroCover;

        if (imgUrl) {
      const bg = document.getElementById('artist-hero-bg');
      if (bg) {
        bg.style.backgroundImage = `url("${imgUrl}")`;
      }
      // apply saved crop (if any)
      try { await applyArtistCropToBg(artistName); } catch (e) {}

    }
  })();





    // Bind Artist green Play button (plays all songs by the artist)
  const artistPlayBtn = document.getElementById('artist-play-btn');
  if (artistPlayBtn) {
    artistPlayBtn.onclick = () => playArtistByName(artistName);
  }

  // Bind Artist 3-dots menu
  const moreBtn = document.getElementById('artist-more-btn');
  if (moreBtn) {
    moreBtn.onclick = (e) => {
      e.preventDefault();
      e.stopPropagation();
      try { showArtistMenuFromButton(moreBtn, artistName); } catch (err) {}
    };
  }

  // Bind Artist menu actions
  const cropBtn = document.getElementById('am-adjust-crop');
  if (cropBtn) cropBtn.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!artistName) return;
    if (typeof window.requireAccount === 'function' && !window.requireAccount('Sign in to customize artist artwork.')) return;
    try { hideArtistMenu(); } catch (err) {}
    try { showArtistCropModal(artistName); } catch (err) {}
  };

  const resetCropBtn = document.getElementById('am-reset-crop');
  if (resetCropBtn) resetCropBtn.onclick = (e) => {
    e.preventDefault(); e.stopPropagation();
    if (!artistName) return;
    if (typeof window.requireAccount === 'function' && !window.requireAccount('Sign in to customize artist artwork.')) return;
    try { clearArtistCrop(artistName); } catch (err) {}
    try { applyArtistCropToBg(artistName); } catch (err) {}
    try { hideArtistMenu(); } catch (err) {}
  };


  // ALBUM GRID (with green play overlay)
  const grid = document.getElementById('artist-album-grid');
  grid.innerHTML = albums.map(a => {
    const cover = getAlbumCover(a.artistName, a.albumName, a.coverArt);
    const safeAlbum = a.albumName.replace(/'/g, "\\'");
    return `
            <div class="p-4 cursor-pointer relative group rounded-lg hover:bg-white/5 transition" data-no-swipe-back="1"

           onclick="openAlbumByName('${safeAlbum}')">
        <img src="${cover}"
             class="w-full aspect-square rounded-md mb-3 object-cover">

       <button
          class="absolute right-6 bottom-14 w-12 h-12 bg-[#1db954] rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition js-green-play"
          type="button"
          data-kind="album"
          data-value="${safeAlbum}"
          aria-label="Play album">
          <i class="fas fa-play text-black text-lg ml-1"></i>
        </button>


        <div class="text-white font-bold truncate">${a.albumName}</div>
        <div class="text-sm text-zinc-400">${a.year || ''}</div>
      </div>
    `;
    }).join('');

  // ✅ Bind the green play overlays (do NOT rely on inline `event`)
  grid.querySelectorAll('.js-green-play').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      const kind = btn.getAttribute('data-kind');
      const value = btn.getAttribute('data-value');

      if (kind === 'album') return playAlbumByName(value);
      if (kind === 'playlist') return playPlaylistById(value);
    });
  });


  // FEATURED IN… (Playlists containing songs by this artist)
  const featuredTitle = document.getElementById('artist-featured-title');
  const plGrid = document.getElementById('artist-playlist-grid');

  const pls = (Array.isArray(playlists) ? playlists : []).filter(pl => {
    const songs = Array.isArray(pl.songs) ? pl.songs : [];
    return songs.some(s => {
      const a = (s.artist || s.artistName || '');
      return a === artistName;
    });
  });

  if (featuredTitle) featuredTitle.classList.toggle('hidden', pls.length === 0);

  if (plGrid) {
    plGrid.innerHTML = pls.map(pl => {
  const idx = (Array.isArray(playlists) ? playlists.findIndex(p => p.id === pl.id) : -1);
  const cover = getEffectivePlaylistCover(pl);
  const safeName = String(pl.name || 'Playlist').replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `
    <div class="p-4 cursor-pointer relative group rounded-lg hover:bg-white/5 transition"
         onclick="if (${idx} !== -1) showView('playlist', ${idx});">
      ${getPlaylistCoverMarkup(pl, "w-full aspect-square rounded-md mb-3 overflow-hidden")}

      <button
        class="absolute right-6 bottom-14 w-12 h-12 bg-[#1db954] rounded-full flex items-center justify-center shadow-lg opacity-0 group-hover:opacity-100 transition js-green-play"
        type="button"
        data-kind="playlist"
        data-value="${pl.id}"
        aria-label="Play playlist">
        <i class="fas fa-play text-black text-lg ml-1"></i>
      </button>

      <div class="text-white font-bold truncate">${safeName}</div>
      <div class="text-sm text-zinc-400">Playlist</div>
    </div>
  `;
}).join('');

  }
}

// Plays ALL songs by this artist (respects shuffle)
function playArtistByName(artistName) {
  const albums = (Array.isArray(libraryData) ? libraryData : []).filter(a => a.artistName === artistName);
  const allSongs = [];
  albums.forEach(a => {
    (Array.isArray(a.songs) ? a.songs : []).forEach(s => allSongs.push({
      ...s,
      album: a.albumName,
      artist: a.artistName,
      cover: getAlbumCover(a.artistName, a.albumName, a.coverArt)
    }));
  });

  const queue = buildQueueFromSongs(allSongs, { album: 'Artist', artist: artistName });
  playContext = { type: 'artist', label: artistName };
  playQueue(queue, 0);
}

// ----------------------------
// RIGHT SIDEBAR: ARTIST BIO (Wikipedia) + cache + click-to-expand
// ----------------------------
(function bindRightBioExpandOnce(){
  if (window.__rightBioExpandBound) return;
  window.__rightBioExpandBound = true;

  function toggleBioExpand(){
    const bio = document.getElementById('right-bio');
    if (!bio) return;
    bio.classList.toggle('right-bio-expanded');
    bio.classList.toggle('right-bio-collapsed');
  }

  document.addEventListener('click', (e) => {
    const card = document.getElementById('right-bio-card');
    if (!card) return;
    if (card.contains(e.target)) toggleBioExpand();
  });

  document.addEventListener('keydown', (e) => {
    const card = document.getElementById('right-bio-card');
    if (!card) return;
    if (document.activeElement !== card) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    e.preventDefault();
    toggleBioExpand();
  });
})();
        
function toggleNpBioExpanded(e){
  if (e) { e.preventDefault(); e.stopPropagation(); }

  const bio = document.getElementById('np-about-artist-bio');
  const icon = document.getElementById('np-about-expand-icon');
  if (!bio) return;

  const expanded = bio.classList.contains('np-bio-expanded');
  bio.classList.toggle('np-bio-expanded', !expanded);
  bio.classList.toggle('np-bio-collapsed', expanded);

  if (icon) {
    icon.className = !expanded
      ? "fas fa-compress text-white/80 text-sm"
      : "fas fa-up-right-and-down-left-from-center text-white/80 text-sm";
  }
}

async function loadRightBio(artistName){
  if (window.innerWidth < 1024) return;

  const status = document.getElementById('right-bio-status');
  const bio = document.getElementById('right-bio');
  const src = document.getElementById('right-bio-source');

  if (!status || !bio || !src) return;

  // Always reset to collapsed when loading a new artist
  bio.classList.remove('right-bio-expanded');
  bio.classList.add('right-bio-collapsed');

  const artist = String(artistName || '').trim();
  if (!artist) {
    status.textContent = 'Play a song to load artist info.';
    bio.textContent = '';
    src.style.display = 'none';
    src.href = '#';
    return;
  }

  // Cache key (stable)
  const aKey = artist.toLowerCase().replace(/\s+/g,' ').trim();
  const key = 'artistBio:v1:' + aKey;

  const NOW = Date.now();
  const TTL_FOUND = 1000 * 60 * 60 * 24 * 30; // 30 days
  const TTL_NOTFOUND = 1000 * 60 * 60 * 12;   // 12 hours

  function readCache(){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.savedAt) return null;
      const ttl = obj.notFound ? TTL_NOTFOUND : TTL_FOUND;
      if ((NOW - obj.savedAt) > ttl) return null;
      return obj;
    }catch(e){ return null; }
  }

  function writeCache(obj){
    try{
      localStorage.setItem(key, JSON.stringify({ ...obj, savedAt: Date.now() }));
    }catch(e){}
  }

  const cached = readCache();
  if (cached){
    if (cached.notFound){
      status.textContent = 'No artist info found.';
      bio.textContent = '';
      src.textContent = 'Wikipedia';
      src.href = 'https://en.wikipedia.org/wiki/Special:Search?search=' + encodeURIComponent(artist);
      src.style.display = 'inline';
      return;
    }
    status.textContent = 'About the artist';
    bio.textContent = (cached.bio || '').trim();
    src.textContent = 'Wikipedia';
    src.href = cached.sourceHref || ('https://en.wikipedia.org/wiki/Special:Search?search=' + encodeURIComponent(artist));
    src.style.display = 'inline';
    return;
  }

  // Fetch Wikipedia summary
  status.textContent = 'Loading artist info…';
  bio.textContent = '';
  src.style.display = 'none';
  src.href = '#';

  try{
    const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(artist);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Wiki HTTP ' + res.status);
    const data = await res.json();

    const extract = (data && data.extract) ? String(data.extract).trim() : '';
    const wikiPage = (data && data.content_urls && data.content_urls.desktop && data.content_urls.desktop.page)
      ? String(data.content_urls.desktop.page)
      : ('https://en.wikipedia.org/wiki/Special:Search?search=' + encodeURIComponent(artist));

    if (!extract || (data && data.type === 'disambiguation')){
      status.textContent = 'No artist info found.';
      bio.textContent = '';
      src.textContent = 'Wikipedia';
      src.href = wikiPage;
      src.style.display = 'inline';
      writeCache({ notFound: true, sourceHref: wikiPage });
      return;
    }

    status.textContent = 'About the artist';
    bio.textContent = extract;
    src.textContent = 'Wikipedia';
    src.href = wikiPage;
    src.style.display = 'inline';

    writeCache({ notFound: false, bio: extract, sourceHref: wikiPage });
  }catch(err){
    console.warn('Bio load failed:', err);
    status.textContent = 'Could not load artist info.';
    bio.textContent = '';
    src.textContent = 'Wikipedia';
    src.href = 'https://en.wikipedia.org/wiki/Special:Search?search=' + encodeURIComponent(artist);
    src.style.display = 'inline';
  }
}

function openArtistFromNowPlayingCard(e){
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const name = (currentSong && currentSong.artist) ? String(currentSong.artist).trim() : '';
  if (!name) return;
  try { closeNowPlaying(); } catch (err) {}
  try { openArtistByName(name); } catch (err) {}
}

function toggleNpBioExpanded(e){
  if (e) { e.preventDefault(); e.stopPropagation(); }
  const bio = document.getElementById('np-about-artist-bio');
  if (!bio) return;
  const expanded = bio.classList.contains('np-bio-expanded');
  bio.classList.toggle('np-bio-expanded', !expanded);
  bio.classList.toggle('np-bio-collapsed', expanded);
}

async function loadNpBio(artistName){
  const status = document.getElementById('np-about-artist-status');
  const bio = document.getElementById('np-about-artist-bio');
  const nameEl = document.getElementById('np-about-artist-name');
  const metaEl = document.getElementById('np-about-artist-meta');

  if (!bio) return;

  const artist = String(artistName || '').trim();
  if (nameEl) nameEl.textContent = artist || '';
  if (metaEl) metaEl.textContent = artist ? 'Tap to open artist' : '';

  bio.classList.remove('np-bio-expanded');
  bio.classList.add('np-bio-collapsed');

  if (!artist) {
    if (status) status.textContent = 'Play a song to load artist info.';
    bio.textContent = '';
    return;
  }

  if (status) status.textContent = 'Loading…';
  bio.textContent = '';

  // same cache scheme as desktop
  const aKey = artist.toLowerCase().replace(/\s+/g,' ').trim();
  const key = 'artistBio:v1:' + aKey;

  const NOW = Date.now();
  const TTL_FOUND = 1000 * 60 * 60 * 24 * 30;
  const TTL_NOTFOUND = 1000 * 60 * 60 * 12;

  function readCache(){
    try{
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.savedAt) return null;
      const ttl = obj.notFound ? TTL_NOTFOUND : TTL_FOUND;
      if ((NOW - obj.savedAt) > ttl) return null;
      return obj;
    }catch(e){ return null; }
  }
  function writeCache(obj){
    try{ localStorage.setItem(key, JSON.stringify({ ...obj, savedAt: Date.now() })); }catch(e){}
  }

  const cached = readCache();
  if (cached){
    if (cached.notFound){
      if (status) status.textContent = 'No artist info found.';
      bio.textContent = '';
      return;
    }
    if (status) status.textContent = 'About the artist';
    bio.textContent = (cached.bio || '').trim();
    return;
  }

  try{
    const url = 'https://en.wikipedia.org/api/rest_v1/page/summary/' + encodeURIComponent(artist);
    const res = await fetch(url);
    if (!res.ok) throw new Error('Wiki ' + res.status);
    const data = await res.json();

    const extract = (data && data.extract) ? String(data.extract).trim() : '';
    if (!extract || (data && data.type === 'disambiguation')){
      if (status) status.textContent = 'No artist info found.';
      bio.textContent = '';
      writeCache({ notFound: true });
      return;
    }

    if (status) status.textContent = 'About the artist';
    bio.textContent = extract;
    writeCache({ notFound: false, bio: extract });
  }catch(err){
    if (status) status.textContent = 'Could not load artist info.';
    bio.textContent = '';
  }
}

// Artist click handler for dock and now-playing
function openArtistFromCurrentSong(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  if (!currentSong || !currentSong.artist) return;

  // ✅ This click counts as "direct artist engagement"
  try { window.__fromArtistView = String(currentSong.artist || '').trim(); } catch (err) {}

  // Close Now Playing if it's open so it doesn't sit on top
  try {
    const nowPlayingOverlay = document.getElementById('now-playing-overlay');
    if (nowPlayingOverlay && !nowPlayingOverlay.classList.contains('hidden')) {
      closeNowPlaying();
    }
  } catch (err) {}

  openArtistByName(currentSong.artist);
}

// Bind dock + NP artist click listeners
(function bindArtistClickListeners() {
  const dockArtistEl = document.getElementById('p-artist');
  if (dockArtistEl) {
    dockArtistEl.addEventListener('click', openArtistFromCurrentSong);
    dockArtistEl.addEventListener('pointerdown', (e) => {
      // don't trigger dock-left openNowPlaying handler
      e.stopPropagation();
    });
  }

  const npArtistEl = document.getElementById('np-artist');
  if (npArtistEl) {
    npArtistEl.addEventListener('click', openArtistFromCurrentSong);
  }
})();

// Export artist globals used by other features and inline handlers.
window.openArtistByName = openArtistByName;
window.playArtistByName = playArtistByName;
window.openArtistFromCurrentSong = openArtistFromCurrentSong;
window.openArtistFromNowPlayingCard = openArtistFromNowPlayingCard;
window.toggleNpBioExpanded = toggleNpBioExpanded;
window.loadRightBio = loadRightBio;
window.loadNpBio = loadNpBio;
