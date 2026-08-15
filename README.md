# Chessss

A server-authoritative, LAN-friendly two-player chess MVP. One player creates a room and a second player joins with its code; the Node server validates every move and broadcasts the resulting chess state.

## Prerequisites

- Node.js 24 or a current Node.js LTS release with Corepack
- pnpm 10 (the repository pins its expected version)

## Run locally

```bash
corepack enable
pnpm install
pnpm dev
```

Open `http://localhost:5173` on the host machine. The API and realtime server runs on port `3001` and the web application runs on port `5173`.

## Play from another LAN device

1. Start both services with `pnpm dev` on the host computer.
2. Find the host's LAN address, for example `192.168.1.20`.
3. Open `http://192.168.1.20:5173` on each device.
4. On one device choose **Create room**; on the other enter the six-character room code and choose **Join room**.

If macOS shows a firewall prompt, allow incoming connections for Node. Both devices must be on the same network. The browser derives the Socket.IO URL from the host name in the page URL, so no extra configuration is needed for normal LAN use.

## Commands

```bash
pnpm dev        # Run web and server concurrently
pnpm build      # Build all workspace packages
pnpm test       # Run chess core and room service tests
pnpm typecheck  # Check TypeScript without emitting output
```

## MVP boundaries and behavior

- Rooms live only in memory; restarting the server removes active rooms.
- Each room accepts exactly a white and black player.
- A reconnecting player receives the same color by retaining the browser session token; a disconnected player's slot is not reassigned to a stranger.
- Moves are sent to the server, validated through `packages/chess-core`, then broadcast as state snapshots.
- Pawn promotion prompts for a queen, rook, bishop, or knight. Resign/draw offers, history export, and persistent rooms are planned follow-up work.

See [requirements](docs/requirements.md), the [roadmap](docs/roadmap.md), and [architecture decisions](docs/adr/) for the project contract.
