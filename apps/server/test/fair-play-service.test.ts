import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { FairPlayService } from "../src/fair-play-service.js";

describe("FairPlayService", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  it("creates a metrics review that requires a separate human decision", () => {
    const directory = mkdtempSync(join(tmpdir(), "chessss-fair-play-"));
    directories.push(directory);
    const service = new FairPlayService(join(directory, "reviews.json"));
    const review = service.create({
      username: "Alice", roomId: "ABC123", actor: "Moderator", reason: "Report received", color: "white",
      analysis: { moves: [
        { moveIndex: 0, label: "best", centipawnLoss: 0, evaluationCp: 20, bestMoveSan: "e4" },
        { moveIndex: 1, label: "mistake", centipawnLoss: 130, evaluationCp: 60, bestMoveSan: "e5" },
        { moveIndex: 2, label: "excellent", centipawnLoss: 20, evaluationCp: 35, bestMoveSan: "Nf3" },
      ] }, timingsMs: [1_500, 1_600],
    });

    expect(review.status).toBe("pending");
    expect(review.metrics).toMatchObject({ averageCentipawnLoss: 10, engineMoveSimilarity: 50 });
    expect(review.metrics.suspiciousTimingScore).toBeGreaterThan(80);
    expect(service.decide(review.id, "approved", "Moderator", "Needs manual account review").status).toBe("approved");
    expect(() => service.decide(review.id, "rejected", "Moderator", "Changed mind")).toThrow("already been decided");
  });
});
