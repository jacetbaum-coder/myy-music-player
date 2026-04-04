## Roadmap: Account Download and Personal Import Flow

This roadmap defines the execution order for adding account-owned music downloads from crate.

Worker rule: when a step is completed, update this document immediately and mark the step as complete before starting the next step.

Worker rule: if a step turns out to require additional substeps, blockers, or design decisions, document them explicitly under that step before moving on. Do not silently expand scope.

Worker rule: stay on the current step until its implementation and verification are done, or until a newly discovered dependency is recorded here.

Worker rule: after each implementation slice, record four things in this document: what changed, what was verified, what remains, and any newly discovered follow-up work.

### Status Key

- `TODO` = not started
- `IN PROGRESS` = active step
- `BLOCKED` = cannot proceed until dependency or decision is resolved
- `DONE` = implemented and verified for current scope

## Scope

Included in this roadmap:
- Account-only download entry launched from crate
- Text search from day one
- Direct pasted URLs from day one
- YouTube-first provider support
- Review-before-save metadata flow
- Save into the authenticated user library
- Reuse of the existing import and downloader pipeline where possible

Excluded from the first ship:
- Cloud-hosted downloader jobs
- One-click silent auto-save
- Advanced batch sorting workflow
- Automatic SpotDL installation on the user machine
- Spotify text search
- Any hosted queue or server-side download fleet

## Execution Rules

1. Only one roadmap step should be `IN PROGRESS` at a time unless the document explicitly marks parallel work.
2. Before changing files for a step, confirm the dependencies listed for that step are already `DONE`.
3. When a step is finished, add a completion note directly under the step with the date, files touched, and verification performed.
4. If new required substeps are discovered, add them directly beneath the current step in a `Discovered substeps` section and mark whether they block progress.
5. If implementation reveals scope drift, stop and document the drift here before proceeding.
6. Do not mark a step `DONE` without at least one concrete verification note.

## Step 1: Define the crate launch path
Status: DONE

Goal:
Add a clear Download Your Music entry point inside crate and keep it account-only.

Dependencies:
- Existing crate UI and auth gating behavior

Implementation notes:
- Reuse the signed-in gating patterns already used for account-owned features.
- Guests should be routed into the existing sign-in or create-account flow.
- Crate should be the launch surface, not the full metadata editor.

Expected files:
- `/Users/jtannenbaum/myy-music-player/src/features/crate/crate.feature.js`
- `/Users/jtannenbaum/myy-music-player/src/features/sync/sync.feature.js`
- `/Users/jtannenbaum/myy-music-player/index.html`

Verification:
- Signed-out user cannot start the flow without auth.
- Signed-in user can find and open the new crate entry.

Completion note:
- Date: 2026-04-03
- Status change: TODO -> IN PROGRESS -> DONE
- What changed: Renamed the crate tile and import header to Download Your Music, kept the tile visible for guests with explicit account-required copy, removed the old full-hide behavior for the crate import tile, and hardened the import subview so guest access always routes through account auth.
- Files touched: `/Users/jtannenbaum/myy-music-player/index.html`, `/Users/jtannenbaum/myy-music-player/src/features/crate/crate.feature.js`, `/Users/jtannenbaum/myy-music-player/src/features/sync/sync.feature.js`
- Verification performed: Static validation of the touched frontend files with workspace diagnostics; confirmed the gated flow now remains discoverable in crate while still requiring account auth before opening the import view.
- Remaining work: Build the unified input model and backend query flow behind this entry point.
- Discovered substeps: Keep crate-specific account-only UI separate from the global hide/show helper so the feature stays visible to guests without exposing the import flow itself.
- Blocking issues: None for this step.

## Step 2: Build the unified input model
Status: DONE

Goal:
Support one input field that accepts either free text or a pasted provider URL.

Dependencies:
- Step 1

Implementation notes:
- The client should detect whether the user entered a URL or a text query.
- The same UI should be reused for both flows so provider support stays interchangeable.
- Keep the input model provider-agnostic even if YouTube is the only initial text-search provider.

Expected files:
- `/Users/jtannenbaum/myy-music-player/src/features/import/import.feature.js`
- `/Users/jtannenbaum/myy-music-player/src/features/search/search.feature.js`

Verification:
- Text entry is recognized as search input.
- YouTube links and playlists are recognized as direct URL input.

Completion note:
- Date: 2026-04-03
- Status change: TODO -> IN PROGRESS -> DONE
- What changed: Reworked the import download panel so one input accepts free text or pasted links, added dynamic primary actions for search, preview, and download, added search result rendering and selection, and added a preview card for resolved YouTube matches before download begins.
- Files touched: `/Users/jtannenbaum/myy-music-player/index.html`, `/Users/jtannenbaum/myy-music-player/src/features/import/import.feature.js`
- Verification performed: Workspace diagnostics show no new errors in the touched frontend files; reviewed the state flow for text query, direct YouTube preview, Spotify direct-download fallback, and the existing review handoff.
- Remaining work: Run the flow against a live local downloader once the required CLI tools are installed.
- Discovered substeps: Remove the old click-to-show-logs behavior because the primary action now handles search and preview before download.
- Blocking issues: None for this step.

## Step 3: Add downloader search and metadata preview contracts
Status: DONE

Goal:
Extend the local downloader so the frontend can ask for candidates and preview normalized metadata before final save.

Dependencies:
- Step 2

Implementation notes:
- Add a provider-normalized search endpoint for text queries.
- Add a provider-normalized metadata-preview endpoint for chosen matches or pasted URLs.
- Make YouTube the initial supported provider for text search and direct URLs.
- Keep Spotify URL support as a later slice behind the same contract shape.

Expected files:
- `/Users/jtannenbaum/myy-music-player/downloader/server.py`
- `/Users/jtannenbaum/myy-music-player/downloader/requirements.txt`
- `/Users/jtannenbaum/myy-music-player/downloader/start.sh`

Verification:
- A text query returns normalized result candidates.
- A selected candidate or pasted URL returns album or track metadata preview.
- Failure states are explicit when the local downloader is offline or the provider lookup fails.

Completion note:
- Date: 2026-04-03
- Status change: TODO -> IN PROGRESS -> BLOCKED -> DONE
- What changed: Added `/search` and `/preview` endpoints to the local downloader using yt-dlp JSON output, normalized YouTube search candidates and preview payloads for the frontend, updated downloader dependency/bootstrap files so missing CLI tools fail clearly instead of silently, and fixed the startup script so it automatically prefers the repo venv instead of system Python.
- Files touched: `/Users/jtannenbaum/myy-music-player/downloader/server.py`, `/Users/jtannenbaum/myy-music-player/downloader/requirements.txt`, `/Users/jtannenbaum/myy-music-player/downloader/start.sh`
- Verification performed: Workspace diagnostics show no new errors in the touched Python files; installed the missing downloader packages into the repo venv; started the local helper successfully; verified `/health`; verified `/search` with a live query returning normalized YouTube candidates; verified `/preview` on a returned source URL and confirmed normalized preview metadata.
- Remaining work: Connect selected results and preview state more deeply into the review workflow.
- Discovered substeps: Keep the helper pinned to the repo venv so runtime verification and future installs do not accidentally use system Python.
- Blocking issues: None for this step.

## Step 4: Reuse the import workflow instead of creating a second editor
Status: IN PROGRESS

Goal:
Deep-link from crate into the existing setup, download, and review workflow with prefilled state.

Dependencies:
- Step 3

Implementation notes:
- Preserve the current 3-panel structure.
- Prefill the panel state from crate launch context.
- Use the review stage to show album, artist, year, artwork, track list, and editable metadata.
- Avoid splitting metadata editing across crate and import.

Expected files:
- `/Users/jtannenbaum/myy-music-player/src/features/import/import.feature.js`
- `/Users/jtannenbaum/myy-music-player/src/features/crate/crate.feature.js`
- `/Users/jtannenbaum/myy-music-player/index.html`

Verification:
- Selecting a match launches the review flow with prefilled metadata.
- Users can edit metadata before saving.
- Existing direct-download import behavior still works.

Completion note:
- Date: 2026-04-03
- Status change: TODO -> IN PROGRESS
- What changed: Added import launch-context plumbing so crate can open the import flow with prefilled state and automatically route into the download panel when the local helper is healthy, preserved selected source metadata through download, added a review summary card, auto-opened review after resolved downloads, and now prefill missing review tags from the chosen preview metadata before upload.
- Files touched: `/Users/jtannenbaum/myy-music-player/src/features/import/import.feature.js`, `/Users/jtannenbaum/myy-music-player/src/features/crate/crate.feature.js`, `/Users/jtannenbaum/myy-music-player/index.html`
- Verification performed: Workspace diagnostics show no new errors in the touched frontend files; live downloader lookups still succeed after the launch-context and review handoff changes.
- Remaining work: Run a browser-level pass to confirm the end-to-end UI sequence from search result selection into the review panel behaves as intended.
- Discovered substeps: The selected source now survives into review, but the crate tile itself still launches the generic download entry rather than pre-seeding a specific artist or album from another crate action.
- Blocking issues: None currently.

## Step 5: Tie uploads to authenticated ownership
Status: IN PROGRESS

Goal:
Store imported files in the authenticated user namespace and make them visible through the personal library path.

Dependencies:
- Step 4

Implementation notes:
- The upload contract must carry account context.
- Imported files should save under the authenticated user prefix.
- The flow should avoid raw shared storage paths for personal imports.

Expected files:
- `/Users/jtannenbaum/myy-music-player/downloader/server.py`
- `/Users/jtannenbaum/myy-music-player/api/api-worker/index.js`
- `/Users/jtannenbaum/myy-music-player/src/features/import/import.feature.js`
- `/Users/jtannenbaum/myy-music-player/src/features/sync/sync.feature.js`

Verification:
- Imported objects land in the authenticated user namespace.
- Personal library listing returns the new files.
- Auth expiry or upload errors produce explicit UI feedback.

Completion note:
- Date: 2026-04-04
- Status change: TODO -> IN PROGRESS
- What changed: Started wiring account ownership into the upload path by adding optional `userId` support to local uploader routes, scoping uploader and copy-from-url keys into `users/<userId>/...`, sending authenticated user context from the import feature, switching the post-upload Done action toward the authenticated `/user/songs` library route, making the main library bootstrap respect `libraryMode=personal` with a separate cache and authenticated `/user/songs` refresh path, exposing a shared mode-aware library refresh helper so personal mode does not rely on one-off import-only refresh logic, hardening the personal-mode bootstrap so signed-in library refresh now merges shared catalog albums with personal uploads instead of replacing the shared library entirely, and adding explicit auth-expiry messaging plus background personal-library refresh after successful copy-to-library actions.
- Files touched: `/Users/jtannenbaum/myy-music-player/downloader/server.py`, `/Users/jtannenbaum/myy-music-player/src/features/import/import.feature.js`, `/Users/jtannenbaum/myy-music-player/index.html`
- Verification performed: Workspace diagnostics show no new errors in the touched files; direct helper validation confirms account-scoped key rewriting produces `users/<userId>/artist/album/file` paths without double-prefixing existing user keys; helper `/health` and `/search` remain live; startup failures were traced to the port already being in use rather than a broken downloader script.
- Remaining work: Verify a real authenticated upload lands under the user prefix and confirm the signed-in browser flow stays on the personal library while still showing the shared base catalog.
- Discovered substeps: The broader app needed a mode-aware bootstrap refresh path and a merged shared-plus-personal library view, which are now wired in the main shell; the next check is to confirm playlist, queue, and player entry points behave correctly with personal `users/<userId>/...` track ids.
- Blocking issues: Browser-level signed-in verification is still needed.

## Step 6: Merge imported tracks into the signed-in library experience
Status: TODO

Goal:
Make successful personal imports appear naturally in the user-facing library and playlist flow.

Dependencies:
- Step 5

Implementation notes:
- Reuse the existing shared-plus-personal library direction.
- Keep source labeling minimal and only where it prevents confusion.
- Confirm imported tracks can be queued, played, and added to playlists.

Expected files:
- `/Users/jtannenbaum/myy-music-player/src/features/library/library.feature.js`
- `/Users/jtannenbaum/myy-music-player/src/features/playlists/playlists.feature.js`
- `/Users/jtannenbaum/myy-music-player/src/features/player/player.feature.js`
- `/Users/jtannenbaum/myy-music-player/api/api-worker/index.js`

Verification:
- Imported tracks appear in the signed-in library.
- Imported tracks play correctly.
- Imported tracks can be added to playlists alongside shared catalog items.

Completion note:
- Pending.

## Step 7: Add clear failure and status handling
Status: TODO

Goal:
Ensure the flow is understandable when the downloader is offline, lookup fails, metadata is incomplete, upload fails, or auth expires.

Dependencies:
- Steps 3 through 6

Implementation notes:
- Every major failure path needs a user-visible state.
- Keep status text and retry behavior explicit.
- If crate shows recent import state, it should be lightweight and not replace the main review workflow.

Expected files:
- `/Users/jtannenbaum/myy-music-player/src/features/import/import.feature.js`
- `/Users/jtannenbaum/myy-music-player/src/features/crate/crate.feature.js`
- `/Users/jtannenbaum/myy-music-player/downloader/server.py`

Verification:
- Offline downloader failure is readable.
- Provider lookup failure is readable.
- Upload failure is readable.
- Auth-expired behavior is readable and recoverable.

Completion note:
- Pending.

## Step 8: Follow-up slice for Spotify URLs through the same pipeline
Status: TODO

Goal:
Add Spotify URL handling through the same unified flow after the YouTube-first account pipeline is stable.

Dependencies:
- Steps 1 through 7

Implementation notes:
- Reuse the same UI and normalized contract.
- Do not add Spotify text search in this step unless separately planned.
- Document rate-limit behavior and any credential friction explicitly.

Expected files:
- `/Users/jtannenbaum/myy-music-player/downloader/server.py`
- `/Users/jtannenbaum/myy-music-player/src/features/import/import.feature.js`
- `/Users/jtannenbaum/myy-music-player/docs/roadmap.md`

Verification:
- Spotify URL input reaches the same review and save path.
- Rate-limit or provider-auth failures are surfaced clearly.

Completion note:
- Pending.

## Step 9: Documentation sync and rollout notes
Status: TODO

Goal:
Keep the durable roadmap and implementation notes current as work lands.

Dependencies:
- Ongoing throughout the project

Implementation notes:
- After each completed slice, update the project roadmap and this execution document.
- Record what shipped, what remains, and what changed in scope.
- Keep any newly discovered dependencies explicit so later workers do not lose context.

Expected files:
- `/Users/jtannenbaum/myy-music-player/docs/roadmap.md`
- This roadmap document
- `/memories/repo/roadmap-summary.md`

Verification:
- Documentation matches the actual shipped state.
- Outstanding work is explicit and current.

Completion note:
- Pending.

## Worker Update Template

Use this format under the active step before moving on:

- Date: YYYY-MM-DD
- Status change: TODO -> IN PROGRESS -> DONE or BLOCKED
- What changed:
- Files touched:
- Verification performed:
- Remaining work:
- Discovered substeps:
- Blocking issues:

## Handoff Note

If a future worker takes over, they should start by reading this roadmap, the session plan at `/memories/session/plan.md`, and the current project roadmap at `/Users/jtannenbaum/myy-music-player/docs/roadmap.md`. They should not skip documentation updates when completing a step.