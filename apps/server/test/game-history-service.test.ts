import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RoomService } from "../src/room-service.js";
import { GameHistoryError, GameHistoryService } from "../src/game-history-service.js";

describe("GameHistoryService", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  it("persists a completed named game for later user history and spectating", () => {
    const directory = mkdtempSync(join(tmpdir(), "chessss-history-")); directories.push(directory);
    const history = new GameHistoryService(join(directory, "games.json"));
    const rooms = new RoomService();
    const white = rooms.createRoom("white", "Alice");
    const black = rooms.joinRoom({ roomId: white.room.id }, "black", "Bob");
    rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "f2", to: "f3" }, "white");
    rooms.move({ roomId: white.room.id, playerToken: black.playerToken, from: "e7", to: "e5" }, "black");
    rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "g2", to: "g4" }, "white");
    const finished = rooms.move({ roomId: white.room.id, playerToken: black.playerToken, from: "d8", to: "h4" }, "black");
    history.capture(finished);

    const restored = new GameHistoryService(join(directory, "games.json"));
    expect(restored.forUser("alice")[0]).toMatchObject({ white: "Alice", black: "Bob", moveCount: 4 });
    expect(restored.snapshot(white.room.id)?.game.result?.kind).toBe("checkmate");
  });

  it("keeps identical rematches as separate archived games", () => {
    const directory = mkdtempSync(join(tmpdir(), "chessss-history-")); directories.push(directory);
    const history = new GameHistoryService(join(directory, "games.json"));
    const rooms = new RoomService();
    const white = rooms.createRoom("white", "Alice");
    const black = rooms.joinRoom({ roomId: white.room.id }, "black", "Bob");
    const playFoolsMate = () => {
      rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "f2", to: "f3" }, "white");
      rooms.move({ roomId: white.room.id, playerToken: black.playerToken, from: "e7", to: "e5" }, "black");
      rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "g2", to: "g4" }, "white");
      return rooms.move({ roomId: white.room.id, playerToken: black.playerToken, from: "d8", to: "h4" }, "black");
    };

    history.capture(playFoolsMate());
    rooms.restart({ roomId: white.room.id, playerToken: white.playerToken }, "white");
    history.capture(playFoolsMate());

    const summaries = history.summaries();
    expect(summaries).toHaveLength(2);
    expect(new Set(summaries.map((game) => game.gameId)).size).toBe(2);
  });

  it("fails safely instead of erasing corrupted history", () => {
    const directory = mkdtempSync(join(tmpdir(), "chessss-history-")); directories.push(directory);
    const file = join(directory, "games.json");
    writeFileSync(file, "not valid json");

    expect(() => new GameHistoryService(file)).toThrow(GameHistoryError);
  });
});
