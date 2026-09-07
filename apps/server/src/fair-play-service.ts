import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { ChessColor, FairPlayMetrics, FairPlayReview, GameAnalysis } from "@chessss/shared";

export class FairPlayError extends Error {}

export class FairPlayService {
  private readonly reviews: FairPlayReview[];

  constructor(private readonly filePath = resolve(process.cwd(), "data", "fair-play-reviews.json")) {
    this.reviews = this.load();
  }

  create(input: { username: string; roomId: string; actor: string; reason: string; color: ChessColor; analysis: GameAnalysis; timingsMs?: number[] }): FairPlayReview {
    const moves = input.analysis.moves.filter((move) => move.moveIndex % 2 === (input.color === "white" ? 0 : 1));
    if (!moves.length) throw new FairPlayError("There are no moves by that player to review.");
    const averageCentipawnLoss = moves.reduce((sum, move) => sum + move.centipawnLoss, 0) / moves.length;
    const engineMoveSimilarity = moves.filter((move) => move.label === "best").length / moves.length * 100;
    const timings = input.timingsMs?.filter((value) => value > 0) ?? [];
    const timingMean = timings.length ? timings.reduce((sum, value) => sum + value, 0) / timings.length : 0;
    const timingDeviation = timings.length ? Math.sqrt(timings.reduce((sum, value) => sum + (value - timingMean) ** 2, 0) / timings.length) : 0;
    const timingConsistency = timingMean ? Math.max(0, 1 - timingDeviation / timingMean) : 0;
    const rapidMoveRatio = timings.length ? timings.filter((value) => value < 2_000).length / timings.length : 0;
    const metrics: FairPlayMetrics = {
      averageCentipawnLoss: Math.round(averageCentipawnLoss),
      accuracy: Math.round(Math.max(0, Math.min(100, 100 * Math.exp(-averageCentipawnLoss / 180)))),
      engineMoveSimilarity: Math.round(engineMoveSimilarity),
      suspiciousTimingScore: Math.round((timingConsistency * 0.6 + rapidMoveRatio * 0.4) * 100),
    };
    const review: FairPlayReview = {
      id: randomUUID(),
      username: input.username,
      roomId: input.roomId,
      createdAt: new Date().toISOString(),
      createdBy: input.actor,
      reason: input.reason.trim() || "Manual fair-play review",
      metrics,
      status: "pending",
    };
    this.reviews.push(review);
    this.persist();
    return review;
  }

  list(): FairPlayReview[] {
    return [...this.reviews].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  decide(reviewId: string, decision: "approved" | "rejected", actor: string, reason: string): FairPlayReview {
    const review = this.reviews.find((candidate) => candidate.id === reviewId);
    if (!review) throw new FairPlayError("Fair-play review not found.");
    if (review.status !== "pending") throw new FairPlayError("This fair-play review has already been decided.");
    review.status = decision;
    review.decidedAt = new Date().toISOString();
    review.decidedBy = actor;
    review.decisionReason = reason.trim() || "No decision reason supplied";
    this.persist();
    return review;
  }

  private load(): FairPlayReview[] {
    if (!existsSync(this.filePath)) return [];
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as FairPlayReview[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      throw new FairPlayError("The fair-play review database could not be read.");
    }
  }

  private persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.reviews, null, 2), { mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }
}
