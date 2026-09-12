# Product Requirements

## Product Vision

Build a deployable chess website that starts with LAN-based two-player multiplayer and can later evolve into an internet-ready platform with AI opponents.

## Current Product Stage

Current stage: playable LAN/small-community platform with accounts, administration, ratings, and Swiss tournaments.

The immediate goal is to define a clean MVP that is fast to build, easy for multiple Codex agents to continue, and structurally ready for later AI support.

## MVP Statement

MVP definition:

One player can create a chess room, another player can join from another device on the same LAN, both can play a full game in real time through a browser, and the server validates the game state and game result.

## Priority Model

Priority labels:

- `P0`: required for the first usable release
- `P1`: important after MVP but not required to prove the core product
- `P2`: valuable expansion work
- `P3`: future or exploratory work

## P0 Requirements

### Gameplay

- Full standard chess initial setup
- Legal move validation
- Turn enforcement
- Capture handling
- Check detection
- Checkmate detection
- Stalemate detection
- Draw handling at minimum for positions that the chosen rules engine supports cleanly in the first version
- Promotion flow
- Game result state
- Server-authoritative chess clock: each player starts with one minute, and reaching zero loses the game.
- Low-time recovery rule: when a player has 20 seconds or less and moves within two seconds of their turn starting, add two seconds to their clock.

### Multiplayer

- Create room
- Join room
- Exactly two active players per room
- Distinct white and black assignments
- Realtime state synchronization
- Reconnect behavior defined at least at a basic level

### Computer Opponent

- Home screen choice between LAN human multiplayer and computer play
- Human player controls White and the computer controls Black through the same server command path
- Computer levels: `beginner` (approximately Elo 250), `medium` (approximately Elo 700), `high` (approximately Elo 1400), `hell` (approximately Elo 2100), and unrestricted `stockfish`
- Before starting a computer game, allow one-minute, three-minute, five-minute, ten-minute, thirty-minute, and forty-five-minute clocks per player

### Client Experience

- Browser-based board UI
- Clear current turn indicator
- Clear move rejection feedback
- Visible room join flow
- Shareable room identifier or link

### Backend

- Server-authoritative room state
- Server-side move validation
- Deterministic game state transitions
- Realtime event protocol between client and server

### Operations

- Run locally on one computer
- Accessible from another device on the same LAN
- Basic environment configuration
- Basic startup documentation

## P1 Requirements

- Manual username/password sign-up and sign-in with persisted user records
- Separate administrator-code login and basic account moderation controls
- Better reconnect handling
- Resign action
- Offer draw and accept draw flow
- Move history
- Exportable PGN or FEN
- Spectator mode
- Better error states and room lifecycle handling
- Basic responsive UI polish

## Competitive Platform Requirements (implemented)

- Rated and casual authenticated human rooms with immutable pre-game eligibility
- Separate Bullet, Blitz, and Rapid Elo pools and persistent rating history
- Public active-player leaderboards and public rating profiles
- Server-managed 4–32 player, 3–7 round Swiss tournaments
- Player-created private drafts with admin/moderator approval and permanent deletion, creator-managed lifecycle controls, registration, optional check-in, assigned tournament rooms, standings, Buchholz, byes, forfeits, and spectating
- Idempotent rating and tournament processing, auditable rating reversals, and no Elo changes for computer games, cancellations, or administrative forfeits
- Manual-only fair-play decisions; automated signals never ban an account

## P2 Requirements

- Persistent game history
- User profiles
- Authentication
- Matchmaking
- Chat
- Observability improvements
- Production deployment hardening

## P3 Requirements

- Analysis mode
- Deeper engine-assisted analysis, including principal variations and richer move labels
- Ranked ladder
- Tournament features

## Original MVP Non-Goals (subsequently delivered where noted above)

- Login or registration
- AI opponent
- Ranking system
- Matchmaking queue
- Social graph features
- Payments

## Key Product Constraints

- The initial version should be easy to run by a small team without heavy infrastructure.
- The implementation should support future online deployment, not just local-only hacks.
- The chess rules layer should be separable from the UI and network transport.
- The multiplayer flow should be designed so AI can later use the same move command path as a human player.

## Open Questions For Later

These are intentionally deferred so they do not block MVP planning:

- Should spectators be enabled in the first public version or after MVP?
- Should room links be guessable IDs or stronger random tokens?
- Which draw rules will be fully supported in the first version?
- Should the initial room model support rematches?
- What persistence model should be used once history is introduced?

## MVP Acceptance Criteria

The MVP is acceptable when all of the following are true:

- two devices on the same LAN can open the app in a browser
- one device can create a room and another can join it
- both players can complete a chess game in real time
- illegal moves are rejected by the server
- the game ends correctly on supported win or draw conditions
- the project has enough documentation that another Codex can continue without re-discovering core decisions

## Magic Board Mode

- Every board surface, including live human/computer/tournament play, finished-game replay positions, and administrator/tournament spectating, offers an explicit Magic entry point.
- Magic displays a floating orthographic 2.5D board and six recognizable modeled piece types in three distinct collections (Astral crystal, Sovereign gold, Neon mechanical), each available independently for White and Black. Skin preferences persist locally and do not affect the opponent's display.
- Move arcs and trails, capture bursts, last-move markers, selected-piece rings, legal destinations, and check indicators communicate accepted moves. Castling animates both pieces; en passant and all four promotions render the server's accepted position.
- Live play uses the existing game command and clock system. Switching presentation must not restart, pause, or leave the room. Spectator and replay positions remain read-only.
- Magic provides only play, promotion, skin/effect customization, live status, and exit. Users must exit to use navigation, resignation, rematches, replay controls, export, analysis, or administration.
- Support keyboard selection, touch/pointer selection, black-side orientation, reduced motion, narrow viewports, and an explicit exit when WebGL cannot load. Dispose GPU resources when Magic closes.
