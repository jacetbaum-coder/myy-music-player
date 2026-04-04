# Reson — Personal Music Player

A self-hosted music player with a shared owner catalog and personal library uploads. Built as a single-page vanilla JS app deployed on Vercel, backed by Cloudflare Workers and R2 for storage.

## Architecture

```
Browser (index.html)
  ├── Vercel ──── static hosting + /api/* serverless functions
  ├── reson-api-worker (Cloudflare Worker) ──── auth, /user/songs, /requests
  ├── music-streamer (Cloudflare Worker) ──── R2 file streaming, personal-data APIs
  └── downloader/server.py (local) ──── yt-dlp search/preview/download, R2 upload
```

| Service | Domain | Purpose |
|---------|--------|---------|
| **Frontend** | Vercel (`npx vercel dev`) | Single-page app, Vercel serverless API routes |
| **API Worker** | `reson-api-worker.jacetbaum.workers.dev` | Auth (register/login/magic-link), user song listing, song requests |
| **Music Streamer** | `music-streamer.jacetbaum.workers.dev` | Streams files from R2, personal-data APIs (playlists, crate, history, etc.) |
| **Downloader** | `localhost:8765` | Local Python server for YouTube/Spotify search, preview, download, and R2 upload |

### Storage

- **Cloudflare R2** bucket: `music-files`
- **R2 key format**: `users/{userId}/Artist/Album/Track.ext` (personal library)
- **KV namespaces**: `SESSIONS` (auth sessions), `REQUESTS` (song requests)

## Prerequisites

- **Node.js** (v18+) — for Vercel CLI and Workers
- **Python 3.12+** — for the local downloader server
- **Vercel CLI** — `npm i -g vercel`
- **Wrangler CLI** — `npm i -g wrangler` (for Cloudflare Worker deploys)

## Setup

### 1. Clone and install

```bash
git clone <repo-url> && cd myy-music-player
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r downloader/requirements.txt
```

### 2. Configure R2 credentials

Create `downloader/.env` (gitignored):

```env
R2_ACCOUNT_ID=<your-cloudflare-account-id>
R2_ACCESS_KEY_ID=<your-r2-access-key>
R2_SECRET_ACCESS_KEY=<your-r2-secret-key>
R2_BUCKET=music-files
```

### 3. Authenticate CLIs

```bash
npx vercel login
npx wrangler login
```

## Running Locally

**Frontend** (serves on `localhost:3000`):
```bash
npx vercel dev
```

**Downloader server** (serves on `localhost:8765`):
```bash
bash downloader/start.sh
```

Check downloader health: `curl http://localhost:8765/health`

## Deploying

**Frontend** (Vercel):
```bash
npx vercel --prod
```

**API Worker** (Cloudflare):
```bash
cd api/api-worker && npx wrangler deploy
```

## Project Structure

```
index.html                  ← Entire SPA (HTML + inline CSS + core JS)
src/features/
  player/player.feature.js  ← Audio playback, queue, now-playing UI
  library/library.feature.js ← Library grid, album detail, sorting
  import/import.feature.js  ← Download wizard (search → preview → download → review → upload)
  search/search.feature.js  ← Search overlay
  playlists/playlists.feature.js ← Playlist CRUD
  queue/queue.feature.js    ← Queue drawer
  crate/crate.feature.js    ← Crate (saved items)
  sync/sync.feature.js      ← Cloud sync helpers
  lyrics/lyrics.feature.js  ← Lyrics display
  artist/artist.feature.js  ← Artist pages
  settings/settings.feature.js ← Settings panel
  context-menu/context-menu.feature.js ← Long-press context menus
  for-you/for-you.feature.js ← For You recommendations
downloader/
  server.py                 ← FastAPI server (yt-dlp, R2 upload)
  start.sh                  ← Launcher script
  requirements.txt          ← Python dependencies
api/
  api-worker/index.js       ← Cloudflare Worker (auth, user songs, requests)
  api-worker/wrangler.toml  ← Worker config (R2/KV bindings)
  get-songs.js              ← Vercel serverless: shared catalog songs
  get-covers.js             ← Vercel serverless: shared catalog covers
  pinned-playlists.js       ← Vercel serverless: pinned playlists
vercel.json                 ← Rewrite rules (proxies /auth/*, /api/* to Workers)
docs/
  roadmap.md                ← Product direction and phase plan
  account-download-roadmap.md ← Download feature implementation plan
```

## Key Concepts

- **Shared catalog**: The owner's music, accessible to all users (guests included)
- **Personal library**: Uploaded tracks scoped to `users/{userId}/` in R2, visible only to the account owner
- **Merged library**: Signed-in users see shared + personal merged into one grid
- **Guest → Account migration**: Guest playlists and crate notes auto-migrate on account creation
- **Cache busting**: Feature scripts use `?v=N` query params — bump the number when editing a file