# Changelog

All meaningful changes in this repository should be recorded here.

The format is intentionally lightweight and optimized for agent handoff:

- `Added` for new files, features, or processes
- `Changed` for updates to behavior or direction
- `Fixed` for bug fixes
- `Notes` for assumptions, follow-ups, or context

## Unreleased

### Changed

- Allowed the Owner role to warn, suspend, sign out, ban, and unban Admin, Moderator, and Analyst accounts while keeping Owner accounts protected.
- Updated the repository collaboration guidelines to allow informal language, including profanity, in contributor discussions.

### Added

- Added local mouse-hover disturbance to the login galaxy: stars follow a soft swept brush with a curling wake, then spring back smoothly. Drag rotation is preserved, and pause/reduced-motion settings disable the hover animation.
- Added a procedural 3D spiral-galaxy background to sign-in, sign-up, and administrator login, inspired by the Astra page: glowing blue/white/amber stars, perspective depth, pointer/touch and keyboard rotation, reset/pause controls, reduced-motion support, and mobile layout. No external image or rendering dependency is required.
- Added Magic mode to player, replay, administrator spectator, and tournament spectator boards: an immersive orthographic 2.5D scene with 36 locally generated piece models across Astral, Sovereign, and Neon collections, independent saved skin choices for each side, move trails, capture bursts, check indicators, and legal destination markers.
- Kept Magic play on the existing authoritative server command path, including promotion and live clocks. A modal focus boundary requires exiting Magic before navigation, analysis, replay controls, or moderation; spectators remain read-only. Added keyboard navigation, reduced-motion controls, responsive layouts, lazy 3D loading, and a recoverable WebGL failure state.
- Added regression coverage for castling, en passant, underpromotion, reconnect/replay transitions, pinned-piece destinations, skin preference validation, and all procedural models. No server protocol or persistent game-data migration is required.

- Added automatic rated and casual matchmaking queues grouped by time control, with cancellation, disconnect cleanup, duplicate-search protection, and random color assignment.
- Added persistent Bullet, Blitz, and Rapid Elo ratings with provisional K-factors, peak/streak statistics, rating history, exact auditable reversals, duplicate-result protection, and repeated-opponent limits.
- Added rated/casual human-room selection, starting ratings, win/draw/loss estimates, post-game rating results, resign support, public leaderboards, searchable player profiles, and eligibility filtering.
- Added persistent server-managed Swiss tournaments for 4–32 players with player-submitted private drafts, admin/moderator approval, registration, check-in, deterministic pairings, color balancing, one-time byes, Buchholz standings, assigned rooms, spectator access, forfeits, result correction, pause/resume, and restart recovery.
- Added repeated very-short resignation flags for manual administrator review without automatic punishment.

- Added a live administrator control center with server health, online users, active/completed games, analysis jobs, activity feed, alerts, operational charts, search, and a command palette.
- Added role-based Owner, Admin, Moderator, and Analyst permissions; warnings, temporary suspension, forced sign-out, permanent bans, private notes, and persistent user game history.
- Added read-only live and archived-game spectating, PGN export, admin analysis, reasoned game cancellation/result decisions, and displaced-player reconnection.
- Added a persistent fair-play review queue with accuracy, average centipawn loss, engine-move similarity, timing signals, and explicit human approval or rejection without automatic bans.
- Added persistent site controls for announcements, maintenance mode, feature flags, time controls, computer levels, and analysis strength/timeouts.
- Added append-only administrator audit records, individual admin-password/TOTP enrollment, role assignment, and inactive admin-session expiry.
- Added a separate administrator login portal using a username and server-validated admin code, plus the existing account moderation panel.
- Added an administrator action to unban accounts and allow them to sign in again.
- Added server-side post-game Stockfish analysis with per-move labels, evaluations, and suggested best moves.
- Added manual username/password sign-up, sign-in, sign-out, and session restoration with locally persisted, salted password hashes.
- Added post-game move replay and PGN downloads; engine-assisted review remains deferred.
- Initialized collaboration foundation docs for a Codex-first project workflow.
- Added `codex.md` as the repo-wide source of truth for cross-agent conventions.
- Added `docs/requirements.md` to capture agreed MVP scope, priorities, and non-goals.
- Added `docs/roadmap.md` to define phased delivery from design through future AI support.
- Added `docs/adr/0001-project-foundation.md` to record the initial architectural direction.
- Added ADR 0002 to select pnpm, React/Vite, Fastify/Socket.IO, chess.js, and Vitest for the Phase 1 MVP.
- Started the Phase 1 monorepo implementation for LAN room multiplayer.
- Added a runnable Fastify/Socket.IO server, shared game protocol, isolated chess rules package, React board UI, LAN startup guide, and unit tests for core gameplay and rooms.
- Added a server-authoritative one-minute chess clock, automatic timeout loss, and the low-time quick-move bonus rule.
- Added human-versus-computer mode with five requested difficulty choices and a server-side Stockfish player controller.
- Added a two-second minimum server-side thinking delay before each computer move.
- Added selectable one-, three-, five-, ten-, thirty-, and forty-five-minute clocks for computer games.
- Reworked the README into a bilingual English/Chinese local-installation, LAN-play, and operations guide.

### Fixed

- Prevented ordinary player credentials from creating administrator privileges, moved password hashing off the server event loop, and added per-address authentication throttling.
- Prioritized computer moves between per-position analysis tasks so long reviews no longer monopolize Stockfish.
- Made administrator reconnects restore the target player's room state, color, and seat token.
- Added unique identities for every game and archived rematch, prevented joins or result overrides after administrative completion, and kept archived selections distinct from active rematches.
- Broadcast live user-list changes to every administrator, displayed administrator-decided winners correctly, rejected repeated fair-play decisions, and fail safely on corrupted game history.
- Made administrator warnings visible to online players immediately and to offline players at their next sign-in, and corrected the spectator board to enforce eight equal rows and columns.
- Preserved the banned-account notice when the server force-disconnects a moderated player, and added visible timeout feedback for Ban and Unban actions.
- Fixed post-game analysis failing after computer games by sharing one serialized Stockfish runtime, and by handling checkmate or draw positions without asking the engine for another move.
- Fixed intentional sign-out or room departure leaving a stale player seat that prevented a new login from joining the room.
- Fixed the chessboard grid so every rank and file retains equal dimensions even when a rank has no pieces.
- Added an explicit in-room restart action after a checkmate or draw, resetting the game for both players while preserving the room and colors.
- Split end-of-game actions into an explicit rematch and a return-to-home flow, including server-side room departure and session cleanup.
- Allow a selected piece to be replaced directly by clicking another one of the player's pieces.

### Notes

- Current agreed MVP excludes login, AI, matchmaking, and rankings.
- First deployment target is a single-computer setup accessible over a local area network.
- Active room state remains in memory, while completed-game history, audit records, fair-play reviews, user accounts, and site configuration persist locally.
- Ratings and tournaments persist in versioned JSON files with atomic replacement; a transactional database remains the required migration path for public or multi-server deployment.
