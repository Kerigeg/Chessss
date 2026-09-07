import { describe, expect, it } from "vitest";
import type { TournamentParticipant } from "@chessss/shared";
import { createSwissPairings } from "../src/swiss-pairing.js";

function player(username: string, seed: number, patch: Partial<TournamentParticipant> = {}): TournamentParticipant {
  return { username, seed, registeredAt: "2026-01-01T00:00:00.000Z", checkedIn: true, score: 0, buchholz: 0, wins: 0, cumulativeScore: 0, colorHistory: [], opponentHistory: [], byeReceived: false, withdrawn: false, disqualified: false, ...patch };
}

describe("Swiss pairing", () => {
  it("is deterministic, avoids repeat opponents, and balances a repeated color", () => {
    const players = [
      player("A", 1, { score: 2, opponentHistory: ["B"], colorHistory: ["white", "white"] }),
      player("B", 2, { score: 2, opponentHistory: ["A"] }),
      player("C", 3, { score: 1, opponentHistory: ["D"] }),
      player("D", 4, { score: 1, opponentHistory: ["C"] }),
    ];
    const first = createSwissPairings(players);
    expect(createSwissPairings(players)).toEqual(first);
    expect(first).toHaveLength(2);
    expect(first.some((pairing) => new Set([pairing.white, pairing.black]).has("A") && new Set([pairing.white, pairing.black]).has("B"))).toBe(false);
    expect(first.find((pairing) => pairing.white === "A" || pairing.black === "A")?.black).toBe("A");
  });

  it("gives the bye to the lowest eligible player and never gives a second bye while another is eligible", () => {
    const first = createSwissPairings([player("A", 1, { score: 2 }), player("B", 2, { score: 1 }), player("C", 3)]);
    expect(first.find((pairing) => pairing.bye)?.bye).toBe("C");
    const second = createSwissPairings([player("A", 1, { score: 2 }), player("B", 2, { score: 1 }), player("C", 3, { byeReceived: true })]);
    expect(second.find((pairing) => pairing.bye)?.bye).toBe("B");
  });
});
