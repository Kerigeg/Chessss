import { Chess, type Move } from "chess.js";
import type { ChessColor, ChessGameState, GameResult, MoveView } from "@chessss/shared";

export function createGame(): Chess {
  return new Chess();
}

export function colorFromTurn(turn: "w" | "b"): ChessColor {
  return turn === "w" ? "white" : "black";
}

export function toMoveView(move: Move): MoveView {
  return {
    from: move.from,
    to: move.to,
    san: move.san,
    color: colorFromTurn(move.color),
    piece: move.piece,
    captured: move.captured,
    promotion: move.promotion,
  };
}

function gameResult(chess: Chess): GameResult | null {
  if (chess.isCheckmate()) {
    return { kind: "checkmate", winner: colorFromTurn(chess.turn() === "w" ? "b" : "w") };
  }
  if (chess.isStalemate()) return { kind: "stalemate", winner: null };
  if (chess.isThreefoldRepetition()) return { kind: "threefold-repetition", winner: null };
  if (chess.isDrawByFiftyMoves()) return { kind: "fifty-move-rule", winner: null };
  if (chess.isInsufficientMaterial()) return { kind: "insufficient-material", winner: null };
  if (chess.isDraw()) return { kind: "draw", winner: null };
  return null;
}

export function snapshotGame(chess: Chess): ChessGameState {
  return {
    fen: chess.fen(),
    turn: colorFromTurn(chess.turn()),
    isCheck: chess.isCheck(),
    moves: chess.history({ verbose: true }).map(toMoveView),
    result: gameResult(chess),
  };
}

export function applyMove(chess: Chess, move: { from: string; to: string; promotion?: "q" | "r" | "b" | "n" }): MoveView {
  return toMoveView(chess.move(move));
}
