import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AdminGameSummary, RoomSnapshot } from "@chessss/shared";

interface ArchivedGame { id: string; capturedAt: string; signature: string; room: RoomSnapshot; }

export class GameHistoryError extends Error {}

export class GameHistoryService {
  private readonly games: ArchivedGame[];
  constructor(private readonly filePath = resolve(process.cwd(), "data", "game-history.json")) { this.games = this.load(); }

  capture(room: RoomSnapshot) {
    if (room.status !== "finished" || !room.game.result) return;
    const signature = room.gameInstanceId;
    if (this.games.some((game) => game.signature === signature)) return;
    this.games.push({ id: randomUUID(), capturedAt: new Date().toISOString(), signature, room: structuredClone(room) });
    this.persist();
  }

  summaries(): AdminGameSummary[] {
    return this.games.map(({ id, room, capturedAt }) => ({
      gameId: id,
      roomId: room.id,
      mode: room.mode,
      status: "finished" as const,
      white: room.players.find((player) => player.color === "white")?.username ?? "Open seat",
      black: room.players.find((player) => player.color === "black")?.username ?? "Open seat",
      moveCount: room.game.moves.length,
      startedAt: capturedAt,
      updatedAt: capturedAt,
      result: room.game.result,
      timeControlMs: room.timeControl.initialTimeMs,
    })).reverse();
  }

  forUser(username: string): AdminGameSummary[] {
    return this.summaries().filter((game) => [game.white, game.black].some((name) => name.toLowerCase() === username.toLowerCase()));
  }

  snapshot(gameIdOrRoomId: string): RoomSnapshot | null {
    return structuredClone([...this.games].reverse().find((game) => game.id === gameIdOrRoomId || game.room.id === gameIdOrRoomId)?.room ?? null);
  }

  private load(): ArchivedGame[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as ArchivedGame[];
      if (!Array.isArray(parsed)) throw new Error("Invalid game history database.");
      return parsed.map((game) => {
        game.room.gameInstanceId ??= `legacy-${game.id}`;
        game.room.access ??= "casual";
        game.room.ratingPool ??= null;
        game.room.startingRatings ??= {};
        game.room.ratingEstimates ??= {};
        game.signature = game.room.gameInstanceId;
        return game;
      });
    }
    catch { throw new GameHistoryError("The game history database could not be read."); }
  }

  private persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.games, null, 2), { mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}
