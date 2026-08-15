export type ChessColor = "white" | "black";

export type GameResultKind =
  | "checkmate"
  | "stalemate"
  | "threefold-repetition"
  | "fifty-move-rule"
  | "insufficient-material"
  | "draw";

export interface GameResult {
  kind: GameResultKind;
  winner: ChessColor | null;
}

export interface MoveView {
  from: string;
  to: string;
  san: string;
  color: ChessColor;
  piece: string;
  captured?: string;
  promotion?: string;
}

export interface ChessGameState {
  fen: string;
  turn: ChessColor;
  isCheck: boolean;
  moves: MoveView[];
  result: GameResult | null;
}

export interface RoomPlayer {
  color: ChessColor;
  connected: boolean;
}

export interface RoomSnapshot {
  id: string;
  status: "waiting" | "active" | "finished";
  players: RoomPlayer[];
  game: ChessGameState;
  lastMove: MoveView | null;
}

export interface JoinRoomRequest {
  roomId: string;
  playerToken?: string;
}

export interface JoinRoomResponse {
  room: RoomSnapshot;
  playerToken: string;
  playerColor: ChessColor;
}

export interface MoveRequest {
  roomId: string;
  playerToken: string;
  from: string;
  to: string;
  promotion?: "q" | "r" | "b" | "n";
}

export interface ServerError {
  message: string;
}
