import { describe, expect, it } from "vitest";
import { applyMove, createGame, snapshotGame } from "@chessss/chess-core";
import { StockfishComputer } from "../src/computer-player.js";
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

  it("returns one analysis entry per move for a completed checkmate", async () => {
    const opening = snapshotGame(createGame());
    const computerMove = await new StockfishComputer().chooseMove(opening.fen, "stockfish");
    expect(computerMove.from).toMatch(/^[a-h][1-8]$/);

    const game = createGame();
    applyMove(game, { from: "f2", to: "f3" });
    applyMove(game, { from: "e7", to: "e5" });
    applyMove(game, { from: "g2", to: "g4" });
    applyMove(game, { from: "d8", to: "h4" });

    const snapshot = snapshotGame(game);
    expect(snapshot.result?.kind).toBe("checkmate");

    const analysis = await new GameAnalyzer().analyze(snapshot);
    expect(analysis.moves).toHaveLength(4);
    expect(analysis.moves[0]).toMatchObject({ moveIndex: 0, bestMoveSan: expect.any(String) });
    expect(analysis.moves.at(-1)?.evaluationCp).toBe(-10_000);
  }, 25_000);
});
