import { randomUUID } from "node:crypto";
import { applyMove, createGame, snapshotGame } from "@chessss/chess-core";
import type { ChessColor, JoinRoomRequest, JoinRoomResponse, MoveRequest, RoomSnapshot } from "@chessss/shared";

interface PlayerSession {
  color: ChessColor;
  token: string;
  socketId: string | null;
}

interface Room {
  id: string;
  game: ReturnType<typeof createGame>;
  players: Map<ChessColor, PlayerSession>;
  lastMove: RoomSnapshot["lastMove"];
}

export class RoomError extends Error {}

export class RoomService {
  private readonly rooms = new Map<string, Room>();

  createRoom(socketId: string): JoinRoomResponse {
    let id = this.roomCode();
    while (this.rooms.has(id)) id = this.roomCode();

    const white = this.newPlayer("white", socketId);
    const room: Room = {
      id,
      game: createGame(),
      players: new Map([["white", white]]),
      lastMove: null,
    };
    this.rooms.set(id, room);
    return this.joinResponse(room, white);
  }

  joinRoom(request: JoinRoomRequest, socketId: string): JoinRoomResponse {
    const room = this.getRoom(request.roomId);
    const existing = request.playerToken
      ? [...room.players.values()].find((player) => player.token === request.playerToken)
      : undefined;

    if (existing) {
      existing.socketId = socketId;
      return this.joinResponse(room, existing);
    }

    if (room.game.isGameOver()) throw new RoomError("This game has already finished.");
    if (room.players.has("black")) throw new RoomError("This room already has two players.");

    const black = this.newPlayer("black", socketId);
    room.players.set("black", black);
    return this.joinResponse(room, black);
  }

  move(request: MoveRequest, socketId: string): RoomSnapshot {
    const room = this.getRoom(request.roomId);
    const player = [...room.players.values()].find((candidate) => candidate.token === request.playerToken);
    if (!player || player.socketId !== socketId) throw new RoomError("You are not an active player in this room.");
    if (room.players.size !== 2 || [...room.players.values()].some((candidate) => !candidate.socketId)) {
      throw new RoomError("Both players must be connected before a move can be made.");
    }
    if (room.game.isGameOver()) throw new RoomError("This game has already finished.");
    if (snapshotGame(room.game).turn !== player.color) throw new RoomError("It is not your turn.");

    try {
      room.lastMove = applyMove(room.game, request);
    } catch {
      throw new RoomError("That move is not legal.");
    }
    return this.snapshot(room);
  }

  disconnect(socketId: string): RoomSnapshot[] {
    const affected: RoomSnapshot[] = [];
    for (const room of this.rooms.values()) {
      const player = [...room.players.values()].find((candidate) => candidate.socketId === socketId);
      if (player) {
        player.socketId = null;
        affected.push(this.snapshot(room));
      }
    }
    return affected;
  }

  snapshotById(roomId: string): RoomSnapshot {
    return this.snapshot(this.getRoom(roomId));
  }

  private snapshot(room: Room): RoomSnapshot {
    const game = snapshotGame(room.game);
    return {
      id: room.id,
      status: game.result ? "finished" : room.players.size === 2 ? "active" : "waiting",
      players: (["white", "black"] as ChessColor[])
        .map((color) => room.players.get(color))
        .filter((player): player is PlayerSession => Boolean(player))
        .map(({ color, socketId }) => ({ color, connected: Boolean(socketId) })),
      game,
      lastMove: room.lastMove,
    };
  }

  private joinResponse(room: Room, player: PlayerSession): JoinRoomResponse {
    return { room: this.snapshot(room), playerToken: player.token, playerColor: player.color };
  }

  private getRoom(id: string): Room {
    const room = this.rooms.get(id.toUpperCase());
    if (!room) throw new RoomError("Room not found.");
    return room;
  }

  private newPlayer(color: ChessColor, socketId: string): PlayerSession {
    return { color, socketId, token: randomUUID() };
  }

  private roomCode(): string {
    return randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  }
}
