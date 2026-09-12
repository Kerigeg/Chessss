# ADR 0005: Magic board as a client-only presentation layer

Status: Accepted

## Context

All chess surfaces need an immersive, playable 2.5D presentation with modeled pieces and effects, while the server retains authority over game state and clocks. Other application features must require returning to the ordinary interface.

## Decision

Use a dynamically imported Three.js renderer with a fixed orthographic camera. Generate all six piece geometries in three collections locally, without remote models, textures, or image services. Keep the React UI responsible for clocks, skin preferences, promotion, accessibility, and status. Use a native modal dialog in a body portal to make underlying controls inert and trap keyboard focus; Escape and a persistent exit button restore the prior interface.

Consume the same room FEN and move command callbacks as the normal board. Use chess.js only for legal destination hints and identifying consecutive accepted transitions, never for committing game state. Rebuild from authoritative positions after reconnects or discontinuous replay jumps; animate a single consecutive accepted move, including both castling pieces. Spectators and replay positions never submit moves. Capture metadata triggers cosmetic effects only.

Three.js loads only after Magic opens. Cap device pixel ratio and frame rate, suspend rendering in hidden documents, respect reduced motion, and dispose geometry, materials, textures, shadows, and the renderer when closing. Failures leave an explicit path to the standard board while the game continues.

## Consequences

The server protocol, stored games, chess core, and ordinary chess rules do not change. Skin choices are per-browser presentation preferences. WebGL2 is required for Magic; unsupported devices retain the existing standard board. Procedural stylized geometry is an intentional lightweight asset choice; bespoke sculpted character assets can later replace individual models without changing gameplay.
