import { describe, expect, it } from "vitest";
import { StockfishRuntime, type StockfishEngine } from "../src/stockfish-runtime.js";

describe("StockfishRuntime", () => {
  it("runs a queued computer operation before lower-priority analysis work", async () => {
    const engine: StockfishEngine = {
      listener: () => undefined,
      sendCommand(command) {
        if (command === "uci") queueMicrotask(() => engine.listener("uciok"));
        if (command === "isready") queueMicrotask(() => engine.listener("readyok"));
      },
    };
    const runtime = new StockfishRuntime(async () => engine);
    const order: string[] = [];
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => { releaseFirst = resolve; });

    const firstAnalysis = runtime.run(async () => { order.push("analysis-1"); await firstGate; });
    const secondAnalysis = runtime.run(async () => { order.push("analysis-2"); });
    const computerMove = runtime.run(async () => { order.push("computer"); }, 100);
    await new Promise((resolve) => setTimeout(resolve, 0));
    releaseFirst();
    await Promise.all([firstAnalysis, secondAnalysis, computerMove]);

    expect(order).toEqual(["analysis-1", "computer", "analysis-2"]);
  });
});
