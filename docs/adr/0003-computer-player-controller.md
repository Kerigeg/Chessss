# ADR 0003: Computer Player Controller

## Status

Accepted

## Date

2026-08-17

## Context

The project now needs a computer-play mode with several requested difficulty levels. ADR 0001 requires AI opponents to use the same game command layer as human players, rather than adding a separate chess implementation in the browser.

## Decision

- The human player is White and a computer controller is Black in a computer room.
- The server owns the Stockfish engine and submits the computer move through the same chess-core state transition used by human moves.
- The computer levels are `beginner`, `medium`, `high`, `hell`, and `stockfish`.
- `high` and `hell` use Stockfish's limited-strength Elo controls at 1400 and 2100. `stockfish` removes the Elo cap.
- `beginner` and `medium` add deliberate randomisation around the engine because the bundled engine's minimum native UCI Elo setting is higher than the requested approximate 250 and 700 levels.
- The project uses the single-threaded lite Stockfish WASM build so it runs reliably in Node without cross-origin isolation. The package is GPL-3.0; distribution and deployment work must retain required attribution and satisfy its licence obligations.

## Consequences

- Computer games remain server-authoritative and do not expose engine controls to the browser.
- Requested low ratings are approximations, not calibrated ratings, and should be verified with playtesting.
- The strongest mode is limited by configured engine thinking time and available server resources.
- A future production release needs a dedicated license review before distribution.
