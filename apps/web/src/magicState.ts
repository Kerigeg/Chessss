import { Chess, type Square } from "chess.js";
import type { ChessColor, MoveView } from "@chessss/shared";

export const skins = {
  astral: { name: "Astral", subtitle: "星辉水晶", white: "#a6edff", black: "#9975ec", accent: "#80e8ff" },
  sovereign: { name: "Sovereign", subtitle: "鎏金王朝", white: "#f4dbab", black: "#a26b48", accent: "#ffd085" },
  neon: { name: "Neon", subtitle: "霓虹机甲", white: "#9afedb", black: "#e975b8", accent: "#72ffcb" },
} as const;
export type Skin = keyof typeof skins;
export type Loadout = Record<ChessColor, Skin>;
export const loadoutKey = "chessss-magic-skins";
export function parseLoadout(value: string | null): Loadout {
  try {
    const parsed = JSON.parse(value ?? "null");
    const valid = (skin: unknown): skin is Skin => typeof skin === "string" && Object.hasOwn(skins, skin);
    return { white: valid(parsed?.white) ? parsed.white : "astral", black: valid(parsed?.black) ? parsed.black : "astral" };
  } catch { return { white: "astral", black: "astral" }; }
}
export function readPosition(fen: string): Map<string, string> {
  const pieces = new Map<string, string>();
  fen.split(" ")[0].split("/").forEach((row, rank) => {
    let file = 0;
    for (const symbol of row) {
      if (/\d/.test(symbol)) file += Number(symbol);
      else pieces.set(`${"abcdefgh"[file++]}${8 - rank}`, symbol);
    }
  });
  return pieces;
}
export function legalTargets(fen: string, selected: string | null): string[] {
  if (!selected) return [];
  try { return [...new Set(new Chess(fen).moves({ square: selected as Square, verbose: true }).map(move => move.to))]; }
  catch { return []; }
}
/** Only animate consecutive, server-accepted positions, never initial loads or replay jumps. */
export function animatedOrigins(previousFen: string | null, fen: string, move: MoveView | null): Map<string, string> {
  const origins = new Map<string, string>();
  if (!previousFen || !move || previousFen === fen) return origins;
  try {
    const chess = new Chess(previousFen);
    chess.move({ from: move.from, to: move.to, promotion: move.promotion });
    if (chess.fen() !== fen) return origins;
    origins.set(move.to, move.from);
    if (move.piece === "k" && Math.abs(move.to.charCodeAt(0) - move.from.charCodeAt(0)) === 2) {
      const rank = move.from[1];
      origins.set(`${move.to[0] === "g" ? "f" : "d"}${rank}`, `${move.to[0] === "g" ? "h" : "a"}${rank}`);
    }
  } catch { /* Reconnects and review jumps render the authoritative position immediately. */ }
  return origins;
}
