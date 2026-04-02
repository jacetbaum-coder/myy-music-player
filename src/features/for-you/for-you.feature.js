// ============================================================
// FOR YOU FEATURE — Daylist & Nightlist auto-playlists
// ============================================================
// Reads reson_play_events_v1 from localStorage, scores songs
// by recency × frequency + a daily random seed, and exposes
// two virtual "auto-playlists" that regenerate each day.
//
// Public API (attached to window):
//   window.initForYou()              — bootstrap on page load
//   window.renderForYouSection()     — refresh the home card UI
//   window.openAutoPlaylist(type)    — open daylist|nightlist in playlist view
//   window.saveAutoPlaylistSnapshot(type) — freeze a copy to the library
// ============================================================

(function () {
  'use strict';

  // ─── Constants ────────────────────────────────────────────
  const AUTO_IDS = { daylist: '__daylist__', nightlist: '__nightlist__' };
  const CACHE_KEYS = {
    daylist: '__auto_daylist_cache',
    nightlist: '__auto_nightlist_cache',
  };
  const EVENTS_KEY = 'reson_play_events_v1';
  const DAY_START = 6;   // 6 am
  const DAY_END = 17;    // 5 pm  (so nightlist = 17–6)
  const TARGET_SIZE = 20;

  // ─── Utility: local YYYY-MM-DD string ─────────────────────
  function todayKey() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  // ─── Utility: deterministic seat noise in [0,1] for variety ─
  // Same url+day → same value all day. Different tomorrow.
  function seededNoise(url, day) {
    let h = 0;
    const s = String(url) + String(day);
    for (let i = 0; i < s.length; i++) {
      h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
    }
    return Math.abs(Math.sin(h)) % 1;
  }

  // ─── Filter play events to a given hour window ────────────
  function filterEventsByHourWindow(events, hourStart, hourEnd) {
    return events.filter(ev => {
      try {
        const h = new Date(ev.ts).getHours();
        if (hourStart < hourEnd) {
          return h >= hourStart && h < hourEnd;
        } else {
          // wraps midnight: e.g. 17–6
          return h >= hourStart || h < hourEnd;
        }
      } catch (e) {
        return false;
      }
    });
  }

  // ─── Score events and return sorted list of {url, score} ──
  function scoreEvents(events) {
    const day = todayKey();
    const now = Date.now();
    const byUrl = new Map();

    for (const ev of events) {
      const url = String(ev.url || '').trim();
      if (!url) continue;
      const entry = byUrl.get(url) || { url, count: 0, latestTs: 0, title: ev.title, artist: ev.artist, album: ev.album };
      entry.count++;
      if (ev.ts > entry.latestTs) {
        entry.latestTs = ev.ts;
        entry.title = ev.title;
        entry.artist = ev.artist;
        entry.album = ev.album;
      }
      byUrl.set(url, entry);
    }

    const scored = [];
    for (const entry of byUrl.values()) {
      const daysAgo = (now - entry.latestTs) / 86400000;
      const recency = 1 / (1 + daysAgo * 0.3);
      const freq = Math.log(entry.count + 1);
      const noise = seededNoise(entry.url, day) * 0.3;
      entry.score = freq * recency + noise;
      scored.push(entry);
    }

    scored.sort((a, b) => b.score - a.score);
    return scored;
  }

  // ─── Resolve scored entries to full song objects ───────────
  function resolveTracks(scoredEntries) {
    const resolved = [];

    for (const entry of scoredEntries) {
      if (resolved.length >= TARGET_SIZE) break;

      try {
        // Extract r2Path from Worker URL: ?id=PATH
        let r2Path = '';
        const url = entry.url;
        if (url.includes('?id=')) {
          r2Path = decodeURIComponent(url.split('?id=')[1].split('&')[0]);
        } else {
          r2Path = url;
        }

        // Look up in tracksById map (fastest)
        let track = window.tracksById ? window.tracksById.get(r2Path) : null;

        // Fallback: scan libraryData
        if (!track && Array.isArray(window.libraryData)) {
          outer: for (const album of window.libraryData) {
            const songs = Array.isArray(album.songs) ? album.songs : [];
            for (const s of songs) {
              const sid = String(s.id || s.r2Path || '').trim();
              if (sid && sid === r2Path) {
                track = {
                  ...s,
                  id: sid,
                  r2Path: sid,
                  title: s.title || s.name || '',
                  artistName: s.artistName || album.artistName || '',
                  albumName: s.albumName || album.albumName || '',
                  cover: s.cover || album.coverArt || album.fallbackArt || '',
                  url: s.url || s.link || url,
                };
                break outer;
              }
            }
          }
        }

        // Last resort: build a minimal stub from event data if url is usable
        if (!track && (entry.title || entry.artist)) {
          track = {
            id: r2Path || url,
            r2Path: r2Path || url,
            title: entry.title || 'Unknown',
            artistName: entry.artist || '',
            albumName: entry.album || '',
            cover: '',
            url: url,
          };
        }

        if (track) resolved.push(track);
      } catch (e) {
        // skip unresolvable
      }
    }

    return resolved;
  }

  // ─── Generate an auto-playlist object ─────────────────────
  function generateAutoPlaylist(type) {
    try {
      const raw = localStorage.getItem(EVENTS_KEY);
      const allEvents = raw ? JSON.parse(raw) : [];
      if (!Array.isArray(allEvents)) return null;

      const isDay = (type === 'daylist');
      const hourStart = isDay ? DAY_START : DAY_END;
      const hourEnd   = isDay ? DAY_END   : DAY_START;

      const windowEvents = filterEventsByHourWindow(allEvents, hourStart, hourEnd);
      const scored = scoreEvents(windowEvents);
      const songs = resolveTracks(scored);

      return {
        id: AUTO_IDS[type],
        name: isDay ? 'daylist' : 'nightlist',
        subtitle: isDay ? 'your day in music' : 'your night in music',
        isAutoPlaylist: true,
        autoType: type,
        songs,
        cover: null,
        generatedDate: todayKey(),
        songCount: songs.length,
      };
    } catch (e) {
      console.warn('[ForYou] generateAutoPlaylist failed:', e);
      return null;
    }
  }

  // ─── Cache helpers ─────────────────────────────────────────
  function loadFromCache(type) {
    try {
      const raw = localStorage.getItem(CACHE_KEYS[type]);
      if (!raw) return null;
      const cached = JSON.parse(raw);
      if (!cached || cached.date !== todayKey()) return null;
      return cached.playlist;
    } catch (e) {
      return null;
    }
  }

  function saveToCache(type, playlist) {
    try {
      localStorage.setItem(CACHE_KEYS[type], JSON.stringify({
        date: todayKey(),
        playlist,
      }));
    } catch (e) {}
  }

  // ─── Regenerate and cache both auto-playlists ──────────────
  function generateAndCacheBoth(force) {
    const playlists = {};
    for (const type of ['daylist', 'nightlist']) {
      let pl = force ? null : loadFromCache(type);
      if (!pl) {
        pl = generateAutoPlaylist(type);
        if (pl) saveToCache(type, pl);
      }
      playlists[type] = pl;
    }
    return playlists;
  }

  // ─── Inject auto-playlists into window.playlists (in-memory) ─
  function injectIntoWindowPlaylists(autoPlaylists) {
    try {
      if (!Array.isArray(window.playlists)) window.playlists = [];

      for (const type of ['daylist', 'nightlist']) {
        const pl = autoPlaylists[type];
        if (!pl) continue;

        const idx = window.playlists.findIndex(p => p && p.id === pl.id);
        if (idx === -1) {
          window.playlists.push(pl);
        } else {
          window.playlists[idx] = pl;
        }
      }
    } catch (e) {
      console.warn('[ForYou] injectIntoWindowPlaylists failed:', e);
    }
  }

  // ─── Build the For You section card HTML ──────────────────
  function buildCardHTML(pl, isActive) {
    if (!pl) return '';

    const isDay = (pl.autoType === 'daylist');
    const songCount = Array.isArray(pl.songs) ? pl.songs.length : 0;
    const hasData = songCount > 0;

    const coverClass = isDay ? 'foryou-cover-day' : 'foryou-cover-night';
    const activeClass = isActive ? ' foryou-cover-active-ring' : '';

    const icon = isDay
      ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="foryou-icon">
           <path d="M12 2.25a.75.75 0 0 1 .75.75v2.25a.75.75 0 0 1-1.5 0V3a.75.75 0 0 1 .75-.75ZM7.5 12a4.5 4.5 0 1 1 9 0 4.5 4.5 0 0 1-9 0ZM18.894 6.166a.75.75 0 0 0-1.06-1.06l-1.591 1.59a.75.75 0 1 0 1.06 1.061l1.591-1.59ZM21.75 12a.75.75 0 0 1-.75.75h-2.25a.75.75 0 0 1 0-1.5H21a.75.75 0 0 1 .75.75ZM17.834 18.894a.75.75 0 0 0 1.06-1.06l-1.59-1.591a.75.75 0 1 0-1.061 1.06l1.59 1.591ZM12 18a.75.75 0 0 1 .75.75V21a.75.75 0 0 1-1.5 0v-2.25A.75.75 0 0 1 12 18ZM7.166 17.834a.75.75 0 0 0-1.06 1.06l1.59 1.591a.75.75 0 1 0 1.061-1.06l-1.591-1.591ZM6 12a.75.75 0 0 1-.75.75H3a.75.75 0 0 1 0-1.5h2.25A.75.75 0 0 1 6 12ZM6.166 6.166a.75.75 0 0 0 1.06 1.06l1.591-1.59a.75.75 0 1 0-1.061-1.061l-1.59 1.591Z"/>
         </svg>`
      : `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" class="foryou-icon">
           <path fill-rule="evenodd" d="M9.528 1.718a.75.75 0 0 1 .162.819A8.97 8.97 0 0 0 9 6a9 9 0 0 0 9 9 8.97 8.97 0 0 0 3.463-.69.75.75 0 0 1 .981.98 10.503 10.503 0 0 1-9.694 6.46c-5.799 0-10.5-4.7-10.5-10.5 0-4.368 2.667-8.112 6.46-9.694a.75.75 0 0 1 .818.162Z" clip-rule="evenodd"/>
         </svg>`;

    const countLine = hasData
      ? `<div class="foryou-song-count">${songCount} song${songCount !== 1 ? 's' : ''}</div>`
      : `<div class="foryou-song-count foryou-empty">not enough data yet</div>`;

    return `
<div class="foryou-card" data-auto-type="${pl.autoType}" onclick="window.openAutoPlaylist('${pl.autoType}')" role="button" tabindex="0" aria-label="Open ${pl.name}">
  <div class="foryou-cover ${coverClass}${activeClass}">
  </div>
  <div class="foryou-below">
    <div class="foryou-subtitle">${pl.subtitle}</div>
    ${countLine}
  </div>
</div>`.trim();
  }

  // ─── Render the For You section in the home view ──────────
  window.renderForYouSection = function () {
    try {
      const autoPlaylists = window.__autoPlaylists || {};
      const hour = new Date().getHours();
      const isDaytime = (hour >= DAY_START && hour < DAY_END);

      const dl = autoPlaylists.daylist;
      const nl = autoPlaylists.nightlist;

      const html = `
        <div class="foryou-cards-row">
          ${buildCardHTML(dl, isDaytime)}
          ${buildCardHTML(nl, !isDaytime)}
        </div>
      `;

      // Render into both mobile and desktop containers
      ['for-you-section-mobile', 'for-you-section-desktop'].forEach(id => {
        const section = document.getElementById(id);
        if (!section) return;
        section.innerHTML = html;

        // keyboard accessibility
        section.querySelectorAll('.foryou-card').forEach(card => {
          card.addEventListener('keydown', e => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              card.click();
            }
          });
        });
      });
    } catch (e) {
      console.warn('[ForYou] renderForYouSection failed:', e);
    }
  };

  // ─── Open an auto-playlist in the playlist view ────────────
  window.openAutoPlaylist = function (type) {
    try {
      const pl = window.__autoPlaylists && window.__autoPlaylists[type];
      if (!pl) return;

      // Ensure the auto-playlist is in window.playlists
      if (Array.isArray(window.playlists)) {
        const idx = window.playlists.findIndex(p => p && p.id === pl.id);
        if (idx === -1) window.playlists.push(pl);
      }

      if (typeof showView === 'function') {
        showView('playlist', pl.id);
      }
    } catch (e) {
      console.warn('[ForYou] openAutoPlaylist failed:', e);
    }
  };

  // ─── Save a frozen snapshot to the library ─────────────────
  window.saveAutoPlaylistSnapshot = function (type) {
    try {
      const pl = window.__autoPlaylists && window.__autoPlaylists[type];
      if (!pl) return;

      const d = new Date();
      const label = `${pl.name} \u00b7 ${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`;

      // Generate a simple unique id
      const newId = 'saved-' + type + '-' + Date.now();

      const snapshot = {
        id: newId,
        name: label,
        songs: Array.isArray(pl.songs) ? JSON.parse(JSON.stringify(pl.songs)) : [],
        cover: pl.cover || null,
        isAutoPlaylist: false,
      };

      if (!Array.isArray(window.playlists)) window.playlists = [];
      window.playlists.push(snapshot);

      if (typeof window.savePlaylists === 'function') window.savePlaylists();

      // Sync to cloud if available
      try {
        if (typeof window.savePlaylistToCloud === 'function') window.savePlaylistToCloud(snapshot);
      } catch (e) {}

      // Toast
      try {
        if (typeof window.showPlaylistAddedToast === 'function') {
          window.showPlaylistAddedToast(label, pl.cover || '');
        } else {
          const msg = `Saved "${label}" to your library`;
          if (typeof window.showToast === 'function') {
            window.showToast(msg);
          }
        }
      } catch (e) {}

      try { if (typeof renderPlaylists === 'function') renderPlaylists(); } catch (e) {}
      try { if (typeof renderHome === 'function') renderHome(); } catch (e) {}

      return snapshot;
    } catch (e) {
      console.warn('[ForYou] saveAutoPlaylistSnapshot failed:', e);
    }
  };

  // ─── Bootstrap ────────────────────────────────────────────
  window.initForYou = function (opts) {
    try {
      const force = opts && opts.force;
      const autoPlaylists = generateAndCacheBoth(force);
      window.__autoPlaylists = autoPlaylists;

      injectIntoWindowPlaylists(autoPlaylists);
      window.renderForYouSection();
    } catch (e) {
      console.warn('[ForYou] initForYou failed:', e);
    }
  };

})();
