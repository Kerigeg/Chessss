import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

export interface StockfishEngine {
  listener: (line: string) => void;
  sendCommand(command: string): void;
}

type StockfishFactory = (flavor: string) => Promise<StockfishEngine>;

export class StockfishRuntime {
  private engine: Promise<StockfishEngine> | null = null;
  private pending: Array<{ priority: number; sequence: number; execute: () => Promise<void> }> = [];
  private running = false;
  private sequence = 0;

  constructor(private readonly factory?: StockfishFactory) {}

  run<T>(operation: (engine: StockfishEngine) => Promise<T>, priority = 0): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.pending.push({
        priority,
        sequence: this.sequence++,
        execute: async () => {
          try { resolve(await operation(await this.getEngine())); }
          catch (error) { reject(error); }
        },
      });
      this.pending.sort((left, right) => right.priority - left.priority || left.sequence - right.sequence);
      this.pump();
    });
  }

  sendAndWait(
    engine: StockfishEngine,
    command: string,
    matches: (line: string) => boolean,
    timeoutMs = 15_000,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        engine.sendCommand("stop");
        reject(new Error(`Stockfish timed out while running ${command}.`));
      }, timeoutMs);
      timeout.unref();
      engine.listener = (line) => {
        if (!matches(line)) return;
        clearTimeout(timeout);
        resolve(line);
      };
      engine.sendCommand(command);
    });
  }

  private pump() {
    if (this.running) return;
    const next = this.pending.shift();
    if (!next) return;
    this.running = true;
    void next.execute().finally(() => {
      this.running = false;
      this.pump();
    });
  }

  private getEngine(): Promise<StockfishEngine> {
    if (!this.engine) {
      const stockfish = this.factory ?? require("stockfish") as StockfishFactory;
      this.engine = stockfish("lite-single").then(async (engine) => {
        await this.sendAndWait(engine, "uci", (line) => line === "uciok");
        await this.sendAndWait(engine, "isready", (line) => line === "readyok");
        return engine;
      });
    }
    return this.engine;
  }
}

export const sharedStockfishRuntime = new StockfishRuntime();
