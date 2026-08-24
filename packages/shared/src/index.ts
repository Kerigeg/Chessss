export type ChessColor = "white" | "black";
export type ComputerLevel = "beginner" | "medium" | "high" | "hell" | "stockfish";
export type GameMode = "human" | "computer";

export interface AuthUser {
  username: string;
  isAdmin: boolean;
}

export interface AdminUserSummary {
  username: string;
  banned: boolean;
  isAdmin: boolean;
}

export interface BanUserRequest {
  username: string;
}

export interface CredentialsRequest {
  username: string;
  password: string;
}

export interface AdminLoginRequest {
  username: string;
  adminCode: string;
}

export interface RestoreSessionRequest {
  sessionToken: string;
}

export interface AuthResponse {
  user: AuthUser;
  sessionToken: string;
}

export type GameResultKind =
  | "checkmate"
  | "stalemate"
  | "threefold-repetition"
  | "fifty-move-rule"
  | "insufficient-material"
  | "timeout"
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

export type MoveLabel = "best" | "excellent" | "good" | "inaccuracy" | "mistake" | "blunder";

export interface MoveAnalysis {
  moveIndex: number;
  label: MoveLabel;
  centipawnLoss: number;
  evaluationCp: number;
  bestMoveSan: string;
}

export interface GameAnalysis {
  moves: MoveAnalysis[];
}

export interface ChessGameState {
  fen: string;
  /** FEN for the initial position followed by every completed half-move. */
  positionHistory: string[];
  turn: ChessColor;
  isCheck: boolean;
  moves: MoveView[];
  result: GameResult | null;
}

export interface RoomPlayer {
  color: ChessColor;
  connected: boolean;
  kind: "human" | "computer";
}

export interface GameClock {
  whiteMs: number;
  blackMs: number;
  activeColor: ChessColor | null;
  turnStartedAt: number | null;
}

export interface TimeControl {
  initialTimeMs: number;
}

export interface RoomSnapshot {
  id: string;
  mode: GameMode;
  computerLevel: ComputerLevel | null;
  timeControl: TimeControl;
  status: "waiting" | "active" | "finished";
  players: RoomPlayer[];
  game: ChessGameState;
  clock: GameClock;
  lastMove: MoveView | null;
}

export interface JoinRoomRequest {
  roomId: string;
  playerToken?: string;
}

export interface LeaveRoomRequest {
  roomId: string;
  playerToken: string;
}

export interface CreateComputerRoomRequest {
  level: ComputerLevel;
  initialTimeMs: number;
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

export interface RestartGameRequest {
  roomId: string;
  playerToken: string;
}

export interface AnalyzeGameRequest {
  roomId: string;
  playerToken: string;
}

export interface ServerError {
  message: string;
}
