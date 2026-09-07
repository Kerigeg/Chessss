import { describe, expect, it } from "vitest";
import type { RoomSnapshot } from "@chessss/shared";
import { resultText } from "./App.js";

describe("resultText", () => {
  it("shows the winner of an administrator decision", () => {
    const room = { game: { result: { kind: "admin-decision", winner: "white" } } } as RoomSnapshot;
    expect(resultText(room)).toBe("White wins by administrator decision.");
  });

  it("keeps a drawn administrator decision as a draw", () => {
    const room = { game: { result: { kind: "admin-decision", winner: null } } } as RoomSnapshot;
    expect(resultText(room)).toBe("Draw — admin decision.");
  });
});
