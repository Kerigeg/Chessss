export type ChessColor = "white" | "black";
export type ComputerLevel = "beginner" | "medium" | "high" | "hell" | "stockfish";
export type GameMode = "human" | "computer";
export type AdminRole = "owner" | "admin" | "moderator" | "analyst";
export type RatingPool = "bullet" | "blitz" | "rapid";
export type GameAccess = "casual" | "rated";

export interface AuthUser {
  username: string;
  isAdmin: boolean;
  role?: AdminRole;
}

export interface UserWarning {
  reason: string;
  actor: string;
  createdAt: string;
}

export interface AdminUserSummary {
  username: string;
  banned: boolean;
  isAdmin: boolean;
  role?: AdminRole;
  online?: boolean;
  createdAt?: string;
  lastSignInAt?: string;
  suspendedUntil?: string;
  warningCount?: number;
  gameCount?: number;
  adminSecurityEnabled?: boolean;
}

export interface BanUserRequest {
  username: string;
  reason?: string;
}

export interface AdminUserActionRequest {
  username: string;
  reason: string;
  durationMinutes?: number;
  note?: string;
  role?: AdminRole | null;
}

export interface AdminNote {
  id: string;
  author: string;
  text: string;
  createdAt: string;
}

export interface AdminUserProfile extends AdminUserSummary {
  notes: AdminNote[];
  warnings: Array<{ reason: string; actor: string; createdAt: string }>;
  games: AdminGameSummary[];
}

export interface AdminActivity {
  id: string;
  timestamp: string;
  category: "auth" | "moderation" | "game" | "analysis" | "server" | "config" | "fair-play";
  action: string;
  actor: string;
  target?: string;
  reason?: string;
  details?: string;
  previousHash?: string;
  integrityHash?: string;
}

export interface AdminGameSummary {
  gameId: string;
  roomId: string;
  mode: GameMode;
  status: "waiting" | "active" | "finished";
  white: string;
  black: string;
  moveCount: number;
  startedAt: string;
  updatedAt: string;
  result: GameResult | null;
  timeControlMs: number;
}

export interface AdminDashboard {
  serverStartedAt: string;
  serverTime: string;
  onlineUsers: string[];
  activeGames: number;
  completedGames: number;
  analysisJobs: number;
  users: AdminUserSummary[];
  games: AdminGameSummary[];
  activity: AdminActivity[];
  fairPlayQueue?: FairPlayReview[];
  config?: AdminSiteConfig;
  charts?: {
    playerGrowth: Array<{ label: string; value: number }>;
    gamesPlayed: Array<{ label: string; value: number }>;
    disconnects: Array<{ label: string; value: number }>;
    popularTimeControls: Array<{ label: string; value: number }>;
  };
}

export interface AdminSiteConfig {
  timeControlsMs: number[];
  computerLevels: ComputerLevel[];
  analysisTimeMs: number;
  analysisTimeoutMs: number;
  announcement: string;
  maintenanceMode: boolean;
  featureFlags: Record<string, boolean>;
}

export interface FairPlayMetrics {
  accuracy: number;
  averageCentipawnLoss: number;
  engineMoveSimilarity: number;
  suspiciousTimingScore: number;
}

export interface FairPlayReview {
  id: string;
  username: string;
  roomId: string;
  createdAt: string;
  createdBy: string;
  reason: string;
  metrics: FairPlayMetrics;
  status: "pending" | "approved" | "rejected";
  decidedAt?: string;
  decidedBy?: string;
  decisionReason?: string;
}

export interface FairPlayReviewRequest {
  gameId?: string;
  roomId?: string;
  username?: string;
  reason: string;
  reviewId?: string;
  decision?: "approved" | "rejected";
}

export interface CredentialsRequest {
  username: string;
  password: string;
}

export interface AdminLoginRequest {
  username: string;
  adminCode?: string;
  password?: string;
  oneTimeCode?: string;
}

export interface AdminSecuritySetupRequest {
  password: string;
  secret: string;
  oneTimeCode: string;
}

export interface AdminSecuritySetup {
  secret: string;
}

export interface RestoreSessionRequest {
  sessionToken: string;
}

export interface AuthResponse {
  user: AuthUser;
  sessionToken: string;
  warnings?: UserWarning[];
}

export type GameResultKind =
  | "checkmate"
  | "resignation"
  | "stalemate"
  | "threefold-repetition"
  | "fifty-move-rule"
  | "insufficient-material"
  | "timeout"
  | "forfeit"
  | "cancelled"
  | "admin-decision"
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
  username?: string;
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
  gameInstanceId: string;
  mode: GameMode;
  computerLevel: ComputerLevel | null;
  timeControl: TimeControl;
  status: "waiting" | "active" | "finished";
  players: RoomPlayer[];
  game: ChessGameState;
  clock: GameClock;
  lastMove: MoveView | null;
  access: GameAccess;
  ratingPool: RatingPool | null;
  startingRatings?: Partial<Record<ChessColor, number>>;
  ratingEstimates?: Partial<Record<ChessColor, { win: number; draw: number; loss: number }>>;
  ratingResult?: RatedGameOutcome;
  tournamentId?: string;
  tournamentRound?: number;
}

export interface CreateHumanRoomRequest {
  access: GameAccess;
  initialTimeMs: number;
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

export interface ResignGameRequest {
  roomId: string;
  playerToken: string;
}

export interface RatingRecord {
  username: string;
  pool: RatingPool;
  rating: number;
  peakRating: number;
  ratedGames: number;
  wins: number;
  draws: number;
  losses: number;
  provisional: boolean;
  currentWinStreak: number;
  bestWinStreak: number;
  lastRatedGameAt?: string;
  lastActivityAt?: string;
}

export interface RatingHistoryEntry {
  id: string;
  gameId: string;
  roomId: string;
  username: string;
  opponent: string;
  pool: RatingPool;
  ratingBefore: number;
  ratingAfter: number;
  ratingChange: number;
  result: "win" | "draw" | "loss";
  resultMethod: GameResultKind;
  timestamp: string;
  tournamentId?: string;
  reversalOf?: string;
}

export interface RatedPlayerOutcome {
  username: string;
  ratingBefore: number;
  ratingAfter: number;
  ratingChange: number;
  opponentRating: number;
}

export interface RatedGameOutcome {
  gameId: string;
  roomId: string;
  pool: RatingPool | null;
  rated: boolean;
  reason?: string;
  white?: RatedPlayerOutcome;
  black?: RatedPlayerOutcome;
}

export interface LeaderboardEntry extends RatingRecord {
  rank: number;
  latestRatingChange: number;
}

export interface LeaderboardRequest {
  pool: RatingPool;
  view?: "season" | "all-time";
  page?: number;
  pageSize?: number;
  search?: string;
}

export interface LeaderboardResponse {
  pool: RatingPool;
  view: "season" | "all-time";
  page: number;
  pageSize: number;
  total: number;
  entries: LeaderboardEntry[];
}

export interface RatingProfileRequest { username?: string; }

export interface PublicRatingProfile {
  username: string;
  ratings: RatingRecord[];
  history: RatingHistoryEntry[];
  leaderboardProgress?: Partial<Record<RatingPool, { qualifyingGames: number; gamesRequired: number }>>;
  tournaments?: TournamentSummary[];
}

export type TournamentState = "draft" | "registration" | "check-in" | "active" | "paused" | "completed" | "cancelled";

export interface TournamentSettings {
  name: string;
  description: string;
  capacity: number;
  rounds: number;
  initialTimeMs: number;
  access: GameAccess;
  registrationOpensAt: string;
  registrationClosesAt: string;
  checkInOpensAt?: string;
  startAt: string;
  roundStartDelayMs: number;
  noShowDeadlineMs: number;
  spectatingAllowed: boolean;
}

export interface TournamentParticipant {
  username: string;
  registeredAt: string;
  checkedIn: boolean;
  score: number;
  buchholz: number;
  wins: number;
  cumulativeScore: number;
  colorHistory: ChessColor[];
  opponentHistory: string[];
  byeReceived: boolean;
  withdrawn: boolean;
  disqualified: boolean;
  finalPlace?: number;
  seed: number;
}

export interface TournamentPairing {
  id: string;
  tournamentId: string;
  round: number;
  white?: string;
  black?: string;
  bye?: string;
  roomId?: string;
  gameId?: string;
  status: "waiting" | "active" | "finished" | "forfeit" | "double-forfeit" | "bye";
  result?: GameResult;
  resultMethod?: GameResultKind;
  startedAt?: string;
  completedAt?: string;
}

export interface TournamentSummary {
  id: string;
  state: TournamentState;
  settings: TournamentSettings;
  playerCount: number;
  currentRound: number;
}

export interface TournamentDetail extends TournamentSummary {
  createdAt: string;
  createdBy: string;
  participants: TournamentParticipant[];
  pairings: TournamentPairing[];
}

export interface TournamentListRequest { tab?: "upcoming" | "live" | "completed" | "mine"; includeDrafts?: boolean; }
export interface TournamentActionRequest {
  tournamentId: string;
  action?: "open-registration" | "begin-check-in" | "start" | "pause" | "resume" | "next-round" | "cancel" | "delete" | "forfeit" | "correct-result" | "disqualify";
  reason?: string;
  username?: string;
  pairingId?: string;
  winner?: ChessColor | null;
  result?: GameResult;
}
export interface TournamentDeleteResponse { deletedTournamentId: string; }
export interface TournamentCreateRequest { settings: TournamentSettings; }
export interface TournamentUpdateRequest { tournamentId: string; settings: TournamentSettings; }

export interface AnalyzeGameRequest {
  roomId: string;
  playerToken: string;
}

export interface AdminGameActionRequest {
  roomId: string;
  reason: string;
  winner?: ChessColor | null;
  username?: string;
}

export interface ServerError {
  message: string;
}
