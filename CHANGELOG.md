# Changelog

All meaningful changes in this repository should be recorded here.

The format is intentionally lightweight and optimized for agent handoff:

- `Added` for new files, features, or processes
- `Changed` for updates to behavior or direction
- `Fixed` for bug fixes
- `Notes` for assumptions, follow-ups, or context

## Unreleased

### Changed

- Updated the repository collaboration guidelines to allow informal language, including profanity, in contributor discussions.

### Added

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

- Fixed intentional sign-out or room departure leaving a stale player seat that prevented a new login from joining the room.
- Fixed the chessboard grid so every rank and file retains equal dimensions even when a rank has no pieces.
- Added an explicit in-room restart action after a checkmate or draw, resetting the game for both players while preserving the room and colors.
- Split end-of-game actions into an explicit rematch and a return-to-home flow, including server-side room departure and session cleanup.
- Allow a selected piece to be replaced directly by clicking another one of the player's pieces.

### Notes

- Current agreed MVP excludes login, AI, matchmaking, and rankings.
- First deployment target is a single-computer setup accessible over a local area network.
- Active room state is intentionally in-memory for the MVP; a process restart clears rooms.
