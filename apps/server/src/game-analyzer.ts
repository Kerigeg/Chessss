import { Chess } from "chess.js";
import type { ChessGameState, GameAnalysis, MoveAnalysis, MoveLabel } from "@chessss/shared";
import { sharedStockfishRuntime, type StockfishEngine, type StockfishRuntime } from "./stockfish-runtime.js";

interface PositionAnalysis {
  scoreCp: number;
  bestMove: string;
}

export function labelForLoss(loss: number, isBestMove: boolean): MoveLabel {
  if (isBestMove || loss <= 10) return "best";
  if (loss <= 25) return "excellent";
  if (loss <= 60) return "good";
  if (loss <= 120) return "inaccuracy";
  if (loss <= 250) return "mistake";
  return "blunder";
}

export class GameAnalyzer {
  private analysisTimeMs = 120;
  constructor(private readonly runtime: StockfishRuntime = sharedStockfishRuntime) {}

  configure(analysisTimeMs: number) { this.analysisTimeMs = analysisTimeMs; }

  async analyze(game: ChessGameState): Promise<GameAnalysis> {
    const positions: PositionAnalysis[] = [];
    for (const fen of game.positionHistory) {
      positions.push(await this.runtime.run(async (engine) => {
        await this.configureEngine(engine);
        return this.inspect(engine, fen);
      }));
    }
    const moves: MoveAnalysis[] = game.moves.map((move, index) => {
      const before = positions[index]!;
      const after = positions[index + 1]!;
      const actualScoreForMover = -after.scoreCp;
      const loss = Math.max(0, before.scoreCp - actualScoreForMover);
      const playedUci = `${move.from}${move.to}${move.promotion ?? ""}`;
      const isBestMove = playedUci === before.bestMove;
      return {
        moveIndex: index,
        label: labelForLoss(loss, isBestMove),
        centipawnLoss: Math.round(loss),
        evaluationCp: move.color === "white" ? -after.scoreCp : after.scoreCp,
        bestMoveSan: this.sanForUci(game.positionHistory[index]!, before.bestMove),
      };
    });
    return { moves };
  }

  private async configureEngine(engine: StockfishEngine) {
    engine.sendCommand("setoption name UCI_LimitStrength value false");
    engine.sendCommand("setoption name Skill Level value 20");
    await this.runtime.sendAndWait(engine, "isready", (line) => line === "readyok");
  }

  private async inspect(engine: StockfishEngine, fen: string): Promise<PositionAnalysis> {
    const position = new Chess(fen);
    if (position.isGameOver()) {
      return {
        scoreCp: position.isCheckmate() ? -10_000 : 0,
        bestMove: "(none)",
      };
    }

    engine.sendCommand(`position fen ${fen}`);
    let scoreCp = 0;
    const bestMove = await this.runtime.sendAndWait(engine, `go movetime ${this.analysisTimeMs}`, (line) => {
      const scoreMatch = line.match(/\bscore cp (-?\d+)/);
      if (scoreMatch) scoreCp = Number(scoreMatch[1]);
      const mateMatch = line.match(/\bscore mate (-?\d+)/);
      if (mateMatch) scoreCp = Number(mateMatch[1]) > 0 ? 10_000 : -10_000;
      return line.startsWith("bestmove ");
    });
    const uci = bestMove.split(" ")[1];
    if (!uci || uci === "(none)") throw new Error("Stockfish did not return a legal move.");
    return { scoreCp, bestMove: uci };
  }

  private sanForUci(fen: string, uci: string): string {
    try {
      const chess = new Chess(fen);
      return chess.move({ from: uci.slice(0, 2), to: uci.slice(2, 4), promotion: uci[4] }).san;
    } catch {
      return uci;
    }
  }

}
