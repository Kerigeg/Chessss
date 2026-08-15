import { describe, expect, it } from "vitest";
import { RoomError, RoomService } from "../src/room-service.js";

describe("RoomService", () => {
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
});
