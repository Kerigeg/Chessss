import { createRequire } from "node:module";
import { Chess } from "chess.js";
import type { ChessGameState, GameAnalysis, MoveAnalysis, MoveLabel } from "@chessss/shared";

const require = createRequire(import.meta.url);
const ANALYSIS_TIME_MS = 120;

interface StockfishEngine {
  listener: (line: string) => void;
  sendCommand(command: string): void;
}

type StockfishFactory = (flavor: string) => Promise<StockfishEngine>;

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
  private engine: Promise<StockfishEngine> | null = null;
  private queue: Promise<void> = Promise.resolve();

  analyze(game: ChessGameState): Promise<GameAnalysis> {
    const next = this.queue.then(() => this.analyzeNow(game));
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async analyzeNow(game: ChessGameState): Promise<GameAnalysis> {
    const positions: PositionAnalysis[] = [];
    for (const fen of game.positionHistory) positions.push(await this.inspect(fen));
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

  private async inspect(fen: string): Promise<PositionAnalysis> {
    const engine = await this.getEngine();
    engine.sendCommand(`position fen ${fen}`);
    let scoreCp = 0;
    const bestMove = await this.sendAndWait(engine, `go movetime ${ANALYSIS_TIME_MS}`, (line) => {
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

  private async getEngine(): Promise<StockfishEngine> {
    if (!this.engine) {
      const stockfish = require("stockfish") as StockfishFactory;
      this.engine = stockfish("lite-single").then(async (engine) => {
        await this.sendAndWait(engine, "uci", (line) => line === "uciok");
        await this.sendAndWait(engine, "isready", (line) => line === "readyok");
        return engine;
      });
    }
    return this.engine;
  }

  private sendAndWait(engine: StockfishEngine, command: string, matches: (line: string) => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Stockfish timed out while running ${command}.`)), 15_000);
      timeout.unref();
      engine.listener = (line) => {
        if (!matches(line)) return;
        clearTimeout(timeout);
        resolve(line);
      };
      engine.sendCommand(command);
    });
  }
}
