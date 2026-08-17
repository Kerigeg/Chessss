# Roadmap

## Planning Principles

- build the thinnest useful vertical slice first
- preserve future AI compatibility
- keep the server authoritative
- document decisions as they are made

## Phase 0: Foundation And Design

Goals:

- define collaboration rules
- lock MVP scope
- choose the primary stack
- define the monorepo structure
- record initial ADRs

Exit criteria:

- `codex.md` exists and is usable
- product requirements are documented
- roadmap is documented
- initial architectural direction is recorded
- implementation stack is finalized and recorded in ADR 0002

## Phase 1: Local LAN Multiplayer MVP

Goals:

- establish monorepo structure
- create frontend, backend, and shared packages
- implement room creation and joining
- implement server-authoritative chess gameplay
- implement the one-minute server-authoritative chess clock and timeout result
- add the computer-play entry point and Stockfish-backed player controller
- enable LAN access from another device
- ship a complete playable browser experience

Suggested deliverables:

- web app shell
- backend room service
- realtime transport
- chess rules package integration
- room UI and board UI
- local run documentation

Current implementation status:

- monorepo, shared contracts, chess-core, Fastify/Socket.IO server, and React board are being built.

Exit criteria:

- two human players can play on separate LAN devices
- move validation is server-authoritative
- game results are computed correctly for supported scenarios
- the app can be started reliably by another contributor

## Phase 2: Reliability And Usability

Goals:

- improve reconnect and room recovery behavior
- add resign and draw flows
- add move history and notation exports
- improve responsiveness and UX clarity

Exit criteria:

- interrupted sessions fail more gracefully
- core room lifecycle edge cases are covered
- players can inspect move history

## Phase 3: Deployment Hardening

Goals:

- prepare production-grade configuration
- introduce persistence where needed
- improve monitoring and deployment workflow
- support internet deployment beyond LAN

Exit criteria:

- deployment process is documented
- core runtime configuration is stable
- production architecture decisions are recorded

## Phase 4: Account And Platform Features

Goals:

- introduce authentication if still desired
- store game history
- add user profiles or lightweight identity
- prepare for matchmaking or ranking

Exit criteria:

- user identity model is defined and implemented
- persistent platform features no longer depend on temporary room state

## Phase 5: AI Integration

Goals:

- add AI as a player controller using the same game command layer
- support at least one AI mode
- expose human versus AI play flow

Exit criteria:

- AI can participate in a room-like game loop without bypassing core rules
- the same domain layer supports both human and AI turns

## Immediate Next Steps

Recommended next implementation sequence:

1. Choose and record the stack in an ADR.
2. Bootstrap the monorepo structure.
3. Define the realtime protocol and shared types.
4. Build the server-authoritative room lifecycle.
5. Build the board UI and integrate gameplay.
6. Test LAN access across two devices.
