import { afterEach, describe, expect, it, vi } from "vitest";
import { RoomError, RoomService } from "../src/room-service.js";

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
});
