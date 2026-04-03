
# Roadmap

## Purpose

This file is the durable implementation plan for the next phase of the project. It is the source of truth to carry work across multiple chats, coding sessions, and commits.

Use it to track:

* the product model we are building
* the current implementation status
* what changed during execution
* what is next
* what is blocked

After each completed phase or small implementation slice, update this file and the matching repo-memory summary.

## Product Model

The app has a layered access model.

* Magic link is the low-friction path for listening to the owner catalog.
* Full accounts unlock personal import, review, customization, and account-owned data.
* Users should not start from nothing. They can still listen to the owner catalog and use owner tracks and playlists as a foundation.
* The long-term library model is shared owner catalog plus personal user additions.

## Architecture Decisions

### Access tiers

* Guest or magic-link access can listen to the owner catalog.
* Password-based account creation and login unlock personal music import and account-owned state.
* Owner-only operations remain restricted by centralized backend checks.

### Library model

* The shared owner catalog remains globally accessible through the existing shared music endpoints.
* Authenticated users get a separate personal library namespace.
* The frontend should merge shared and personal tracks into one browsing experience for signed-in users.
* Playlists should continue to store source-agnostic track references so users can mix owner tracks and personal tracks.

### Import model

* The existing three-step import flow remains the base structure: download, review, upload.
* The import pipeline needs to become account-backed rather than raw local credential-backed.
* Metadata review and confirmation are part of the intended product flow, not an optional extra.
* The more ambitious batch YouTube downloader idea is deferred until account ownership and library integration are stable.

### Identity model (updated)

* The fallback default user should not remain the long-term owner of personalized data.
* Guest identity and account identity need to be separated cleanly.
* Guest-created playlists and crate notes **should migrate automatically** into a new account when a guest upgrades.
* Migration behavior is explicit and automatic.

## Current Snapshot

### What exists now

* Shared owner catalog loading is already in place.
* Account auth endpoints already exist in the Cloudflare Worker.
* The frontend already has an auth modal with magic link, sign-in, and register modes.
* A partial personal import pipeline already exists through the import feature and local downloader service.
* Personal track storage seams already exist, but the personal library is not fully wired into the main app experience.

### What is not done yet

* The app does not yet cleanly distinguish guest capabilities from account-only capabilities.
* The frontend does not yet merge the shared catalog with an authenticated user library.
* The import flow is not yet tied cleanly to authenticated account ownership.
* The fallback identity path still conflicts with the target ownership model.
* Documentation is not yet in place for multi-session implementation handoff.

## Phase Plan

### Phase 1: Lock product rules

Define the capability split between guest access and full account access in both UI copy and backend expectations.

Target outcome:

* listening to the owner catalog remains easy
* personal upload and customization require an account
* the project stops drifting between conflicting auth assumptions

### Phase 1A: Clean up identity boundaries (updated)

Audit where the app currently uses fallback identity, local storage user ids, URL-based user ids, or authenticated session state.

Target outcome (updated):

* Guest state is temporary but carried forward into a full account when upgraded.
* Account state is the owner of personal data.
* Migration behavior is explicit and automatic.

Decision (updated):

* Guest-created playlists and crate notes **automatically migrate** into a new account when a guest upgrades.
* Any future import path should be explicit and opt-in, not automatic.

Current rule (updated):

* Guest-created playlists and crate notes stay local to the device **until upgrade**, then are merged into the account.
* Signed-in accounts use separate account-scoped cache keys plus cloud sync.
* Migration happens automatically on guest-to-account upgrade.

### Phase 2: Preserve the shared catalog as the base layer

Keep the owner catalog and its metadata endpoints as the shared source for listening.

Target outcome:

* Shared catalog remains stable and accessible
* Account work does not break the existing music experience

### Phase 3: Add authenticated personal library loading

Wire the frontend so signed-in users see both the shared catalog and their own uploaded tracks.

Target outcome:

* Guests see shared music only
* Signed-in users see shared music plus personal additions
* Playback and playlist behavior work consistently across both sources

### Phase 3A: Define merged library behavior

Decide how merged data is presented in the UI.

Recommended outcome:

* One library experience
* Clear source labeling where useful
* No separate playlist logic for owner versus user tracks

### Phase 4: Refactor auth around account-only capabilities

Keep one auth overlay and one handler system, but make the upgrade path clear in the copy and flow.

Target outcome:

* Users understand the difference between listening access and account ownership
* Login and registration support the personal-library path instead of blocking casual listening

### Phase 5: Upgrade import into an account-backed feature

Rework the import and downloader flow so downloads, review, metadata fixes, and uploads are tied to the authenticated account.

Target outcome:

* User import path is smoother
* Metadata review is part of the normal flow
* Upload results appear in the user library without brittle refresh behavior

### Phase 5A: Future downloader direction

Defer the batch-heavy YouTube downloader and advanced sorting UX until the account-backed pipeline is stable.

Target outcome:

* Avoid mixing product exploration with core ownership plumbing

### Phase 6: Let users bootstrap from the owner catalog

Preserve the ability for users to add owner tracks and playlists into their own account-owned playlists.

Target outcome:

* Users do not start from an empty app
* Owner music and user music can coexist naturally

### Phase 7: Owner and admin operations

Keep admin scope focused on real operational needs: user inspection, request moderation, and storage or playlist management.

Target outcome:

* Owner controls remain centralized
* Admin work supports the layered model rather than bypassing it

### Phase 8: Documentation and rollout

Document the layered access model, required services, deployment details, and any migration behavior.

Target outcome:

* Future chats and implementation sessions have a stable reference point
* Operator knowledge is not trapped in a single conversation

### Phase 9: Verification

Test the real journeys that define success for this phase.

Required verification:

* Guest access can listen to the owner catalog
* Account creation and login unlock personal import features
* Imported tracks appear in the user library
* Signed-in users can use both shared and personal tracks
* Playlists can mix both sources
* Owner-only tools stay restricted

## Relevant Files

* [index.html](/Users/jtannenbaum/myy-music-player/index.html)
* [src/features/import/import.feature.js](/Users/jtannenbaum/myy-music-player/src/features/import/import.feature.js)
* [downloader/server.py](/Users/jtannenbaum/myy-music-player/downloader/server.py)
* [src/features/crate/crate.feature.js](/Users/jtannenbaum/myy-music-player/src/features/crate/crate.feature.js)
* [src/features/playlists/playlists.feature.js](/Users/jtannenbaum/myy-music-player/src/features/playlists/playlists.feature.js)
* [src/features/context-menu/context-menu.feature.js](/Users/jtannenbaum/myy-music-player/src/features/context-menu/context-menu.feature.js)
* [src/features/sync/sync.feature.js](/Users/jtannenbaum/myy-music-player/src/features/sync/sync.feature.js)
* [api/api-worker/index.js](/Users/jtannenbaum/myy-music-player/api/api-worker/index.js)
* [api/get-songs.js](/Users/jtannenbaum/myy-music-player/api/get-songs.js)
* [api/get-covers.js](/Users/jtannenbaum/myy-music-player/api/get-covers.js)
* [api/pinned-playlists.js](/Users/jtannenbaum/myy-music-player/api/pinned-playlists.js)
* [README.md](/Users/jtannenbaum/myy-music-player/README.md)

## Working Log

### Done

* Created the durable roadmap and repo-memory handoff structure.
* Locked the current product direction around a layered catalog model.
* Updated guest-upgrade decision: guest playlists and crate notes **now automatically migrate** into accounts.
* Removed the shared fallback user path from guest personalization and separated guest versus account local caches for playlists and crate data.
* Replaced the remaining raw `app_user_id` fallbacks on personalized cloud reads and writes, including now-playing and history sync paths.
* Implemented automatic guest-to-account migration for guest playlists and crate notes during auth success.
* Hid and guarded account-only guest UI entry points for sync, recently deleted, and import-related flows.
* Audited the checked-in backend surface and confirmed the in-repo Cloudflare worker only handles auth, per-user song listing, and request moderation.
* Tightened the remaining guest-visible customization actions by runtime-guarding artist crop and profile photo upload behind account checks.
* Centralized personal-data endpoint routing behind a shared frontend helper so playlists, crate, history, now-playing, recently deleted, artist crop, delete-album, and link flows can be repointed without another multi-file URL sweep.
* Switched deployed personal-data routing toward same-origin `/api/*` rewrites so account-backed requests can carry the existing session cookie instead of depending on direct cross-origin worker calls.
* Updated the `music-streamer` worker copy to derive ownership from session-backed identity for artist crop, delete-album, now-playing, recently deleted, playlists, playlist items, crate, import-playlist, and history-log, and removed duplicate playlist handlers in that copy.
* Verified live anonymous enforcement for deployed `now-playing`, `playlists`, `crate`, `history-log`, and `artist-crop` routes: each now returns `401 Not signed in` through the site origin instead of trusting raw user ids.
* Fixed the frontend `personalDataApiUrl` recursion bug in playlist and settings feature wrappers so signed-in `history-log`, `now-playing`, `artist-crop`, and related personal-data calls can be tested again after redeploy.

### Next

* Bring the personal-data worker source for playlists, crate, history, now-playing, recently deleted, artist crop, and link endpoints into this repo, or repoint the app to a checked-in backend that can enforce session-backed ownership.
* Sub-step for Phase 1A: redeploy the frontend helper fix plus the exact `/api/recently-deleted` rewrite so signed-in personal-data calls use the corrected helper and the bare recently-deleted route reaches `music-streamer`.
* After that deployment step, verify the hardened personal-data routes against signed-in flows and then add or wire a repeatable verification harness for guest upgrade migration, guest-mode gating, merged library behavior, and history or now-playing sync.

### Blocked

* The personal-data endpoints used by the frontend still point at `music-streamer.jacetbaum.workers.dev`, but that worker code is not present in this workspace, so backend ownership enforcement cannot be completed from this checkout.
* The bare `/api/recently-deleted` route still needs the new exact Vercel rewrite deployed; without it, that path falls through the generic `/api/*` rule instead of reaching `music-streamer`.
* `link/start` and `link/redeem` are still referenced in the frontend and live site but are not present in the provided worker copies or deployed rewrites, so that flow remains unresolved until it is either implemented or removed.
* No automated E2E test harness is present in the repo, and verification of the live personal-data backend still requires a deployed worker plus a valid signed-in test session.

### Changes From Original Assumption

* Login does not gate all listening; guests can access the owner catalog.
* Guest state now migrates automatically to accounts rather than staying local-only.
* The earlier fallback-id sync model is no longer a valid basis for personal playlists or crate notes.

## Update Protocol

After each phase or small implementation slice, update both this file and the repo-memory summary with:

* what was done
* what is next
* what is blocked
* any architecture or product decision changes

Keep the roadmap detailed enough for handoff and keep repo memory short enough to scan quickly at the start of a new chat.

At the end of the roadmap, always include a sentence stating the last completed step (using the exact roadmap step name) and the next actual roadmap step (using the exact step name). If a prerequisite or sub-step is needed before the next step, include it explicitly as a sub-step and tell me in your report. After completing a full phase, report that the phase is complete and tell me to start a new chat to begin the next phase. If there is something I must do on my end, please walk me through explicitly how to do it. Please advise me when to push changes to github/vercel. 

Last completed step: Phase 1: Lock product rules. Next actual roadmap step: Phase 1A: Clean up identity boundaries (updated). Prerequisite sub-step: redeploy the frontend helper fix plus the exact `/api/recently-deleted` rewrite, then confirm the already-deployed session-backed worker enforcement against signed-in flows before finishing the broader verification pass.