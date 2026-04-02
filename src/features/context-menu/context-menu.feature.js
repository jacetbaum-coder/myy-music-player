/* ==========================================================
   CONTEXT MENU FEATURE
   - Song context menu (bottom sheet on mobile, popover on desktop)
   - Add-to-playlist submenu (Spotify-style bottom sheet)
   - Add-to-folder submenu (tile grid)
   - Drag-to-close handle interactions (both sheets)
   - Mobile slide-pick and swipe-dismiss gestures
   - menuAction dispatcher (queue, remove, go-to-album, crate, like)
   - Outside-dismiss and ghost-click fix patch
   ========================================================== */

// ---- Shared target ----
var menuTargetSong = null;

// ---- Mobile-safe "Add to playlist" submenu (Spotify-style) ----
window.openAddToPlaylistSubmenu = function (e) {
          try { if (e && e.preventDefault) e.preventDefault(); } catch (_) {}
          try { if (e && e.stopPropagation) e.stopPropagation(); } catch (_) {}

          const sub = document.getElementById('playlist-submenu');
          if (!sub) return;

          try { sub.classList.add('open'); } catch (_) {}
          try { sub.style.display = 'block'; } catch (_) {}

          sub.style.overflow = 'hidden';
          sub.style.webkitOverflowScrolling = 'touch';
          sub.style.position = 'relative';

          sub.innerHTML = `
            <div id="ps_header" style="position:sticky;top:0;z-index:10;background:#000;padding:18px 16px 14px 16px;border-bottom:1px solid rgba(255,255,255,.12);border-radius:18px 18px 0 0">
              <div style="display:flex;align-items:center;justify-content:space-between">
                <button id="ps_cancel" type="button" style="color:#fff;opacity:.85;font-size:18px;background:transparent;border:none;">Cancel</button>
                <div style="color:#fff;font-weight:900;font-size:18px;">Add to playlist</div>
                <div style="width:56px;"></div>
              </div>

              <button id="ps_new" type="button"
                style="margin:18px auto 0 auto;display:block;width:64%;max-width:320px;background:#fff;color:#000;font-weight:900;border-radius:999px;padding:14px 18px;border:none;font-size:22px;">
                New playlist
              </button>

              <div style="margin-top:16px;background:#2a2a2a;border-radius:14px;padding:14px 14px;display:flex;align-items:center;gap:12px;">
                <span style="color:rgba(255,255,255,.75);font-size:18px;line-height:1">🔎</span>
                <input id="ps_search" placeholder="Find playlist" autocomplete="off"
                  style="flex:1;background:transparent;border:none;outline:none;color:#fff;font-size:18px;" />
              </div>

              <div id="__ps_savedin_row" style="display:flex;align-items:center;justify-content:space-between;margin-top:14px;margin-bottom:6px;padding:0 2px;">
                <div style="color:rgba(255,255,255,.85);font-weight:800;font-size:18px;">Saved in</div>
                <button id="__ps_clear_all" type="button" style="background:transparent;border:none;color:#1ed760;font-weight:900;font-size:18px;padding:6px 0;">Clear all</button>
              </div>
            </div>

            <div id="ps_listwrap" style="overflow-y:auto;-webkit-overflow-scrolling:touch; padding:12px 0 120px 0;"></div>

            <button id="ps_done" type="button"
              style="position:absolute;left:50%;transform:translateX(-50%);bottom:10px;width:72%;max-width:360px;
                     background:#1db954;color:#000;font-weight:950;border-radius:999px;padding:14px;border:none;z-index:20;font-size:22px;">
              Done
            </button>
          `;


          const listWrap = sub.querySelector('#ps_listwrap');
          const search   = sub.querySelector('#ps_search');
          const cancel   = sub.querySelector('#ps_cancel');
          const create   = sub.querySelector('#ps_new');
                    const done     = sub.querySelector('#ps_done');
          const clearAll = sub.querySelector('#__ps_clear_all');

			

          const headerH = sub.querySelector('#ps_header')?.getBoundingClientRect()?.height || 140;
          const maxH = Math.min(window.innerHeight * 0.85, window.innerHeight - 80);
          sub.style.maxHeight = `${maxH}px`;
          listWrap.style.maxHeight = `${Math.max(200, maxH - headerH)}px`;

                    sub.__selected = new Set();

          if (clearAll) {
            clearAll.onclick = () => {
              sub.__selected.clear();
              try { renderList(search?.value || ""); } catch (e) {}
            };
          }


          function canonTrackId(v) {
            let s = String(v || "").trim();
            if (!s) return "";
            try {
              if (s.includes("://")) {
                const u = new URL(s);
                const id = u.searchParams.get("id");
                if (id) s = id;
              }
            } catch (e) {}
            if (s.includes("?id=")) {
              try { s = (s.split("?id=")[1] || "").split("&")[0] || s; } catch (e) {}
            }
            try { s = decodeURIComponent(s); } catch (e) {}
            return s.replace(/^\/+/, "").trim();
          }

          function resolveTrackId() {
            const s = window.menuTargetSong;
            if (!s) return "";
            let trackId =
              s.id || s.r2Path || s.track_id || s.trackId || s.key || s.r2_key || "";
            if (!trackId) {
              const u = s.link || s.url || "";
              try {
                const parsed = new URL(u, window.location.origin);
                trackId = parsed.searchParams.get("id") || "";
              } catch (_) {}
            }
            return canonTrackId(trackId);
          }

          function getPlaylistId(p) {
            return String(p?.id || p?.playlistId || p?.playlist_id || "").trim();
          }

          function renderList(q) {
            const needle = String(q || "").toLowerCase().trim();
            listWrap.innerHTML = "";

                        const plsLocal = Array.isArray(window.playlists) ? window.playlists : [];
            const plsCloud = Array.isArray(window.cloudPlaylists) ? window.cloudPlaylists : [];

            // Merge (cloud first), de-dupe by playlist id
            const byId = new Map();
            for (const p of [...plsCloud, ...plsLocal]) {
              const pid = getPlaylistId(p);
              if (!pid) continue;
              if (!byId.has(pid)) byId.set(pid, p);
            }

                        function getPlaylistCover(p) {
              let eff = "";
              try {
                if (typeof window.getEffectivePlaylistCover === "function") {
                  eff = String(window.getEffectivePlaylistCover(p) || "").trim();
                }
              } catch (e) {}

              const src = eff ||
                p?.autoCover ||
                p?.cover ||
                p?.coverUrl ||
                p?.cover_url ||
                p?.image ||
                p?.img ||
                p?.art ||
                "";

              return String(src || "").trim();
            }


                        const rows = Array.from(byId.values())
              .map(p => ({
                pid: getPlaylistId(p),
                name: String(p?.name || "Untitled"),
                cover: getPlaylistCover(p),
                count:
                  (Array.isArray(p?.trackIds) ? p.trackIds.length : null) ??
                  (Array.isArray(p?.tracks) ? p.tracks.length : null) ??
                  (typeof p?.trackCount === "number" ? p.trackCount : null) ??
                  null
              }))
              .filter(r => r.pid)
              .filter(r => !needle || r.name.toLowerCase().includes(needle));


            rows.forEach(({ pid, name, cover }) => {

              const row = document.createElement('div');
              row.style.display = 'flex';
              row.style.alignItems = 'center';
              row.style.justifyContent = 'space-between';
              row.style.padding = '14px 12px';
              row.style.color = '#fff';

                             // Left side: cover + title (keeps title left-aligned, with a small "tad" offset)
               const left = document.createElement('div');
               left.style.display = 'flex';
               left.style.alignItems = 'center';
               left.style.gap = '12px';
               left.style.flex = '1';
               left.style.minWidth = '0';

               const img = document.createElement('img');
               img.alt = '';
                              img.style.width = '56px';
               img.style.height = '56px';
               img.style.flex = '0 0 56px';

               if (cover) img.src = cover;
               img.addEventListener('error', () => {
                 // If cover URL is bad/missing, just show the dark placeholder square
                 try { img.removeAttribute('src'); } catch (e) {}
               }, { once: true });

                             const textWrap = document.createElement('div');
               textWrap.style.display = 'flex';
               textWrap.style.flexDirection = 'column';
               textWrap.style.minWidth = '0';
               textWrap.style.gap = '6px';

               const titleEl = document.createElement('div');
               titleEl.textContent = name;
               titleEl.style.fontWeight = '900';
               titleEl.style.fontSize = '22px';
               titleEl.style.textAlign = 'left';
               titleEl.style.minWidth = '0';
               titleEl.style.overflow = 'hidden';
               titleEl.style.textOverflow = 'ellipsis';
               titleEl.style.whiteSpace = 'nowrap';
               titleEl.style.color = '#fff';

               const subEl = document.createElement('div');
               const countText = (typeof count === 'number' && isFinite(count)) ? `${count} songs` : '';
               subEl.textContent = countText;
               subEl.style.fontWeight = '700';
               subEl.style.fontSize = '18px';
               subEl.style.textAlign = 'left';
               subEl.style.minWidth = '0';
               subEl.style.overflow = 'hidden';
               subEl.style.textOverflow = 'ellipsis';
               subEl.style.whiteSpace = 'nowrap';
               subEl.style.color = 'rgba(255,255,255,.55)';

               textWrap.appendChild(titleEl);
               if (countText) textWrap.appendChild(subEl);

               left.append(img, textWrap);

               const bubble = document.createElement('div');

              bubble.style.width = '26px';
              bubble.style.height = '26px';
              bubble.style.borderRadius = '50%';
              bubble.style.border = '2px solid rgba(255,255,255,.4)';
              bubble.style.display = 'grid';
              bubble.style.placeItems = 'center';

              function paint() {
                const on = sub.__selected.has(pid);
                if (on) {
                  bubble.style.background = '#1db954';
                  bubble.style.borderColor = '#1db954';
                  bubble.innerHTML = '<span style="color:#000;font-weight:950;">✓</span>';
                } else {
                  bubble.style.background = 'transparent';
                  bubble.style.borderColor = 'rgba(255,255,255,.4)';
                  bubble.innerHTML = '';
                }
              }
              paint();

              row.addEventListener('click', (ev) => {
                try { ev.preventDefault(); } catch (_) {}
                try { ev.stopPropagation(); } catch (_) {}
                if (sub.__selected.has(pid)) sub.__selected.delete(pid);
                else sub.__selected.add(pid);
                paint();
              }, true);

                             row.append(left, bubble);
               listWrap.appendChild(row);

            });
          }

          renderList("");
          search.addEventListener('input', () => renderList(search.value), true);

          cancel.addEventListener('click', (ev) => {
            try { ev.preventDefault(); } catch (_) {}
            try { ev.stopPropagation(); } catch (_) {}
            if (typeof window.closeContextMenu === "function") window.closeContextMenu();
          }, true);

          create.addEventListener('click', (ev) => {
            try { ev.preventDefault(); } catch (_) {}
            try { ev.stopPropagation(); } catch (_) {}
            if (typeof window.createNewPlaylist === "function") window.createNewPlaylist();
          }, true);

          done.addEventListener('click', async (ev) => {
            try { ev.preventDefault(); } catch (_) {}
            try { ev.stopPropagation(); } catch (_) {}

            const ids = Array.from(sub.__selected || []);
            if (!ids.length) {
              if (typeof window.closeContextMenu === "function") window.closeContextMenu();
              return;
            }

            const trackId = resolveTrackId();
            if (!trackId) return alert("Missing trackId for this song.");

            let ok = 0;

            for (const pid of ids) {
              try {
                if (typeof window.addTrackToPlaylistInCloud !== "function") throw new Error("addTrackToPlaylistInCloud missing");
                await window.addTrackToPlaylistInCloud(pid, trackId);
                ok++;
              } catch (err) {
                console.warn("❌ cloud add failed:", pid, err);
                continue;
              }

              // local best-effort (ignore quota)
              try {
                const pls = Array.isArray(window.playlists) ? window.playlists : [];
                const pl = pls.find(p => String(p?.id || p?.playlistId || p?.playlist_id || "") === pid);
                if (pl) {
                  if (!Array.isArray(pl.trackIds)) pl.trackIds = [];
                  const set = new Set(pl.trackIds.map(canonTrackId));
                  if (!set.has(trackId)) pl.trackIds.push(trackId);
                  try { if (typeof window.savePlaylists === "function") window.savePlaylists(); } catch (_) {}
                }
              } catch (_) {}
            }

            if (!ok) {
              alert("Couldn't add to playlist (cloud sync failed).");
              return;
            }

            if (typeof window.closeContextMenu === "function") window.closeContextMenu();
          }, true);
        };

// ---- Suppress-close timing guards (var → window.*) ----
var suppressContextMenuCloseUntil = 0;
var suppressPlaylistMenuCloseUntil = 0;

// (old drag-to-close removed — replaced by 3-state handler below)

// ---- Context menu DOM references (also kept in inline script for initGlobalKeys) ----
// var so these land on window and are accessible from other scripts (e.g. initGlobalKeys in index.html)
var contextMenu = document.getElementById("context-menu");
var contextMenuBackdrop = document.getElementById("context-menu-backdrop");

// ✅ Ensure context menu renders in the same visual layer as Now Playing
try {
  const npRoot =
    document.getElementById("now-playing-overlay") ||
    document.querySelector('[id*="now-playing"]') ||
    document.querySelector('[class*="now-playing"]');

  if (npRoot && contextMenu && contextMenuBackdrop) {
    npRoot.appendChild(contextMenuBackdrop);
    npRoot.appendChild(contextMenu);
  }
} catch (e) {}

let contextMenuAnchor = null;
let contextMenuScrollHandler = null;
var contextMenuCloseTimer = null;

// ---- closeContextMenu ----
function closeContextMenu(e) {

  const sub = document.getElementById('playlist-submenu');

  // Mobile: animate down then hide
  if (window.innerWidth <= 768) {  const sub = document.getElementById('playlist-submenu');

  // ✅ If this close was triggered by a click/tap INSIDE the playlist submenu, ignore it.
  // This prevents the global capture outside-dismiss from nuking the submenu.
  try {
    if (e && e.target) {
      if (sub && (sub === e.target || sub.contains(e.target))) return;

      // If user just hit "Add to playlist" option, submenu is about to open — don't close.
      if (e.target.closest && e.target.closest('#menu-add-opt')) return;
    }
  } catch (_) {}

  // ✅ If we JUST opened, ignore this close (ghost / stacked dismiss listeners)
  try {
    const sc = (typeof suppressContextMenuCloseUntil !== 'undefined') ? suppressContextMenuCloseUntil : 0;
    const sp = (typeof suppressPlaylistMenuCloseUntil !== 'undefined') ? suppressPlaylistMenuCloseUntil : 0;
    if (Date.now() < sc || Date.now() < sp) return;
  } catch (_) {}

    if (contextMenuBackdrop) {
      contextMenuBackdrop.style.opacity = '0';
    }

    // hide playlist panel immediately (it has its own transform)
    if (sub) {
      sub.classList.remove('open');
      sub.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1), opacity 200ms ease';
      sub.style.transform = 'translateY(100%)';
      sub.style.opacity = '0';
    }

    // slide main sheet down
    contextMenu.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
    contextMenu.style.transform = 'translateY(100%)';

    if (contextMenuCloseTimer) {
      clearTimeout(contextMenuCloseTimer);
      contextMenuCloseTimer = null;
    }

    contextMenuCloseTimer = setTimeout(() => {
      contextMenu.style.display = 'none';
      contextMenu.style.right = '';
      contextMenu.style.height = '';
      contextMenu.style.maxHeight = '';
      contextMenu.style.overflowY = '';
      contextMenuAnchor = null;

      if (sub) {
        sub.style.display = 'none';
        sub.style.transform = '';
        sub.style.opacity = '';
      }

      if (contextMenuBackdrop) {
        contextMenuBackdrop.style.display = 'none';
      }

      if (contextMenuScrollHandler) {
        window.removeEventListener('scroll', contextMenuScrollHandler, true);
        contextMenuScrollHandler = null;
      }

      contextMenuCloseTimer = null;
    }, 220);

    return;
  }

  // Desktop: old behavior
  contextMenu.style.display = 'none';
  contextMenu.style.transform = '';
  contextMenu.style.right = '';
  contextMenuAnchor = null;

  // Desktop: also hide any open playlist submenu flyout
  if (sub) {
    sub.classList.remove('open');
    sub.style.display = 'none';
    sub.style.transform = '';
    sub.style.opacity = '';
  }

  if (contextMenuScrollHandler) {
    window.removeEventListener('scroll', contextMenuScrollHandler, true);
    contextMenuScrollHandler = null;
  }
}

// ---- 3-state snap drag handle (half → full → close) ----
(function initContextMenuDragToClose(){
  if (window.__cmDrag3Init) return;
  window.__cmDrag3Init = true;

  function isMobile(){ return window.innerWidth <= 768; }

  function attach(sheetId){
    const sheet = document.getElementById(sheetId);
    if (!sheet) return;

    // Listen on the whole upper drag zone for expand/collapse gestures
    const handle = sheet.querySelector('.cm-drag-zone') || sheet.querySelector('.cm-handle');
    if (!handle) return;

    let startY = 0;
    let dragging = false;
    // 3-state: 'half' (default) | 'full' (expanded)
    sheet.__cmSnapState = 'half';

    function snapToFull() {
      sheet.__cmSnapState = 'full';
      sheet.style.transition = 'max-height 320ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      sheet.style.transform = 'translateY(0)';
      sheet.style.maxHeight = '92vh';
      sheet.style.overflowY = 'auto';
      const bd = document.getElementById('context-menu-backdrop');
      if (bd) bd.style.opacity = '1';
    }

    function snapToHalf() {
      sheet.__cmSnapState = 'half';
      sheet.style.transition = 'max-height 280ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      sheet.style.transform = 'translateY(0)';
      sheet.style.maxHeight = '55vh';
      sheet.style.overflowY = 'auto';
      const bd = document.getElementById('context-menu-backdrop');
      if (bd) bd.style.opacity = '1';
    }

    handle.addEventListener('pointerdown', (e) => {
      if (!isMobile()) return;
      if (e.pointerType === 'mouse') return;

      dragging = true;
      startY = e.clientY;

      try { sheet.style.transition = 'none'; } catch (err) {}
      try { e.preventDefault(); } catch (err) {}
    }, { passive: false });

    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      if (!isMobile()) return;
      if (e.pointerType === 'mouse') return;

      const dy = e.clientY - startY;
      if (dy > 0) {
        sheet.style.transform = `translateY(${dy}px)`;
        const bd = document.getElementById('context-menu-backdrop');
        if (bd && sheetId === 'context-menu') {
          const t = Math.min(1, dy / 200);
          bd.style.opacity = String(1 - t * 0.7);
        }
      }
    }, { passive: true });

    window.addEventListener('pointerup', (e) => {
      if (!dragging) return;
      dragging = false;

      const dy = e.clientY - startY;

      if (dy < -50) {
        // Swiped UP → expand to full
        snapToFull();
      } else if (dy > 50) {
        // Swiped DOWN
        if (sheet.__cmSnapState === 'full') {
          // full → half
          snapToHalf();
        } else {
          // half → close
          try { closeContextMenu(); } catch (err) {}
        }
      } else {
        // Short movement — snap back to current state
        sheet.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
        sheet.style.transform = 'translateY(0)';
        const bd = document.getElementById('context-menu-backdrop');
        if (bd) bd.style.opacity = '1';
      }
    }, { passive: true });

    window.addEventListener('pointercancel', () => {
      if (!dragging) return;
      dragging = false;
      sheet.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
      sheet.style.transform = 'translateY(0)';
      const bd = document.getElementById('context-menu-backdrop');
      if (bd) bd.style.opacity = '1';
    }, { passive: true });
  }

  // main sheet + playlist sheet both get drag handle behavior
  attach('context-menu');
  attach('playlist-submenu');
})();

// ---- Context Menu positioning (desktop) ----
function positionContextMenuForAnchor(anchorEl) {
  if (!anchorEl) return;
  const rect = anchorEl.getBoundingClientRect();
  const menuWidth = contextMenu.offsetWidth || 230;
  const menuHeight = contextMenu.offsetHeight || 160;

  const left = Math.max(12, Math.min(rect.right - menuWidth - 12, window.innerWidth - menuWidth - 12));
  const top = Math.max(12, Math.min(rect.top + rect.height / 2 - menuHeight / 2, window.innerHeight - menuHeight - 12));

  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
}

// ---- showContextMenuAt ----
function showContextMenuAt(x, y, song, anchorEl = null) {
  // ✅ Always resolve a real target song for submenu actions
  const _resolvedSong =
    song ||
    ((typeof currentSong !== 'undefined' && currentSong) ? currentSong : null) ||
    (window.currentSong || null);

        menuTargetSong = _resolvedSong;

            // ✅ Ensure context menu is attached to the correct layer
// If Now Playing overlay is open, keep the menu inside it (so it sits above the overlay).
try {
  const np = document.getElementById('now-playing-overlay');
  const npOpen = !!(np && !np.classList.contains('hidden'));
  const host = npOpen ? np : document.body;

  if (typeof contextMenu !== 'undefined' && contextMenu) host.appendChild(contextMenu);
  if (typeof contextMenuBackdrop !== 'undefined' && contextMenuBackdrop) host.appendChild(contextMenuBackdrop);

  // ✅ Ensure it wins z-index battles
  try { if (contextMenu) contextMenu.style.zIndex = '200000'; } catch (e) {}
  try { if (contextMenuBackdrop) contextMenuBackdrop.style.zIndex = '199999'; } catch (e) {}
} catch (e) {}

try { suppressContextMenuCloseUntil = Date.now() + 600; } catch (e) {}

try { window.__outsideDismissSkipUntil = Date.now() + 600; } catch (e) {}

try { window.menuTargetSong = menuTargetSong; } catch (e) {}


  // Fill the sheet header with the pressed song


    try {
    const tEl = document.getElementById('cm-title');
    const aEl = document.getElementById('cm-artist');
    const cEl = document.getElementById('cm-cover');

    const s = _resolvedSong;

    if (tEl) tEl.textContent = (s && (s.title || s.name)) ? (s.title || s.name) : 'Song';
    if (aEl) aEl.textContent = (s && (s.artist || s.artistName)) ? (s.artist || s.artistName) : 'Artist';
        if (cEl) cEl.src =
      (s && (s.cover || s.coverUrl || s.art || s.image))
        ? (s.cover || s.coverUrl || s.art || s.image)
        : (() => {
            // ✅ Prefer the clicked row's thumbnail (so we don't show Now Playing art)
            try {
              const row = anchorEl ? anchorEl.closest('.track-row') : null;
              const img = row ? row.querySelector('img') : null;
              const src = img ? (img.currentSrc || img.src) : '';
              if (src) return src;
            } catch (e) {}
            // fallback: Now Playing cover
            return (document.getElementById('p-cover') ? document.getElementById('p-cover').src : '');
          })();

  } catch (err) {}


    // Show / hide "Remove from playlist"
  const removeOpt = document.getElementById('menu-remove-opt');
  if (removeOpt) {
    removeOpt.style.display = activePlaylistId ? 'flex' : 'none';
  }

  // Show "Add to folder" only when the target is a playlist/album, not a single song
  const folderOpt = document.getElementById('menu-folder-opt');
  if (folderOpt) {
    folderOpt.style.display = (song && song.type === 'playlist') ? 'flex' : 'none';
  }

  // Show "Save to Library" only for auto-playlists (Daylist / Nightlist)
  const saveAutoOpt = document.getElementById('menu-save-autoplaylist-opt');
  if (saveAutoOpt) {
    const isAutoPlaylist = song && song.type === 'playlist' &&
      (song.id === '__daylist__' || song.id === '__nightlist__');
    saveAutoOpt.style.display = isAutoPlaylist ? 'flex' : 'none';
  }

  // Default: show the normal single-song options
const addOpt = document.getElementById('menu-add-opt');
const qAddOpt = document.getElementById('menu-queue-add-opt');
const crateOpt = document.getElementById('menu-crate-add-artist-opt');
const goAlbumOpt = document.getElementById('menu-go-album-opt');
const qGoOpt = document.getElementById('menu-queue-go-opt');

if (addOpt) addOpt.style.display = 'flex';
if (qAddOpt) qAddOpt.style.display = 'flex';
if (crateOpt) crateOpt.style.display = 'flex';
if (qGoOpt) qGoOpt.style.display = 'flex';

// ✅ Infer Artist + Album from the song id/url when possible
let __artistName = "";

try {
  __artistName = (song && (song.artistName || song.artist)) ? String(song.artistName || song.artist).trim() : "";
  __albumName = (song && (song.albumName || song.album)) ? String(song.albumName || song.album).trim() : "";

  if (!__artistName || !__albumName) {
    let tid = String(
      (song && (song.id || song.r2Path || song.r2_key || song.track_id || song.trackId || song.link || song.url)) || ""
    ).trim();

    // If it's a Worker URL, pull the real key from ?id=
    if (tid.includes("?id=")) {
      try { tid = decodeURIComponent(tid.split("?id=")[1].split("&")[0]); } catch (e) {}
    }

    const parts = tid.split("/").filter(Boolean);
    if (parts.length >= 3) {
      if (!__artistName) __artistName = parts[0];
      if (!__albumName) __albumName = parts[1];
    }
  }

  // store back onto the target song so menuAction can use it
  if (menuTargetSong) {
    if (__artistName && !menuTargetSong.artist) menuTargetSong.artist = __artistName;
    if (__albumName) menuTargetSong.albumName = __albumName;
  }
} catch (e) {}

// ✅ Only show "Go to album" if we found an album name
if (goAlbumOpt) goAlbumOpt.style.display = __albumName ? 'flex' : 'none';

// Desktop hover behavior: arm + open playlist submenu like Spotify
if (window.innerWidth > 768 && addOpt) {
  addOpt.onmouseenter = (ev) => {
    try { addOpt.classList.add('cm-armed'); } catch (e) {}
    try {
      const ps = document.getElementById('playlist-submenu');
      if (ps && ps.classList.contains('open')) return;
      openPlaylistSubmenu(ev);
    } catch (e) {
      
    }
  };
  addOpt.onmouseleave = () => {
    try { addOpt.classList.remove('cm-armed'); } catch (e) {}
  };
}



  // ✅ Labels — do not overwrite innerHTML (icons are embedded in the spans)
  // Labels are already baked into the HTML, no override needed.

  // ✅ Order: Add to queue above Go to queue
  try {
    if (qAddOpt && qGoOpt && qGoOpt.parentNode) {
      qGoOpt.parentNode.insertBefore(qAddOpt, qGoOpt);
    }
  } catch (e) {}


  // Mobile: bottom sheet (ignore x/y)
    // ✅ Strip any stale cm-armed highlight from a previous interaction before opening
    try {
      contextMenu.querySelectorAll('.cm-armed').forEach(el => el.classList.remove('cm-armed'));
    } catch (e) {}

    // Mobile: bottom sheet (ignore x/y)
      if (window.innerWidth <= 768) {

    // ✅ If a previous close animation timer is still pending, cancel it.
    // Otherwise it will fire right after we open and instantly hide the menu again.
    if (contextMenuCloseTimer) {
      clearTimeout(contextMenuCloseTimer);
      contextMenuCloseTimer = null;
    }

    // ✅ undo closeContextMenu() inline display:none

    try { contextMenu.style.display = 'block'; } catch (e) {}
    try { contextMenuBackdrop.style.display = 'block'; } catch (e) {}

    // close submenu by default
    const sub = document.getElementById('playlist-submenu');
    if (sub) sub.classList.remove('open');

        if (contextMenuBackdrop) {
      // ✅ ensure backdrop is actually visible (display) before animating opacity
      contextMenuBackdrop.style.display = 'block';

      contextMenuBackdrop.style.opacity = '0';

    }

    contextMenu.style.display = 'block';
    contextMenu.style.height = '';
    contextMenu.style.maxHeight = '55vh';
    contextMenu.style.overflowY = 'auto';
    contextMenu.__cmSnapState = 'half';
    contextMenu.style.transition = 'none';
    contextMenu.style.transform = 'translateY(100%)';

    // animate up on next frame (same feel as your dock / now-playing)
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        if (contextMenuBackdrop) contextMenuBackdrop.style.opacity = '1';
        contextMenu.style.transition = 'transform 200ms cubic-bezier(0.2, 0.8, 0.2, 1)';
                contextMenu.style.transform = 'translateY(0)';


      });
    });

   suppressContextMenuCloseUntil = Date.now() + 400;
window.__outsideDismissSkipUntil = Date.now() + 450;
window.__cmArmGuardUntil = Date.now() + 300;
return;

  }

  // Desktop: existing anchored popover behavior
  const useAnchor = anchorEl && window.innerWidth <= 768;
  if (useAnchor) {
    contextMenu.style.position = 'fixed';
    contextMenu.style.transform = '';
    contextMenu.style.right = '';
    contextMenuAnchor = anchorEl;
    positionContextMenuForAnchor(anchorEl);
    if (!contextMenuScrollHandler) {
      contextMenuScrollHandler = () => {
        if (contextMenuAnchor) positionContextMenuForAnchor(contextMenuAnchor);
      };
      window.addEventListener('scroll', contextMenuScrollHandler, true);
    }
  } else {
    contextMenu.style.position = 'fixed';
    // Desktop: force compact menu sizing each open
    contextMenu.style.height = 'auto';
    contextMenu.style.minHeight = '0';
    contextMenu.style.maxHeight = 'none';
    contextMenu.style.overflow = 'visible';
    contextMenu.style.padding = '4px';
    contextMenu.style.bottom = 'auto';
    contextMenu.style.margin = '0';

    // Desktop: explicitly hide song header so the menu stays short
    try {
      const _hdl = contextMenu.querySelector('.cm-handle');
      const _sng = contextMenu.querySelector('.cm-song');
      const _div = contextMenu.querySelector('.cm-divider');
      if (_hdl) _hdl.style.display = 'none';
      if (_sng) _sng.style.display = 'none';
      if (_div) _div.style.display = 'none';
    } catch (e) {}

    contextMenu.style.display = 'block';
    contextMenu.style.visibility = 'hidden';

    const mw = contextMenu.offsetWidth || 280;
    const mh = contextMenu.offsetHeight || 240;
    const pad = 8;

    // Default: top-left of menu at cursor (like Spotify); flip if near screen edge
    let left = x;
    let top = y;
    if (left + mw + pad > window.innerWidth)  left = x - mw;
    if (top  + mh + pad > window.innerHeight) top  = y - mh;
    left = Math.max(pad, left);
    top  = Math.max(pad, top);

    contextMenu.style.left = left + 'px';
    contextMenu.style.top = top + 'px';
    contextMenu.style.transform = '';
    contextMenu.style.right = '';
    contextMenu.style.visibility = 'visible';
    contextMenuAnchor = null;
    if (contextMenuScrollHandler) {
      window.removeEventListener('scroll', contextMenuScrollHandler, true);
      contextMenuScrollHandler = null;
    }
  }

  contextMenu.style.display = 'block';
suppressContextMenuCloseUntil = Date.now() + 400;
window.__outsideDismissSkipUntil = Date.now() + 450;

}

// ---- showMultiSelectContextMenuFromHero ----
function showMultiSelectContextMenuFromHero(anchorEl){
  const urls = (typeof getSelectedSongUrls === 'function') ? getSelectedSongUrls() : [];
  if (!urls || !urls.length) return;

  // Open the existing bottom-sheet menu first
  try { showContextMenuAt(0, 0, {}, anchorEl || null); } catch (e) {}

  // Now set the real multi-select target (array is supported by remove logic)
  try {
    menuTargetSong = urls.map(u => ({ url: u, link: u }));
  } catch (e) {}

  // Header: "X songs selected" + hide cover
  try {
    const tEl = document.getElementById('cm-title');
    const aEl = document.getElementById('cm-artist');
    const cEl = document.getElementById('cm-cover');
    const n = urls.length;
    if (tEl) tEl.textContent = `${n} song${n === 1 ? '' : 's'} selected`;
    if (aEl) aEl.textContent = '';
    if (cEl) {
      cEl.src = '';
      cEl.style.opacity = '0';
    }
  } catch (e) {}

    const addOpt = document.getElementById('menu-add-opt');
  const qAddOpt = document.getElementById('menu-queue-add-opt');
  const crateOpt = document.getElementById('menu-crate-add-artist-opt');
  const goAlbumOpt = document.getElementById('menu-go-album-opt');
  const qGoOpt = document.getElementById('menu-queue-go-opt');

  if (addOpt) addOpt.style.display = 'flex';
  if (qAddOpt) qAddOpt.style.display = 'flex';
  if (crateOpt) crateOpt.style.display = 'flex';
  if (qGoOpt) qGoOpt.style.display = 'flex';

   // ✅ Decide album name reliably
  let __albumName = "";
  let __artistName = "";

  // 1) If song object already has it
  try {
    __artistName = (song && (song.artistName || song.artist)) ? String(song.artistName || song.artist).trim() : "";
    __albumName  = (song && (song.albumName  || song.album))  ? String(song.albumName  || song.album).trim()  : "";
  } catch (e) {}

  // 2) Otherwise derive from the R2 key in the song url/id:
  //    Artist/Album/Track.mp3  -> album = parts[1]
  //    Artist/Track.mp3        -> treat as album = "Singles"
  if (!__albumName || !__artistName) {
    try {
      const raw = String(song && (song.id || song.trackId || song.r2Path || song.url || song.link) || "").trim();
      const urlish = raw.includes("?id=") ? decodeURIComponent(raw.split("?id=")[1].split("&")[0]) : raw;
      const parts = urlish.split("/").filter(Boolean);

      if (!__artistName && parts.length >= 1) __artistName = String(parts[0] || "").trim();

      if (!__albumName) {
        if (parts.length >= 3) __albumName = String(parts[1] || "").trim();
        else if (parts.length === 2) __albumName = "Singles";
      }
    } catch (e) {}
  }

  // 3) If still empty, try the clicked row's dataset url (this is your .track-row.group[data-url])
  if (!__albumName || !__artistName) {
    try {
      const row = anchorEl && anchorEl.closest ? anchorEl.closest(".track-row.group[data-url], .track-row[data-song-url], .track-row") : null;
      const rowUrl = row ? (row.getAttribute("data-song-url") || (row.dataset ? row.dataset.url : "") || "") : "";
      const id = rowUrl.includes("?id=") ? decodeURIComponent(rowUrl.split("?id=")[1].split("&")[0]) : "";
      const parts = id.split("/").filter(Boolean);

      if (!__artistName && parts.length >= 1) __artistName = String(parts[0] || "").trim();

      if (!__albumName) {
        if (parts.length >= 3) __albumName = String(parts[1] || "").trim();
        else if (parts.length === 2) __albumName = "Singles";
      }
    } catch (e) {}
  }

  // Remember for menuAction('go_album')
  try { window.__menuTargetAlbumName = __albumName; } catch (e) {}
  try { window.__menuTargetArtistName = __artistName; } catch (e) {}

  // Show/hide the option
  if (goAlbumOpt) goAlbumOpt.style.display = __albumName ? 'flex' : 'none';
}

// ---- handleContextMenu (simple, desktop fallback) ----
function handleContextMenu(e, song) {
  e.preventDefault();
  showContextMenuAt(e.clientX, e.clientY, song);
}

// ---- closePlaylistSubmenuQuick ----
function closePlaylistSubmenuQuick(){
  try{
    const submenu = document.getElementById('playlist-submenu');
    if (!submenu) return;
    submenu.classList.remove('open');
    submenu.style.display = 'none';
  }catch(e){}
}

// ---- openAddToFolderSubmenu ----
function openAddToFolderSubmenu(event){
  try{
    if (event) { event.preventDefault(); event.stopPropagation(); }
  }catch(e){}

  const submenu = document.getElementById('playlist-submenu');
  const items = document.getElementById('playlist-submenu-items');
  const title = submenu ? submenu.querySelector('.cm-submenu-title') : null;

  if (!submenu || !items || !title) {
    console.warn("Add-to-folder submenu missing DOM pieces");
    return;
  }

  const isDesktop = window.innerWidth > 768;

  if (isDesktop) {
    title.textContent = "Add to folder";

    try {
      const cm = document.getElementById('context-menu');
      const cmRect = cm ? cm.getBoundingClientRect() : null;
      const flyW = 280;
      const pad = 8;

      const baseLeft = cmRect ? (cmRect.right + 4) : (window.innerWidth * 0.55);
      const baseTop = cmRect ? cmRect.top : (window.innerHeight * 0.24);

      const left = Math.max(pad, Math.min(baseLeft, window.innerWidth - flyW - pad));
      const top = Math.max(pad, baseTop);

      submenu.style.position = 'fixed';
      submenu.style.left = `${left}px`;
      submenu.style.top = `${top}px`;
      submenu.style.right = 'auto';
      submenu.style.bottom = 'auto';
      submenu.style.width = `${flyW}px`;
      submenu.style.maxWidth = `min(${flyW}px, calc(100vw - 24px))`;
      submenu.style.height = 'auto';
      submenu.style.maxHeight = 'calc(100vh - 24px)';
      submenu.style.display = 'block';
      submenu.style.overflow = 'hidden';
      submenu.style.background = 'rgba(42,42,42,0.98)';
      submenu.style.border = '1px solid rgba(255,255,255,0.10)';
      submenu.style.borderRadius = '8px';
      submenu.style.boxShadow = '0 14px 38px rgba(0,0,0,0.45)';
      submenu.style.transform = 'none';
      submenu.style.opacity = '1';
      submenu.style.pointerEvents = 'auto';
      submenu.style.zIndex = '200500';
      submenu.classList.add('open');
    } catch (e) {}

    let folders = [];
    try {
      const raw = localStorage.getItem('folders');
      const arr = raw ? JSON.parse(raw) : [];
      folders = Array.isArray(arr) ? arr : [];
    } catch (e) {
      folders = [];
    }

    const getCurrentPlaylistId = () => {
      const a = (window.navCurrent && window.navCurrent.playlistId) ? String(window.navCurrent.playlistId) : '';
      const b = (window.menuTargetSong && window.menuTargetSong.playlistId) ? String(window.menuTargetSong.playlistId) : '';
      const c = (window.menuTargetSong && window.menuTargetSong.id) ? String(window.menuTargetSong.id) : '';
      return (a || b || c || '').trim();
    };

    const addCurrentPlaylistToFolder = (folderId) => {
      const pid = getCurrentPlaylistId();
      if (!pid) return;
      const idx = folders.findIndex(f => String(f?.id || '') === String(folderId));
      if (idx < 0) return;

      const folder = folders[idx];
      folder.playlistIds = Array.isArray(folder.playlistIds) ? folder.playlistIds.map(String) : [];
      if (!folder.playlistIds.includes(pid)) folder.playlistIds.push(pid);

      try { localStorage.setItem('folders', JSON.stringify(folders)); } catch (e) {}
      try { if (typeof window.closeContextMenu === 'function') window.closeContextMenu(); } catch (e) {}
    };

    items.innerHTML = `
      <div style="padding:10px;border-bottom:1px solid rgba(255,255,255,0.08);">
        <div style="display:flex;align-items:center;gap:8px;background:rgba(255,255,255,0.10);border-radius:6px;padding:8px 10px;">
          <i class="fas fa-search" style="opacity:.75"></i>
          <input id="folder_desktop_search" placeholder="Find a folder" autocomplete="off"
                 style="flex:1;background:transparent;border:none;outline:none;color:#fff;font-size:15px;">
        </div>
      </div>
      <div id="folder_desktop_list" style="max-height:356px;overflow:auto;"></div>
    `;

    const list = items.querySelector('#folder_desktop_list');
    const search = items.querySelector('#folder_desktop_search');

    const renderList = (q = '') => {
      const needle = String(q || '').trim().toLowerCase();
      const rows = folders.filter(f => !needle || String(f?.name || '').toLowerCase().includes(needle));
      list.innerHTML = '';

      const mk = (label, onClick, withArrow = false) => {
        const el = document.createElement('div');
        el.className = 'menu-item';
        el.style.display = 'flex';
        el.style.alignItems = 'center';
        el.style.justifyContent = 'space-between';
        el.style.padding = '10px 14px';
        el.style.cursor = 'pointer';
        el.innerHTML = `<span>${label}</span>${withArrow ? '<i class="fas fa-chevron-right" style="font-size:12px;opacity:.8"></i>' : ''}`;
        el.addEventListener('mouseenter', () => el.classList.add('cm-armed'));
        el.addEventListener('mouseleave', () => el.classList.remove('cm-armed'));
        el.addEventListener('click', (e) => { e.preventDefault(); e.stopPropagation(); onClick(); });
        return el;
      };

      list.appendChild(mk('New Folder', () => {
        try {
          const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
          folders.push({ id, name: 'New Folder', playlistIds: [] });
          localStorage.setItem('folders', JSON.stringify(folders));
          renderList(search ? search.value : '');
        } catch (e) {}
      }, true));

      rows.forEach((f) => {
        list.appendChild(mk(String(f?.name || 'Folder'), () => addCurrentPlaylistToFolder(f.id)));
      });
    };

    if (search) search.addEventListener('input', () => renderList(search.value));
    renderList('');
    return;
  }

  // Title
  title.textContent = "Add to folder";

  // Clear old items
  items.innerHTML = "";

  // ---- Folders UI: centered pill + Spotify-ish tiles ----
  items.innerHTML = `
    <div class="folder-new-row">
      <button id="folder-new-pill" type="button">+ New Folder</button>
    </div>

    <div id="folder-tiles-grid" class="folder-tiles-grid"></div>
  `;

    // Data: folders persisted in localStorage (single source of truth)
  try {
    const raw = localStorage.getItem('folders');
    const arr = raw ? JSON.parse(raw) : [];
    window.folders = Array.isArray(arr) ? arr : [];
  } catch (e) {
    window.folders = [];
  }

  const gridEl = document.getElementById('folder-tiles-grid');


  const folderIconSvg = `
    <svg class="folder-tile-icon" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
      <path d="M3 6.5C3 5.119 4.119 4 5.5 4h5l2 2h6C19.881 6 21 7.119 21 8.5v9c0 1.381-1.119 2.5-2.5 2.5h-13C4.119 20 3 18.881 3 17.5v-11z" fill="rgba(255,255,255,0.78)"/>
      <path d="M3 8h18v1.6H3V8z" fill="rgba(0,0,0,0.18)"/>
    </svg>
  `;

  const ensureTileCount = (arr, minCount) => {
  // ✅ No demo/default folders. Only show real folders.
  return Array.isArray(arr) ? arr.slice() : [];
};


  function renderFolderTiles(){
    if (!gridEl) return;
    const tiles = ensureTileCount(window.folders, 9);

    gridEl.innerHTML = tiles.map((f) => {
      const name = String(f.name || "Folder");
      const count = Array.isArray(f.playlistIds) ? f.playlistIds.length : (Number(f.count) || 0);
      const fid = String(f.id || "");

      return `
        <div class="folder-tile" data-folder-id="${fid}">
          <div class="folder-tile-square">${folderIconSvg}</div>
          <div class="folder-tile-name">${name.replace(/</g,"&lt;").replace(/>/g,"&gt;")}</div>
          <div class="folder-tile-sub">${count} playlists</div>
        </div>
      `;
    }).join("");

  // ✅ Click a tile to add current playlist to that folder (submenu action)
  // ✅ Adds: toast confirm, dupe prevention, hard-stop bubbling, closes menus
  try {
    // tiny in-app toast
    const __toast = (msg) => {
      let el = document.getElementById('__reson_toast');
      if (!el) {
        el = document.createElement('div');
        el.id = '__reson_toast';
        el.style.position = 'fixed';
        el.style.left = '50%';
        el.style.bottom = '26px';
        el.style.transform = 'translateX(-50%)';
        el.style.padding = '10px 12px';
        el.style.borderRadius = '999px';
        el.style.background = 'rgba(0,0,0,0.75)';
        el.style.color = '#fff';
        el.style.fontSize = '14px';
        el.style.fontWeight = '700';
        el.style.zIndex = '999999';
        el.style.pointerEvents = 'none';
        el.style.opacity = '0';
        el.style.transition = 'opacity 120ms ease';
        document.body.appendChild(el);
      }
      el.textContent = msg;
      el.style.opacity = '1';
      clearTimeout(window.__resonToastT);
      window.__resonToastT = setTimeout(() => { el.style.opacity = '0'; }, 900);
    };

    const __getCurrentPlaylistId = () => {
      const a = (window.navCurrent && window.navCurrent.playlistId) ? String(window.navCurrent.playlistId) : "";
      const b = (window.menuTargetSong && window.menuTargetSong.playlistId) ? String(window.menuTargetSong.playlistId) : "";
      const c = (window.menuTargetSong && window.menuTargetSong.id) ? String(window.menuTargetSong.id) : "";
      return (a || b || c || "").trim();
    };

    const tilesEls = gridEl ? Array.from(gridEl.querySelectorAll('.folder-tile')) : [];
    tilesEls.forEach((el) => {
      el.onclick = (e) => {
        try {
          // ✅ stop click from triggering ANY other menu ("Add song to playlist", etc.)
          try { e.preventDefault(); } catch (err) {}
          try { e.stopPropagation(); } catch (err) {}
          try { e.stopImmediatePropagation(); } catch (err) {}

          const fid = String(el.getAttribute('data-folder-id') || '').trim();
          if (!fid) return;

          const pid = __getCurrentPlaylistId();
          if (!pid) {
            console.warn("Add-to-folder: missing current playlistId");

            __toast("Couldn't find playlist");
            return;
          }

          const foldersArr = Array.isArray(window.folders) ? window.folders : [];
          const folder = foldersArr.find(x => String(x?.id || "") === fid);
          if (!folder) { __toast("Folder not found"); return; }

          folder.playlistIds = Array.isArray(folder.playlistIds) ? folder.playlistIds.map(String) : [];

          // ✅ dupe prevention + confirm
          if (folder.playlistIds.includes(pid)) {
            __toast("Already in folder");
            try { if (typeof window.closeContextMenu === "function") window.closeContextMenu(); } catch (err) {}
            try { closePlaylistSubmenu(e); } catch (err) {}
            return;
          }

          folder.playlistIds.push(pid);

          try { localStorage.setItem('folders', JSON.stringify(foldersArr)); } catch (err) {}

          __toast("Added to folder");

// mark this open as coming from add-flow
window.__folderOpenMode = "add-flow";

// navigate to folder home view
try { openFolderViewById(fid); } catch (err) {}

// close menus so nothing overlays the folder
try { if (typeof window.closeContextMenu === "function") window.closeContextMenu(); } catch (err) {}
try { closePlaylistSubmenu(e); } catch (err) {}


        } catch (err) {}
      };
    });
  } catch (err) {}


    // Create folder (prototype)
    const newBtn = document.getElementById('folder-new-pill');
    if (newBtn) {
      newBtn.onclick = () => {
        try{
          const id = (crypto && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
                   try{ window.folders = JSON.parse(localStorage.getItem('folders') || '[]'); }catch(e){ window.folders = []; }
          if (!Array.isArray(window.folders)) window.folders = [];
          window.folders.push({ id, name: "New Folder", playlistIds: [] });
          try{ localStorage.setItem('folders', JSON.stringify(window.folders)); }catch(e){}

          renderFolderTiles();

          openFolderViewById(id);

          // ✅ immediately show the Rename modal (Spotify behavior)
try{ openFolderRenameModal(id, 'new'); }catch(e){}

        }catch(e){}
      };
    }

  } // ✅ end renderFolderTiles()

 // First paint
try { renderFolderTiles(); } catch (e) { console.warn("renderFolderTiles missing:", e); }


  // Show submenu
  submenu.style.display = 'block';
  submenu.style.transform = 'translateY(0)';
  submenu.style.opacity = '1';
  submenu.style.zIndex = '200500';
  submenu.style.pointerEvents = 'auto';
  submenu.style.overflow = 'hidden';
  submenu.style.overflowX = 'hidden';
  submenu.style.top = '70px';
  submenu.style.height = 'calc(100vh - 40px)';

  submenu.classList.add('open');

  // ✅ APPLY YOUR PROTOTYPE BEHAVIOR (scroll + bubbles + backdrop fix)
  (() => {
    const sub = document.getElementById("playlist-submenu");
    const items = document.getElementById("playlist-submenu-items");
    const bd = document.getElementById("context-menu-backdrop");
    if (!sub || !items) return console.log("missing submenu/items");

    // 1) Backdrop is blocking clicks/scroll
    if (bd) {
      bd.style.pointerEvents = "none";
      bd.style.opacity = bd.style.opacity || "1";
    }

    // 2) Grid wrapper (tiles container)
    const grid = document.getElementById("folder-tiles-grid");
    if (!grid) return console.log("no grid found");

    // 3) Make grid scrollable by giving it a real height
    const subRect = sub.getBoundingClientRect();
    const pill = items.firstElementChild; // + New Folder pill
    const pillH = pill ? pill.getBoundingClientRect().height : 0;

    grid.style.maxHeight = Math.max(160, subRect.height - pillH - 90) + "px";
    grid.style.overflowY = "auto";
    grid.style.webkitOverflowScrolling = "touch";
    grid.style.paddingBottom = grid.style.paddingBottom || "96px";
    grid.style.pointerEvents = "auto";

    // Prevent other global handlers from killing scroll
    if (!window.__FOLDER_SCROLL_GUARD) {
      window.__FOLDER_SCROLL_GUARD = true;

      grid.addEventListener("wheel", (e) => { e.stopPropagation(); }, { capture: true });
      grid.addEventListener("touchmove", (e) => { e.stopPropagation(); }, { capture: true, passive: true });
    }

    // 4) Selection: bubbles on squares (click square toggles)
    const selected = window.__FOLDER_SELECTED_SET || new Set();
    window.__FOLDER_SELECTED_SET = selected;

    const tileWraps = [...grid.children].filter(el => el && el.firstElementChild);

    const ensureBubble = (wrap) => {
      const sq = wrap.firstElementChild;
      if (!sq) return null;
      sq.style.position = "relative";

      let bub = sq.querySelector(".__ms_bubble");
      if (!bub) {
        bub = document.createElement("div");
        bub.className = "__ms_bubble";
        bub.style.position = "absolute";
        bub.style.right = "8px";
        bub.style.bottom = "8px";
        bub.style.width = "18px";
        bub.style.height = "18px";
        bub.style.borderRadius = "9999px";
        bub.style.border = "2px solid rgba(255,255,255,0.8)";
        bub.style.background = "rgba(0,0,0,0.25)";
        bub.style.display = "none";
        bub.style.pointerEvents = "none";
        sq.appendChild(bub);
      }
      return bub;
    };

    const refresh = () => {
      const selecting = !!window.__FOLDER_SELECTING;
      tileWraps.forEach((wrap, i) => {
        const bub = ensureBubble(wrap);
        if (!bub) return;

        if (!selecting) { bub.style.display = "none"; return; }
        bub.style.display = "block";

        if (selected.has(i)) {
          bub.style.background = "#1db954";
          bub.style.borderColor = "#1db954";
        } else {
          bub.style.background = "rgba(0,0,0,0.25)";
          bub.style.borderColor = "rgba(255,255,255,0.8)";
        }
      });
    };

    tileWraps.forEach((w)=>ensureBubble(w));
    refresh();

    if (!window.__FOLDER_TILE_CLICK_GUARD) {
      window.__FOLDER_TILE_CLICK_GUARD = true;

      grid.addEventListener("click", (e) => {
        if (!window.__FOLDER_SELECTING) return;

        const wrap = e.target.closest(":scope > div");
        if (!wrap) return;

        const idx = tileWraps.indexOf(wrap);
        if (idx < 0) return;

        e.preventDefault();
        e.stopPropagation();

        if (selected.has(idx)) selected.delete(idx);
        else selected.add(idx);

        refresh();
      }, true);
    }
  })();
}

// ---- Mobile slide-pick for both sheets ----
(function bindMenuSlidePick(){
  if (window.__cmSlidePickBound) return;
  window.__cmSlidePickBound = true;

  function bindOne(sheetId){
    const sheet = document.getElementById(sheetId);
    if (!sheet) return;

    let armedEl = null;
    let tracking = false;
    let startTouchY = 0;
    let startTouchX = 0;
    let didScroll = false;

    function clearArmed(){
      if (armedEl) armedEl.classList.remove('cm-armed');
      armedEl = null;
    }

    function pickAtTouch(touch){
      const el = document.elementFromPoint(touch.clientX, touch.clientY);
      const item = el && el.closest ? el.closest('#' + sheetId + ' .menu-item') : null;
      if (!item) return;

      if (armedEl !== item){
        clearArmed();
        armedEl = item;
        armedEl.classList.add('cm-armed');
      }
    }

    sheet.addEventListener('touchstart', (e) => {
      if (window.innerWidth > 768) return;
      if (!e.touches || !e.touches[0]) return;

      // don't hijack the handle drag gesture
      if (e.target && e.target.closest && e.target.closest('.cm-handle')) return;

        // don't arm during the open animation (prevents leakage from the opening tap)
        if (Date.now() < (window.__cmArmGuardUntil || 0)) return;

      tracking = true;
      didScroll = false;
      startTouchY = e.touches[0].clientY;
      startTouchX = e.touches[0].clientX;
      pickAtTouch(e.touches[0]);
    }, { passive: true });


    sheet.addEventListener('touchmove', (e) => {
      if (!tracking) return;
      if (!e.touches || !e.touches[0]) return;

      const dy = Math.abs(e.touches[0].clientY - startTouchY);
      const dx = Math.abs(e.touches[0].clientX - startTouchX);

      // If finger moved more than 8px vertically, treat as a scroll — don't fire
      if (dy > 8 || dx > 8) {
        didScroll = true;
        clearArmed();
      }
    }, { passive: true });

    sheet.addEventListener('touchend', (e) => {
      if (!tracking) return;
      tracking = false;

      const fire = armedEl;
      clearArmed();

      // Only fire if this was a tap (no scroll movement)
      if (fire && !didScroll) {
        try { fire.click(); } catch(err){}
      }
    }, { passive: true });

    sheet.addEventListener('touchcancel', () => {
      tracking = false;
      didScroll = false;
      clearArmed();
    }, { passive: true });
  }

  bindOne('context-menu');
  bindOne('playlist-submenu');
})();

// (swipe dismiss via legacy touch events removed — handled by 3-state pointer handler above)

// ---- handleContextMenu (full version, handles multi-select) ----
function handleContextMenu(e, song){
  e.preventDefault();
  e.stopPropagation();

  // If we have a multi-selection AND the right-clicked song is inside it,
  // use the whole selection for the menu.
  try {
    const u = String(song && (song.url || song.link || song.id || '')).trim();
    if (window.__songSelect && window.__songSelect.enabled && window.__songSelect.urls.size > 0) {
      const has = u && window.__songSelect.urls.has(u);
      if (has) {
        // Build array of song-like objects from selected urls (minimal fields for remove/add)
        const selectedArr = [];
        document.querySelectorAll('.track-row.is-selected[data-song-url]').forEach(row => {
          const ru = getSongUrlFromRow(row);
          if (!ru) return;
          selectedArr.push({ url: ru, trackId: row.getAttribute('data-track-id') || '' });
        });

        if (selectedArr.length) {
        menuTargetSong = selectedArr;
          try { window.menuTargetSong = menuTargetSong; } catch (e) {}
          showContextMenuAt(
            e.clientX,
            e.clientY,
            song,
            (e.target && e.target.closest) ? e.target.closest("button.track-menu, .track-row, .track-row.group") : null
          );
          return;
            }
      }
    }
  } catch (err) {}

  showContextMenuAt(
    e.clientX,
    e.clientY,
    song,
    (e.target && e.target.closest) ? e.target.closest("button.track-menu, .track-row, .track-row.group") : null
  );

}

// ---- Remove toast ----
(function initRemoveToast(){
  let _timer = null;
  let _undoFn = null;

  window.showRemoveToast = function(label, undoFn) {
    const toast = document.getElementById('remove-toast');
    const lbl   = document.getElementById('rt-label');
    const btn   = document.getElementById('rt-undo-btn');
    if (!toast) return;

    if (_timer) { clearTimeout(_timer); _timer = null; }

    if (lbl) lbl.textContent = label;
    _undoFn = undoFn || null;
    if (btn) btn.style.display = _undoFn ? '' : 'none';

    toast.classList.add('rt-show');

    _timer = setTimeout(() => {
      toast.classList.remove('rt-show');
      _undoFn = null;
    }, 4000);

    if (btn) {
      btn.onclick = () => {
        if (_timer) { clearTimeout(_timer); _timer = null; }
        toast.classList.remove('rt-show');
        if (_undoFn) { try { _undoFn(); } catch(e){} }
        _undoFn = null;
      };
    }
  };
})();

// ---- menuAction ----
async function menuAction(type) {

  if (!menuTargetSong) return;

   // REMOVE FROM PLAYLIST
  if (type === 'remove') {
    if (!activePlaylistId) return;

    const plIndex = playlists.findIndex(p => p.id === activePlaylistId);
    if (plIndex === -1) return;

    const pl = playlists[plIndex];

        // ✅ Resolve trackId robustly (canonical ID is the R2 path)
    const targets = Array.isArray(menuTargetSong) ? menuTargetSong : [menuTargetSong];

    // Fallback: parse ?id= from the song URL/link
    function canonTrackId(v) {
      let s = String(v || "").trim();
      if (!s) return "";

      // If we were given a full URL, pull out ?id=
      try {
        if (s.includes("://")) {
          const u = new URL(s);
          const id = u.searchParams.get("id");
          if (id) s = id;
        }
      } catch (e) {}

      // If we were given just a query-ish string
      if (s.includes("?id=")) {
        try {
          const part = s.split("?id=")[1] || "";
          s = part.split("&")[0] || part;
        } catch (e) {}
      }

      try { s = decodeURIComponent(s); } catch (e) {}
      s = s.replace(/^\/+/, "").trim();
      return s;
    }

    function getTrackIdForSong(s) {
      if (!s) return "";

      let trackId =
        s?.id ||
        s?.r2Path ||
        s?.track_id ||
        s?.trackId ||
        s?.key ||
        s?.r2_key ||
        "";

      if (!trackId) {
        trackId = __extractIdFromMaybeUrl(s?.url || s?.link || "");
      }

      return canonTrackId(trackId);
    }

    const trackIds = targets
      .map(getTrackIdForSong)
      .filter(Boolean);

    if (!trackIds.length) {
      alert("Missing trackId for this song.");
      return;
    }

    // ✅ Store the full set for the actual remove call (Step 3A.2)
    window.__pendingRemoveTrackIds = trackIds;

    // Keep existing downstream logic working (it expects `trackId`)
    let trackId = trackIds[0];

// ✅ Update local IDs-only model first (UI updates instantly)
let __plBeforeIds = null;

// reuse existing playlist reference (do NOT redeclare)
if (pl) {
  const arr = Array.isArray(pl.trackIds) ? pl.trackIds : [];
  __plBeforeIds = arr.slice();

        const __idsToRemove = Array.isArray(window.__pendingRemoveTrackIds) && window.__pendingRemoveTrackIds.length
      ? window.__pendingRemoveTrackIds
      : [trackId];

    pl.trackIds = arr.filter((id) => !__idsToRemove.includes(canonTrackId(id)));


  // ✅ IDs-only: do NOT store song objects on playlist
  savePlaylists();


  try { updatePlaylistAutoCoverById(activePlaylistId); } catch (e) {}
  try { renderPlaylists(); } catch (e) {}
}

// Cloud delete (try to persist so it stays removed after refresh)
try {
  if (typeof window.removeTrackFromPlaylistInCloud === "function") {
        const __idsToRemoveCloud = Array.isArray(window.__pendingRemoveTrackIds) && window.__pendingRemoveTrackIds.length
      ? window.__pendingRemoveTrackIds
      : [trackId];

    for (const __tid of __idsToRemoveCloud) {
      await window.removeTrackFromPlaylistInCloud((pl && pl.id) ? pl.id : activePlaylistId, __tid);

    }

    try { window.__pendingRemoveTrackIds = null; } catch (e) {}

try{
  if (typeof window.__pushUndo === "function") {
    const __plId = (pl && pl.id) ? pl.id : activePlaylistId;
    const __before = Array.isArray(__plBeforeIds) ? __plBeforeIds.slice() : null;
    const __removed = Array.isArray(__idsToRemoveCloud) ? __idsToRemoveCloud.slice() : [trackId];

    const __undoFn = async () => {
        try{
          // restore local list immediately (preserving original position)
          try{
            const pls = Array.isArray(window.playlists) ? window.playlists : [];
            const p = pls.find(x => String(x?.id || x?.playlistId || x?.playlist_id || "") === String(__plId));
            if (p && __before) {
              p.trackIds = __before.slice();
              try{ p.songs = typeof resolveTrackIdsToSongs === "function" ? resolveTrackIdsToSongs(__before) : p.songs; }catch(e){}
            }
            try{ if (typeof window.savePlaylists === "function") window.savePlaylists(); }catch(e){}
          }catch(e){}

          // restore in cloud (fire-and-forget — do NOT await loadPlaylistsFromCloud after,
          // because that would overwrite our locally-restored order with the cloud's appended order)
          if (typeof window.addTrackToPlaylistInCloud === "function") {
            for (const tid of __removed) {
              try{ window.addTrackToPlaylistInCloud(__plId, tid); }catch(e){}
            }
          }

          // re-render the open playlist view from local state (correct order)
          try{
            const pls = Array.isArray(window.playlists) ? window.playlists : [];
            const p = pls.find(x => String(x?.id || x?.playlistId || x?.playlist_id || "") === String(__plId));
            if (p && typeof renderCollection === "function") {
              renderCollection(p.name || "Playlist", p.songs, true, activePlaylistIndex);
            }
          }catch(e){}

          try{ renderPlaylists(); }catch(e){}
          try{ if (typeof renderHome === "function") renderHome(); }catch(e){}
        }catch(e){}
    };

    window.__lastUndoFn = __undoFn;
    window.__pushUndo({
      type: "playlist:removeTrack",
      playlistId: __plId,
      trackIds: __removed,
      undo: __undoFn,
    });
  }
}catch(e){}


  }
  try { if (typeof window.forceCloudPlaylistPull === "function") window.forceCloudPlaylistPull(); } catch (e) {}
} catch (err) {
  console.warn("Cloud remove failed:", err);

  // Roll back local change so you DON'T get "it disappears then comes back"
  if (pl && Array.isArray(__plBeforeIds)) {
    pl.trackIds = __plBeforeIds;
    pl.songs = resolveTrackIdsToSongs(pl.trackIds);
    savePlaylists();
    try { updatePlaylistAutoCoverById(activePlaylistId); } catch (e) {}
    try { renderPlaylists(); } catch (e) {}
  }

 alert("Couldn't remove from playlist (cloud sync failed). Try again.");
}

try { closeContextMenu(); } catch (e) {}

try { hidePlaylistMenu(); } catch (e) {}

// ✅ Re-render immediately WITHOUT reloading from cloud
try {
  const plNow = playlists.find(p => p.id === activePlaylistId);
  if (plNow) {
    plNow.trackIds = Array.isArray(plNow.trackIds) ? plNow.trackIds : [];
    plNow.songs = resolveTrackIdsToSongs(plNow.trackIds);
    renderCollection(plNow.name || "Playlist", plNow.songs, true, activePlaylistIndex);
  }
} catch (e) {}

// ✅ Pull latest cloud playlist meta soon (counts/covers/other devices)
try { if (typeof window.forceCloudPlaylistPull === "function") window.forceCloudPlaylistPull(); } catch (e) {}

closeContextMenu();

// Show removed toast with undo
try {
  const _removedSong = Array.isArray(menuTargetSong) ? menuTargetSong[0] : menuTargetSong;
  const _songName = _removedSong?.title || _removedSong?.name || 'Song';
  const _undoRef = (typeof window.__pushUndo !== 'undefined') ? null : null; // undo already registered via __pushUndo
  // Trigger undo via the last pushed undo entry
  window.showRemoveToast('Removed ' + _songName, typeof window.__lastUndoFn === 'function' ? window.__lastUndoFn : null);
} catch(e) {}

return;

  }

  // LIKE / UNLIKE


  // LIKE / UNLIKE
  if (type === 'like') {
    toggleLike();
    closeContextMenu();
    return;
  }
  // ADD TO QUEUE (close menu + toast)
  if (type === 'queue_add' || type === 'add_to_queue' || type === 'add_queue') {
    try { addSongToQueue(menuTargetSong); } catch (e) {}
    closeContextMenu();
    return;
  }

  // GO TO QUEUE
  if (type === 'queue_go') {
    closeContextMenu();
    openQueueSheet();
    return;
  }

    // GO TO ALBUM
  if (type === 'go_album') {

    // 0) Prefer what showContextMenuAt already computed
    let albumName =
      (typeof window.__menuTargetAlbumName === 'string' && window.__menuTargetAlbumName.trim())
        ? window.__menuTargetAlbumName.trim()
        : '';

    let artistHint =
      (typeof window.__menuTargetArtistName === 'string' && window.__menuTargetArtistName.trim())
        ? window.__menuTargetArtistName.trim()
        : '';

    // 1) If we still don't have an album, try to resolve via tracksById using the song's canonical id
    if (!albumName || albumName === 'Unknown Album') {
      try {
        const rawUrl = String(menuTargetSong?.url || menuTargetSong?.link || '').trim();
        let id = '';

        // pull ?id= if it's a URL
        try {
          if (rawUrl.includes('://')) {
            const u = new URL(rawUrl);
            const qid = u.searchParams.get('id');
            if (qid) id = qid;
          }
        } catch (e) {}

        // fallback parse
        if (!id && rawUrl.includes('?id=')) {
          try {
            id = (rawUrl.split('?id=')[1] || '').split('&')[0] || '';
          } catch (e) {}
        }

        if (id) {
          try { id = decodeURIComponent(id); } catch (e) {}
          id = id.replace(/^\/+/, '').trim();

          // If it's a short id like "Artist/Track.mp3", map it to full "Artist/Album/Track.mp3"
          let fullId = id;
          try {
            if (window.__shortTrackIdToFullId && typeof window.__shortTrackIdToFullId.get === 'function') {
              const mapped = window.__shortTrackIdToFullId.get(id);
              if (mapped) fullId = mapped;
            }
          } catch (e) {}

          // Now look up the track
          try {
            if (window.tracksById && typeof window.tracksById.get === 'function') {
              const tr = window.tracksById.get(fullId) || window.tracksById.get(id);
              if (tr) {
                if (!artistHint) artistHint = String(tr.artistName || tr.artist || '').trim();
                albumName = String(tr.albumName || tr.album || '').trim();
              }
            }
          } catch (e) {}
        }
      } catch (e) {}
    }

    // 2) If still missing, try the old path-splitting logic as last resort
    if (!albumName || albumName === 'Unknown Album') {
      try {
        const rawUrl = String(menuTargetSong?.url || menuTargetSong?.link || '').trim();
        let id2 = '';
        try {
          const u2 = new URL(rawUrl);
          id2 = u2.searchParams.get('id') || '';
        } catch (e) {
          if (rawUrl.includes('?id=')) id2 = (rawUrl.split('?id=')[1] || '').split('&')[0] || '';
        }
        try { id2 = decodeURIComponent(id2); } catch (e) {}
        const parts = String(id2 || '').split('/').filter(Boolean);
        if (parts.length >= 3) {
          if (!artistHint) artistHint = parts[0] || '';
          albumName = parts[1] || '';
        }
      } catch (e) {}
    }

        // 3) If we STILL can't resolve, fall back for short ids:
    //    "Artist/Track.mp3" -> treat as Artist / Singles
    if (!albumName || albumName === 'Unknown Album') {
      try {
        const rawUrl3 = String(menuTargetSong?.url || menuTargetSong?.link || '').trim();
        let id3 = '';
        try {
          const u3 = new URL(rawUrl3);
          id3 = u3.searchParams.get('id') || '';
        } catch (e) {
          if (rawUrl3.includes('?id=')) id3 = (rawUrl3.split('?id=')[1] || '').split('&')[0] || '';
        }
        try { id3 = decodeURIComponent(id3); } catch (e) {}
        const parts3 = String(id3 || '').split('/').filter(Boolean);

        if (parts3.length === 2) {
          if (!artistHint) artistHint = parts3[0] || '';
          albumName = 'Singles';
        }
      } catch (e) {}
    }

    // If still missing, don't fail silently
    if (!albumName || albumName === 'Unknown Album') {
      try {
        console.warn('[go_album] Could not resolve album for menuTargetSong:', menuTargetSong);
      } catch (e) {}
      try {
        if (typeof window.showToast === 'function') window.showToast('Album not found in library');
      } catch (e) {}
      return;
    }

    // If the album doesn't exist in libraryData for this artist, don't fail silently
    try {
      const lib = Array.isArray(window.libraryData) ? window.libraryData : [];
      const exists = (artistHint && artistHint.trim())
        ? lib.some(a => a && a.albumName === albumName && a.artistName === artistHint)
        : lib.some(a => a && a.albumName === albumName);

            if (!exists) {
        // Not in libraryData (Drive source mismatch) — open a virtual album view so Go to album isn't silent.
        try {
          console.warn('[go_album] Album not present in libraryData (opening virtual view):', { artistHint, albumName, menuTargetSong });
        } catch (e) {}

        // Build a 1-song "album" from the clicked row
        const vt = Object.assign({}, menuTargetSong || {});
        if (artistHint) { vt.artistName = artistHint; vt.artist = artistHint; }
        if (albumName)  { vt.albumName = albumName;  vt.album  = albumName; }
        if (!vt.title && vt.name) vt.title = vt.name;

        try { closeContextMenu(); } catch (e) {}
        try { pushNavCurrent(); } catch (e) {}
        try { setNavCurrent({ type: 'album', albumName: albumName, artistName: (artistHint || '') }); } catch (e) {}
        try { playContext = { type: 'album', label: albumName }; } catch (e) {}
        try { renderCollection(albumName, [vt], false); } catch (e) {}
        return;
      }

    } catch (e) {}

    // Help openAlbumByName pick the right album if names collide
    try { window.__albumArtistHint = artistHint || ''; } catch (e) {}

    closeContextMenu();
    openAlbumByName(albumName);
    return;

  }



  if (type === 'crate_add_artist') {
    const a = (menuTargetSong && (menuTargetSong.artist || menuTargetSong.artistName)) ? String(menuTargetSong.artist || menuTargetSong.artistName).trim() : "";
    if (a) {
      try { addArtistToCrate(a); } catch (e) {}
      try { closeContextMenu(); } catch (e) {}
      try { showView('crate'); } catch (e) {}
    } else {
      try { closeContextMenu(); } catch (e) {}
    }
    return;
  }

  if (type === 'save_autoplaylist') {
    const id = String((menuTargetSong && menuTargetSong.id) || '');
    const autoType = id === '__daylist__' ? 'daylist' : id === '__nightlist__' ? 'nightlist' : null;
    if (autoType && typeof window.saveAutoPlaylistSnapshot === 'function') {
      window.saveAutoPlaylistSnapshot(autoType);
    }
    try { closeContextMenu(); } catch (e) {}
    return;
  }
}

try { window.menuAction = menuAction; } catch (e) {}

// ---- Explicit window exports (function declarations are already globals,
//      but these ensure other scripts find them even in strict/module contexts) ----
window.closeContextMenu          = closeContextMenu;
window.showContextMenuAt         = showContextMenuAt;
window.handleContextMenu         = handleContextMenu;
window.openAddToFolderSubmenu    = openAddToFolderSubmenu;
window.closePlaylistSubmenuQuick = closePlaylistSubmenuQuick;
window.showMultiSelectContextMenuFromHero = showMultiSelectContextMenuFromHero;

// ---- PATCH: stable Add-to-Playlist menu (no auto-open) + ghost-click fix ----
(function(){
  // 1) Never close menus when clicking inside context menu OR playlist submenu
  const origClose = window.closeContextMenu;
  if (typeof origClose === "function" && !origClose.__patched) {
    window.closeContextMenu = function(e){
      try {
        const cm = document.getElementById('context-menu');
        const ps = document.getElementById('playlist-submenu');
        if (e && ( (cm && cm.contains(e.target)) || (ps && ps.contains(e.target)) )) return;
      } catch(_) {}
      return origClose.apply(this, arguments);
    };
    window.closeContextMenu.__patched = true;
  }

  // 2) Guard outside-dismiss so it only happens when truly outside both menus
  if (!window.__outsideDismissPatched) {
    window.__outsideDismissPatched = true;
    document.addEventListener('click', function(e){
      const cm = document.getElementById('context-menu');
      const ps = document.getElementById('playlist-submenu');
      const cmOpen = cm && cm.style && cm.style.display !== 'none';
      const psOpen = ps && ps.style && ps.style.display !== 'none';
      if (!cmOpen && !psOpen) return;

      // ✅ If we JUST opened, ignore this click
      if (Date.now() < (typeof suppressContextMenuCloseUntil !== 'undefined' ? suppressContextMenuCloseUntil : 0)) return;
      if (Date.now() < (typeof suppressPlaylistMenuCloseUntil !== 'undefined' ? suppressPlaylistMenuCloseUntil : 0)) return;

      // ✅ Clicking the opener (Now Playing •••) is NOT an outside click
      try {
        const npMore = document.getElementById('np-more');
        if (npMore && (npMore === e.target || npMore.contains(e.target))) return;
      } catch (err) {}

      if ((cm && cm.contains(e.target)) || (ps && ps.contains(e.target))) return;
      if (typeof window.closeContextMenu === 'function') window.closeContextMenu(e);
    }, true);

  }

  // 3) Ghost-click fix:
  // Record the last pointerdown target id.
  // When the playlist submenu opens immediately after tapping "Add to playlist",
  // the same click can "tap-through" the first playlist item. We block ONLY that case.
  if (!window.__playlistGhostClickFixInstalled) {
    window.__playlistGhostClickFixInstalled = true;

    window.__playlistSubmenuOpenedAt = 0;
    window.__playlistSubmenuOpenFromAddOpt = false;
    window.__playlistSubmenuLastPointerDownId = null;

    document.addEventListener('pointerdown', (e) => {
      const t = e && e.target;
      const addOpt = t && t.closest && t.closest('#menu-add-opt');
      const mi = t && t.closest && t.closest('#playlist-submenu .menu-item');
      if (addOpt) window.__playlistSubmenuLastPointerDownId = 'menu-add-opt';
      else if (mi) window.__playlistSubmenuLastPointerDownId = 'playlist-menu-item';
      else window.__playlistSubmenuLastPointerDownId = (t && t.id) ? String(t.id) : null;
    }, true);

    // Detect submenu open via visibility
    const menuIsVisible = () => {
      const m = document.getElementById('playlist-submenu');
      if (!m) return false;
      const r = m.getBoundingClientRect();
      return r.width > 0 && r.height > 0 && m.classList.contains('open');
    };

    const obs = new MutationObserver(() => {
      if (menuIsVisible()) {
        window.__playlistSubmenuOpenedAt = Date.now();
        window.__playlistSubmenuOpenFromAddOpt = (window.__playlistSubmenuLastPointerDownId === 'menu-add-opt');
      }
    });
    obs.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

    // Block ONLY the "same tap-through" click (very fast after open, and opener was Add-to-playlist)
    document.addEventListener('click', (e) => {
      const mi = e.target && e.target.closest && e.target.closest('#playlist-submenu .menu-item');
      if (!mi) return;

      const dt = Date.now() - (window.__playlistSubmenuOpenedAt || 0);
      const openerWasAdd = !!window.__playlistSubmenuOpenFromAddOpt;
      const lastPD = window.__playlistSubmenuLastPointerDownId;

      if (openerWasAdd && dt >= 0 && dt < 80 && lastPD === 'menu-add-opt') {
        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();
        return;
      }
    }, true);
  }
})();
