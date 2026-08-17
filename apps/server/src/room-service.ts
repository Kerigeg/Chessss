import { randomUUID } from "node:crypto";
import { applyMove, createGame, snapshotGame } from "@chessss/chess-core";
import type { ChessColor, ComputerLevel, CreateComputerRoomRequest, GameClock, GameMode, GameResult, JoinRoomRequest, JoinRoomResponse, LeaveRoomRequest, MoveRequest, RestartGameRequest, RoomSnapshot } from "@chessss/shared";
import { StockfishComputer, type ComputerMove, type ComputerMoveProvider } from "./computer-player.js";

const INITIAL_TIME_MS = 60_000;
const ALLOWED_COMPUTER_TIME_CONTROLS_MS = new Set([60_000, 180_000, 300_000, 600_000, 1_800_000, 2_700_000]);
const LOW_TIME_THRESHOLD_MS = 20_000;
const QUICK_MOVE_WINDOW_MS = 2_000;
const QUICK_MOVE_BONUS_MS = 2_000;

interface PlayerSession {
  color: ChessColor;
  token: string;
  socketId: string | null;
  kind: "human" | "computer";
}

interface Room {
  id: string;
  mode: GameMode;
  computerLevel: ComputerLevel | null;
  initialTimeMs: number;
  aiThinking: boolean;
  game: ReturnType<typeof createGame>;
  players: Map<ChessColor, PlayerSession>;
  clock: GameClock;
  forcedResult: GameResult | null;
  timeout: NodeJS.Timeout | null;
  lastMove: RoomSnapshot["lastMove"];
}

export class RoomError extends Error {}

export class RoomService {
  private readonly rooms = new Map<string, Room>();

  constructor(
    private readonly onRoomUpdated?: (room: RoomSnapshot) => void,
    private readonly now: () => number = () => Date.now(),
    private readonly computer: ComputerMoveProvider = new StockfishComputer(),
  ) {}

  createRoom(socketId: string): JoinRoomResponse {
    let id = this.roomCode();
    while (this.rooms.has(id)) id = this.roomCode();

    const white = this.newPlayer("white", socketId);
    const room: Room = {
      id,
      mode: "human",
      computerLevel: null,
      initialTimeMs: INITIAL_TIME_MS,
      aiThinking: false,
      game: createGame(),
      players: new Map([["white", white]]),
      clock: this.newClock(),
      forcedResult: null,
      timeout: null,
      lastMove: null,
    };
    this.rooms.set(id, room);
    return this.joinResponse(room, white);
  }

  createComputerRoom(request: CreateComputerRoomRequest, socketId: string): JoinRoomResponse {
    if (!ALLOWED_COMPUTER_TIME_CONTROLS_MS.has(request.initialTimeMs)) throw new RoomError("Choose one of the available computer game time controls.");
    let id = this.roomCode();
    while (this.rooms.has(id)) id = this.roomCode();

    const white = this.newPlayer("white", socketId);
    const room: Room = {
      id,
      mode: "computer",
      computerLevel: request.level,
      initialTimeMs: request.initialTimeMs,
      aiThinking: false,
      game: createGame(),
      players: new Map([["white", white], ["black", this.newComputer("black")]]),
      clock: this.newClock(request.initialTimeMs),
      forcedResult: null,
      timeout: null,
      lastMove: null,
    };
    this.rooms.set(id, room);
    this.resumeClock(room);
    return this.joinResponse(room, white);
  }

  joinRoom(request: JoinRoomRequest, socketId: string): JoinRoomResponse {
    const room = this.getRoom(request.roomId);
    const existing = request.playerToken
      ? [...room.players.values()].find((player) => player.token === request.playerToken)
      : undefined;

    if (existing) {
      existing.socketId = socketId;
      this.resumeClock(room);
      return this.joinResponse(room, existing);
    }

    if (room.game.isGameOver()) throw new RoomError("This game has already finished.");
    if (room.players.has("black")) throw new RoomError("This room already has two players.");

    const black = this.newPlayer("black", socketId);
    room.players.set("black", black);
    this.resumeClock(room);
    return this.joinResponse(room, black);
  }

  move(request: MoveRequest, socketId: string): RoomSnapshot {
    const room = this.getRoom(request.roomId);
    const player = [...room.players.values()].find((candidate) => candidate.token === request.playerToken);
    if (!player || player.kind !== "human" || player.socketId !== socketId) throw new RoomError("You are not an active player in this room.");
    if (!this.arePlayersConnected(room)) {
      throw new RoomError("Both players must be connected before a move can be made.");
    }
    const now = this.now();
    if (this.expireIfNeeded(room, now)) throw new RoomError("Your time has run out.");
    if (this.isFinished(room)) throw new RoomError("This game has already finished.");
    if (snapshotGame(room.game).turn !== player.color) throw new RoomError("It is not your turn.");

    const turnStartedAt = room.clock.turnStartedAt;
    const elapsed = turnStartedAt === null ? Number.POSITIVE_INFINITY : now - turnStartedAt;
    this.pauseClock(room, now);
    if (room.clock[player.color === "white" ? "whiteMs" : "blackMs"] <= LOW_TIME_THRESHOLD_MS && elapsed <= QUICK_MOVE_WINDOW_MS) {
      room.clock[player.color === "white" ? "whiteMs" : "blackMs"] += QUICK_MOVE_BONUS_MS;
    }

    try {
      room.lastMove = applyMove(room.game, request);
    } catch {
      this.resumeClock(room);
      throw new RoomError("That move is not legal.");
    }

    if (this.isFinished(room)) {
      room.clock.activeColor = null;
      return this.snapshot(room);
    }

    room.clock.activeColor = player.color === "white" ? "black" : "white";
    this.resumeClock(room, now);
    return this.snapshot(room);
  }

  restart(request: RestartGameRequest, socketId: string): RoomSnapshot {
    const room = this.getRoom(request.roomId);
    const player = [...room.players.values()].find((candidate) => candidate.token === request.playerToken);
    if (!player || player.kind !== "human" || player.socketId !== socketId) throw new RoomError("You are not an active player in this room.");
    if (!this.isFinished(room)) throw new RoomError("The current game has not finished yet.");

    room.game.reset();
    room.forcedResult = null;
    this.clearTimeout(room);
    room.clock = this.newClock(room.initialTimeMs);
    this.resumeClock(room);
    room.lastMove = null;
    return this.snapshot(room);
  }

  leave(request: LeaveRoomRequest, socketId: string): RoomSnapshot {
    const room = this.getRoom(request.roomId);
    const player = [...room.players.values()].find((candidate) => candidate.token === request.playerToken);
    if (!player || player.kind !== "human" || player.socketId !== socketId) throw new RoomError("You are not an active player in this room.");

    player.socketId = null;
    this.pauseClock(room);
    return this.snapshot(room);
  }

  async takeComputerTurn(roomId: string): Promise<RoomSnapshot | null> {
    const room = this.getRoom(roomId);
    if (room.mode !== "computer" || !room.computerLevel || room.aiThinking || this.isFinished(room) || !this.arePlayersConnected(room)) return null;
    if (snapshotGame(room.game).turn !== "black") return null;

    room.aiThinking = true;
    try {
      const move = await this.computer.chooseMove(room.game.fen(), room.computerLevel);
      return this.applyComputerMove(room, move);
    } finally {
      room.aiThinking = false;
    }
  }

  disconnect(socketId: string): RoomSnapshot[] {
    const affected: RoomSnapshot[] = [];
    for (const room of this.rooms.values()) {
      const player = [...room.players.values()].find((candidate) => candidate.socketId === socketId);
      if (player) {
        player.socketId = null;
        this.pauseClock(room);
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
    game.result = room.forcedResult ?? game.result;
    const now = this.now();
    return {
      id: room.id,
      mode: room.mode,
      computerLevel: room.computerLevel,
      timeControl: { initialTimeMs: room.initialTimeMs },
      status: game.result ? "finished" : room.players.size === 2 && this.arePlayersConnected(room) ? "active" : "waiting",
      players: (["white", "black"] as ChessColor[])
        .map((color) => room.players.get(color))
        .filter((player): player is PlayerSession => Boolean(player))
        .map(({ color, socketId, kind }) => ({ color, connected: kind === "computer" || Boolean(socketId), kind })),
      game,
      clock: {
        whiteMs: this.remainingTime(room, "white", now),
        blackMs: this.remainingTime(room, "black", now),
        activeColor: room.clock.turnStartedAt === null ? null : room.clock.activeColor,
        turnStartedAt: room.clock.turnStartedAt,
      },
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
    return { color, socketId, token: randomUUID(), kind: "human" };
  }

  private newComputer(color: ChessColor): PlayerSession {
    return { color, socketId: null, token: randomUUID(), kind: "computer" };
  }

  private roomCode(): string {
    return randomUUID().replaceAll("-", "").slice(0, 6).toUpperCase();
  }

  private newClock(initialTimeMs = INITIAL_TIME_MS): GameClock {
    return { whiteMs: initialTimeMs, blackMs: initialTimeMs, activeColor: "white", turnStartedAt: null };
  }

  private arePlayersConnected(room: Room): boolean {
    return room.players.size === 2 && [...room.players.values()].every((player) => player.kind === "computer" || player.socketId !== null);
  }

  private isFinished(room: Room): boolean {
    return room.forcedResult !== null || room.game.isGameOver();
  }

  private applyComputerMove(room: Room, move: ComputerMove): RoomSnapshot {
    const now = this.now();
    if (this.expireIfNeeded(room, now) || this.isFinished(room)) return this.snapshot(room);

    this.pauseClock(room, now);
    try {
      room.lastMove = applyMove(room.game, move);
    } catch {
      this.resumeClock(room, now);
      throw new RoomError("Computer selected an invalid move.");
    }

    if (this.isFinished(room)) {
      room.clock.activeColor = null;
      return this.snapshot(room);
    }

    room.clock.activeColor = "white";
    this.resumeClock(room, now);
    return this.snapshot(room);
  }

  private remainingTime(room: Room, color: ChessColor, now: number): number {
    const value = room.clock[color === "white" ? "whiteMs" : "blackMs"];
    if (room.clock.activeColor !== color || room.clock.turnStartedAt === null) return value;
    return Math.max(0, value - (now - room.clock.turnStartedAt));
  }

  private pauseClock(room: Room, now = this.now()) {
    if (room.clock.turnStartedAt !== null && room.clock.activeColor !== null) {
      const key = room.clock.activeColor === "white" ? "whiteMs" : "blackMs";
      room.clock[key] = this.remainingTime(room, room.clock.activeColor, now);
      room.clock.turnStartedAt = null;
    }
    this.clearTimeout(room);
  }

  private resumeClock(room: Room, now = this.now()) {
    if (this.isFinished(room) || !this.arePlayersConnected(room) || room.clock.activeColor === null || room.clock.turnStartedAt !== null) return;
    room.clock.turnStartedAt = now;
    this.scheduleTimeout(room);
  }

  private expireIfNeeded(room: Room, now = this.now()): boolean {
    const activeColor = room.clock.activeColor;
    if (!activeColor || room.clock.turnStartedAt === null || this.remainingTime(room, activeColor, now) > 0) return false;

    const key = activeColor === "white" ? "whiteMs" : "blackMs";
    room.clock[key] = 0;
    room.clock.turnStartedAt = null;
    room.forcedResult = { kind: "timeout", winner: activeColor === "white" ? "black" : "white" };
    this.clearTimeout(room);
    this.onRoomUpdated?.(this.snapshot(room));
    return true;
  }

  private scheduleTimeout(room: Room) {
    this.clearTimeout(room);
    const activeColor = room.clock.activeColor;
    if (!activeColor || room.clock.turnStartedAt === null) return;
    room.timeout = setTimeout(() => {
      const currentRoom = this.rooms.get(room.id);
      if (currentRoom && !this.expireIfNeeded(currentRoom)) this.scheduleTimeout(currentRoom);
    }, this.remainingTime(room, activeColor, this.now()));
    room.timeout.unref();
  }

  private clearTimeout(room: Room) {
    if (room.timeout) clearTimeout(room.timeout);
    room.timeout = null;
  }
}
