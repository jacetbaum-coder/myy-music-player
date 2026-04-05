const API_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const TOKEN_SAFETY_WINDOW_MS = 30 * 1000;
const ARTIST_PORTRAIT_OVERRIDES = {
  // Normalize artist names to lower-case keys when adding overrides.
  // Example:
  // 'suicideboys': { spotifyQuery: '$uicideboy$' },
};

const portraitCache = globalThis.__artistPortraitResponseCache || new Map();
globalThis.__artistPortraitResponseCache = portraitCache;

let spotifyTokenCache = globalThis.__artistPortraitSpotifyToken || null;

function normalizeArtistName(name) {
  return String(name || '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeArtistKey(name) {
  return normalizeArtistName(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function getOverride(name) {
  return ARTIST_PORTRAIT_OVERRIDES[normalizeArtistKey(name)] || null;
}

function getCachedPortrait(name, type) {
  const key = `${normalizeArtistKey(name)}:${type || 'portrait'}`;
  if (!key) return null;

  const cached = portraitCache.get(key);
  if (!cached) return null;
  if (Date.now() - Number(cached.cachedAt || 0) > API_CACHE_TTL_MS) {
    portraitCache.delete(key);
    return null;
  }
  return cached.payload || null;
}

function setCachedPortrait(name, type, payload) {
  const key = `${normalizeArtistKey(name)}:${type || 'portrait'}`;
  if (!key) return;
  portraitCache.set(key, {
    cachedAt: Date.now(),
    payload,
  });
}

// ---- TheAudioDB (primary — no credentials required) ----
async function fetchTheAudioDBPortrait(name, type) {
  const query = normalizeArtistName(name);
  if (!query) return null;

  const url = `https://www.theaudiodb.com/api/v1/json/2/search.php?s=${encodeURIComponent(query)}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(6000) });
  } catch (e) {
    return null;
  }
  if (!response.ok) return null;

  const data = await response.json().catch(() => null);
  const artist = Array.isArray(data?.artists) ? data.artists[0] : null;
  if (!artist) return null;

  let image = '';
  if (type === 'wide') {
    // Prefer fanart for hero backgrounds; fall back to thumb if nothing wide exists
    image = String(
      artist.strArtistFanart ||
      artist.strArtistFanart2 ||
      artist.strArtistFanart3 ||
      artist.strArtistBanner ||
      artist.strArtistThumb ||
      ''
    ).trim();
  } else {
    image = String(artist.strArtistThumb || '').trim();
    // Upgrade TheAudioDB thumbnail resolution (300 → 1000)
    if (image) image = image.replace(/\/300$/, '/1000').replace(/\/300\//, '/1000/');
  }

  if (!image) return null;

  return {
    ok: true,
    image,
    source: 'theaudiodb',
    matchedName: String(artist.strArtist || name),
  };
}

// ---- Wikipedia (secondary) ----
async function fetchWikipediaPortrait(name, type) {
  const query = normalizeArtistName(name);
  if (!query) return null;

  const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(query)}`;
  let response;
  try {
    response = await fetch(url, { signal: AbortSignal.timeout(5000) });
  } catch (e) {
    return null;
  }
  if (!response.ok) return null;

  const data = await response.json().catch(() => null);
  // For wide images prefer the full-resolution original; for portraits the thumbnail is fine
  const image = String(
    (type === 'wide' ? data?.originalimage?.source : null) ||
    data?.thumbnail?.source ||
    ''
  ).trim();
  if (!image) return null;

  return {
    ok: true,
    image,
    source: 'wikipedia',
    matchedName: String(data?.title || name),
  };
}

// ---- Spotify (tertiary — only used when env vars are configured) ----
function pickLargestImage(images) {
  const list = Array.isArray(images) ? images.slice() : [];
  list.sort((a, b) => Number(b?.width || 0) - Number(a?.width || 0));
  return String(list[0]?.url || '').trim();
}

function scoreArtistMatch(query, candidate) {
  const wanted = normalizeArtistKey(query);
  const actual = normalizeArtistKey(candidate?.name || '');
  if (!wanted || !actual) return -1;

  let score = 0;
  if (wanted === actual) score += 1000;
  else if (actual.includes(wanted) || wanted.includes(actual)) score += 300;

  const popularity = Number(candidate?.popularity || 0);
  score += Math.min(popularity, 100);

  if (Array.isArray(candidate?.images) && candidate.images.length) score += 100;
  return score;
}

async function getSpotifyToken() {
  const clientId = String(process.env.SPOTIFY_CLIENT_ID || '').trim();
  const clientSecret = String(process.env.SPOTIFY_CLIENT_SECRET || '').trim();
  if (!clientId || !clientSecret) return null;

  if (
    spotifyTokenCache &&
    spotifyTokenCache.token &&
    Number(spotifyTokenCache.expiresAt || 0) > Date.now() + TOKEN_SAFETY_WINDOW_MS
  ) {
    return spotifyTokenCache.token;
  }

  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      Authorization: `Basic ${creds}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: 'grant_type=client_credentials',
  });

  if (!response.ok) return null;

  const data = await response.json().catch(() => null);
  if (!data || !data.access_token) return null;

  spotifyTokenCache = {
    token: String(data.access_token),
    expiresAt: Date.now() + (Number(data.expires_in || 0) * 1000),
  };
  globalThis.__artistPortraitSpotifyToken = spotifyTokenCache;
  return spotifyTokenCache.token;
}

async function fetchSpotifyPortrait(name) {
  const override = getOverride(name);
  if (override?.disabledSpotify) return null;

  const token = await getSpotifyToken();
  if (!token) return null;

  const query = String(override?.spotifyQuery || name || '').trim();
  if (!query) return null;

  const url = `https://api.spotify.com/v1/search?type=artist&limit=5&q=${encodeURIComponent(`artist:${query}`)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return null;

  const data = await response.json().catch(() => null);
  const items = Array.isArray(data?.artists?.items) ? data.artists.items : [];
  const best = items
    .filter((item) => Array.isArray(item?.images) && item.images.length)
    .sort((a, b) => scoreArtistMatch(query, b) - scoreArtistMatch(query, a))[0];

  if (!best) return null;

  const image = pickLargestImage(best.images);
  if (!image) return null;

  return {
    ok: true,
    image,
    source: 'spotify',
    matchedName: String(best.name || ''),
  };
}

// ---- Override + music-streamer worker (last resort) ----
async function fetchFallbackPortrait(name) {
  const override = getOverride(name);
  if (override?.image) {
    return {
      ok: true,
      image: String(override.image).trim(),
      source: 'override',
      matchedName: normalizeArtistName(name),
    };
  }

  const fallbackBase = String(process.env.ARTIST_IMAGE_FALLBACK_URL || 'https://music-streamer.jacetbaum.workers.dev/api/artist-image').trim();
  let response;
  try {
    response = await fetch(`${fallbackBase}?name=${encodeURIComponent(name)}`);
  } catch (e) {
    return null;
  }
  if (!response.ok) return null;

  const data = await response.json().catch(() => null);
  if (!data || !data.ok || !data.image) return null;

  return {
    ok: true,
    image: String(data.image || '').trim(),
    source: 'fallback-worker',
    matchedName: normalizeArtistName(name),
  };
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ ok: false, error: 'Method not allowed' });
  }

  const artistName = normalizeArtistName(req.query?.name || '');
  if (!artistName) {
    return res.status(400).json({ ok: false, error: 'Missing artist name' });
  }

  const imageType = String(req.query?.type || '').trim() === 'wide' ? 'wide' : 'portrait';

  res.setHeader('Cache-Control', 's-maxage=21600, stale-while-revalidate=86400');

  const cached = getCachedPortrait(artistName, imageType);
  if (cached) {
    return res.status(200).json({ ...cached, cached: true });
  }

  try {
    const tadbPortrait = await fetchTheAudioDBPortrait(artistName, imageType);
    if (tadbPortrait?.ok && tadbPortrait.image) {
      setCachedPortrait(artistName, imageType, tadbPortrait);
      return res.status(200).json(tadbPortrait);
    }

    const wikiPortrait = await fetchWikipediaPortrait(artistName, imageType);
    if (wikiPortrait?.ok && wikiPortrait.image) {
      setCachedPortrait(artistName, imageType, wikiPortrait);
      return res.status(200).json(wikiPortrait);
    }

    const spotifyPortrait = await fetchSpotifyPortrait(artistName);
    if (spotifyPortrait?.ok && spotifyPortrait.image) {
      setCachedPortrait(artistName, imageType, spotifyPortrait);
      return res.status(200).json(spotifyPortrait);
    }

    const fallbackPortrait = await fetchFallbackPortrait(artistName);
    if (fallbackPortrait?.ok && fallbackPortrait.image) {
      setCachedPortrait(artistName, imageType, fallbackPortrait);
      return res.status(200).json(fallbackPortrait);
    }

    const empty = { ok: false, image: '', source: 'none', matchedName: artistName };
    setCachedPortrait(artistName, imageType, empty);
    return res.status(200).json(empty);
  } catch (error) {
    return res.status(500).json({
      ok: false,
      image: '',
      source: 'error',
      error: String(error?.message || error || 'Unknown error'),
    });
  }
}