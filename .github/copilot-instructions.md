# Copilot Instructions — Reson Music Player

## What This Project Is

A self-hosted music player SPA. No framework — vanilla HTML/JS/CSS in a single `index.html` plus modular `.feature.js` files. Deployed on Vercel. Backend is two Cloudflare Workers + a local Python downloader server.

## Architecture

| Layer | Tech | Location |
|-------|------|----------|
| Frontend | Vanilla JS, Tailwind CDN, Font Awesome | `index.html` (SPA entry point) |
| Feature modules | Vanilla JS | `src/features/<name>/<name>.feature.js` |
| Shared catalog API | Vercel serverless | `api/get-songs.js`, `api/get-covers.js`, `api/pinned-playlists.js` |
| Auth + user songs API | Cloudflare Worker | `api/api-worker/index.js` (deployed as `reson-api-worker`) |
| R2 streaming + personal data | Cloudflare Worker | Separate `music-streamer` worker (not in this repo) |
| Local download server | Python FastAPI | `downloader/server.py` (runs on `localhost:8765`) |
| Storage | Cloudflare R2 | Bucket `music-files` |
| Auth state | Cloudflare KV | `SESSIONS` namespace, HttpOnly cookies |

### URL routing

`vercel.json` proxies:
- `/auth/*` → `reson-api-worker`
- `/api/artist-image`, `/api/playlists`, `/api/crate`, etc. → `music-streamer`
- `/api/*` → Vercel serverless functions
- Everything else → `index.html`

## File Guide

### `index.html` (~15,000 lines)

The entire SPA. Contains:
- All HTML structure (library grid, album detail, player dock, now-playing overlay, auth modal, settings, import wizard, etc.)
- Inline `<style>` blocks (plus Tailwind utility classes)
- Core JS: `stripUserPrefix()`, `buildTracksByIdFromLibrary()`, `normalizeSong()`, `buildQueueFromSongs()`, library loading/merging, auth init
- Script tags for all feature modules at the bottom

### Feature modules (`src/features/`)

Each file is a self-contained feature. They attach to the DOM via `getElementById` / event listeners. Key ones:

| File | Purpose |
|------|---------|
| `player/player.feature.js` | Audio playback, `playSpecificSong()`, `currentSong`, now-playing UI, media session, dock |
| `library/library.feature.js` | Library grid rendering, sorting (A-Z, recently added), album detail view |
| `import/import.feature.js` | Full download wizard: search → preview → download → review metadata → upload to R2 |
| `search/search.feature.js` | Search overlay with results |
| `playlists/playlists.feature.js` | Playlist CRUD, playlist detail view |
| `queue/queue.feature.js` | Queue drawer |
| `crate/crate.feature.js` | Crate (bookmarked items) |
| `sync/sync.feature.js` | Cloud sync helpers, `personalDataApiUrl()` |
| `context-menu/context-menu.feature.js` | Long-press / right-click menus |
| `lyrics/lyrics.feature.js` | Lyrics fetching and display |
| `artist/artist.feature.js` | Artist detail pages |
| `settings/settings.feature.js` | Settings panel |

### `downloader/server.py`

FastAPI server with endpoints:
- `POST /search` — yt-dlp YouTube search
- `POST /preview` — single video metadata via yt-dlp `--dump-single-json`
- `POST /playlist-tracks` — enumerate playlist tracks (flat)
- `POST /download` — async download job (yt-dlp or spotdl)
- `GET /job/{id}` — poll download progress
- `POST /upload` — upload files to R2 (extracts cover art from APIC/covr tags)
- `POST /clear` — wipe local download dir
- `GET /health` — status check (includes `r2Configured` flag)
- `PATCH /file` — update file metadata (title, artist, album, etc.)

R2 credentials come from `downloader/.env` (gitignored).

### `api/api-worker/index.js`

Cloudflare Worker routes:
- `/auth/register`, `/auth/login`, `/auth/magic-link`, `/auth/verify`, `/auth/me`, `/auth/logout`
- `/user/songs` — lists user's R2 objects, returns `artistName`, `albumName`, `coverArt` per album
- `/requests` — song request management

Bindings: R2 (`MUSIC_BUCKET`), KV (`SESSIONS`, `REQUESTS`).

## Critical Patterns

### R2 key format

Personal library files are stored as:
```
users/{userId}/Artist/Album/Track.ext
users/{userId}/Artist/Album/cover.jpg
```

`userId` = first 12 chars of SHA-256(email), e.g. `4a294cd0f975`.

### `stripUserPrefix(key)`

Defined in `index.html`. Strips the `users/{userId}/` prefix from R2 keys so path parsing gets `[Artist, Album, Track]` instead of `[users, 4a294cd0f975, Artist, Album, Track]`.

```js
function stripUserPrefix(key) {
  const parts = String(key || '').split('/').filter(Boolean);
  if (parts.length >= 3 && parts[0] === 'users') parts.splice(0, 2);
  return parts;
}
```

A duplicate `_stripUserPrefix()` exists in `player.feature.js`.

**IMPORTANT**: Any code that parses R2 keys into artist/album/track MUST use `stripUserPrefix` first. Forgetting this causes "users" to appear as the artist name.

### Cache busting

Feature scripts are loaded with `?v=N` query params:
```html
<script src="src/features/player/player.feature.js?v=3"></script>
```

**When you edit a feature file, bump its version number in the `<script>` tag in `index.html`.** If you don't, browsers will serve the cached old version.

### `currentSong` object

Set in `playSpecificSong()` in `player.feature.js`:
```js
currentSong = { url, title, album, artist, cover };
```

Persisted to `localStorage` as `lastSongState`. Restored on page load by `restorePlayerStateIfRecent()`. The artist field must never be `"users"` — sanitize it.

### Library merging

Signed-in users see shared catalog + personal library merged. `mergeLibraryAlbums()` in `index.html` combines both sources. `buildTracksByIdFromLibrary()` populates `window.tracksById` with normalized track objects (must have both `artist` and `artistName` fields).

### Auth model

- HttpOnly session cookies (set by `reson-api-worker`)
- `window.currentUserId` / `window.currentUserEmail` / `window.isAdmin`
- Guests can browse + listen to shared catalog
- Account required for: import/download, personal library, sync, crate cloud backup
- Guest data (playlists, crate) auto-migrates to account on signup

### Download flow

1. User pastes URL or searches in the import wizard
2. Frontend calls `/preview` or `/playlist-tracks` on the local downloader
3. User reviews preview, selects tracks, clicks Download
4. Frontend calls `/download` → polls `/job/{id}` until complete
5. User reviews metadata in Review panel, edits tags
6. Frontend calls `/upload` → files go to R2 under `users/{userId}/Artist/Album/`
7. Cover art is auto-extracted from MP3 APIC tags and uploaded as `cover.jpg`

### Playlist and radio/mix detection

- `importIsRadioOrMixUrl()` — detects `list=RD...`, `list=FL...`, `start_radio`
- `importIsPlaylistUrl()` — detects regular playlists (`list=PL...`, `/playlist?list=...`)
- Both show a track checklist UI; downloads happen one track at a time

## Common Gotchas

1. **Always bump `?v=N`** on `<script>` tags after editing feature files
2. **Always use `stripUserPrefix()`** when parsing R2 keys into artist/album paths
3. **`importCleanUrl()` strips `list=` params** — don't use it on playlist URLs
4. **The downloader's `/download` uses `--no-playlist`** — it downloads one video at a time; the frontend handles batching
5. **`_clean_youtube_url()` in server.py also strips playlist params** — only used for `/preview` and `/download`, NOT for `/playlist-tracks`
6. **`normalizeSong()` and the "Playlist truth" block** both parse song objects — if `song.artist` is already set (even to a wrong value like `"users"`), it won't be overwritten unless explicitly handled
7. **The `music-streamer` worker is not in this repo** — it's deployed separately and handles R2 streaming + personal data APIs (playlists, crate, history, etc.)

## Running Locally

```bash
# Terminal 1: Frontend
npx vercel dev

# Terminal 2: Downloader (needs .venv activated or will auto-detect)
bash downloader/start.sh
```

## Deploying

```bash
# Frontend
npx vercel --prod

# API Worker
cd api/api-worker && npx wrangler deploy
```
