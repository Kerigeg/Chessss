# ADR 0004: Server-authoritative ratings and Swiss tournaments

## Status

Accepted — 2026-09-05

## Context

Chessss needs persistent human ratings, public leaderboards, and small-community Swiss tournaments while retaining its server-authoritative game model. The current deployment is a single Node.js server used on a LAN, and its other durable domains use local JSON persistence.

## Decision

- Keep Elo and tournament calculations in dedicated server services. Browsers submit commands and render returned state; they never submit trusted ratings, pairings, standings, or results.
- Use separate Bullet, Blitz, and Rapid Elo records, based only on initial time. A room captures rated/casual eligibility before play and cannot change it after the first move.
- Process a unique game identity once. Save both players' rating transactions and tournament result state atomically before exposing the result.
- Isolate deterministic Swiss pairing from persistence and transport. Prefer similar scores, prohibit repeats when a valid pairing exists, balance colors, avoid a third identical color when possible, and assign a bye to the lowest eligible player without a prior bye.
- Treat administrative forfeits and cancellations as tournament-only decisions with no Elo change. Reverse fraudulent Elo through an auditable compensating transaction rather than rewriting history.
- Persist ratings and tournaments in versioned JSON structures using temporary-file plus rename atomic replacement for this deployment stage.

## Consequences

The competitive rules are testable independently of Socket.IO and survive process restarts. Duplicate room completion events cannot duplicate points or Elo. Tournament rooms use the same authoritative room, clock, move, and result path as ordinary games.

JSON files and in-memory active rooms do not provide cross-process transactions, locking, horizontal scaling, or crash recovery for live games. Before public or multi-server deployment, these services should move behind a transactional database and coordinated job/event processing while preserving the current domain interfaces and idempotency keys.
