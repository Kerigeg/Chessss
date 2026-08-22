import { describe, expect, it } from "vitest";
import { applyMove, createGame, snapshotGame } from "@chessss/chess-core";
import { GameAnalyzer, labelForLoss } from "../src/game-analyzer.js";

describe("move analysis labels", () => {
  it("assigns labels from centipawn loss thresholds", () => {
    expect(labelForLoss(0, true)).toBe("best");
    expect(labelForLoss(20, false)).toBe("excellent");
    expect(labelForLoss(55, false)).toBe("good");
    expect(labelForLoss(115, false)).toBe("inaccuracy");
    expect(labelForLoss(240, false)).toBe("mistake");
    expect(labelForLoss(251, false)).toBe("blunder");
  });

  it("returns one analysis entry for each move", async () => {
    const game = createGame();
    applyMove(game, { from: "e2", to: "e4" });
    applyMove(game, { from: "e7", to: "e5" });

    const analysis = await new GameAnalyzer().analyze(snapshotGame(game));
    expect(analysis.moves).toHaveLength(2);
    expect(analysis.moves[0]).toMatchObject({ moveIndex: 0, bestMoveSan: expect.any(String) });
  }, 20_000);
});
