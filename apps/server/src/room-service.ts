import { randomUUID } from "node:crypto";
import { applyMove, createGame, snapshotGame } from "@chessss/chess-core";
import type { AdminGameSummary, AnalyzeGameRequest, ChessColor, ChessGameState, ComputerLevel, CreateComputerRoomRequest, CreateHumanRoomRequest, GameClock, GameMode, GameResult, JoinRoomRequest, JoinRoomResponse, LeaveRoomRequest, MoveRequest, RatedGameOutcome, RatingPool, ResignGameRequest, RestartGameRequest, RoomSnapshot } from "@chessss/shared";
import { StockfishComputer, type ComputerMove, type ComputerMoveProvider } from "./computer-player.js";
import { ratingPoolForTimeControl } from "./rating-service.js";

const INITIAL_TIME_MS = 60_000;
const LOW_TIME_THRESHOLD_MS = 20_000;
const QUICK_MOVE_WINDOW_MS = 2_000;
const QUICK_MOVE_BONUS_MS = 2_000;

interface PlayerSession {
  color: ChessColor;
  token: string;
  socketId: string | null;
  kind: "human" | "computer";
  username: string;
}

interface Room {
  id: string;
  gameInstanceId: string;
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
  startedAt: string;
  updatedAt: string;
  moveTimingsMs: number[];
  access: "rated" | "casual";
  ratingPool: RatingPool | null;
  startingRatings: Partial<Record<ChessColor, number>>;
  ratingEstimates: Partial<Record<ChessColor, { win: number; draw: number; loss: number }>>;
  ratingResult?: RatedGameOutcome;
  tournamentId?: string;
  tournamentRound?: number;
  tournamentPaused: boolean;
}

export class RoomError extends Error {}

export class RoomService {
  private readonly rooms = new Map<string, Room>();
  private allowedComputerTimeControlsMs = new Set([60_000, 180_000, 300_000, 600_000, 1_800_000, 2_700_000]);

  constructor(
    private readonly onRoomUpdated?: (room: RoomSnapshot) => void,
    private readonly now: () => number = () => Date.now(),
    private readonly computer: ComputerMoveProvider = new StockfishComputer(),
  ) {}

  configureTimeControls(values: number[]) {
    this.allowedComputerTimeControlsMs = new Set(values);
  }

  createRoom(socketId: string, username = "Guest", request: CreateHumanRoomRequest = { access: "casual", initialTimeMs: INITIAL_TIME_MS }, startingRating = 1200): JoinRoomResponse {
    if (!this.allowedComputerTimeControlsMs.has(request.initialTimeMs)) throw new RoomError("Choose one of the available time controls.");
    const pool = ratingPoolForTimeControl(request.initialTimeMs);
    if (request.access === "rated" && !pool) throw new RoomError("Rated games must use a Bullet, Blitz, or Rapid time control of 30 minutes or less.");
    let id = this.roomCode();
    while (this.rooms.has(id)) id = this.roomCode();

    const white = this.newPlayer("white", socketId, username);
    const createdAt = new Date(this.now()).toISOString();
    const room: Room = {
      id,
      gameInstanceId: randomUUID(),
      mode: "human",
      computerLevel: null,
      initialTimeMs: request.initialTimeMs,
      aiThinking: false,
      game: createGame(),
      players: new Map([["white", white]]),
      clock: this.newClock(request.initialTimeMs),
      forcedResult: null,
      timeout: null,
      lastMove: null,
      startedAt: createdAt,
      updatedAt: createdAt,
      moveTimingsMs: [],
      access: request.access,
      ratingPool: request.access === "rated" ? pool : null,
      startingRatings: { white: startingRating },
      ratingEstimates: {},
      tournamentPaused: false,
    };
    this.rooms.set(id, room);
    return this.joinResponse(room, white);
  }

  createComputerRoom(request: CreateComputerRoomRequest, socketId: string, username = "Guest"): JoinRoomResponse {
    if (!this.allowedComputerTimeControlsMs.has(request.initialTimeMs)) throw new RoomError("Choose one of the available computer game time controls.");
    let id = this.roomCode();
    while (this.rooms.has(id)) id = this.roomCode();

    const white = this.newPlayer("white", socketId, username);
    const createdAt = new Date(this.now()).toISOString();
    const room: Room = {
      id,
      gameInstanceId: randomUUID(),
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
      startedAt: createdAt,
      updatedAt: createdAt,
      moveTimingsMs: [],
      access: "casual",
      ratingPool: null,
      startingRatings: {},
      ratingEstimates: {},
      tournamentPaused: false,
    };
    this.rooms.set(id, room);
    this.resumeClock(room);
    return this.joinResponse(room, white);
  }

  createTournamentRoom(request: { tournamentId: string; round: number; white: string; black: string; initialTimeMs: number; access: "rated" | "casual"; startingRatings?: Partial<Record<ChessColor, number>> }): RoomSnapshot {
    if (!this.allowedComputerTimeControlsMs.has(request.initialTimeMs)) throw new RoomError("Choose one of the available time controls.");
    const pool = ratingPoolForTimeControl(request.initialTimeMs);
    if (request.access === "rated" && !pool) throw new RoomError("Rated tournament games must use a Bullet, Blitz, or Rapid time control.");
    let id = this.roomCode();
    while (this.rooms.has(id)) id = this.roomCode();
    const createdAt = new Date(this.now()).toISOString();
    const room: Room = {
      id, gameInstanceId: randomUUID(), mode: "human", computerLevel: null, initialTimeMs: request.initialTimeMs, aiThinking: false,
      game: createGame(), players: new Map([
        ["white", this.newPlayer("white", null, request.white)],
        ["black", this.newPlayer("black", null, request.black)],
      ]), clock: this.newClock(request.initialTimeMs), forcedResult: null, timeout: null, lastMove: null,
      startedAt: createdAt, updatedAt: createdAt, moveTimingsMs: [], access: request.access,
      ratingPool: request.access === "rated" ? pool : null, startingRatings: structuredClone(request.startingRatings ?? {}), ratingEstimates: {},
      tournamentId: request.tournamentId, tournamentRound: request.round,
      tournamentPaused: false,
    };
    this.rooms.set(id, room);
    return this.snapshot(room);
  }

  joinRoom(request: JoinRoomRequest, socketId: string, username = "Guest", startingRating = 1200): JoinRoomResponse {
    const room = this.getRoom(request.roomId);
    const existing = request.playerToken
      ? [...room.players.values()].find((player) => player.token === request.playerToken)
      : room.tournamentId ? [...room.players.values()].find((player) => player.username.toLowerCase() === username.toLowerCase()) : undefined;

    if (existing) {
      existing.socketId = socketId;
      if (!room.tournamentId) existing.username = username;
      this.touch(room);
      this.resumeClock(room);
      return this.joinResponse(room, existing);
    }

    if (this.isFinished(room)) throw new RoomError("This game has already finished.");
    if (room.players.size >= 2) throw new RoomError("This room already has two players.");

    const color: ChessColor = room.players.has("white") ? "black" : "white";
    const joiningPlayer = this.newPlayer(color, socketId, username);
    room.players.set(color, joiningPlayer);
    if (room.access === "rated") room.startingRatings[color] = startingRating;
    this.touch(room);
    this.resumeClock(room);
    return this.joinResponse(room, joiningPlayer);
  }

  move(request: MoveRequest, socketId: string): RoomSnapshot {
    const room = this.getRoom(request.roomId);
    if (room.tournamentPaused) throw new RoomError("This tournament is paused.");
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
      room.moveTimingsMs.push(Number.isFinite(elapsed) ? Math.max(0, elapsed) : 0);
      this.touch(room);
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
    if (room.tournamentId) throw new RoomError("Tournament games cannot be rematched.");
    if (!this.isFinished(room)) throw new RoomError("The current game has not finished yet.");

    room.game.reset();
    room.gameInstanceId = randomUUID();
    room.forcedResult = null;
    this.clearTimeout(room);
    room.clock = this.newClock(room.initialTimeMs);
    this.resumeClock(room);
    room.lastMove = null;
    room.moveTimingsMs = [];
    room.ratingResult = undefined;
    room.ratingEstimates = {};
    room.startedAt = new Date(this.now()).toISOString();
    this.touch(room);
    return this.snapshot(room);
  }

  resign(request: ResignGameRequest, socketId: string): RoomSnapshot {
    const room = this.getRoom(request.roomId);
    const player = [...room.players.values()].find((candidate) => candidate.token === request.playerToken);
    if (!player || player.kind !== "human" || player.socketId !== socketId) throw new RoomError("You are not an active player in this room.");
    if (this.isFinished(room)) throw new RoomError("This game has already finished.");
    this.pauseClock(room);
    room.forcedResult = { kind: "resignation", winner: player.color === "white" ? "black" : "white" };
    this.touch(room);
    return this.snapshot(room);
  }

  configureRatings(roomId: string, ratings: Partial<Record<ChessColor, number>>, estimates: Partial<Record<ChessColor, { win: number; draw: number; loss: number }>>) {
    const room = this.getRoom(roomId);
    if (room.game.history().length > 0) throw new RoomError("Rating details cannot change after the first move.");
    room.startingRatings = { ...room.startingRatings, ...ratings };
    room.ratingEstimates = structuredClone(estimates);
  }

  setRatingResult(roomId: string, gameId: string, result: RatedGameOutcome): RoomSnapshot {
    const room = this.getRoom(roomId);
    if (room.gameInstanceId !== gameId) throw new RoomError("The rating result belongs to a different game.");
    room.ratingResult = structuredClone(result);
    return this.snapshot(room);
  }

  leave(request: LeaveRoomRequest, socketId: string): RoomSnapshot {
    const room = this.getRoom(request.roomId);
    const player = [...room.players.values()].find((candidate) => candidate.token === request.playerToken);
    if (!player || player.kind !== "human" || player.socketId !== socketId) throw new RoomError("You are not an active player in this room.");

    this.pauseClock(room);
    if (room.tournamentId) player.socketId = null;
    else room.players.delete(player.color);
    this.touch(room);
    return this.snapshot(room);
  }

  async takeComputerTurn(roomId: string): Promise<RoomSnapshot | null> {
    const room = this.getRoom(roomId);
    if (room.mode !== "computer" || !room.computerLevel || room.aiThinking || this.isFinished(room) || !this.arePlayersConnected(room)) return null;
    if (snapshotGame(room.game).turn !== "black") return null;

    room.aiThinking = true;
    const thinkingStartedAt = this.now();
    try {
      const move = await this.computer.chooseMove(room.game.fen(), room.computerLevel);
      return this.applyComputerMove(room, move, this.now() - thinkingStartedAt);
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
        this.touch(room);
        this.pauseClock(room);
        affected.push(this.snapshot(room));
      }
    }
    return affected;
  }

  snapshotById(roomId: string): RoomSnapshot {
    return this.snapshot(this.getRoom(roomId));
  }

  allSnapshots(): RoomSnapshot[] { return [...this.rooms.values()].map((room) => this.snapshot(room)); }

  isSocketInUnfinishedRoom(socketId: string): boolean {
    return [...this.rooms.values()].some((room) => !this.isFinished(room) && [...room.players.values()].some((player) => player.socketId === socketId));
  }

  setTournamentPaused(tournamentId: string, paused: boolean): RoomSnapshot[] {
    const affected: RoomSnapshot[] = [];
    for (const room of this.rooms.values()) {
      if (room.tournamentId !== tournamentId || this.isFinished(room)) continue;
      room.tournamentPaused = paused;
      if (paused) this.pauseClock(room);
      else this.resumeClock(room);
      this.touch(room);
      affected.push(this.snapshot(room));
    }
    return affected;
  }

  tournamentRooms(tournamentId: string): RoomSnapshot[] {
    return [...this.rooms.values()].filter((room) => room.tournamentId === tournamentId).map((room) => this.snapshot(room));
  }

  adminGames(): AdminGameSummary[] {
    return [...this.rooms.values()]
      .map((room) => {
        const snapshot = this.snapshot(room);
        const name = (color: ChessColor) => room.players.get(color)?.username ?? "Open seat";
        return {
          gameId: room.gameInstanceId,
          roomId: room.id,
          mode: room.mode,
          status: snapshot.status,
          white: name("white"),
          black: name("black"),
          moveCount: snapshot.game.moves.length,
          startedAt: room.startedAt,
          updatedAt: room.updatedAt,
          result: snapshot.game.result,
          timeControlMs: room.initialTimeMs,
        };
      })
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  adminCancel(roomId: string): RoomSnapshot {
    const room = this.getRoom(roomId);
    if (this.isFinished(room)) throw new RoomError("This game has already finished.");
    this.pauseClock(room);
    room.forcedResult = { kind: "cancelled", winner: null };
    this.touch(room);
    return this.snapshot(room);
  }

  adminDeclareResult(roomId: string, winner: ChessColor | null): RoomSnapshot {
    const room = this.getRoom(roomId);
    if (this.isFinished(room)) throw new RoomError("This game has already finished.");
    this.pauseClock(room);
    room.forcedResult = { kind: "admin-decision", winner };
    this.touch(room);
    return this.snapshot(room);
  }

  adminForfeit(roomId: string, winner: ChessColor | null): RoomSnapshot {
    const room = this.getRoom(roomId);
    if (this.isFinished(room)) throw new RoomError("This game has already finished.");
    this.pauseClock(room);
    room.forcedResult = { kind: "forfeit", winner };
    this.touch(room);
    return this.snapshot(room);
  }

  adminReconnect(roomId: string, username: string, socketId: string): JoinRoomResponse {
    const room = this.getRoom(roomId);
    const player = [...room.players.values()].find((candidate) => candidate.kind === "human" && candidate.username.toLowerCase() === username.toLowerCase());
    if (!player) throw new RoomError("That user does not occupy a seat in this room.");
    player.socketId = socketId;
    this.touch(room);
    this.resumeClock(room);
    return this.joinResponse(room, player);
  }

  adminAnalysisGame(roomId: string): ChessGameState {
    const room = this.getRoom(roomId);
    const game = snapshotGame(room.game);
    game.result = room.forcedResult ?? game.result;
    return game;
  }

  adminPlayerColor(roomId: string, username: string): ChessColor {
    const player = [...this.getRoom(roomId).players.values()].find((candidate) => candidate.username.toLowerCase() === username.toLowerCase());
    if (!player || player.kind !== "human") throw new RoomError("That user did not play in this room.");
    return player.color;
  }

  adminMoveTimings(roomId: string, username: string): number[] {
    const color = this.adminPlayerColor(roomId, username);
    return this.getRoom(roomId).moveTimingsMs.filter((_, index) => index % 2 === (color === "white" ? 0 : 1));
  }

  analysisGame(request: AnalyzeGameRequest, socketId: string): ChessGameState {
    const room = this.getRoom(request.roomId);
    const player = [...room.players.values()].find((candidate) => candidate.token === request.playerToken);
    if (!player || player.kind !== "human" || player.socketId !== socketId) throw new RoomError("You are not an active player in this room.");
    if (!this.isFinished(room)) throw new RoomError("Analysis is available after the game ends.");
    const game = snapshotGame(room.game);
    game.result = room.forcedResult ?? game.result;
    return game;
  }

  private snapshot(room: Room): RoomSnapshot {
    const game = snapshotGame(room.game);
    game.result = room.forcedResult ?? game.result;
    const now = this.now();
    return {
      id: room.id,
      gameInstanceId: room.gameInstanceId,
      mode: room.mode,
      computerLevel: room.computerLevel,
      timeControl: { initialTimeMs: room.initialTimeMs },
      status: game.result ? "finished" : room.players.size === 2 && this.arePlayersConnected(room) ? "active" : "waiting",
      players: (["white", "black"] as ChessColor[])
        .map((color) => room.players.get(color))
        .filter((player): player is PlayerSession => Boolean(player))
        .map(({ color, socketId, kind, username }) => ({ color, connected: kind === "computer" || Boolean(socketId), kind, username })),
      game,
      clock: {
        whiteMs: this.remainingTime(room, "white", now),
        blackMs: this.remainingTime(room, "black", now),
        activeColor: room.clock.turnStartedAt === null ? null : room.clock.activeColor,
        turnStartedAt: room.clock.turnStartedAt,
      },
      lastMove: room.lastMove,
      access: room.access,
      ratingPool: room.ratingPool,
      startingRatings: structuredClone(room.startingRatings),
      ratingEstimates: structuredClone(room.ratingEstimates),
      ratingResult: room.ratingResult ? structuredClone(room.ratingResult) : undefined,
      tournamentId: room.tournamentId,
      tournamentRound: room.tournamentRound,
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

  private newPlayer(color: ChessColor, socketId: string | null, username: string): PlayerSession {
    return { color, socketId, token: randomUUID(), kind: "human", username };
  }

  private newComputer(color: ChessColor): PlayerSession {
    return { color, socketId: null, token: randomUUID(), kind: "computer", username: "Computer" };
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

  private applyComputerMove(room: Room, move: ComputerMove, elapsedMs: number): RoomSnapshot {
    const now = this.now();
    if (this.expireIfNeeded(room, now) || this.isFinished(room)) return this.snapshot(room);

    this.pauseClock(room, now);
    try {
      room.lastMove = applyMove(room.game, move);
      room.moveTimingsMs.push(Math.max(0, elapsedMs));
      this.touch(room);
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
    if (this.isFinished(room) || room.tournamentPaused || !this.arePlayersConnected(room) || room.clock.activeColor === null || room.clock.turnStartedAt !== null) return;
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
    this.touch(room);
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

  private touch(room: Room) {
    room.updatedAt = new Date(this.now()).toISOString();
  }
}
