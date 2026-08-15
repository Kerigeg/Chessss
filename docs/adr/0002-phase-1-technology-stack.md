# ADR 0002: Phase 1 Technology Stack

## Status

Accepted

## Date

2026-08-15

## Context

ADR 0001 establishes the architectural direction but deliberately leaves the concrete Phase 1 stack open. The LAN multiplayer MVP now needs a stack that supports a TypeScript monorepo, a browser UI, room-based real-time updates, server-authoritative validation, and isolated chess-rule tests.

## Decision

Use the following stack for Phase 1:

- `pnpm` workspaces for the monorepo.
- React and Vite for `apps/web`.
- Node.js, Fastify, and Socket.IO for `apps/server`.
- `chess.js`, wrapped by `packages/chess-core`, for deterministic chess rules.
- `packages/shared` for transport contracts and shared domain types.
- Vitest for unit tests in pure packages.

The server owns each room's `Chess` instance. The browser receives room snapshots and submits move commands; it never becomes authoritative for legal-move or game-result decisions.

## Consequences

Positive:

- one language is used across all project layers;
- Socket.IO provides reliable room-scoped real-time events and straightforward LAN development;
- chess rules remain testable independently of Fastify and React;
- shared contracts reduce protocol drift.

Trade-offs:

- the MVP keeps room state in memory, so a server restart ends active rooms;
- Socket.IO adds a protocol layer that must be documented and versioned as the product grows.

## Follow-Up

- document production persistence and deployment choices before Phase 3;
- decide the authentication model before persistent player identity is added.
