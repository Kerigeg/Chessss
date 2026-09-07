import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { calculateElo, expectedScore, RatingService, ratingPoolForTimeControl, type RatingGameInput } from "../src/rating-service.js";

describe("RatingService", () => {
  const directories: string[] = [];

  afterEach(() => { for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true }); });

  function service(now = Date.parse("2026-08-31T10:00:00Z")) {
    const directory = mkdtempSync(join(tmpdir(), "chessss-ratings-"));
    directories.push(directory);
    const file = join(directory, "ratings.json");
    return { ratings: new RatingService(file, () => now), file };
  }

  function game(overrides: Partial<RatingGameInput> = {}): RatingGameInput {
    return {
      gameId: "game-1", roomId: "ROOM01", mode: "human", access: "rated", initialTimeMs: 300_000,
      white: "Alice", black: "Bob", result: { kind: "checkmate", winner: "white" }, ...overrides,
    };
  }

  it("calculates expected score and provisional or established Elo", () => {
    expect(expectedScore(1200, 1200)).toBe(0.5);
    expect(calculateElo(1200, 1200, 1, 0)).toBe(1220);
    expect(calculateElo(1200, 1200, 0, 0)).toBe(1180);
    expect(calculateElo(1200, 1400, 1, 0)).toBeGreaterThan(1220);
    expect(calculateElo(1200, 1200, 1, 10)).toBe(1210);
  });

  it("maps pools and keeps them separate", () => {
    expect(ratingPoolForTimeControl(179_999)).toBe("bullet");
    expect(ratingPoolForTimeControl(180_000)).toBe("blitz");
    expect(ratingPoolForTimeControl(420_000)).toBe("blitz");
    expect(ratingPoolForTimeControl(421_000)).toBe("rapid");
    expect(ratingPoolForTimeControl(1_800_001)).toBeNull();

    const { ratings } = service();
    ratings.processCompletedGame(game({ initialTimeMs: 60_000 }));
    expect(ratings.rating("Alice", "bullet").rating).toBe(1220);
    expect(ratings.rating("Alice", "blitz").rating).toBe(1200);
  });

  it("updates draws, peaks, streaks, and both players from pre-game ratings", () => {
    const { ratings } = service();
    const win = ratings.processCompletedGame(game());
    expect(win.white?.ratingAfter).toBe(1220);
    expect(win.black?.ratingAfter).toBe(1180);
    expect(ratings.rating("Alice", "blitz")).toMatchObject({ peakRating: 1220, wins: 1, currentWinStreak: 1, bestWinStreak: 1 });

    ratings.processCompletedGame(game({ gameId: "game-2", black: "Carol", result: { kind: "draw", winner: null } }));
    expect(ratings.rating("Alice", "blitz")).toMatchObject({ ratedGames: 2, draws: 1, currentWinStreak: 0, bestWinStreak: 1 });
  });

  it("ignores computer, casual, cancelled, forfeit, and duplicate results", () => {
    const { ratings } = service();
    expect(ratings.processCompletedGame(game({ mode: "computer" })).rated).toBe(false);
    expect(ratings.processCompletedGame(game({ gameId: "casual", access: "casual" })).rated).toBe(false);
    expect(ratings.processCompletedGame(game({ gameId: "cancelled", result: { kind: "cancelled", winner: null } })).rated).toBe(false);
    expect(ratings.processCompletedGame(game({ gameId: "forfeit", result: { kind: "forfeit", winner: "white" } })).rated).toBe(false);
    const rated = ratings.processCompletedGame(game({ gameId: "rated" }));
    const duplicate = ratings.processCompletedGame(game({ gameId: "rated" }));
    expect(duplicate).toEqual(rated);
    expect(ratings.rating("Alice", "blitz").ratedGames).toBe(1);
  });

  it("treats checkmate, resignation, and timeout wins identically", () => {
    const changes = (["checkmate", "resignation", "timeout"] as const).map((kind) => {
      const { ratings } = service();
      return ratings.processCompletedGame(game({ result: { kind, winner: "white" }, tournamentId: "swiss-1" })).white?.ratingChange;
    });
    expect(changes).toEqual([20, 20, 20]);
  });

  it("persists records, history, and processed-result idempotency across restarts", () => {
    const { ratings, file } = service();
    ratings.processCompletedGame(game());
    const restored = new RatingService(file, () => Date.parse("2026-08-31T10:05:00Z"));
    expect(restored.rating("alice", "blitz").rating).toBe(1220);
    expect(restored.profile("ALICE").history).toHaveLength(1);
    restored.processCompletedGame(game());
    expect(restored.rating("Alice", "blitz").ratedGames).toBe(1);
  });

  it("reverses the exact rating delta as an auditable compensating transaction", () => {
    const { ratings } = service();
    ratings.processCompletedGame(game());
    const reversal = ratings.reverse("game-1", "Owner");
    expect(ratings.rating("Alice", "blitz")).toMatchObject({ rating: 1200, ratedGames: 0, wins: 0, currentWinStreak: 0 });
    expect(ratings.rating("Bob", "blitz")).toMatchObject({ rating: 1200, ratedGames: 0, losses: 0 });
    expect(reversal[0]).toMatchObject({ ratingChange: -20, reversalOf: "game-1" });
    expect(() => ratings.reverse("game-1", "Owner")).toThrow("already been reversed");
  });

  it("limits repeated opponents and exposes eligible leaderboard players", () => {
    const { ratings } = service();
    for (let index = 1; index <= 4; index += 1) ratings.processCompletedGame(game({ gameId: `repeat-${index}` }));
    expect(ratings.rating("Alice", "blitz").ratedGames).toBe(3);
    expect(ratings.processed("repeat-4")?.reason).toContain("first three");

    ratings.processCompletedGame(game({ gameId: "other-1", black: "Carol" }));
    ratings.processCompletedGame(game({ gameId: "other-2", black: "Dana" }));
    const board = ratings.leaderboard({ pool: "blitz" });
    expect(board.entries[0]).toMatchObject({ username: "Alice", ratedGames: 5, provisional: true, rank: 1 });
    expect(ratings.leaderboard({ pool: "blitz" }, (username) => username !== "Alice").entries.some((entry) => entry.username === "Alice")).toBe(false);
  });
});
