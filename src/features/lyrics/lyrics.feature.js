// =============================================================================
// LYRICS FEATURE (extracted from index.html)
// - Sidebar lyrics (desktop right panel, LRCLIB + OVH providers)
// - Center lyrics mode (dock mic button, full overlay)
// - Mobile lyrics card (Now Playing panel)
// - Expand/collapse/share
//
// Dependencies (must be defined before this script loads):
//   currentSong, rightSidebar, toggleRightSidebar(), setRightSidebarNowPlaying()
// =============================================================================

// -----------------------
// LYRICS (DESKTOP RIGHT SIDEBAR — OVH provider)
// -----------------------
const __lyricsCache = new Map(); // key = "artist||title" -> lyrics string

function __cleanTitleForLyrics(rawTitle) {
  // Cleans *song titles* without breaking "Artist - Song" patterns.
  const t = String(rawTitle || "")
    .replace(/\.mp3$/i, "")
    .replace(/\s*\[[^\]]*\]\s*/g, " ")   // [Remastered], etc
    .replace(/\s*\([^)]*\)\s*/g, " ")   // (feat...), (remaster...)
    // Only strip dash-suffixes that are clearly versions, not the actual title
    .replace(/\s*-\s*(live|remaster(?:ed)?|acoustic|demo|radio edit|edit|version|mix|mono|stereo|instrumental)\b.*$/i, " ")
    .replace(/\s+/g, " ")
    .trim();
  return t;
}


async function fetchLyricsOVH(artist, title) {
  const a = String(artist || "").trim();
  let rawTitle = String(title || "").trim();

  if (!a || !rawTitle) return null;

  // If title is "Artist - Song", strip the artist prefix
  // Handles hyphen "-" and en dash "–"
  const aLower = a.toLowerCase();
  const splitOn = rawTitle.includes(" – ") ? " – " : (rawTitle.includes(" - ") ? " - " : null);

  if (splitOn) {
    const parts = rawTitle.split(splitOn);
    if (parts.length >= 2) {
      const left = String(parts[0] || "").trim().toLowerCase();
      if (left === aLower) {
        rawTitle = parts.slice(1).join(splitOn).trim();
      }
    }
  }

  const t = __cleanTitleForLyrics(rawTitle);
  if (!t) return null;

  const cacheKey = `${a}||${t}`;
  if (__lyricsCache.has(cacheKey)) return __lyricsCache.get(cacheKey);

  const url = `https://api.lyrics.ovh/v1/${encodeURIComponent(a)}/${encodeURIComponent(t)}`;

  try {
    const res = await fetch(url);
    if (!res.ok) {
      __lyricsCache.set(cacheKey, null);
      return null;
    }
    const data = await res.json();
    const lyrics = (data && typeof data.lyrics === "string") ? data.lyrics.trim() : "";
    const finalLyrics = lyrics ? lyrics : null;
    __lyricsCache.set(cacheKey, finalLyrics);
    return finalLyrics;
  } catch (e) {
    __lyricsCache.set(cacheKey, null);
    return null;
  }
}

async function updateRightLyricsForSong(songObj) {
  // Desktop only (your sidebar is desktop-only anyway, but keep it safe)
  if (window.innerWidth <= 768) return;

  const statusEl = document.getElementById("right-lyrics-status");
  const lyricsEl = document.getElementById("right-lyrics");

  if (!statusEl || !lyricsEl) return;

  if (!songObj) {
    statusEl.innerText = "—";
    lyricsEl.textContent = "";
    return;
  }

  statusEl.innerText = "Loading…";
  lyricsEl.textContent = "";

  const artist = songObj.artist || "";
  const title = songObj.title || "";

  const lyrics = await fetchLyricsOVH(artist, title);

  if (lyrics) {
    statusEl.innerText = "Found";
    lyricsEl.textContent = lyrics;
  } else {
    statusEl.innerText = "Not found";
    lyricsEl.textContent = "No lyrics found for this track.";
  }
}

/* -----------------------
   CENTER LYRICS (Dock mic)
------------------------ */
let isCenterLyricsOpen = false;

function setCenterLyricsOpen(open) {
  isCenterLyricsOpen = !!open;

  const panel = document.getElementById('lyrics-center-overlay');
  const btn   = document.getElementById('dock-lyrics-btn');

  // Right sidebar pieces (desktop)
  const rightLyricsCard = document.getElementById('right-lyrics-card');
  const rightBio = document.getElementById('right-bio');

  // show/hide center panel
  if (panel) panel.classList.toggle('hidden', !isCenterLyricsOpen);

  // take over the entire middle screen
  document.body.classList.toggle('lyrics-mode', isCenterLyricsOpen);

  // mic active state (green when open)
  if (btn) {
    btn.classList.toggle('text-[var(--spotify-green)]', isCenterLyricsOpen);
  }

  // Right panel behavior while mic is on:
  // - hide lyrics card
  // - force bio to be in expanded mode so it can fill space
    if (rightLyricsCard) {
    const shouldHide = isCenterLyricsOpen || document.body.classList.contains('queue-mode');
    rightLyricsCard.classList.toggle('hidden', shouldHide);
  }

  if (rightBio) {
    if (isCenterLyricsOpen) {
      // remember prior state so we can restore it
      rightBio.dataset.prevBioState = rightBio.classList.contains('right-bio-expanded') ? 'expanded' : 'collapsed';
      rightBio.classList.remove('right-bio-collapsed');
      rightBio.classList.add('right-bio-expanded');
    } else {
      // restore prior state
      const prev = rightBio.dataset.prevBioState || 'collapsed';
      rightBio.classList.remove('right-bio-collapsed', 'right-bio-expanded');
      rightBio.classList.add(prev === 'expanded' ? 'right-bio-expanded' : 'right-bio-collapsed');
      delete rightBio.dataset.prevBioState;
    }
  }

  // load lyrics immediately if opening
  if (isCenterLyricsOpen) {
    if (currentSong && (currentSong.title || currentSong.artist || currentSong.name)) {
      updateCenterLyricsForSong(currentSong);
    } else {
      const body = document.getElementById('lyrics-overlay-body');
      const title = document.getElementById('lyrics-overlay-title');
      const sub = document.getElementById('lyrics-overlay-sub');
      if (title) title.textContent = 'Lyrics';
      if (sub) sub.textContent = 'Play a song to load lyrics.';
      if (body) body.textContent = 'Play a song to load lyrics.';
    }
  }
}


function toggleCenterLyrics() {
  setCenterLyricsOpen(!isCenterLyricsOpen);
}

async function loadCenterLyrics(trackTitle, artistName) {
  const titleEl = document.getElementById('lyrics-overlay-title');
  const subEl   = document.getElementById('lyrics-overlay-sub');
  const bodyEl  = document.getElementById('lyrics-overlay-body');

  const cleanTitle  = String(trackTitle || '').replace('.mp3','').trim();
  const cleanArtist = String(artistName || '').trim();

  if (titleEl) titleEl.textContent = cleanTitle || 'Lyrics';
  if (subEl)   subEl.textContent = cleanArtist || '';
  if (bodyEl)  bodyEl.textContent = 'Loading lyrics…';

  // -----------------------
  // localStorage cache (persists across refresh)
  // key is stable per (artist + title)
  // -----------------------
  const cacheKey = (() => {
    const a = cleanArtist.toLowerCase().trim();
    const t = cleanTitle.toLowerCase().trim();
    return `lyricsCache:v1:${a}||${t}`;
  })();

  // Try cache first
  try {
    const cached = localStorage.getItem(cacheKey);
    if (cached && cached.trim().length) {
      if (bodyEl) bodyEl.textContent = cached;
      return;
    }
  } catch (e) {
    // ignore cache failures
  }

  try {
    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('LRCLIB not ok');

    const data = await res.json();
    const text = (data && (data.plainLyrics || data.syncedLyrics)) ? (data.plainLyrics || data.syncedLyrics) : '';

    if (!text) {
      if (bodyEl) bodyEl.textContent = 'No lyrics found for this track.';
      return;
    }

    // If synced lyrics, strip timestamps for the big Spotify-like look
    const cleaned = String(text).replace(/\[[0-9:.]+\]\s*/g, '').trim();
    const finalText = cleaned || 'No lyrics found for this track.';

    if (bodyEl) bodyEl.textContent = finalText;

    // Save into cache (so refresh won't re-fetch)
    try {
      if (finalText && finalText.trim().length) {
        localStorage.setItem(cacheKey, finalText);
      }
    } catch (e) {
      // ignore storage full / blocked
    }
  } catch (e) {
    if (bodyEl) bodyEl.textContent = 'Lyrics not available right now.';
  }
}


function updateCenterLyricsForSong(songObj) {
  if (!isCenterLyricsOpen) return;
  if (!songObj) return;

  const t = (songObj.title || songObj.name || '').replace('.mp3','');
  const a = (songObj.artist || songObj.artistName || '');

  loadCenterLyrics(t, a);
}

// Bind dock mic button (safe even if called early)
(function bindDockLyricsButton(){
  function bind() {
    const btn = document.getElementById('dock-lyrics-btn');
    if (!btn || btn.__lyricsBound) return;
    btn.__lyricsBound = true;

    btn.addEventListener('click', (e) => {
      e.preventDefault();
      e.stopPropagation();
      toggleCenterLyrics();
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bind);
  } else {
    bind();
  }
})(); 

// Lyrics providers:
// 1) LRCLIB (free, no key) - returns plain or synced lyrics when available
// 2) Fallback: provide a Genius search link when lyrics aren't available
async function loadRightLyrics(title, artist) {
  if (window.innerWidth < 1024) return;

  const box = document.getElementById('right-lyrics');
  const status = document.getElementById('right-lyrics-status');
  const source = document.getElementById('right-lyrics-source');

  if (!box || !status || !source) return;

  // Reset UI
  box.textContent = '';
  status.textContent = 'Loading lyrics…';
  source.style.display = 'none';
  source.href = '#';

  const t = String(title || '').trim();
  const a = String(artist || '').trim();

  if (!t) {
    status.textContent = 'Play a song to load lyrics.';
    return;
  }

  // Build the Genius search URL for fallback / source link
  const geniusUrl = 'https://genius.com/search?q=' + encodeURIComponent((a ? (a + ' ') : '') + t);

  // ----------------------------
  // ✅ LocalStorage cache helpers
  // ----------------------------
  const key = 'lyricsCache:v1:' + (a || 'unknown') + '||' + t;

  const NOW = Date.now();
  const TTL_FOUND = 1000 * 60 * 60 * 24 * 30;   // 30 days
  const TTL_NOTFOUND = 1000 * 60 * 60 * 6;      // 6 hours

  function readCache() {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      const obj = JSON.parse(raw);
      if (!obj || !obj.savedAt) return null;

      const ttl = obj.notFound ? TTL_NOTFOUND : TTL_FOUND;
      if ((NOW - obj.savedAt) > ttl) return null;

      return obj;
    } catch (e) {
      return null;
    }
  }

  function writeCache(obj) {
    try {
      localStorage.setItem(key, JSON.stringify({ ...obj, savedAt: Date.now() }));
    } catch (e) {}
  }

  // ✅ Use cached lyrics immediately (no network)
  const cached = readCache();
  if (cached) {
    if (cached.notFound) {
      status.textContent = 'No lyrics found for this track.';
      source.textContent = 'Search on Genius';
      source.href = geniusUrl;
      source.style.display = 'inline';
      return;
    }

    box.textContent = (cached.lyrics || '').trim();
    status.textContent = 'Lyrics';
    source.textContent = cached.sourceLabel || 'LRCLIB';
    source.href = cached.sourceHref || 'https://lrclib.net/';
    source.style.display = 'inline';
    return;
  }

  // ----------------------------
  // ✅ Fetch from LRCLIB if needed
  // ----------------------------
  try {
    const url =
      'https://lrclib.net/api/get?track_name=' + encodeURIComponent(t) +
      (a ? ('&artist_name=' + encodeURIComponent(a)) : '');

    const res = await fetch(url, { method: 'GET' });
    if (!res.ok) throw new Error('LRCLIB HTTP ' + res.status);

    const data = await res.json();
    const lyrics = (data && (data.plainLyrics || data.syncedLyrics))
      ? String(data.plainLyrics || data.syncedLyrics)
      : '';

    if (lyrics && lyrics.trim().length) {
      const finalLyrics = lyrics.trim();

      box.textContent = finalLyrics;
      status.textContent = 'Lyrics';
      source.textContent = 'LRCLIB';
      source.href = 'https://lrclib.net/';
      source.style.display = 'inline';

      // ✅ save success
      writeCache({
        notFound: false,
        lyrics: finalLyrics,
        sourceLabel: 'LRCLIB',
        sourceHref: 'https://lrclib.net/'
      });

      return;
    }

    // No lyrics found
    status.textContent = 'No lyrics found for this track.';
    source.textContent = 'Search on Genius';
    source.href = geniusUrl;
    source.style.display = 'inline';

    // ✅ save notFound (short TTL)
    writeCache({ notFound: true });

  } catch (err) {
    console.warn('Lyrics load failed:', err);
    status.textContent = 'Could not load lyrics (network or CORS).';
    source.textContent = 'Search on Genius';
    source.href = geniusUrl;
    source.style.display = 'inline';
  }
}

// ✅ Mobile fix: allow tapping expanded lyrics to collapse back
window.toggleNpLyricsExpanded = window.toggleNpLyricsExpanded || function(e){
  try {
    if (e) { e.preventDefault?.(); e.stopPropagation?.(); }
  } catch (_) {}

  const body = document.getElementById('np-lyrics-body');
  const icon = document.getElementById('np-lyrics-expand-icon');
  const btn  = document.getElementById('np-lyrics-expand');
  if (!body) return;

  const isExpanded = body.classList.contains('np-lyrics-expanded');

  // toggle classes
  body.classList.toggle('np-lyrics-expanded', !isExpanded);
  body.classList.toggle('np-lyrics-collapsed', isExpanded);

  // toggle icon (FontAwesome)
  if (icon) {
    icon.classList.toggle('fa-up-right-and-down-left-from-center', isExpanded);
    icon.classList.toggle('fa-down-left-and-up-right-to-center', !isExpanded);
  }

  // aria label
  if (btn) {
    btn.setAttribute('aria-label', isExpanded ? 'Expand lyrics' : 'Collapse lyrics');
  }
};

(function bindNpLyricsCollapse(){
  if (window.__npLyricsCollapseBound) return;
  window.__npLyricsCollapseBound = true;

  document.addEventListener('click', (e) => {
    if (window.innerWidth > 768) return;

    const body = document.getElementById('np-lyrics-body');
    if (!body) return;

    if (
      body.classList.contains('np-lyrics-expanded') &&
      body.contains(e.target)
    ) {
      window.toggleNpLyricsExpanded(e);
    }
  }, true);
})();

async function shareNpLyrics(e){

  if (e) { e.preventDefault(); e.stopPropagation(); }

  const text = (document.getElementById('np-lyrics-body')?.textContent || '').trim();
  const title = (currentSong && (currentSong.title || currentSong.name)) ? String(currentSong.title || currentSong.name).replace('.mp3','').trim() : 'Lyrics';
  const artist = (currentSong && currentSong.artist) ? String(currentSong.artist).trim() : '';

  if (!text) return;

  try{
    if (navigator.share) {
      await navigator.share({ title, text: (artist ? (artist + " — ") : "") + title + "\n\n" + text });
      return;
    }
  }catch(err){}

  try{
    await navigator.clipboard.writeText((artist ? (artist + " — ") : "") + title + "\n\n" + text);
  }catch(err){}
}

async function loadNpLyrics(trackTitle, artistName){
  const status = document.getElementById('np-lyrics-status');
  const bodyEl = document.getElementById('np-lyrics-body');
  const source = document.getElementById('np-lyrics-source');

  if (!status || !bodyEl || !source) return;

  const cleanTitle  = String(trackTitle || '').replace('.mp3','').trim();
  const cleanArtist = String(artistName || '').trim();

  // reset UI
  bodyEl.textContent = '';
  status.textContent = 'Loading…';
  source.classList.add('hidden');
  source.href = '#';

  // reset collapsed
  bodyEl.classList.remove('np-lyrics-expanded');
  bodyEl.classList.add('np-lyrics-collapsed');

  if (!cleanTitle) {
    status.textContent = 'Play a song to load lyrics.';
    return;
  }

  const geniusUrl = 'https://genius.com/search?q=' + encodeURIComponent((cleanArtist ? (cleanArtist + ' ') : '') + cleanTitle);

  // localStorage cache (same as your center lyrics pattern)
  const cacheKey = (() => {
    const a = cleanArtist.toLowerCase().trim();
    const t = cleanTitle.toLowerCase().trim();
    return `lyricsCache:v1:${a}||${t}`;
  })();

  try{
    const cached = localStorage.getItem(cacheKey);
    if (cached && cached.trim().length) {
      status.textContent = 'Lyrics';
      bodyEl.textContent = cached;
      return;
    }
  }catch(err){}

  try{
    const url = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('LRCLIB not ok');

    const data = await res.json();
    const text = (data && (data.plainLyrics || data.syncedLyrics)) ? (data.plainLyrics || data.syncedLyrics) : '';

    if (!text) {
      status.textContent = 'No lyrics found for this track.';
      source.textContent = 'Search on Genius';
      source.href = geniusUrl;
      source.classList.remove('hidden');
      return;
    }

    // strip timestamps if synced
    const cleaned = String(text).replace(/\[[0-9:.]+\]\s*/g, '').trim();
    const finalText = cleaned || 'No lyrics found for this track.';

    status.textContent = 'Lyrics';
    bodyEl.textContent = finalText;

    try{
      if (finalText && finalText.trim().length) localStorage.setItem(cacheKey, finalText);
    }catch(err){}

  }catch(err){
    status.textContent = 'Lyrics not available right now.';
    source.textContent = 'Search on Genius';
    source.href = geniusUrl;
    source.classList.remove('hidden');
  }
}
