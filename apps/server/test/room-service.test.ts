import { afterEach, describe, expect, it, vi } from "vitest";
import type { RoomSnapshot } from "@chessss/shared";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { RoomError, RoomService } from "../src/room-service.js";
import { RatingService } from "../src/rating-service.js";

describe("RoomService", () => {
  afterEach(() => vi.useRealTimers());
  it("creates a room, assigns colors, and keeps moves authoritative", () => {
    const rooms = new RoomService();
    const white = rooms.createRoom("socket-white");
    const black = rooms.joinRoom({ roomId: white.room.id }, "socket-black");

    expect(white.playerColor).toBe("white");
    expect(black.playerColor).toBe("black");

    const state = rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "e2", to: "e4" }, "socket-white");
    expect(state.lastMove?.san).toBe("e4");
    expect(state.game.turn).toBe("black");
  });

  it("rejects a move from the wrong color", () => {
    const rooms = new RoomService();
    const white = rooms.createRoom("socket-white");
    const black = rooms.joinRoom({ roomId: white.room.id }, "socket-black");

    expect(() => rooms.move({ roomId: white.room.id, playerToken: black.playerToken, from: "e7", to: "e5" }, "socket-black"))
      .toThrowError(RoomError);
  });

  it("restarts a finished game in the same room", () => {
    const rooms = new RoomService();
    const white = rooms.createRoom("socket-white");
    const black = rooms.joinRoom({ roomId: white.room.id }, "socket-black");

    rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "f2", to: "f3" }, "socket-white");
    rooms.move({ roomId: white.room.id, playerToken: black.playerToken, from: "e7", to: "e5" }, "socket-black");
    rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "g2", to: "g4" }, "socket-white");
    const finished = rooms.move({ roomId: white.room.id, playerToken: black.playerToken, from: "d8", to: "h4" }, "socket-black");
    expect(finished.status).toBe("finished");

    const restarted = rooms.restart({ roomId: white.room.id, playerToken: white.playerToken }, "socket-white");
    expect(restarted.status).toBe("active");
    expect(restarted.game.turn).toBe("white");
    expect(restarted.game.moves).toEqual([]);
  });

  it("awards a two-second bonus for a quick move in low time", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const rooms = new RoomService();
    const white = rooms.createRoom("socket-white");
    const black = rooms.joinRoom({ roomId: white.room.id }, "socket-black");
    vi.advanceTimersByTime(41_500);
    rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "e2", to: "e4" }, "socket-white");
    rooms.move({ roomId: white.room.id, playerToken: black.playerToken, from: "e7", to: "e5" }, "socket-black");

    vi.advanceTimersByTime(1_500);
    const state = rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "g1", to: "f3" }, "socket-white");
    expect(state.clock.whiteMs).toBe(19_000);
    expect(state.clock.activeColor).toBe("black");
  });

  it("ends the game when a clock reaches zero", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const updates: RoomSnapshot[] = [];
    const rooms = new RoomService((room) => updates.push(room));
    const white = rooms.createRoom("socket-white");
    rooms.joinRoom({ roomId: white.room.id }, "socket-black");

    vi.advanceTimersByTime(60_000);
    expect(updates.at(-1)?.game.result).toEqual({ kind: "timeout", winner: "black" });
    expect(updates.at(-1)?.clock.whiteMs).toBe(0);
  });

  it("uses the computer controller as Black after a human move", async () => {
    const computer = { chooseMove: vi.fn().mockResolvedValue({ from: "e7", to: "e5" }) };
    const rooms = new RoomService(undefined, undefined, computer);
    const white = rooms.createComputerRoom({ level: "medium", initialTimeMs: 300_000 }, "socket-white");

    rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "e2", to: "e4" }, "socket-white");
    const state = await rooms.takeComputerTurn(white.room.id);

    expect(computer.chooseMove).toHaveBeenCalledOnce();
    expect(state?.game.moves.map((move) => move.san)).toEqual(["e4", "e5"]);
    expect(state?.game.turn).toBe("white");
    expect(state?.players.find((player) => player.color === "black")?.kind).toBe("computer");
    expect(state?.timeControl.initialTimeMs).toBe(300_000);
  });

  it("releases a player's seat when they intentionally leave", () => {
    const rooms = new RoomService();
    const white = rooms.createRoom("socket-white");
    const black = rooms.joinRoom({ roomId: white.room.id }, "socket-black");

    const state = rooms.leave({ roomId: white.room.id, playerToken: white.playerToken }, "socket-white");
    expect(state.status).toBe("waiting");
    expect(state.players.find((player) => player.color === "white")).toBeUndefined();
    expect(state.clock.activeColor).toBeNull();

    const replacement = rooms.joinRoom({ roomId: white.room.id }, "socket-replacement");
    expect(replacement.playerColor).toBe("white");
    expect(rooms.snapshotById(white.room.id).players).toHaveLength(2);
    expect(black.playerColor).toBe("black");
  });

  it("exposes named games for spectators and supports administrator interventions", () => {
    const rooms = new RoomService();
    const white = rooms.createRoom("socket-white", "Alice");
    const black = rooms.joinRoom({ roomId: white.room.id }, "socket-black", "Bob");

    const summary = rooms.adminGames()[0]!;
    expect(summary).toMatchObject({ roomId: white.room.id, white: "Alice", black: "Bob", status: "active" });
    expect(rooms.snapshotById(white.room.id).players.map((player) => player.username)).toEqual(["Alice", "Bob"]);

    rooms.disconnect("socket-black");
    const reconnected = rooms.adminReconnect(white.room.id, "Bob", "socket-black-new");
    expect(reconnected.room.players.find((player) => player.username === "Bob")?.connected).toBe(true);
    expect(reconnected.playerToken).toBe(black.playerToken);

    const declared = rooms.adminDeclareResult(white.room.id, "white");
    expect(declared.game.result).toEqual({ kind: "admin-decision", winner: "white" });
  });

  it("rejects new players after an administrator has finished the game", () => {
    const rooms = new RoomService();
    const white = rooms.createRoom("socket-white", "Alice");
    rooms.adminCancel(white.room.id);

    expect(() => rooms.joinRoom({ roomId: white.room.id }, "socket-black", "Bob")).toThrow("already finished");
  });

  it("gives each rematch a unique game identity and protects completed results", () => {
    const rooms = new RoomService();
    const white = rooms.createRoom("socket-white", "Alice");
    rooms.joinRoom({ roomId: white.room.id }, "socket-black", "Bob");
    const firstGameId = white.room.gameInstanceId;
    rooms.adminDeclareResult(white.room.id, "white");

    expect(() => rooms.adminDeclareResult(white.room.id, "black")).toThrow("already finished");
    const rematch = rooms.restart({ roomId: white.room.id, playerToken: white.playerToken }, "socket-white");
    expect(rematch.gameInstanceId).not.toBe(firstGameId);
  });

  it("feeds authoritative checkmate and resignation results into the same rating pipeline", () => {
    const ratings = new RatingService(join(mkdtempSync(join(tmpdir(), "chessss-room-rating-")), "ratings.json"));
    const rooms = new RoomService();
    const white = rooms.createRoom("socket-white", "Alice", { access: "rated", initialTimeMs: 300_000 }, 1200);
    const black = rooms.joinRoom({ roomId: white.room.id }, "socket-black", "Bob", 1200);
    rooms.configureRatings(white.room.id, { white: 1200, black: 1200 }, {
      white: ratings.estimate("Alice", "Bob", "blitz"),
      black: ratings.estimate("Bob", "Alice", "blitz"),
    });
    rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "f2", to: "f3" }, "socket-white");
    rooms.move({ roomId: white.room.id, playerToken: black.playerToken, from: "e7", to: "e5" }, "socket-black");
    rooms.move({ roomId: white.room.id, playerToken: white.playerToken, from: "g2", to: "g4" }, "socket-white");
    const checkmate = rooms.move({ roomId: white.room.id, playerToken: black.playerToken, from: "d8", to: "h4" }, "socket-black");
    const first = ratings.processCompletedGame({
      gameId: checkmate.gameInstanceId, roomId: checkmate.id, mode: checkmate.mode, access: checkmate.access,
      initialTimeMs: checkmate.timeControl.initialTimeMs, white: "Alice", black: "Bob", result: checkmate.game.result,
    });
    expect(first).toMatchObject({ rated: true, pool: "blitz", white: { ratingChange: -20 }, black: { ratingChange: 20 } });

    const rematch = rooms.restart({ roomId: white.room.id, playerToken: white.playerToken }, "socket-white");
    const resigned = rooms.resign({ roomId: rematch.id, playerToken: black.playerToken }, "socket-black");
    const second = ratings.processCompletedGame({
      gameId: resigned.gameInstanceId, roomId: resigned.id, mode: resigned.mode, access: resigned.access,
      initialTimeMs: resigned.timeControl.initialTimeMs, white: "Alice", black: "Bob", result: resigned.game.result,
    });
    expect(resigned.game.result).toEqual({ kind: "resignation", winner: "white" });
    expect(second.rated).toBe(true);
    expect(second.white!.ratingChange).toBeGreaterThan(0);
  });

  it("reserves tournament rooms for the assigned usernames and preserves their seats", () => {
    const rooms = new RoomService();
    const room = rooms.createTournamentRoom({ tournamentId: "event-1", round: 1, white: "Alice", black: "Bob", initialTimeMs: 300_000, access: "rated" });
    expect(() => rooms.joinRoom({ roomId: room.id }, "socket-eve", "Eve")).toThrow("already has two players");
    const alice = rooms.joinRoom({ roomId: room.id }, "socket-alice", "alice");
    const bob = rooms.joinRoom({ roomId: room.id }, "socket-bob", "Bob");
    expect(bob.room.status).toBe("active");
    const left = rooms.leave({ roomId: room.id, playerToken: alice.playerToken }, "socket-alice");
    expect(left.players).toHaveLength(2);
    expect(left.players.find((player) => player.username === "Alice")?.connected).toBe(false);
  });

  it("freezes tournament clocks and rejects moves while the tournament is paused", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-17T12:00:00.000Z"));
    const rooms = new RoomService();
    const room = rooms.createTournamentRoom({ tournamentId: "event-1", round: 1, white: "Alice", black: "Bob", initialTimeMs: 300_000, access: "rated" });
    const alice = rooms.joinRoom({ roomId: room.id }, "socket-alice", "Alice");
    rooms.joinRoom({ roomId: room.id }, "socket-bob", "Bob");
    vi.advanceTimersByTime(5_000);
    const paused = rooms.setTournamentPaused("event-1", true)[0]!;
    vi.advanceTimersByTime(30_000);
    expect(rooms.snapshotById(room.id).clock.whiteMs).toBe(paused.clock.whiteMs);
    expect(() => rooms.move({ roomId: room.id, playerToken: alice.playerToken, from: "e2", to: "e4" }, "socket-alice")).toThrow("paused");
    const resumed = rooms.setTournamentPaused("event-1", false)[0]!;
    expect(resumed.clock.activeColor).toBe("white");
  });
});
