# ADR 0001: Project Foundation

## Status

Accepted

## Date

2026-06-08

## Context

This project is starting from an empty repository and is intended to be developed collaboratively through Codex agents and human contributors.

The product goal is a chess website that:

- supports two-player browser multiplayer first
- runs locally on one machine for LAN testing in the first phase
- can later be deployed more broadly
- can later add AI opponents without a major rewrite

Because multiple Codex agents may work on the repository over time, the project needs clear shared rules and lightweight but durable documentation from the start.

## Decision

We will establish the following project foundation immediately:

- maintain a top-level collaboration guide in `codex.md`
- maintain a running `CHANGELOG.md` for agent handoff and change visibility
- maintain product scope and priorities in `docs/requirements.md`
- maintain phased delivery plans in `docs/roadmap.md`
- record important architecture decisions as ADRs in `docs/adr/`

At the architecture level, we will prefer:

- a monorepo structure
- TypeScript as the default implementation language across app layers
- server-authoritative multiplayer state
- a separable chess domain layer that is independent of UI concerns

## Consequences

Positive consequences:

- future contributors can resume work with lower rediscovery cost
- product scope drift is easier to detect
- AI support can be added through a stable game command layer later
- architecture decisions become explicit earlier

Costs and trade-offs:

- contributors must spend small ongoing effort keeping docs synchronized
- early design discipline adds a little overhead before coding begins

## Follow-Up

Next important decision to record:

- select the concrete web, server, workspace, and realtime stack for Phase 1 implementation
