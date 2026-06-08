# Codex Collaboration Guide

## Purpose

This file defines the repo-wide collaboration rules for all Codex agents and human contributors working on this project.

Project: `Chessss`
Remote repository: `https://github.com/Kerigeg/Chessss.git`

This repository is intended to be built primarily through Codex-based collaboration. The goal of this file is to keep that collaboration predictable, traceable, and easy to resume.

## Scope

This file is the source of truth for:

- repo-wide collaboration rules
- architecture boundaries
- documentation update rules
- changelog expectations
- git workflow expectations

This file is not the place to duplicate external skills or downloaded Codex skills. Those should continue to live in their normal loading locations and be referenced as needed.

## Working Language

To reduce ambiguity across agents, all persistent repository documentation and code comments should default to English.

Allowed exceptions:

- user-facing product copy may be multilingual later
- discussion with the user can be in Chinese
- examples may include Chinese when needed

## Product Goal

Build a deployable online chess website that starts with LAN-friendly two-player multiplayer and can later support AI opponents without a major rewrite.

## Current Stage

Current stage: design and project foundation.

Before substantial implementation begins, contributors should align on:

- MVP scope
- architecture boundaries
- delivery phases
- shared conventions

## MVP Definition

The first shippable version should allow:

- one player to create a chess room
- another player to join from another device on the same LAN
- both players to play a full chess game in real time
- the server to validate legal moves
- the game to detect checkmate, stalemate, draw, and turn order
- the app to be runnable from a single computer for local testing

## Explicit Non-Goals For MVP

Do not treat these as MVP blockers:

- account/login system
- AI opponent
- ranking system
- matchmaking
- payment or monetization
- advanced social features

## Architecture Principles

The project should be structured so that chess rules are not tightly coupled to transport or UI.

Preferred high-level modules:

- `apps/web`: frontend UI for lobby, room, and chessboard
- `apps/server`: backend for room lifecycle, realtime sync, and server-authoritative game flow
- `packages/chess-core`: pure shared chess domain logic
- `packages/shared`: shared types, protocol contracts, and reusable utilities

Core rule:

- the server is authoritative for multiplayer game state

This means:

- clients may render speculative UI, but the server decides accepted moves
- chess rule validation should live in shared domain logic usable by the server
- realtime protocol should send state snapshots or well-defined events, not ad hoc client mutations

## Future AI Compatibility

AI should be introduced later as a new player controller, not as a special-case rewrite of multiplayer logic.

Design implication:

- human player and AI player should both act through the same game command layer
- chess state transitions should be deterministic and testable outside the UI

## Required Repo Documents

The following files are part of the project operating system and should be maintained continuously:

- `codex.md`: shared agent rules and collaboration norms
- `CHANGELOG.md`: chronological record of meaningful repository changes
- `docs/requirements.md`: current agreed product requirements and priorities
- `docs/roadmap.md`: phased delivery plan
- `docs/adr/`: architecture decision records for important decisions

## Documentation Update Rules

When changing the repo, contributors must keep documentation in sync.

Minimum rules:

- any meaningful implementation change must update `CHANGELOG.md`
- any scope or priority change must update `docs/requirements.md`
- any delivery sequencing change must update `docs/roadmap.md`
- any important architectural decision must add or update an ADR
- if a contributor changes repo-wide working rules, update `codex.md`

## Changelog Rules

Every meaningful change should add an entry under the current unreleased section of `CHANGELOG.md`.

Each changelog entry should answer:

- what changed
- why it changed
- what area is affected
- what follow-up work remains, if any

Small typo-only edits may be grouped rather than logged individually.

## Git Workflow

Default branch strategy:

- keep `main` in a runnable or restorable state
- create short-lived task branches with prefix `codex/`
- prefer small, reviewable changes

Branch naming examples:

- `codex/bootstrap-docs`
- `codex/setup-monorepo`
- `codex/web-room-flow`

Commit expectations:

- use clear, scoped commit messages
- do not mix unrelated refactors with feature work
- update docs in the same change when the docs are affected

## Handoff Expectations

Before finishing a work session, contributors should leave the repo in a state where another Codex can continue quickly.

Minimum handoff quality:

- changelog updated
- pending work described clearly
- assumptions made explicit
- tests run or not run clearly stated

## Definition Of Done For Any Task

A task is not fully done unless:

- code or docs are updated
- impacted shared documentation is synchronized
- the changelog is updated
- validation status is stated clearly

## Decision Escalation

Contributors should pause and seek explicit user confirmation before making decisions with high product impact, such as:

- changing the MVP boundary
- changing the primary stack
- adding authentication to early phases
- introducing persistence complexity earlier than planned
- rewriting established shared conventions

## Initial Stack Direction

The exact stack is not locked in this file yet, but the preferred direction is:

- TypeScript across frontend, backend, and shared packages
- a monorepo structure from the start
- a realtime transport suitable for room-based play
- a pure chess rules package that is testable in isolation

The specific framework choices should be finalized in an ADR before implementation begins.
