import { describe, expect, it } from "vitest";
import { Chess } from "chess.js";
import type { MoveView } from "@chessss/shared";
import { animatedOrigins, legalTargets, parseLoadout, readPosition } from "./magicState";
import { pieceModel } from "./MagicScene";
import { Box3, Vector3 } from "three";

function transition(fen: string, san: string) {
  const chess = new Chess(fen);
  const move = chess.move(san);
  const view: MoveView = { ...move, color: move.color === "w" ? "white" : "black" };
  return { fen: chess.fen(), move: view };
}
describe("Magic authoritative position transitions", () => {
  it("animates an accepted move once and ignores reconnect jumps", () => {
    const initial = new Chess().fen();
    const next = transition(initial, "e4");
    expect([...animatedOrigins(initial, next.fen, next.move)]).toEqual([["e4", "e2"]]);
    expect(animatedOrigins(next.fen, next.fen, next.move).size).toBe(0);
    expect(animatedOrigins(null, next.fen, next.move).size).toBe(0);
    const later = transition(next.fen, "e5");
    expect(animatedOrigins(initial, later.fen, later.move).size).toBe(0);
  });
  it.each(["O-O", "O-O-O"])("moves the king and rook together for %s", san => {
    const initial = "r3k2r/8/8/8/8/8/8/R3K2R w KQkq - 0 1";
    const next = transition(initial, san);
    expect([...animatedOrigins(initial, next.fen, next.move)]).toEqual(san === "O-O" ? [["g1", "e1"], ["f1", "h1"]] : [["c1", "e1"], ["d1", "a1"]]);
  });
  it("renders en passant from the accepted FEN without leaving a captured pawn", () => {
    const initial = "4k3/8/8/3pP3/8/8/8/4K3 w - d6 0 1";
    const next = transition(initial, "exd6");
    expect([...animatedOrigins(initial, next.fen, next.move)]).toEqual([["d6", "e5"]]);
    expect(readPosition(next.fen).get("d5")).toBeUndefined();
    expect(next.move.captured).toBe("p");
  });
  it.each(["q", "r", "b", "n"])("preserves underpromotion to %s", piece => {
    const initial = "4k3/P7/8/8/8/8/8/4K3 w - - 0 1";
    const next = transition(initial, `a8=${piece.toUpperCase()}`);
    expect([...animatedOrigins(initial, next.fen, next.move)]).toEqual([["a8", "a7"]]);
    expect(readPosition(next.fen).get("a8")).toBe(piece.toUpperCase());
  });
  it("does not suggest moves exposing a pinned king", () => {
    expect(legalTargets("k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1", "e2")).not.toContain("d2");
    expect(legalTargets(new Chess().fen(), "e2")).toEqual(["e3", "e4"]);
  });
});
describe("Magic collections", () => {
  it("recovers corrupted preferences and independently validates both sides", () => {
    expect(parseLoadout("broken")).toEqual({ white: "astral", black: "astral" });
    expect(parseLoadout('{"white":"neon","black":"sovereign"}')).toEqual({ white: "neon", black: "sovereign" });
    expect(parseLoadout('{"white":"__proto__","black":"neon"}')).toEqual({ white: "astral", black: "neon" });
  });
  it("builds all 36 models within a square, with distinct piece silhouettes", () => {
    for (const skin of ["astral", "sovereign", "neon"] as const) for (const side of ["white", "black"]) {
      const heights = new Set<number>();
      for (const piece of "pnbrqk") {
        const model = pieceModel(side === "white" ? piece.toUpperCase() : piece, skin);
        const size = new Box3().setFromObject(model).getSize(new Vector3());
        expect(size.x).toBeLessThan(1); expect(size.z).toBeLessThan(1);
        expect(size.y).toBeGreaterThan(.5); expect(size.y).toBeLessThan(1.8);
        heights.add(size.y);
      }
      expect(heights.size).toBeGreaterThanOrEqual(5);
    }
  });
});
