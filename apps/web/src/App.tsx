import { useEffect, useMemo, useState, type FormEvent } from "react";
import { io, type Socket } from "socket.io-client";
import type { AdminDashboard, AdminGameSummary, AdminLoginRequest, AdminSiteConfig, AdminUserActionRequest, AdminUserProfile, AdminUserSummary, AuthResponse, AuthUser, ChessColor, ComputerLevel, CreateComputerRoomRequest, CreateHumanRoomRequest, CredentialsRequest, GameAnalysis, JoinRoomResponse, MoveAnalysis, MoveRequest, RestartGameRequest, RoomSnapshot, ServerError, TournamentDetail, UserWarning } from "@chessss/shared";
import { LeaderboardView, OwnProfileView } from "./RankingViews";
import { TournamentAdminPanel, TournamentView } from "./TournamentViews";
import { GalaxyBackground } from "./GalaxyBackground";

const STORAGE_KEY = "chessss-player-session";
const AUTH_STORAGE_KEY = "chessss-auth-session";
const glyphs: Record<string, string> = {
  wp: "♙", wn: "♘", wb: "♗", wr: "♖", wq: "♕", wk: "♔",
  bp: "♟", bn: "♞", bb: "♝", br: "♜", bq: "♛", bk: "♚",
};
const computerLevels: Array<{ id: ComputerLevel; title: string; detail: string }> = [
  { id: "beginner", title: "Beginner", detail: "Approx. Elo 250" },
  { id: "medium", title: "Medium", detail: "Approx. Elo 700" },
  { id: "high", title: "High", detail: "Approx. Elo 1400" },
  { id: "hell", title: "Hell", detail: "Approx. Elo 2100" },
  { id: "stockfish", title: "Stockfish", detail: "Full engine strength" },
];
const computerTimeControls = [
  { milliseconds: 60_000, label: "1 minute" },
  { milliseconds: 180_000, label: "3 minutes" },
  { milliseconds: 300_000, label: "5 minutes" },
  { milliseconds: 600_000, label: "10 minutes" },
  { milliseconds: 1_800_000, label: "30 minutes" },
  { milliseconds: 2_700_000, label: "45 minutes" },
];

interface SavedSession { roomId: string; playerToken: string; }
interface SavedAuthSession { sessionToken: string; }
type Ack<T extends object> = T | { error: ServerError };

function hasError<T extends object>(value: Ack<T>): value is { error: ServerError } {
  return "error" in value;
}

function loadSession(): SavedSession | null {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null") as SavedSession | null; } catch { return null; }
}

function saveSession(roomId: string, playerToken: string) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ roomId, playerToken }));
}

function clearSession() {
  localStorage.removeItem(STORAGE_KEY);
}

function loadAuthSession(): SavedAuthSession | null {
  try { return JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? "null") as SavedAuthSession | null; } catch { return null; }
}

function saveAuthSession(sessionToken: string) {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify({ sessionToken }));
}

function clearAuthSession() {
  localStorage.removeItem(AUTH_STORAGE_KEY);
}

function boardFromFen(fen: string): Map<string, string> {
  const board = new Map<string, string>();
  const rows = fen.split(" ")[0].split("/");
  rows.forEach((row, index) => {
    let file = 0;
    for (const symbol of row) {
      if (/\d/.test(symbol)) file += Number(symbol);
      else {
        board.set(`${"abcdefgh"[file]}${8 - index}`, symbol);
        file += 1;
      }
    }
  });
  return board;
}

function colorName(color: ChessColor) { return color === "white" ? "White" : "Black"; }
function computerLabel(level: ComputerLevel | null) { return computerLevels.find((option) => option.id === level)?.title ?? "Computer"; }
function timeControlLabel(milliseconds: number) { return computerTimeControls.find((option) => option.milliseconds === milliseconds)?.label ?? `${Math.round(milliseconds / 60_000)} minutes`; }

export function resultText(room: RoomSnapshot): string | null {
  const result = room.game.result;
  if (!result) return null;
  if (result.kind === "checkmate") return `${colorName(result.winner!)} wins by checkmate.`;
  if (result.kind === "timeout") return `${colorName(result.winner!)} wins on time.`;
  if (result.kind === "resignation") return `${colorName(result.winner!)} wins by resignation.`;
  if (result.kind === "forfeit") return result.winner ? `${colorName(result.winner)} wins by forfeit.` : "Double forfeit.";
  if (result.kind === "cancelled") return "Game cancelled.";
  if (result.kind === "admin-decision" && result.winner) return `${colorName(result.winner)} wins by administrator decision.`;
  return `Draw — ${result.kind.replaceAll("-", " ")}.`;
}

function remainingMilliseconds(room: RoomSnapshot, color: ChessColor, now: number): number {
  const stored = color === "white" ? room.clock.whiteMs : room.clock.blackMs;
  if (room.clock.activeColor !== color || room.clock.turnStartedAt === null) return stored;
  return Math.max(0, stored - (now - room.clock.turnStartedAt));
}

function formatClock(milliseconds: number): string {
  const seconds = Math.ceil(milliseconds / 1_000);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

function pgnResult(room: RoomSnapshot): string {
  if (!room.game.result) return "*";
  if (!room.game.result.winner) return "1/2-1/2";
  return room.game.result.winner === "white" ? "1-0" : "0-1";
}

function pgnFor(room: RoomSnapshot): string {
  const movetext = room.game.moves.map((move, index) => `${index % 2 === 0 ? `${Math.floor(index / 2) + 1}. ` : ""}${move.san}`).join(" ");
  const result = pgnResult(room);
  return `[Event "Chessss game"]\n[Site "LAN"]\n[Result "${result}"]\n\n${movetext}${movetext ? " " : ""}${result}\n`;
}

function evaluationText(scoreCp: number): string {
  const score = (scoreCp / 100).toFixed(1);
  return `${scoreCp > 0 ? "+" : ""}${score}`;
}

function labelText(label: MoveAnalysis["label"]): string {
  return label[0].toUpperCase() + label.slice(1);
}

export function App() {
  const [socket, setSocket] = useState<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  const [authChecked, setAuthChecked] = useState(false);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [authMode, setAuthMode] = useState<"signin" | "signup" | "admin">("signin");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [adminOtp, setAdminOtp] = useState("");
  const [room, setRoom] = useState<RoomSnapshot | null>(null);
  const [playerToken, setPlayerToken] = useState<string | null>(null);
  const [playerColor, setPlayerColor] = useState<ChessColor | null>(null);
  const [roomInput, setRoomInput] = useState("");
  const [lobbyMode, setLobbyMode] = useState<"choose" | "human" | "computer" | "computer-time">("choose");
  const [selectedComputerLevel, setSelectedComputerLevel] = useState<ComputerLevel | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pendingPromotion, setPendingPromotion] = useState<{ from: string; to: string } | null>(null);
  const [notice, setNotice] = useState("Create a room or join a friend with their room code.");
  const [clockNow, setClockNow] = useState(() => Date.now());
  const [replayIndex, setReplayIndex] = useState<number | null>(null);
  const [analysis, setAnalysis] = useState<GameAnalysis | null>(null);
  const [analyzing, setAnalyzing] = useState(false);
  const [adminUsers, setAdminUsers] = useState<AdminUserSummary[]>([]);
  const [adminDashboard, setAdminDashboard] = useState<AdminDashboard | null>(null);
  const [adminSearch, setAdminSearch] = useState("");
  const [adminProfile, setAdminProfile] = useState<AdminUserProfile | null>(null);
  const [spectatedRoom, setSpectatedRoom] = useState<RoomSnapshot | null>(null);
  const [spectatedGameId, setSpectatedGameId] = useState<string | null>(null);
  const [adminGameAnalysis, setAdminGameAnalysis] = useState<GameAnalysis | null>(null);
  const [siteConfig, setSiteConfig] = useState<AdminSiteConfig | null>(null);
  const [adminCommand, setAdminCommand] = useState("");
  const [accountWarnings, setAccountWarnings] = useState<UserWarning[]>([]);
  const [playerView, setPlayerView] = useState<"play" | "leaderboards" | "tournaments" | "profile">("play");
  const [humanAccess, setHumanAccess] = useState<CreateHumanRoomRequest["access"]>("rated");
  const [matchmaking, setMatchmaking] = useState<CreateHumanRoomRequest | null>(null);

  useEffect(() => {
    const serverUrl = import.meta.env.VITE_SERVER_URL ?? `${window.location.protocol}//${window.location.hostname}:3001`;
    const client = io(serverUrl);
    let moderatedByAdmin = false;
    client.on("connect", () => {
      moderatedByAdmin = false;
      setConnected(true);
      const rejoinRoom = () => {
        const saved = loadSession();
        if (!saved) return;
        client.emit("room:join", saved, (response: Ack<JoinRoomResponse>) => {
          if (hasError(response)) return;
          setRoom(response.room);
          setPlayerToken(response.playerToken);
          setPlayerColor(response.playerColor);
          setNotice(`Rejoined room ${response.room.id} as ${colorName(response.playerColor)}.`);
        });
      };
      const savedAuth = loadAuthSession();
      if (!savedAuth) {
        setAuthChecked(true);
        return;
      }
      client.emit("auth:restore", savedAuth, (response: Ack<AuthResponse>) => {
        if (!hasError(response)) {
          setUser(response.user);
          setAccountWarnings(response.warnings ?? []);
          rejoinRoom();
        } else {
          clearAuthSession();
          clearSession();
          setUser(null);
          setRoom(null);
          setPlayerToken(null);
          setPlayerColor(null);
        }
        setAuthChecked(true);
      });
    });
    client.on("disconnect", () => {
      setConnected(false);
      setAnalyzing(false);
      setMatchmaking(null);
      if (!moderatedByAdmin) setNotice("Server disconnected. Reconnect and try again.");
    });
    client.on("admin:banned", () => {
      moderatedByAdmin = true;
      clearAuthSession();
      clearSession();
      setUser(null);
      setRoom(null);
      setPlayerToken(null);
      setPlayerColor(null);
      setAccountWarnings([]);
      setNotice("This account has been banned.");
    });
    const forcedExit = (message: string) => {
      moderatedByAdmin = true;
      clearAuthSession();
      clearSession();
      setUser(null);
      setRoom(null);
      setPlayerToken(null);
      setPlayerColor(null);
      setAccountWarnings([]);
      setNotice(message);
    };
    client.on("admin:suspended", () => forcedExit("This account has been temporarily suspended."));
    client.on("admin:signed-out", () => forcedExit("An administrator signed this account out."));
    client.on("admin:warning", (warning: UserWarning) => {
      setAccountWarnings((current) => [...current, warning]);
      setNotice(`Warning from ${warning.actor}: ${warning.reason}`);
    });
    client.on("admin:dashboard", (next: AdminDashboard) => {
      setAdminDashboard(next);
      setAdminUsers(next.users);
    });
    client.on("site:config", (next: AdminSiteConfig) => setSiteConfig(next));
    client.on("room:state", (next: RoomSnapshot) => {
      setRoom((current) => current?.id === next.id ? next : current);
      setSpectatedRoom((current) => current?.gameInstanceId === next.gameInstanceId ? next : current);
    });
    client.on("room:reconnected", (response: JoinRoomResponse) => {
      saveSession(response.room.id, response.playerToken);
      setRoom(response.room);
      setPlayerToken(response.playerToken);
      setPlayerColor(response.playerColor);
      setSelected(null);
      setPendingPromotion(null);
      setNotice(`An administrator reconnected you to room ${response.room.id} as ${colorName(response.playerColor)}.`);
    });
    client.on("matchmaking:matched", (response: JoinRoomResponse) => {
      setMatchmaking(null);
      acceptJoin(response);
      const opponent = response.room.players.find((player) => player.color !== response.playerColor)?.username ?? "your opponent";
      setNotice(`Matched with ${opponent}. You are ${colorName(response.playerColor)}.`);
    });
    setSocket(client);
    return () => { client.close(); };
  }, []);

  useEffect(() => {
    if (!socket || !connected || !user?.isAdmin) {
      setAdminDashboard(null);
      return setAdminUsers([]);
    }
    socket.emit("admin:users", (response: Ack<AdminUserSummary[]>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setAdminUsers(response);
    });
    socket.emit("admin:dashboard:get", (response: Ack<AdminDashboard>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setAdminDashboard(response);
    });
  }, [socket, user, connected]);

  useEffect(() => {
    if (!socket || !user || user.isAdmin) return;
    const tournamentUpdate = (tournament: TournamentDetail) => {
      const assigned = tournament.pairings.find((pairing) => pairing.round === tournament.currentRound && pairing.roomId && [pairing.white, pairing.black].some((name) => name?.toLowerCase() === user.username.toLowerCase()) && ["waiting", "active"].includes(pairing.status));
      if (assigned) setNotice(`${tournament.settings.name}: Round ${tournament.currentRound} is ready. Open Tournaments to join your assigned game.`);
    };
    socket.on("tournament:updated", tournamentUpdate);
    return () => { socket.off("tournament:updated", tournamentUpdate); };
  }, [socket, user]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 100);
    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    setReplayIndex(null);
    setAnalysis(null);
  }, [room?.id, room?.game.moves.length]);

  const replayPosition = room && replayIndex !== null ? room.game.positionHistory[replayIndex] : undefined;
  const pieces = useMemo(() => room ? boardFromFen(replayPosition ?? room.game.fen) : new Map<string, string>(), [room, replayPosition]);
  const spectatorPieces = useMemo(() => spectatedRoom ? boardFromFen(spectatedRoom.game.fen) : new Map<string, string>(), [spectatedRoom]);
  const isYourTurn = Boolean(room && replayIndex === null && playerColor && room.status === "active" && room.game.turn === playerColor);

  function acceptJoin(response: JoinRoomResponse) {
    setMatchmaking(null);
    saveSession(response.room.id, response.playerToken);
    setRoom(response.room);
    setPlayerToken(response.playerToken);
    setPlayerColor(response.playerColor);
    setSelected(null);
    setPendingPromotion(null);
    setNotice(response.room.mode === "computer"
      ? `You are White. ${computerLabel(response.room.computerLevel)} plays Black.`
      : `You are ${colorName(response.playerColor)}. Share the code with your opponent.`);
  }

  function createRoom(initialTimeMs: number) {
    if (!socket || !connected) return setNotice("Connecting to the game server…");
    socket.emit("room:create", { access: humanAccess, initialTimeMs }, (response: Ack<JoinRoomResponse>) => {
      if (hasError(response)) return setNotice(response.error.message);
      acceptJoin(response);
    });
  }

  function findMatch(initialTimeMs: number) {
    if (!socket || !connected) return setNotice("Connecting to the game server…");
    const request: CreateHumanRoomRequest = { access: humanAccess, initialTimeMs };
    socket.emit("matchmaking:join", request, (response: Ack<{ status: "queued" | "matched"; access: CreateHumanRoomRequest["access"]; initialTimeMs: number }>) => {
      if (hasError(response)) return setNotice(response.error.message);
      if (response.status === "queued") { setMatchmaking(request); setNotice(`Searching for a ${humanAccess} opponent at ${timeControlLabel(initialTimeMs)}…`); }
    });
  }

  function cancelMatchmaking() {
    if (!socket) return;
    socket.emit("matchmaking:cancel", () => undefined);
    setMatchmaking(null);
    setNotice("Matchmaking cancelled.");
  }

  function resignGame() {
    if (!socket || !room || !playerToken || room.status === "finished" || !window.confirm("Resign this game?")) return;
    socket.emit("game:resign", { roomId: room.id, playerToken }, (response: Ack<{ room: RoomSnapshot }>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setRoom(response.room);
    });
  }

  function submitAuth(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!socket || !connected) return setNotice("Connecting to the game server…");
    const eventName = authMode === "admin" ? "auth:admin-signin" : `auth:${authMode}`;
    const request: CredentialsRequest | AdminLoginRequest = authMode === "admin"
      ? { username, adminCode: password, password, oneTimeCode: adminOtp }
      : { username, password };
    socket.emit(eventName, request, (response: Ack<AuthResponse>) => {
      if (hasError(response)) return setNotice(response.error.message);
      saveAuthSession(response.sessionToken);
      setUser(response.user);
      setAccountWarnings(response.warnings ?? []);
      setPassword("");
      setAdminOtp("");
      setNotice(`${response.user.isAdmin ? "Administrator" : "Player"} ${response.user.username} signed in.`);
    });
  }

  function chooseAuthMode(mode: "signin" | "signup" | "admin") {
    setAuthMode(mode);
    setPassword("");
    setNotice(mode === "admin" ? "Enter an administrator username and code." : "Sign in or create a player account.");
  }

  function signOut() {
    const saved = loadAuthSession();
    if (room && playerToken && socket) socket.emit("room:leave", { roomId: room.id, playerToken }, () => undefined);
    if (matchmaking && socket) socket.emit("matchmaking:cancel", () => undefined);
    if (saved && socket) socket.emit("auth:signout", saved, () => undefined);
    clearAuthSession();
    clearSession();
    setUser(null);
    setRoom(null);
    setPlayerToken(null);
    setPlayerColor(null);
    setAccountWarnings([]);
    setMatchmaking(null);
    setLobbyMode("choose");
    setPlayerView("play");
    setAdminUsers([]);
    setNotice("Sign in to start a game.");
  }

  function banUser(usernameToBan: string) {
    if (!socket || !connected || !user?.isAdmin) return setNotice("The server is not connected. Please try again in a moment.");
    const reason = window.prompt(`Reason for permanently banning ${usernameToBan}:`)?.trim();
    if (!reason || !window.confirm(`Permanently ban ${usernameToBan}? They will be signed out immediately.`)) return;
    setNotice(`Banning ${usernameToBan}…`);
    socket.timeout(10_000).emit("admin:ban", { username: usernameToBan, reason }, (timeoutError: Error | null, response: Ack<AdminUserSummary[]>) => {
      if (timeoutError) return setNotice(`Could not ban ${usernameToBan}: the server did not respond.`);
      if (hasError(response)) return setNotice(response.error.message);
      setAdminUsers(response);
      setNotice(`${usernameToBan} has been banned.`);
    });
  }

  function unbanUser(usernameToUnban: string) {
    if (!socket || !connected || !user?.isAdmin) return setNotice("The server is not connected. Please try again in a moment.");
    const reason = window.prompt(`Reason for unbanning ${usernameToUnban}:`)?.trim();
    if (!reason) return;
    setNotice(`Unbanning ${usernameToUnban}…`);
    socket.timeout(10_000).emit("admin:unban", { username: usernameToUnban, reason }, (timeoutError: Error | null, response: Ack<AdminUserSummary[]>) => {
      if (timeoutError) return setNotice(`Could not unban ${usernameToUnban}: the server did not respond.`);
      if (hasError(response)) return setNotice(response.error.message);
      setAdminUsers(response);
      setNotice(`${usernameToUnban} can sign in again.`);
    });
  }

  function adminUserAction(eventName: "admin:user:warn" | "admin:user:suspend" | "admin:user:signout", usernameToManage: string) {
    if (!socket || !connected || !user?.isAdmin) return;
    const reason = window.prompt(`Reason for this action on ${usernameToManage}:`)?.trim();
    if (!reason) return;
    const request: AdminUserActionRequest = { username: usernameToManage, reason };
    if (eventName === "admin:user:suspend") {
      const minutes = Number(window.prompt("Suspension length in minutes (maximum 43200):", "60"));
      if (!Number.isFinite(minutes) || minutes < 1) return setNotice("Enter a valid suspension length.");
      request.durationMinutes = minutes;
    }
    socket.timeout(10_000).emit(eventName, request, (timeoutError: Error | null, response: Ack<AdminUserSummary[]>) => {
      if (timeoutError) return setNotice("The moderation request timed out.");
      if (hasError(response)) return setNotice(response.error.message);
      setAdminUsers(response);
      setNotice(eventName === "admin:user:warn" ? `Warning sent to ${usernameToManage}.` : eventName === "admin:user:suspend" ? `${usernameToManage} was suspended.` : `${usernameToManage} was signed out.`);
    });
  }

  function openAdminProfile(usernameToInspect: string) {
    if (!socket || !user?.isAdmin) return;
    socket.emit("admin:user:profile", { username: usernameToInspect }, (response: Ack<AdminUserProfile>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setAdminProfile(response);
    });
  }

  function addAdminNote(usernameToManage: string) {
    if (!socket || !user?.isAdmin) return;
    const note = window.prompt(`Private administrator note for ${usernameToManage}:`)?.trim();
    if (!note) return;
    const request: AdminUserActionRequest = { username: usernameToManage, reason: "Administrator note", note };
    socket.emit("admin:user:note", request, (response: Ack<AdminUserProfile>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setAdminProfile(response);
      setNotice("Private note saved.");
    });
  }

  function changeAdminRole(usernameToManage: string, role: "admin" | "moderator" | "analyst" | null) {
    if (!socket || user?.role !== "owner") return;
    const reason = window.prompt(`Reason for changing ${usernameToManage} to ${role ?? "player"}:`)?.trim();
    if (!reason) return;
    socket.emit("admin:user:role", { username: usernameToManage, role, reason }, (response: Ack<AdminUserSummary[]>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setAdminUsers(response);
      setAdminProfile(null);
      setNotice(`${usernameToManage}'s role was changed to ${role ?? "player"}.`);
    });
  }

  function spectateGame(game: AdminGameSummary | string) {
    if (!socket || !user?.isAdmin) return;
    const roomId = typeof game === "string" ? game : game.roomId;
    const gameId = typeof game === "string" ? undefined : game.gameId;
    socket.emit("admin:game:spectate", { roomId, gameId }, (response: Ack<{ room: RoomSnapshot }>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setSpectatedRoom(response.room);
      setSpectatedGameId(gameId ?? response.room.gameInstanceId);
      setAdminGameAnalysis(null);
    });
  }

  function superviseGame(action: "cancel" | "result" | "reconnect", winner?: ChessColor | null) {
    if (!socket || !spectatedRoom || !user?.isAdmin) return;
    const reason = window.prompt("Reason for this game intervention:")?.trim();
    if (!reason) return;
    if ((action === "cancel" || action === "result") && !window.confirm("Confirm this permanent change to the recorded game result?")) return;
    const request: { roomId: string; reason: string; winner?: ChessColor | null; username?: string } = { roomId: spectatedRoom.id, reason };
    if (action === "result") request.winner = winner ?? null;
    if (action === "reconnect") {
      const usernameToReconnect = window.prompt("Username to reconnect:")?.trim();
      if (!usernameToReconnect) return;
      request.username = usernameToReconnect;
    }
    socket.emit(`admin:game:${action}`, request, (response: Ack<{ room: RoomSnapshot }>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setSpectatedRoom(response.room);
      setNotice(`Game ${response.room.id} was updated.`);
    });
  }

  function analyzeSpectatedGame() {
    if (!socket || !spectatedRoom) return;
    setNotice(`Analyzing room ${spectatedRoom.id}…`);
    socket.timeout(60_000).emit("admin:game:analyze", { roomId: spectatedRoom.id, gameId: spectatedGameId ?? undefined }, (timeoutError: Error | null, response: Ack<GameAnalysis>) => {
      if (timeoutError) return setNotice("Admin analysis timed out.");
      if (hasError(response)) return setNotice(response.error.message);
      setAdminGameAnalysis(response);
      setNotice(`Analysis ready for room ${spectatedRoom.id}.`);
    });
  }

  function downloadAdminPgn() {
    if (!spectatedRoom) return;
    const url = URL.createObjectURL(new Blob([pgnFor(spectatedRoom)], { type: "application/x-chess-pgn;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `chessss-admin-${spectatedRoom.id}.pgn`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function createFairPlayReview() {
    if (!socket || !spectatedRoom) return;
    const usernameToReview = window.prompt("Player username to add to fair-play review:")?.trim();
    const reason = usernameToReview ? window.prompt("Reason for the fair-play review:")?.trim() : "";
    if (!usernameToReview || !reason) return;
    socket.timeout(60_000).emit("admin:fairplay:create", { roomId: spectatedRoom.id, gameId: spectatedGameId ?? undefined, username: usernameToReview, reason }, (timeoutError: Error | null, response: Ack<{ id: string }>) => {
      if (timeoutError) return setNotice("Fair-play analysis timed out.");
      if (hasError(response)) return setNotice(response.error.message);
      setNotice(`${usernameToReview} was added to the human review queue.`);
    });
  }

  function decideFairPlay(reviewId: string, decision: "approved" | "rejected") {
    if (!socket) return;
    const reason = window.prompt(`Reason for marking this report ${decision}:`)?.trim();
    if (!reason) return;
    socket.emit("admin:fairplay:decide", { reviewId, decision, reason }, (response: Ack<{ id: string }>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setNotice(`Fair-play report ${decision}. No account action was taken automatically.`);
    });
  }

  function runAdminCommand() {
    const command = adminCommand.trim();
    const find = command.match(/^find user\s+(.+)$/i);
    const spectate = command.match(/^spectate(?: room)?\s+([a-z0-9]+)$/i);
    if (find) setAdminSearch(find[1]!);
    else if (spectate) spectateGame(spectate[1]!.toUpperCase());
    else if (/^show server errors$/i.test(command)) {
      const latest = adminDashboard?.activity.find((entry) => entry.category === "server");
      setNotice(latest ? `${latest.action}: ${latest.details ?? "No details"}` : "No server errors are recorded.");
    } else setNotice("Commands: Find user NAME · Spectate room CODE · Show server errors");
    setAdminCommand("");
  }

  function joinRoom() {
    if (!socket || !connected) return setNotice("Connecting to the game server…");
    const roomId = roomInput.trim().toUpperCase();
    if (!roomId) return setNotice("Enter a room code first.");
    socket.emit("room:join", { roomId }, (response: Ack<JoinRoomResponse>) => {
      if (hasError(response)) return setNotice(response.error.message);
      acceptJoin(response);
    });
  }

  function createComputerRoom(level: ComputerLevel, initialTimeMs: number) {
    if (!socket || !connected) return setNotice("Connecting to the game server…");
    const request: CreateComputerRoomRequest = { level, initialTimeMs };
    socket.emit("computer:create", request, (response: Ack<JoinRoomResponse>) => {
      if (hasError(response)) return setNotice(response.error.message);
      acceptJoin(response);
    });
  }

  function submitMove(from: string, to: string, promotion?: "q" | "r" | "b" | "n") {
    if (!room || !playerToken || !socket) return;
    const request: MoveRequest = { roomId: room.id, playerToken, from, to, promotion };
    socket.emit("game:move", request, (response: Ack<{ room: RoomSnapshot }>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setRoom(response.room);
      setSelected(null);
      setPendingPromotion(null);
    });
  }

  function restartGame() {
    if (!room || !playerToken || !socket) return;
    const request: RestartGameRequest = { roomId: room.id, playerToken };
    socket.emit("game:restart", request, (response: Ack<{ room: RoomSnapshot }>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setRoom(response.room);
      setSelected(null);
      setNotice("A new game has started. White to move.");
    });
  }

  function returnToHome() {
    const reset = () => {
      clearSession();
      setRoom(null);
      setPlayerToken(null);
      setPlayerColor(null);
      setSelected(null);
      setPendingPromotion(null);
      setLobbyMode("choose");
      setNotice("Choose how you want to play your next game.");
    };
    if (!room || !playerToken || !socket) return reset();
    socket.emit("room:leave", { roomId: room.id, playerToken }, () => undefined);
    reset();
  }

  function downloadPgn() {
    if (!room) return;
    const url = URL.createObjectURL(new Blob([pgnFor(room)], { type: "application/x-chess-pgn;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `chessss-${room.id}.pgn`;
    link.click();
    URL.revokeObjectURL(url);
  }

  function analyzeGame() {
    if (!room || !playerToken || !socket || room.status !== "finished") return;
    setAnalyzing(true);
    setNotice("Analyzing every move with Stockfish…");
    socket.timeout(siteConfig?.analysisTimeoutMs ?? 60_000).emit("game:analyze", { roomId: room.id, playerToken }, (timeoutError: Error | null, response: Ack<GameAnalysis>) => {
      setAnalyzing(false);
      if (timeoutError) return setNotice("Analysis timed out. Please try again.");
      if (hasError(response)) return setNotice(response.error.message);
      setAnalysis(response);
      setNotice("Analysis complete. Labels and evaluations are shown beside each move.");
    });
  }

  function saveSiteConfig() {
    if (!socket || !siteConfig) return;
    socket.emit("admin:config:update", siteConfig, (response: Ack<AdminSiteConfig>) => {
      if (hasError(response)) return setNotice(response.error.message);
      setSiteConfig(response);
      setNotice("Website configuration saved and broadcast live.");
    });
  }

  function enableAdminTwoFactor() {
    if (!socket) return;
    socket.emit("admin:security:begin", (begin: Ack<{ secret: string }>) => {
      if (hasError(begin)) return setNotice(begin.error.message);
      window.alert(`Add this manual setup key to your authenticator app:\n\n${begin.secret}\n\nThen continue to set your individual admin password.`);
      const newPassword = window.prompt("Choose an individual administrator password (8–128 characters):") ?? "";
      const oneTimeCode = newPassword ? window.prompt("Enter the current 6-digit authenticator code:") ?? "" : "";
      if (!newPassword || !oneTimeCode) return;
      socket.emit("admin:security:complete", { password: newPassword, secret: begin.secret, oneTimeCode }, (response: Ack<AuthResponse>) => {
        if (hasError(response)) return setNotice(response.error.message);
        saveAuthSession(response.sessionToken);
        setUser(response.user);
        setNotice("Individual admin password and two-factor authentication enabled.");
      });
    });
  }

  function selectSquare(square: string) {
    if (!room || !playerColor || !playerToken || !socket) return;
    const piece = pieces.get(square);
    const isOwnPiece = piece && (piece === piece.toUpperCase() ? playerColor === "white" : playerColor === "black");
    if (!selected) {
      if (isYourTurn && isOwnPiece) setSelected(square);
      return;
    }
    if (square === selected) return setSelected(null);
    if (isYourTurn && isOwnPiece) return setSelected(square);
    if (isYourTurn) {
      const movingPiece = pieces.get(selected);
      if (movingPiece?.toLowerCase() === "p" && (square.endsWith("1") || square.endsWith("8"))) {
        setPendingPromotion({ from: selected, to: square });
        setSelected(null);
      } else submitMove(selected, square);
    }
  }

  const ranks = playerColor === "black" ? [1, 2, 3, 4, 5, 6, 7, 8] : [8, 7, 6, 5, 4, 3, 2, 1];
  const files = playerColor === "black" ? ["h", "g", "f", "e", "d", "c", "b", "a"] : ["a", "b", "c", "d", "e", "f", "g", "h"];
  const canModerate = user?.role === "owner" || user?.role === "admin" || user?.role === "moderator";
  const canAdminister = user?.role === "owner" || user?.role === "admin";

  return (
    <main className={!user ? "auth-shell" : undefined}>
      {!user && <GalaxyBackground />}
      <header>
        <p className="eyebrow">LAN MULTIPLAYER</p>
        <h1>Chessss</h1>
        {user && !user.isAdmin && <nav className="player-nav">{(["play", "leaderboards", "tournaments", "profile"] as const).map((view) => <button className={playerView === view ? "active" : ""} onClick={() => { setPlayerView(view); setLobbyMode("choose"); }} key={view}>{view}</button>)}</nav>}
        {user && <span className="account">{user.username}{user.isAdmin && <small>ADMIN</small>} <button onClick={signOut}>Sign out</button></span>}
        <span className={`connection ${connected ? "online" : ""}`}>{connected ? "Server connected" : "Connecting…"}</span>
      </header>
      {siteConfig?.announcement && <div className="site-announcement">{siteConfig.announcement}</div>}
      {siteConfig?.maintenanceMode && <div className="maintenance-banner">Maintenance mode is active. Administrators can still access the control center.</div>}

      {!authChecked ? <section className="lobby card"><p>Restoring your session…</p></section> : !user ? (
        <section className="lobby card auth-card">
          <p className="eyebrow">{authMode === "admin" ? "ADMINISTRATION" : "ACCOUNT"}</p>
          <h2>{authMode === "admin" ? "Admin login" : authMode === "signin" ? "Welcome back" : "Create your account"}</h2>
          <p>{authMode === "admin" ? "Use your administrator username and private admin code." : authMode === "signin" ? "Sign in to create or join a chess game." : "Register with a username and password to start playing."}</p>
          <form onSubmit={submitAuth}>
            <label htmlFor="username">Username</label>
            <input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" minLength={3} maxLength={24} pattern="[A-Za-z0-9_]+" required />
            <label htmlFor="password">{authMode === "admin" ? "Admin password" : "Password"}</label>
            <input id="password" type="password" value={password} onChange={(event) => setPassword(event.target.value)} autoComplete={authMode === "admin" ? "off" : authMode === "signin" ? "current-password" : "new-password"} minLength={authMode === "admin" ? 1 : 8} maxLength={128} required />
            {authMode === "admin" && <><label htmlFor="admin-otp">Authenticator code</label><input id="admin-otp" inputMode="numeric" pattern="[0-9]{6}" maxLength={6} value={adminOtp} onChange={(event) => setAdminOtp(event.target.value.replace(/\D/g, ""))} placeholder="Required after 2FA setup" /></>}
            <button className="primary" type="submit">{authMode === "admin" ? "Enter admin portal" : authMode === "signin" ? "Sign in" : "Sign up"}</button>
          </form>
          <div className="auth-options">
            {authMode === "admin" ? <button className="auth-switch" onClick={() => chooseAuthMode("signin")}>← Player login</button> : <>
              <button className="auth-switch" onClick={() => chooseAuthMode(authMode === "signin" ? "signup" : "signin")}>{authMode === "signin" ? "Need an account? Sign up" : "Already have an account? Sign in"}</button>
              <button className="auth-switch admin-login" onClick={() => chooseAuthMode("admin")}>Admin login</button>
            </>}
          </div>
          <p className="notice">{notice}</p>
        </section>
      ) : !room ? (
        user.isAdmin ? (
          <section className="admin-console card">
            <div className="admin-title"><div><p className="eyebrow">CONTROL CENTER</p><h2>Live administration</h2></div><div className="admin-tools"><span className="notification-badge">{(adminDashboard?.fairPlayQueue?.filter((review) => review.status === "pending").length ?? 0) + (adminDashboard?.activity.filter((entry) => entry.category === "server").length ?? 0)} alerts</span><span className="role-badge">{user.role ?? "admin"}</span></div></div>
            {!adminUsers.find((account) => account.username.toLowerCase() === user.username.toLowerCase())?.adminSecurityEnabled && <div className="security-warning"><strong>Security setup required.</strong> The bootstrap code can still access this unconfigured owner account. Use “Set individual password + 2FA” below to replace it with your own secure login.</div>}
            <p className="admin-notice" role="status">{notice}</p>
            <div className="command-palette"><input aria-label="Admin command" value={adminCommand} onChange={(event) => setAdminCommand(event.target.value)} onKeyDown={(event) => event.key === "Enter" && runAdminCommand()} placeholder="Command: Find user NAME, Spectate room CODE, Show server errors" /><button onClick={runAdminCommand}>Run</button></div>
            <div className="admin-stats">
              <article><strong className="health-pulse">Healthy</strong><span>Server · since {adminDashboard ? new Date(adminDashboard.serverStartedAt).toLocaleTimeString() : "…"}</span></article>
              <article><strong>{adminDashboard?.onlineUsers.length ?? 0}</strong><span>Online users</span></article>
              <article><strong>{adminDashboard?.activeGames ?? 0}</strong><span>Active games</span></article>
              <article><strong>{adminDashboard?.completedGames ?? 0}</strong><span>Completed games</span></article>
              <article><strong>{adminDashboard?.analysisJobs ?? 0}</strong><span>Analysis jobs</span></article>
            </div>
            <div className="admin-columns">
              <section className="admin-section">
                <div className="section-heading"><h3>Users</h3><input aria-label="Search users" placeholder="Search users…" value={adminSearch} onChange={(event) => setAdminSearch(event.target.value)} /></div>
                <div className="admin-users expanded">
                  {adminUsers.filter((account) => account.username.toLowerCase().includes(adminSearch.toLowerCase())).map((account) => <div className="admin-user detailed" key={account.username}>
                    <button className="user-name" onClick={() => openAdminProfile(account.username)}><strong>{account.username}</strong><small>{account.role ?? (account.online ? "online" : "player")}{account.warningCount ? ` · ${account.warningCount} warning${account.warningCount === 1 ? "" : "s"}` : ""}{account.suspendedUntil ? " · suspended" : ""}{account.banned ? " · banned" : ""}</small></button>
                    <div className="admin-actions">
                      {account.isAdmin && (user.role !== "owner" || account.role === "owner") ? <small>Protected</small> : !canModerate ? <small>Read only</small> : account.banned ? <button className="unban" onClick={() => unbanUser(account.username)}>Unban</button> : <>
                        <button onClick={() => adminUserAction("admin:user:warn", account.username)}>Warn</button>
                        <button onClick={() => adminUserAction("admin:user:suspend", account.username)}>Suspend</button>
                        {canAdminister && <button onClick={() => adminUserAction("admin:user:signout", account.username)}>Sign out</button>}
                        <button className="danger" onClick={() => banUser(account.username)}>Ban</button>
                      </>}
                    </div>
                  </div>)}
                </div>
              </section>
              <section className="admin-section">
                <h3>Live games</h3>
                <div className="admin-games">{adminDashboard?.games.length ? adminDashboard.games.map((game, index) => <article key={`${game.gameId}:${game.updatedAt}:${index}`}>
                  <div><strong>{game.roomId}</strong><small>{game.white} vs {game.black}</small></div><span className={`status ${game.status}`}>{game.status}</span><small>{game.moveCount} moves · {timeControlLabel(game.timeControlMs)}</small><button onClick={() => spectateGame(game)}>Spectate</button>
                </article>) : <p>No games have been created since the server started.</p>}</div>
              </section>
              {(user.role === "owner" || user.role === "admin" || user.role === "moderator") && socket && <TournamentAdminPanel socket={socket} username={user.username} onNotice={setNotice} enabledTimeControls={siteConfig?.timeControlsMs ?? computerTimeControls.map((control) => control.milliseconds)} />}
              {siteConfig && (user.role === "owner" || user.role === "admin") && <section className="admin-section activity-section config-panel">
                <h3>Website controls</h3>
                <label>Site-wide announcement<input value={siteConfig.announcement} onChange={(event) => setSiteConfig({ ...siteConfig, announcement: event.target.value })} placeholder="Leave blank for no announcement" /></label>
                <div className="config-grid"><label>Time controls (seconds)<input value={siteConfig.timeControlsMs.map((value) => value / 1000).join(", ")} onChange={(event) => setSiteConfig({ ...siteConfig, timeControlsMs: event.target.value.split(",").map((value) => Number(value.trim()) * 1000).filter(Number.isFinite) })} /></label>
                  <label>Analysis ms per position<input type="number" min="25" max="5000" value={siteConfig.analysisTimeMs} onChange={(event) => setSiteConfig({ ...siteConfig, analysisTimeMs: Number(event.target.value) })} /></label>
                  <label>Analysis timeout seconds<input type="number" min="5" max="300" value={siteConfig.analysisTimeoutMs / 1000} onChange={(event) => setSiteConfig({ ...siteConfig, analysisTimeoutMs: Number(event.target.value) * 1000 })} /></label>
                </div>
                <div className="config-switches"><label><input type="checkbox" checked={siteConfig.maintenanceMode} onChange={(event) => setSiteConfig({ ...siteConfig, maintenanceMode: event.target.checked })} /> Maintenance mode</label>{Object.entries(siteConfig.featureFlags).map(([flag, enabled]) => <label key={flag}><input type="checkbox" checked={enabled} onChange={(event) => setSiteConfig({ ...siteConfig, featureFlags: { ...siteConfig.featureFlags, [flag]: event.target.checked } })} /> {flag}</label>)}</div>
                <div className="config-switches"><strong>Computer levels:</strong>{computerLevels.map((level) => <label key={level.id}><input type="checkbox" checked={siteConfig.computerLevels.includes(level.id)} onChange={(event) => setSiteConfig({ ...siteConfig, computerLevels: event.target.checked ? [...siteConfig.computerLevels, level.id] : siteConfig.computerLevels.filter((value) => value !== level.id) })} /> {level.title}</label>)}</div>
                <div className="config-buttons"><button onClick={saveSiteConfig}>Save website controls</button><button onClick={enableAdminTwoFactor}>Set individual password + 2FA</button></div>
              </section>}
              <section className="admin-section activity-section"><h3>Notification center</h3><div className="notifications">
                {adminDashboard?.fairPlayQueue?.filter((review) => review.status === "pending").map((review) => <article key={review.id}><strong>Fair-play review</strong><span>{review.username} · room {review.roomId}</span></article>)}
                {adminDashboard?.activity.filter((entry) => entry.action === "repeated-short-resignations-flagged").slice(0, 10).map((entry) => <article key={entry.id}><strong>Short resignations flagged</strong><span>{entry.target} · manual review only</span></article>)}
                {adminDashboard?.activity.filter((entry) => entry.category === "server").slice(0, 10).map((entry) => <article key={entry.id}><strong>Server problem</strong><span>{entry.action} · {entry.details}</span></article>)}
                {!(adminDashboard?.fairPlayQueue?.some((review) => review.status === "pending") || adminDashboard?.activity.some((entry) => entry.category === "server")) && <p>No unresolved reports or server problems.</p>}
              </div></section>
              <section className="admin-section activity-section">
                <h3>Activity feed</h3>
                <div className="activity-feed">{adminDashboard?.activity.length ? adminDashboard.activity.map((entry) => <article key={entry.id}>
                  <time>{new Date(entry.timestamp).toLocaleTimeString()}</time><div><strong>{entry.action}</strong><span>{entry.actor}{entry.target ? ` → ${entry.target}` : ""}</span>{entry.reason && <small>{entry.reason}</small>}</div>
                </article>) : <p>No activity recorded yet.</p>}</div>
              </section>
              <section className="admin-section activity-section">
                <h3>Fair-play review queue</h3>
                <div className="review-queue">{adminDashboard?.fairPlayQueue?.length ? adminDashboard.fairPlayQueue.map((review) => <article key={review.id}>
                  <div><strong>{review.username}</strong><span>Room {review.roomId} · {review.status}</span><small>{review.reason}</small></div>
                  <div className="review-metrics"><span>{review.metrics.accuracy}% accuracy</span><span>{review.metrics.averageCentipawnLoss} ACPL</span><span>{review.metrics.engineMoveSimilarity}% best-move similarity</span><span>{review.metrics.suspiciousTimingScore}% timing signal</span></div>
                  {review.status === "pending" && user.role !== "analyst" && <div className="review-decisions"><button onClick={() => decideFairPlay(review.id, "approved")}>Approve report</button><button onClick={() => decideFairPlay(review.id, "rejected")}>Reject report</button></div>}
                </article>) : <p>No accounts are waiting for fair-play review.</p>}</div>
              </section>
              <section className="admin-section activity-section"><h3>Operational trends</h3><div className="admin-charts">{adminDashboard?.charts && Object.entries(adminDashboard.charts).map(([name, points]) => <article key={name}><strong>{name.replace(/([A-Z])/g, " $1")}</strong><div>{points.length ? points.map((point) => <span key={point.label} title={`${point.label}: ${point.value}`} style={{ height: `${Math.max(8, point.value * 18)}px` }}><small>{point.label}</small></span>) : <small>No data yet</small>}</div></article>)}</div></section>
            </div>
            <p className="notice">{notice}</p>
            {adminProfile && <div className="profile-backdrop" onClick={() => setAdminProfile(null)}><section className="admin-profile card" onClick={(event) => event.stopPropagation()}>
              <button className="profile-close" onClick={() => setAdminProfile(null)}>×</button><p className="eyebrow">USER PROFILE</p><h2>{adminProfile.username}</h2>
              <div className="profile-meta"><span>{adminProfile.gameCount ?? adminProfile.games.length} games</span><span>{adminProfile.warningCount ?? 0} warnings</span><span>{adminProfile.banned ? "Banned" : adminProfile.suspendedUntil ? "Suspended" : "Active"}</span></div>
              {user.role === "owner" && adminProfile.username.toLowerCase() !== user.username.toLowerCase() && <div className="role-actions"><button onClick={() => changeAdminRole(adminProfile.username, "admin")}>Make admin</button><button onClick={() => changeAdminRole(adminProfile.username, "moderator")}>Make moderator</button><button onClick={() => changeAdminRole(adminProfile.username, "analyst")}>Make analyst</button><button onClick={() => changeAdminRole(adminProfile.username, null)}>Make player</button></div>}
              <button onClick={() => addAdminNote(adminProfile.username)}>Add private note</button>
              <h3>Admin notes</h3>{adminProfile.notes.length ? adminProfile.notes.map((note) => <p key={note.id}><strong>{note.author}</strong> · {note.text}</p>) : <p>No private notes.</p>}
              <h3>Game history</h3>{adminProfile.games.length ? adminProfile.games.map((game, index) => <p key={`${game.gameId}:${game.updatedAt}:${index}`}>{game.roomId} · {game.white} vs {game.black} · {game.status}</p>) : <p>No games recorded this server session.</p>}
            </section></div>}
            {spectatedRoom && <div className="profile-backdrop" onClick={() => setSpectatedRoom(null)}><section className="spectator-panel card" onClick={(event) => event.stopPropagation()}>
              <button className="profile-close" onClick={() => setSpectatedRoom(null)}>×</button><p className="eyebrow">READ-ONLY SPECTATOR</p><h2>Room {spectatedRoom.id}</h2>
              <div className="spectator-layout"><div className="mini-board">{[8,7,6,5,4,3,2,1].flatMap((rank, row) => ["a","b","c","d","e","f","g","h"].map((file, column) => {
                const square = `${file}${rank}`; const piece = spectatorPieces.get(square); const key = piece ? `${piece === piece.toUpperCase() ? "w" : "b"}${piece.toLowerCase()}` : "";
                return <div className={(row + column) % 2 ? "dark" : "light"} key={square}>{piece && glyphs[key]}</div>;
              }))}</div><div className="spectator-info">
                <p>{spectatedRoom.players.find((entry) => entry.color === "white")?.username ?? "Open"} vs {spectatedRoom.players.find((entry) => entry.color === "black")?.username ?? "Open"}</p>
                <p>{resultText(spectatedRoom) ?? `${colorName(spectatedRoom.game.turn)} to move`} · {spectatedRoom.game.moves.length} moves</p>
                <div className="spectator-actions"><button onClick={downloadAdminPgn}>Download PGN</button><button onClick={analyzeSpectatedGame}>Analyze</button>{user.role !== "analyst" && <button onClick={createFairPlayReview}>Fair-play review</button>}
                  {(user.role === "owner" || user.role === "admin") && spectatedRoom.status !== "finished" && <><button onClick={() => superviseGame("reconnect")}>Reconnect player</button><button onClick={() => superviseGame("result", "white")}>White wins</button><button onClick={() => superviseGame("result", "black")}>Black wins</button><button onClick={() => superviseGame("result", null)}>Declare draw</button><button className="danger" onClick={() => superviseGame("cancel")}>Cancel game</button></>}
                </div>
                <ol className="spectator-moves">{spectatedRoom.game.moves.map((move, index) => <li key={`${move.san}-${index}`}>{Math.floor(index / 2) + 1}{index % 2 ? "…" : "."} {move.san}{adminGameAnalysis?.moves[index] && <small>{adminGameAnalysis.moves[index]!.label} · {evaluationText(adminGameAnalysis.moves[index]!.evaluationCp)}</small>}</li>)}</ol>
              </div></div>
            </section></div>}
          </section>
        ) : playerView === "leaderboards" && socket ? <LeaderboardView socket={socket} onNotice={setNotice} />
        : playerView === "profile" && socket ? <OwnProfileView socket={socket} username={user.username} onNotice={setNotice} />
        : playerView === "tournaments" && socket ? <TournamentView socket={socket} username={user.username} onNotice={setNotice} onJoinGame={acceptJoin} onSpectate={setSpectatedRoom} enabledTimeControls={siteConfig?.timeControlsMs ?? computerTimeControls.map((control) => control.milliseconds)} />
        : lobbyMode === "choose" ? (
          <section className="lobby card">
            <h2>Choose how to play</h2>
            <p>Play a friend on your local network, or challenge the computer.</p>
            <div className="mode-options">
              <button className="mode-option" onClick={() => setLobbyMode("human")}><span>♚</span><strong>Play a person</strong><small>Quick match or private room</small></button>
              <button className="mode-option" onClick={() => setLobbyMode("computer")}><span>♞</span><strong>Play the computer</strong><small>Choose a Stockfish difficulty</small></button>
            </div>
            <p className="notice">{notice}</p>
          </section>
        ) : lobbyMode === "human" ? (
          <section className="lobby card">
            <button className="back" onClick={() => { if (matchmaking) cancelMatchmaking(); setLobbyMode("choose"); }}>← Back</button>
            <h2>Play a person</h2>
            <p>Find an available opponent automatically, or create a private room for a friend.</p>
            <div className="access-options"><button className={humanAccess === "rated" ? "active" : ""} onClick={() => { if (matchmaking) cancelMatchmaking(); setHumanAccess("rated"); }}><strong>Rated</strong><small>Ratings change after the game</small></button><button className={humanAccess === "casual" ? "active" : ""} onClick={() => { if (matchmaking) cancelMatchmaking(); setHumanAccess("casual"); }}><strong>Casual</strong><small>Ratings will not change</small></button></div>
            <section className="matchmaking-panel"><h3>Quick match</h3>{matchmaking ? <><p className="queue-status"><span className="queue-spinner" />Searching for another {matchmaking.access} player at {timeControlLabel(matchmaking.initialTimeMs)}…</p><button className="danger" onClick={cancelMatchmaking}>Cancel search</button></> : <><p>Choose a clock. You will be paired with the next player searching for the same game.</p><div className="human-time-options">{computerTimeControls.filter((control) => (siteConfig?.timeControlsMs.includes(control.milliseconds) ?? true) && (humanAccess === "casual" || control.milliseconds <= 1_800_000)).map((control) => <button className="primary" onClick={() => findMatch(control.milliseconds)} key={control.milliseconds}>Find {control.label}</button>)}</div></>}</section>
            <div className="divider"><span>private room</span></div>
            <label>Create a room with time per player</label><div className="human-time-options">{computerTimeControls.filter((control) => (siteConfig?.timeControlsMs.includes(control.milliseconds) ?? true) && (humanAccess === "casual" || control.milliseconds <= 1_800_000)).map((control) => <button onClick={() => createRoom(control.milliseconds)} key={control.milliseconds}>{control.label}</button>)}</div>
            <div className="divider"><span>join by code</span></div>
            <label htmlFor="room-code">Room code</label>
            <div className="join-row">
              <input id="room-code" value={roomInput} onChange={(event) => setRoomInput(event.target.value)} onKeyDown={(event) => event.key === "Enter" && joinRoom()} placeholder="ABC123" maxLength={6} autoCapitalize="characters" />
              <button onClick={joinRoom}>Join room</button>
            </div>
            <p className="notice">{notice}</p>
          </section>
        ) : lobbyMode === "computer" ? (
          <section className="lobby card">
            <button className="back" onClick={() => setLobbyMode("choose")}>← Back</button>
            <h2>Choose computer strength</h2>
            <p>You play White. The computer plays Black.</p>
            <div className="level-options">
              {computerLevels.filter((level) => siteConfig?.computerLevels.includes(level.id) ?? true).map((level) => <button key={level.id} className="level-option" onClick={() => { setSelectedComputerLevel(level.id); setLobbyMode("computer-time"); }}><strong>{level.title}</strong><small>{level.detail}</small></button>)}
            </div>
            <p className="notice">{notice}</p>
          </section>
        ) : (
          <section className="lobby card">
            <button className="back" onClick={() => setLobbyMode("computer")}>← Back</button>
            <h2>Choose time per player</h2>
            <p>Playing against {computerLabel(selectedComputerLevel)}. Both sides receive the selected amount of time.</p>
            <div className="level-options time-options">
              {computerTimeControls.filter((control) => siteConfig?.timeControlsMs.includes(control.milliseconds) ?? true).map((control) => <button key={control.milliseconds} className="level-option" onClick={() => selectedComputerLevel && createComputerRoom(selectedComputerLevel, control.milliseconds)}><strong>{control.label}</strong><small>Per player</small></button>)}
            </div>
            <p className="notice">{notice}</p>
          </section>
        )
      ) : (
        <section className="game-layout">
          <div className="board-card">
            <div className="board" aria-label="Chess board">
              {ranks.flatMap((rank, row) => files.map((file, column) => {
                const square = `${file}${rank}`;
                const piece = pieces.get(square);
                const key = piece ? `${piece === piece.toUpperCase() ? "w" : "b"}${piece.toLowerCase()}` : "";
                return <button key={square} className={`square ${(row + column) % 2 ? "dark" : "light"} ${selected === square ? "selected" : ""}`} onClick={() => selectSquare(square)} aria-label={square}>
                  {column === 0 && <small className="rank">{rank}</small>}
                  {piece && <span className="piece">{glyphs[key]}</span>}
                  {row === 7 && <small className="file">{file}</small>}
                </button>;
              }))}
            </div>
            <p className="board-help">{replayIndex !== null ? `Reviewing ${replayIndex === 0 ? "the starting position" : `move ${replayIndex}`}. Select Latest to resume the live board.` : "Select one of your pieces, then select its destination. Choose a piece when a pawn reaches the last rank."}</p>
          </div>
          <aside className="game-panel card">
            <p className="eyebrow">{room.mode === "computer" ? "COMPUTER" : "ROOM"}</p>
            <div className="room-code">{room.mode === "computer" ? computerLabel(room.computerLevel) : room.id}</div>
            <p className="share">{room.mode === "computer" ? `You are White. The computer is Black. ${timeControlLabel(room.timeControl.initialTimeMs)} each.` : `${room.access === "rated" ? `Rated ${room.ratingPool ?? ""}` : "Casual — ratings will not change"}. Share this code with your opponent.`}</p>
            <div className="players">
              {(["white", "black"] as ChessColor[]).map((color) => {
                const player = room.players.find((entry) => entry.color === color);
                const milliseconds = remainingMilliseconds(room, color, clockNow);
                const active = room.clock.activeColor === color;
                const label = player?.kind === "computer" ? `${computerLabel(room.computerLevel)} (${colorName(color)})` : `${colorName(color)} ${playerColor === color ? "(you)" : ""}`;
                return <div className={`player ${active ? "active-clock" : ""}`} key={color}><span>{label}{room.access === "rated" && room.startingRatings?.[color] ? ` · ${room.startingRatings[color]}` : ""}</span><strong className={milliseconds <= 20_000 ? "low-time" : ""}>{formatClock(milliseconds)}</strong><em className={player?.connected ? "present" : ""}>{player?.kind === "computer" ? active ? "thinking" : "ready" : player?.connected ? "connected" : "waiting"}</em></div>;
              })}
            </div>
            {room.access === "rated" && playerColor && room.ratingEstimates?.[playerColor] && room.status !== "finished" && <p className="rating-estimate">Estimated: Win {room.ratingEstimates[playerColor]!.win >= 0 ? "+" : ""}{room.ratingEstimates[playerColor]!.win} · Draw {room.ratingEstimates[playerColor]!.draw >= 0 ? "+" : ""}{room.ratingEstimates[playerColor]!.draw} · Loss {room.ratingEstimates[playerColor]!.loss}</p>}
            <div className="turn-status">
              {resultText(room) ?? (room.status === "waiting" ? "Waiting for Black to join." : `${colorName(room.game.turn)} to move${room.game.isCheck ? " — check" : ""}.`)}
            </div>
            {room.status !== "finished" && room.mode === "human" && room.status === "active" && <button className="resign" onClick={resignGame}>Resign</button>}
            {room.status === "finished" && room.ratingResult?.rated && playerColor && <div className="rating-result"><strong>{room.ratingPool?.toUpperCase()} rating</strong><span>{room.ratingResult[playerColor]?.ratingBefore} → {room.ratingResult[playerColor]?.ratingAfter} ({(room.ratingResult[playerColor]?.ratingChange ?? 0) >= 0 ? "+" : ""}{room.ratingResult[playerColor]?.ratingChange})</span><small>Opponent rating {room.ratingResult[playerColor]?.opponentRating} · {room.game.result?.kind}</small><button onClick={() => { returnToHome(); setPlayerView("profile"); }}>View profile</button></div>}
            {room.status === "finished" && !room.ratingResult?.rated && room.access === "rated" && <p className="rating-estimate">No rating change: {room.ratingResult?.reason ?? "This result was not eligible."}</p>}
            {room.status === "finished" && <div className="finish-actions"><button className="primary restart" onClick={restartGame}>Play rematch</button><button className="home" onClick={returnToHome}>Return to home</button></div>}
            <p className="notice">{notice}</p>
            <h3>Moves</h3>
            {room.status === "finished" && <div className="review-actions">
              <button onClick={() => setReplayIndex((current) => Math.max(0, (current ?? room.game.moves.length) - 1))} disabled={replayIndex === 0}>← Previous</button>
              <button onClick={() => setReplayIndex((current) => Math.min(room.game.moves.length, (current ?? room.game.moves.length) + 1))} disabled={replayIndex === room.game.moves.length}>Next →</button>
              <button onClick={() => setReplayIndex(null)} disabled={replayIndex === null}>Latest</button>
              <button onClick={downloadPgn}>Download PGN</button>
              <button className="analyze" onClick={analyzeGame} disabled={analyzing}>{analyzing ? "Analyzing…" : analysis ? "Analyze again" : "Analyze game"}</button>
            </div>}
            <ol className="moves">
              {room.game.moves.length === 0 ? <li>No moves yet.</li> : room.game.moves.map((move, index) => {
                const moveAnalysis = analysis?.moves[index];
                return <li key={`${move.san}-${index}`} className={replayIndex === index + 1 ? "active-move" : ""}><button onClick={() => setReplayIndex(index + 1)}><span>{Math.floor(index / 2) + 1}{index % 2 === 0 ? "." : "…"}</span>{move.san}{moveAnalysis && <small className={`move-label ${moveAnalysis.label}`}>{labelText(moveAnalysis.label)} · {evaluationText(moveAnalysis.evaluationCp)} · Best: {moveAnalysis.bestMoveSan}</small>}</button></li>;
              })}
            </ol>
          </aside>
        </section>
      )}
      {pendingPromotion && <div className="promotion-backdrop" role="dialog" aria-modal="true" aria-label="Choose promotion piece">
        <div className="promotion card">
          <h2>Promote pawn</h2>
          <p>Choose the new piece.</p>
          <div className="promotion-options">
            {(["q", "r", "b", "n"] as const).map((piece) => <button key={piece} onClick={() => submitMove(pendingPromotion.from, pendingPromotion.to, piece)}>{glyphs[`${playerColor === "white" ? "w" : "b"}${piece}`]}</button>)}
          </div>
          <button className="cancel" onClick={() => setPendingPromotion(null)}>Cancel</button>
        </div>
      </div>}
      {accountWarnings[0] && <div className="warning-backdrop" role="dialog" aria-modal="true" aria-label="Account warning">
        <section className="warning-dialog card">
          <p className="eyebrow">ADMINISTRATOR NOTICE</p>
          <h2>Account warning</h2>
          <p>{accountWarnings[0].reason}</p>
          <small>Issued by {accountWarnings[0].actor} · {new Date(accountWarnings[0].createdAt).toLocaleString()}{accountWarnings.length > 1 ? ` · ${accountWarnings.length - 1} more warning${accountWarnings.length === 2 ? "" : "s"}` : ""}</small>
          <button className="primary" onClick={() => setAccountWarnings((current) => current.slice(1))}>I understand</button>
        </section>
      </div>}
      {!user?.isAdmin && spectatedRoom && <div className="profile-backdrop" onClick={() => setSpectatedRoom(null)}><section className="spectator-panel card" onClick={(event) => event.stopPropagation()}>
        <button className="profile-close" onClick={() => setSpectatedRoom(null)}>×</button><p className="eyebrow">TOURNAMENT SPECTATOR</p><h2>Room {spectatedRoom.id}</h2>
        <div className="spectator-layout"><div className="mini-board">{[8,7,6,5,4,3,2,1].flatMap((rank, row) => ["a","b","c","d","e","f","g","h"].map((file, column) => { const square = `${file}${rank}`; const piece = spectatorPieces.get(square); const key = piece ? `${piece === piece.toUpperCase() ? "w" : "b"}${piece.toLowerCase()}` : ""; return <div className={(row + column) % 2 ? "dark" : "light"} key={square}>{piece && glyphs[key]}</div>; }))}</div><div className="spectator-info"><p>{spectatedRoom.players.find((entry) => entry.color === "white")?.username} vs {spectatedRoom.players.find((entry) => entry.color === "black")?.username}</p><p>{resultText(spectatedRoom) ?? `${colorName(spectatedRoom.game.turn)} to move`} · {spectatedRoom.game.moves.length} moves</p><ol className="spectator-moves">{spectatedRoom.game.moves.map((move, index) => <li key={`${move.san}-${index}`}>{Math.floor(index / 2) + 1}{index % 2 ? "…" : "."} {move.san}</li>)}</ol></div></div>
      </section></div>}
    </main>
  );
}
