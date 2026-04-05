// =============================================================================
// ARTIST PORTRAITS
// - Shared circular artist avatar resolver for library/search/detail surfaces
// - Client-side memoization + localStorage cache
// =============================================================================

(function initArtistPortraitsFeature() {
  const MEMORY_CACHE = new Map();
  const STORAGE_KEY = 'artistPortraitCacheV1';
  const STORAGE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
  const STORAGE_MAX_ENTRIES = 400;

  function normalizeArtistName(name) {
    return String(name || '')
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function escapeHtmlAttr(value) {
    return String(value || '')
      .replace(/&/g, '&amp;')
      .replace(/"/g, '&quot;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  function cacheKeyForArtist(name) {
    return normalizeArtistName(name).toLowerCase();
  }

  function readStoredCache() {
    try {
      const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (e) {
      return {};
    }
  }

  function writeStoredCache(cache) {
    try {
      const entries = Object.entries(cache || {})
        .sort((a, b) => Number(b[1]?.cachedAt || 0) - Number(a[1]?.cachedAt || 0))
        .slice(0, STORAGE_MAX_ENTRIES);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(entries)));
    } catch (e) {}
  }

  function readCachedPortrait(name) {
    const key = cacheKeyForArtist(name);
    if (!key) return null;

    const stored = readStoredCache()[key];
    if (!stored || typeof stored !== 'object') return null;
    if (Date.now() - Number(stored.cachedAt || 0) > STORAGE_TTL_MS) return null;

    return {
      ok: !!stored.image,
      image: String(stored.image || ''),
      source: String(stored.source || 'cache'),
      artist: normalizeArtistName(name),
      cached: true,
    };
  }

  function storeCachedPortrait(name, payload) {
    const key = cacheKeyForArtist(name);
    if (!key) return;

    const cache = readStoredCache();
    cache[key] = {
      image: String(payload?.image || ''),
      source: String(payload?.source || 'fallback'),
      cachedAt: Date.now(),
    };
    writeStoredCache(cache);
  }

  function setAvatarPlaceholder(element) {
    if (!element) return;
    element.setAttribute('data-artist-avatar-status', 'placeholder');
    element.innerHTML = `
      <span class="w-full h-full rounded-full bg-white/10 flex items-center justify-center">
        <i class="fas fa-user text-white/45 text-xl"></i>
      </span>
    `;
  }

  function setAvatarImage(element, imageUrl, artistName) {
    if (!element || !imageUrl) return false;

    const img = document.createElement('img');
    img.src = imageUrl;
    img.alt = artistName ? `${artistName} portrait` : '';
    img.loading = 'lazy';
    img.className = 'w-full h-full object-cover';
    img.referrerPolicy = 'no-referrer';
    img.onerror = () => {
      setAvatarPlaceholder(element);
      element.setAttribute('data-artist-avatar-status', 'error');
    };

    element.innerHTML = '';
    element.appendChild(img);
    element.setAttribute('data-artist-avatar-status', 'resolved');
    return true;
  }

  async function fetchArtistPortrait(name) {
    const artistName = normalizeArtistName(name);
    if (!artistName) {
      return { ok: false, image: '', source: 'empty', artist: '' };
    }

    const key = cacheKeyForArtist(artistName);
    if (MEMORY_CACHE.has(key)) return MEMORY_CACHE.get(key);

    const cached = readCachedPortrait(artistName);
    if (cached && cached.ok && cached.image) {
      const resolved = Promise.resolve(cached);
      MEMORY_CACHE.set(key, resolved);
      return resolved;
    }

    const request = (async () => {
      try {
        const response = await fetch('/api/artist-portrait?name=' + encodeURIComponent(artistName));
        const data = await response.json().catch(() => null);
        if (response.ok && data && data.ok && data.image) {
          const resolved = {
            ok: true,
            image: String(data.image || ''),
            source: String(data.source || 'remote'),
            artist: artistName,
            cached: false,
          };
          storeCachedPortrait(artistName, resolved);
          return resolved;
        }
      } catch (e) {}

      // Remove from memory cache on failure so the next search triggers a fresh retry
      MEMORY_CACHE.delete(key);
      return { ok: false, image: '', source: 'fallback', artist: artistName, cached: false };
    })();

    MEMORY_CACHE.set(key, request);
    return request;
  }

  function getArtistAvatarMarkup(name, shellClassName) {
    const artistName = normalizeArtistName(name);
    const shellClass = String(shellClassName || '').trim();
    return `
      <div class="${shellClass}"
           data-artist-avatar="1"
           data-artist-name="${escapeHtmlAttr(artistName)}"
           data-artist-avatar-status="placeholder"
           aria-hidden="true">
        <span class="w-full h-full rounded-full bg-white/10 flex items-center justify-center">
          <i class="fas fa-user text-white/45 text-xl"></i>
        </span>
      </div>
    `;
  }

  async function hydrateArtistPortraitElement(element, artistName) {
    if (!element) return;

    const resolvedArtistName = normalizeArtistName(artistName || element.getAttribute('data-artist-name'));
    if (!resolvedArtistName) {
      setAvatarPlaceholder(element);
      return;
    }

    element.setAttribute('data-artist-avatar', '1');
    element.setAttribute('data-artist-name', resolvedArtistName);

    if (!element.innerHTML.trim()) {
      setAvatarPlaceholder(element);
    }

    const portrait = await fetchArtistPortrait(resolvedArtistName);
    if (!portrait || !portrait.ok || !portrait.image) {
      setAvatarPlaceholder(element);
      element.setAttribute('data-artist-avatar-status', 'fallback');
      return;
    }

    setAvatarImage(element, portrait.image, resolvedArtistName);
  }

  function hydrateArtistPortraits(root) {
    const scope = root && typeof root.querySelectorAll === 'function' ? root : document;
    const nodes = [...scope.querySelectorAll('[data-artist-avatar][data-artist-name]')];
    nodes.forEach((node) => {
      hydrateArtistPortraitElement(node, node.getAttribute('data-artist-name'));
    });
  }

  window.normalizeArtistPortraitName = normalizeArtistName;
  window.fetchArtistPortrait = fetchArtistPortrait;
  window.getArtistAvatarMarkup = getArtistAvatarMarkup;
  window.hydrateArtistPortraitElement = hydrateArtistPortraitElement;
  window.hydrateArtistPortraits = hydrateArtistPortraits;
})();