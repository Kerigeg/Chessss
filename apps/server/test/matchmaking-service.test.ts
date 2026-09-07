import { describe, expect, it } from "vitest";
import { MatchmakingError, MatchmakingService } from "../src/matchmaking-service.js";

const ticket = (socketId: string, username: string, initialTimeMs = 300_000, access: "rated" | "casual" = "rated", joinedAt = 1) => ({ socketId, username, initialTimeMs, access, joinedAt });

describe("MatchmakingService", () => {
  it("pairs the oldest compatible players and removes them from the queue", () => {
    const queue = new MatchmakingService();
    expect(queue.join(ticket("one", "Alice"))).toMatchObject({ status: "queued" });
    expect(queue.join(ticket("two", "Bob", 300_000, "rated", 2))).toMatchObject({ status: "matched", first: { username: "Alice" }, second: { username: "Bob" } });
    expect(queue.waitingCount()).toBe(0);
  });

  it("keeps different clocks and modes in separate queues", () => {
    const queue = new MatchmakingService();
    queue.join(ticket("one", "Alice", 60_000));
    queue.join(ticket("two", "Bob", 300_000));
    queue.join(ticket("three", "Cara", 60_000, "casual"));
    expect(queue.waitingCount()).toBe(3);
    expect(queue.join(ticket("four", "Dan", 60_000, "rated", 2))).toMatchObject({ status: "matched", first: { username: "Alice" } });
  });

  it("rejects duplicate searches and supports cancellation", () => {
    const queue = new MatchmakingService();
    queue.join(ticket("one", "Alice"));
    expect(() => queue.join(ticket("one", "Alice"))).toThrowError(MatchmakingError);
    expect(() => queue.join(ticket("other-tab", "alice"))).toThrow("account is already searching");
    expect(queue.cancel("one")).toBe(true);
    expect(queue.waitingCount()).toBe(0);
  });
});
