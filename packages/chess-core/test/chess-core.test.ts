import { describe, expect, it } from "vitest";
import { applyMove, createGame, snapshotGame } from "../src/index.js";

describe("chess-core", () => {
  it("starts with white to move and records a legal move", () => {
    const game = createGame();
    expect(snapshotGame(game).turn).toBe("white");

    const move = applyMove(game, { from: "e2", to: "e4" });
    expect(move.san).toBe("e4");
    expect(snapshotGame(game).turn).toBe("black");
  });

  it("recognizes checkmate", () => {
    const game = createGame();
    applyMove(game, { from: "f2", to: "f3" });
    applyMove(game, { from: "e7", to: "e5" });
    applyMove(game, { from: "g2", to: "g4" });
    applyMove(game, { from: "d8", to: "h4" });

    expect(snapshotGame(game).result).toEqual({ kind: "checkmate", winner: "black" });
  });
});
