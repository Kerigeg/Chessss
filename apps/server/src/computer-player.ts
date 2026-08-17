import { createRequire } from "node:module";
import { Chess, type Move } from "chess.js";
import type { ComputerLevel } from "@chessss/shared";

const require = createRequire(import.meta.url);

interface StockfishEngine {
  listener: (line: string) => void;
  sendCommand(command: string): void;
}

type StockfishFactory = (flavor: string) => Promise<StockfishEngine>;

export interface ComputerMove {
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
}

export interface ComputerMoveProvider {
  chooseMove(fen: string, level: ComputerLevel): Promise<ComputerMove>;
}

export class StockfishComputer implements ComputerMoveProvider {
  private engine: Promise<StockfishEngine> | null = null;
  private queue: Promise<void> = Promise.resolve();

  chooseMove(fen: string, level: ComputerLevel): Promise<ComputerMove> {
    const next = this.queue.then(() => this.chooseMoveNow(fen, level));
    this.queue = next.then(() => undefined, () => undefined);
    return next;
  }

  private async chooseMoveNow(fen: string, level: ComputerLevel): Promise<ComputerMove> {
    const legalMoves = new Chess(fen).moves({ verbose: true });
    if (legalMoves.length === 0) throw new Error("Computer was asked to move in a finished position.");
    if (level === "beginner") return this.randomMove(legalMoves);
    if (level === "medium" && Math.random() < 0.65) return this.randomMove(legalMoves);

    try {
      const engine = await this.getEngine();
      await this.configure(engine, level);
      const bestMove = await this.bestMove(engine, fen, this.thinkTime(level));
      return this.uciMove(bestMove);
    } catch {
      return this.randomMove(legalMoves);
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

  private async configure(engine: StockfishEngine, level: Exclude<ComputerLevel, "beginner">) {
    if (level === "medium") {
      engine.sendCommand("setoption name UCI_LimitStrength value true");
      engine.sendCommand("setoption name UCI_Elo value 1320");
      engine.sendCommand("setoption name Skill Level value 0");
    } else if (level === "high") {
      engine.sendCommand("setoption name UCI_LimitStrength value true");
      engine.sendCommand("setoption name UCI_Elo value 1400");
    } else if (level === "hell") {
      engine.sendCommand("setoption name UCI_LimitStrength value true");
      engine.sendCommand("setoption name UCI_Elo value 2100");
    } else {
      engine.sendCommand("setoption name UCI_LimitStrength value false");
      engine.sendCommand("setoption name Skill Level value 20");
    }
    await this.sendAndWait(engine, "isready", (line) => line === "readyok");
  }

  private async bestMove(engine: StockfishEngine, fen: string, thinkTime: number): Promise<string> {
    engine.sendCommand(`position fen ${fen}`);
    const line = await this.sendAndWait(engine, `go movetime ${thinkTime}`, (output) => output.startsWith("bestmove "));
    const move = line.split(" ")[1];
    if (!move || move === "(none)") throw new Error("Stockfish did not return a legal move.");
    return move;
  }

  private sendAndWait(engine: StockfishEngine, command: string, matches: (line: string) => boolean): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Stockfish timed out while running ${command}.`)), 8_000);
      timeout.unref();
      engine.listener = (line) => {
        if (!matches(line)) return;
        clearTimeout(timeout);
        resolve(line);
      };
      engine.sendCommand(command);
    });
  }

  private thinkTime(level: Exclude<ComputerLevel, "beginner">): number {
    if (level === "medium") return 40;
    if (level === "high") return 100;
    if (level === "hell") return 250;
    return 800;
  }

  private randomMove(moves: Move[]): ComputerMove {
    const move = moves[Math.floor(Math.random() * moves.length)]!;
    return { from: move.from, to: move.to, promotion: move.promotion as ComputerMove["promotion"] };
  }

  private uciMove(move: string): ComputerMove {
    const promotion = move[4] as ComputerMove["promotion"] | undefined;
    return { from: move.slice(0, 2), to: move.slice(2, 4), promotion };
  }
}
