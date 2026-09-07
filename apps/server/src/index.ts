import Fastify from "fastify";
import { setTimeout as delay } from "node:timers/promises";
import { Server } from "socket.io";
import type { AdminDashboard, AdminGameActionRequest, AdminLoginRequest, AdminRole, AdminSecuritySetup, AdminSecuritySetupRequest, AdminSiteConfig, AdminUserActionRequest, AdminUserProfile, AdminUserSummary, AnalyzeGameRequest, AuthResponse, BanUserRequest, CreateHumanRoomRequest, CredentialsRequest, CreateComputerRoomRequest, FairPlayReview, FairPlayReviewRequest, GameAnalysis, JoinRoomRequest, LeaderboardRequest, LeaderboardResponse, LeaveRoomRequest, MoveRequest, PublicRatingProfile, RatingProfileRequest, ResignGameRequest, RestartGameRequest, RestoreSessionRequest, RoomSnapshot, ServerError, TournamentActionRequest, TournamentCreateRequest, TournamentDeleteResponse, TournamentDetail, TournamentListRequest, TournamentSummary, TournamentUpdateRequest } from "@chessss/shared";
import { AuthError, AuthService } from "./auth-service.js";
import { AuditService } from "./audit-service.js";
import { ConfigError, ConfigService } from "./config-service.js";
import { FairPlayError, FairPlayService } from "./fair-play-service.js";
import { GameAnalyzer } from "./game-analyzer.js";
import { GameHistoryError, GameHistoryService } from "./game-history-service.js";
import { MatchmakingError, MatchmakingService } from "./matchmaking-service.js";
import { RatingError, RatingService, ratingPoolForTimeControl } from "./rating-service.js";
import { RoomError, RoomService } from "./room-service.js";
import { TournamentError, TournamentService } from "./tournament-service.js";

const app = Fastify({ logger: true });
const io = new Server(app.server, { cors: { origin: true } });
const history = new GameHistoryService();
const auth = new AuthService();
const ratings = new RatingService();
const tournaments = new TournamentService();
const rooms = new RoomService((room) => { publishRoom(room); });
const audit = new AuditService();
const config = new ConfigService();
const fairPlay = new FairPlayService();
const analyzer = new GameAnalyzer();
const matchmaking = new MatchmakingService();
const COMPUTER_MOVE_DELAY_MS = 2_000;
const SERVER_STARTED_AT = new Date().toISOString();
let analysisJobs = 0;
const AUTH_ATTEMPT_WINDOW_MS = 60_000;
const MAX_AUTH_ATTEMPTS_PER_WINDOW = 12;
const authAttempts = new Map<string, { count: number; windowStartedAt: number }>();
rooms.configureTimeControls(config.get().timeControlsMs);
analyzer.configure(config.get().analysisTimeMs);

app.get("/health", async () => ({ status: "ok" }));

function errorResponse(error: unknown): ServerError {
  const known = error instanceof RoomError || error instanceof AuthError || error instanceof FairPlayError || error instanceof ConfigError || error instanceof GameHistoryError || error instanceof MatchmakingError || error instanceof RatingError || error instanceof TournamentError;
  if (!known) recordActivity({ category: "server", action: "unexpected-error", actor: "server", details: error instanceof Error ? error.message : "Unknown error" });
  return { message: known ? error.message : "Unexpected server error." };
}

function requireAuthenticated(socket: { data: { sessionToken?: string } }) {
  if (!socket.data.sessionToken) throw new AuthError("Please sign in before starting or joining a game.");
}

function requireAdmin(socket: { data: { sessionToken?: string } }, allowed: AdminRole[] = ["owner", "admin", "moderator", "analyst"]): AdminRole {
  requireAuthenticated(socket);
  const role = auth.roleForSession(socket.data.sessionToken!);
  if (!role || !allowed.includes(role)) throw new AuthError("Your administrator role cannot perform this action.");
  return role;
}

function requireSiteAvailable(socket: { data: { sessionToken?: string } }) {
  if (config.get().maintenanceMode && (!socket.data.sessionToken || !auth.roleForSession(socket.data.sessionToken))) throw new RoomError("The site is currently in maintenance mode.");
}

function registerAuthAttempt(address: string) {
  const now = Date.now();
  const current = authAttempts.get(address);
  if (!current || now - current.windowStartedAt >= AUTH_ATTEMPT_WINDOW_MS) {
    authAttempts.set(address, { count: 1, windowStartedAt: now });
    return;
  }
  current.count += 1;
  if (current.count > MAX_AUTH_ATTEMPTS_PER_WINDOW) throw new AuthError("Too many authentication attempts. Please wait one minute and try again.");
}

function dashboard(): AdminDashboard {
  rooms.allSnapshots().forEach((room) => history.capture(room));
  const games = [...rooms.adminGames().filter((game) => game.status !== "finished"), ...history.summaries()];
  const onlineUsers = [...new Set([...io.sockets.sockets.values()].flatMap((socket) => socket.data.username ? [socket.data.username as string] : []))].sort();
  const countBy = (values: string[]) => [...values.reduce((map, value) => map.set(value, (map.get(value) ?? 0) + 1), new Map<string, number>())]
    .map(([label, value]) => ({ label, value })).sort((left, right) => left.label.localeCompare(right.label)).slice(-12);
  const activities = audit.recent(1_000);
  return {
    serverStartedAt: SERVER_STARTED_AT,
    serverTime: new Date().toISOString(),
    onlineUsers,
    activeGames: games.filter((game) => game.status === "active").length,
    completedGames: games.filter((game) => game.status === "finished").length,
    analysisJobs,
    users: decorateUsers(auth.dashboardUsers()),
    games,
    activity: audit.recent(100),
    fairPlayQueue: fairPlay.list(),
    config: config.get(),
    charts: {
      playerGrowth: countBy(auth.accountCreationDates().map((date) => date === "legacy" ? "Legacy" : date.slice(0, 10))),
      gamesPlayed: countBy(history.summaries().map((game) => game.updatedAt.slice(0, 10))),
      disconnects: countBy(activities.filter((entry) => entry.action === "disconnect").map((entry) => entry.timestamp.slice(0, 10))),
      popularTimeControls: countBy(games.map((game) => `${Math.round(game.timeControlMs / 60_000)}m`)),
    },
  };
}

function emitAdminDashboard() {
  const state = dashboard();
  for (const socket of io.sockets.sockets.values()) if (socket.data.role) socket.emit("admin:dashboard", state);
}

function emitTournamentUpdate(tournament: TournamentDetail) {
  if (tournament.state !== "draft") {
    io.emit("tournament:updated", tournament);
    return;
  }
  for (const client of io.sockets.sockets.values()) {
    const role = client.data.sessionToken ? auth.roleForSession(client.data.sessionToken) : null;
    const isCreator = client.data.username?.toLowerCase() === tournament.createdBy.toLowerCase();
    if (isCreator || (role && ["owner", "admin", "moderator"].includes(role))) client.emit("tournament:updated", tournament);
  }
}

function setSocketAuth(socket: { data: Record<string, unknown> }, response: AuthResponse) {
  socket.data.sessionToken = response.sessionToken;
  socket.data.username = response.user.username;
  socket.data.role = response.user.role;
}

function recordActivity(entry: Parameters<AuditService["record"]>[0]) {
  audit.record(entry);
  emitAdminDashboard();
}

function decorateUsers(users: AdminUserSummary[]): AdminUserSummary[] {
  const online = new Set([...io.sockets.sockets.values()].flatMap((socket) => socket.data.username ? [String(socket.data.username).toLowerCase()] : []));
  const games = [...rooms.adminGames().filter((game) => game.status !== "finished"), ...history.summaries()];
  return users.map((user) => ({ ...user, online: online.has(user.username.toLowerCase()), gameCount: games.filter((game) => [game.white, game.black].some((name) => name.toLowerCase() === user.username.toLowerCase())).length }));
}

function snapshotForAdmin(roomId: string, gameId?: string): RoomSnapshot {
  if (gameId) {
    try {
      const active = rooms.snapshotById(roomId);
      if (active.gameInstanceId === gameId) return active;
    } catch { /* The requested game may only exist in history. */ }
    const archived = history.snapshot(gameId);
    if (archived) return archived;
    throw new RoomError("Game not found.");
  }
  try { return rooms.snapshotById(roomId); }
  catch { return history.snapshot(roomId) ?? (() => { throw new RoomError("Room not found."); })(); }
}

function gameForAdminAnalysis(roomId: string, gameId?: string) {
  return snapshotForAdmin(roomId, gameId).game;
}

function configureRoomRatingDisplay(roomId: string): RoomSnapshot {
  const room = rooms.snapshotById(roomId);
  if (room.access !== "rated" || !room.ratingPool || room.players.length !== 2) return room;
  const white = room.players.find((player) => player.color === "white")?.username;
  const black = room.players.find((player) => player.color === "black")?.username;
  if (!white || !black) return room;
  rooms.configureRatings(room.id, {
    white: ratings.rating(white, room.ratingPool).rating,
    black: ratings.rating(black, room.ratingPool).rating,
  }, {
    white: ratings.estimate(white, black, room.ratingPool),
    black: ratings.estimate(black, white, room.ratingPool),
  });
  return rooms.snapshotById(room.id);
}

function publishRoom(room: RoomSnapshot): RoomSnapshot {
  let published = room;
  if (room.status === "finished" && room.game.result) {
    const white = room.players.find((player) => player.color === "white")?.username ?? "Open seat";
    const black = room.players.find((player) => player.color === "black")?.username ?? "Open seat";
    const outcome = ratings.processCompletedGame({
      gameId: room.gameInstanceId, roomId: room.id, mode: room.mode, access: room.access,
      initialTimeMs: room.timeControl.initialTimeMs, white, black, result: room.game.result, tournamentId: room.tournamentId,
    });
    published = rooms.setRatingResult(room.id, room.gameInstanceId, outcome);
    flagRepeatedShortResignation(room);
    if (room.tournamentId) {
      const tournament = tournaments.processGame(room.gameInstanceId, room.game.result);
      if (tournament) emitTournamentUpdate(tournament);
    }
  }
  history.capture(published);
  io.to(published.id).emit("room:state", published);
  return published;
}

function flagRepeatedShortResignation(room: RoomSnapshot) {
  if (room.game.result?.kind !== "resignation" || room.game.moves.length > 6) return;
  const resigningColor = room.game.result.winner === "white" ? "black" : "white";
  const username = room.players.find((player) => player.color === resigningColor)?.username;
  if (!username) return;
  const recent = audit.recent(5_000);
  if (recent.some((entry) => entry.action === "short-resignation-observed" && entry.target === room.gameInstanceId)) return;
  const cutoff = Date.now() - 24 * 60 * 60_000;
  const previous = recent.filter((entry) => entry.action === "short-resignation-observed" && entry.actor.toLowerCase() === username.toLowerCase() && new Date(entry.timestamp).getTime() >= cutoff).length;
  audit.record({ category: "fair-play", action: "short-resignation-observed", actor: username, target: room.gameInstanceId, details: `${room.game.moves.length} half-moves` });
  if (previous >= 2) audit.record({ category: "fair-play", action: "repeated-short-resignations-flagged", actor: "server", target: username, reason: "Three or more games resigned within six half-moves in 24 hours.", details: "Manual review required; no automatic punishment was applied." });
}

function materializeTournamentRound(tournamentId: string): TournamentDetail {
  let tournament = tournaments.detail(tournamentId);
  for (const pairing of tournament.pairings.filter((candidate) => candidate.round === tournament.currentRound && !candidate.bye && !["finished", "forfeit", "double-forfeit", "bye"].includes(candidate.status))) {
    if (pairing.roomId) {
      try { rooms.snapshotById(pairing.roomId); continue; }
      catch { tournaments.replaceMissingRoom(tournament.id, pairing.id); }
    }
    const pool = ratingPoolForTimeControl(tournament.settings.initialTimeMs);
    const room = rooms.createTournamentRoom({
      tournamentId: tournament.id, round: tournament.currentRound, white: pairing.white!, black: pairing.black!,
      initialTimeMs: tournament.settings.initialTimeMs, access: tournament.settings.access,
      startingRatings: tournament.settings.access === "rated" && pool ? { white: ratings.rating(pairing.white!, pool).rating, black: ratings.rating(pairing.black!, pool).rating } : {},
    });
    tournaments.attachRoom(tournament.id, pairing.id, room.id, room.gameInstanceId);
    if (room.access === "rated" && room.ratingPool) configureRoomRatingDisplay(room.id);
  }
  tournament = tournaments.detail(tournamentId);
  emitTournamentUpdate(tournament);
  return tournament;
}

function playComputerTurn(roomId: string) {
  void delay(COMPUTER_MOVE_DELAY_MS)
    .then(() => rooms.takeComputerTurn(roomId))
    .then((room) => { if (room) { publishRoom(room); emitAdminDashboard(); } })
    .catch((error) => {
      app.log.error(error, "Computer move failed");
      recordActivity({ category: "server", action: "computer-move-error", actor: "server", target: roomId, details: error instanceof Error ? error.message : "Unknown error" });
    });
}

io.on("connection", (socket) => {
  socket.emit("site:config", config.get());
  socket.on("auth:signup", async (request: CredentialsRequest, respond: (response: AuthResponse | { error: ServerError }) => void) => {
    try {
      registerAuthAttempt(socket.handshake.address);
      const response = await auth.signUp(request);
      ratings.ensurePlayer(response.user.username);
      setSocketAuth(socket, response);
      recordActivity({ category: "auth", action: "sign-up", actor: response.user.username });
      respond(response);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("auth:signin", async (request: CredentialsRequest, respond: (response: AuthResponse | { error: ServerError }) => void) => {
    try {
      registerAuthAttempt(socket.handshake.address);
      const response = await auth.signIn(request);
      ratings.ensurePlayer(response.user.username);
      setSocketAuth(socket, response);
      recordActivity({ category: "auth", action: "sign-in", actor: response.user.username });
      respond(response);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("auth:admin-signin", async (request: AdminLoginRequest, respond: (response: AuthResponse | { error: ServerError }) => void) => {
    try {
      registerAuthAttempt(socket.handshake.address);
      const response = await auth.signInAdmin(request);
      setSocketAuth(socket, response);
      recordActivity({ category: "auth", action: "admin-sign-in", actor: response.user.username, details: response.user.role });
      respond(response);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("auth:restore", (request: RestoreSessionRequest, respond: (response: AuthResponse | { error: ServerError }) => void) => {
    try {
      const response = auth.restore(request.sessionToken);
      setSocketAuth(socket, response);
      respond(response);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("auth:signout", (request: RestoreSessionRequest, respond: () => void) => {
    matchmaking.cancel(socket.id);
    auth.signOut(request.sessionToken);
    delete socket.data.sessionToken;
    delete socket.data.username;
    delete socket.data.role;
    respond();
  });

  socket.on("rating:leaderboard", (request: LeaderboardRequest, respond: (response: LeaderboardResponse | { error: ServerError }) => void) => {
    try { respond(ratings.leaderboard(request, (username) => auth.isPubliclyEligible(username))); }
    catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("rating:profile", (request: RatingProfileRequest, respond: (response: PublicRatingProfile | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      const username = request.username?.trim() || socket.data.username!;
      if (!auth.isPubliclyEligible(username) && username.toLowerCase() !== socket.data.username!.toLowerCase()) throw new AuthError("That player profile is unavailable.");
      const profile = ratings.profile(username, username.toLowerCase() === socket.data.username!.toLowerCase());
      profile.tournaments = tournaments.list({ tab: "mine" }, username);
      respond(profile);
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("tournament:list", (request: TournamentListRequest, respond: (response: TournamentSummary[] | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      const mayManage = Boolean(socket.data.sessionToken && ["owner", "admin", "moderator"].includes(auth.roleForSession(socket.data.sessionToken) ?? ""));
      respond(tournaments.list({ ...request, includeDrafts: Boolean(request.includeDrafts && mayManage) }, socket.data.username!, mayManage));
    }
    catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("tournament:detail", (request: { tournamentId: string }, respond: (response: TournamentDetail | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      const tournament = tournaments.detail(request.tournamentId);
      const mayManage = Boolean(socket.data.sessionToken && ["owner", "admin", "moderator"].includes(auth.roleForSession(socket.data.sessionToken) ?? ""));
      if (tournament.state === "draft" && !mayManage && tournament.createdBy.toLowerCase() !== socket.data.username!.toLowerCase()) throw new TournamentError("That tournament draft is private.");
      respond(tournament);
    }
    catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("tournament:register", (request: { tournamentId: string }, respond: (response: TournamentDetail | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket); requireSiteAvailable(socket);
      if (auth.isSuspended(socket.data.username!)) throw new AuthError("Suspended accounts cannot enter tournaments.");
      const tournament = tournaments.register(request.tournamentId, socket.data.username!);
      recordActivity({ category: "game", action: "tournament-registered", actor: socket.data.username!, target: tournament.id });
      emitTournamentUpdate(tournament); respond(tournament);
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("tournament:withdraw", (request: { tournamentId: string }, respond: (response: TournamentDetail | { error: ServerError }) => void) => {
    try { requireAuthenticated(socket); const tournament = tournaments.withdraw(request.tournamentId, socket.data.username!); emitTournamentUpdate(tournament); respond(tournament); }
    catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("tournament:check-in", (request: { tournamentId: string }, respond: (response: TournamentDetail | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      if (auth.isSuspended(socket.data.username!)) throw new AuthError("Suspended accounts cannot check in to tournaments.");
      const tournament = tournaments.checkIn(request.tournamentId, socket.data.username!); emitTournamentUpdate(tournament); respond(tournament);
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("tournament:game:join", (request: { tournamentId: string; pairingId: string }, respond: (response: unknown) => void) => {
    try {
      requireAuthenticated(socket); requireSiteAvailable(socket);
      let tournament = tournaments.detail(request.tournamentId);
      if (tournament.state !== "active") throw new TournamentError("Tournament games are not currently running.");
      tournament = materializeTournamentRound(tournament.id);
      if (tournament.settings.access === "rated" && auth.isSuspended(socket.data.username!)) throw new AuthError("Suspended accounts cannot join rated tournament games.");
      const pairing = tournament.pairings.find((candidate) => candidate.id === request.pairingId);
      if (!pairing?.roomId || ![pairing.white, pairing.black].some((name) => name?.toLowerCase() === socket.data.username!.toLowerCase())) throw new TournamentError("You are not assigned to that game.");
      if (pairing.startedAt && Date.now() < new Date(pairing.startedAt).getTime()) throw new TournamentError("This round has not started yet.");
      const joined = rooms.joinRoom({ roomId: pairing.roomId }, socket.id, socket.data.username!);
      socket.join(joined.room.id); tournaments.markPairingActive(tournament.id, pairing.id);
      io.to(joined.room.id).emit("room:state", joined.room); respond(joined);
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("tournament:spectate", (request: { tournamentId: string; roomId: string }, respond: (response: { room: RoomSnapshot } | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      const tournament = tournaments.detail(request.tournamentId);
      if (!tournament.settings.spectatingAllowed || !tournament.pairings.some((pairing) => pairing.roomId === request.roomId)) throw new TournamentError("Spectating is not allowed for that game.");
      const room = rooms.snapshotById(request.roomId); socket.join(room.id); respond({ room });
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  const createTournament = (request: TournamentCreateRequest, respond: (response: TournamentDetail | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket); requireSiteAvailable(socket);
      if (auth.isSuspended(socket.data.username!)) throw new AuthError("Suspended accounts cannot create tournaments.");
      if (!request?.settings) throw new TournamentError("Tournament settings are required.");
      if (!config.get().timeControlsMs.includes(request.settings.initialTimeMs)) throw new TournamentError("Choose an enabled site time control.");
      if (request.settings.access === "rated" && !ratingPoolForTimeControl(request.settings.initialTimeMs)) throw new TournamentError("Rated tournaments must use a Bullet, Blitz, or Rapid time control.");
      const tournament = tournaments.create(request.settings, socket.data.username!);
      recordActivity({ category: "game", action: "tournament-draft-submitted", actor: socket.data.username!, target: tournament.id });
      emitTournamentUpdate(tournament); respond(tournament);
    } catch (error) { respond({ error: errorResponse(error) }); }
  };
  socket.on("tournament:create", createTournament);
  socket.on("admin:tournament:create", createTournament);

  socket.on("admin:tournament:update", (request: TournamentUpdateRequest, respond: (response: TournamentDetail | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      if (!request?.settings) throw new TournamentError("Tournament settings are required.");
      const current = tournaments.detail(request.tournamentId);
      const role = auth.roleForSession(socket.data.sessionToken!);
      const mayManage = Boolean(role && ["owner", "admin", "moderator"].includes(role));
      if (!mayManage && current.createdBy.toLowerCase() !== socket.data.username!.toLowerCase()) throw new AuthError("Only the draft creator or tournament staff can edit it.");
      if (!config.get().timeControlsMs.includes(request.settings.initialTimeMs)) throw new TournamentError("Choose an enabled site time control.");
      if (request.settings.access === "rated" && !ratingPoolForTimeControl(request.settings.initialTimeMs)) throw new TournamentError("Rated tournaments must use a Bullet, Blitz, or Rapid time control.");
      const tournament = tournaments.update(request.tournamentId, request.settings);
      recordActivity({ category: "game", action: "tournament-updated", actor: socket.data.username!, target: tournament.id }); emitTournamentUpdate(tournament); respond(tournament);
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:tournament:action", (request: TournamentActionRequest, respond: (response: TournamentDetail | TournamentDeleteResponse | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      if (!request?.tournamentId) throw new TournamentError("Choose a tournament.");
      const current = tournaments.detail(request.tournamentId);
      const role = auth.roleForSession(socket.data.sessionToken!);
      const isStaff = Boolean(role && ["owner", "admin", "moderator"].includes(role));
      const isCreator = current.createdBy.toLowerCase() === socket.data.username!.toLowerCase();
      const actions: NonNullable<TournamentActionRequest["action"]>[] = ["open-registration", "begin-check-in", "start", "pause", "resume", "next-round", "cancel", "delete", "forfeit", "correct-result", "disqualify"];
      if (!request.action || !actions.includes(request.action)) throw new TournamentError("Choose a valid tournament action.");
      if (["open-registration", "delete", "forfeit", "correct-result", "disqualify"].includes(request.action) && !isStaff) throw new AuthError("An admin or moderator must perform this tournament action.");
      if (!isStaff && !isCreator) throw new AuthError("Only the tournament organizer or tournament staff can perform this action.");
      if (["cancel", "delete", "forfeit", "correct-result", "disqualify"].includes(request.action) && !request.reason?.trim()) throw new TournamentError("A reason is required for this action.");
      if (request.action === "delete") {
        if (!["completed", "cancelled"].includes(current.state)) {
          tournaments.transition(current.id, "cancel");
          for (const room of rooms.tournamentRooms(current.id).filter((value) => value.status !== "finished")) publishRoom(rooms.adminCancel(room.id));
        }
        tournaments.delete(current.id);
        recordActivity({ category: "game", action: "tournament-deleted", actor: socket.data.username!, target: current.id, reason: request.reason });
        io.emit("tournament:deleted", { tournamentId: current.id });
        respond({ deletedTournamentId: current.id });
        return;
      }
      let tournament: TournamentDetail;
      if (request.action === "start") tournament = materializeTournamentRound(tournaments.start(request.tournamentId).id);
      else if (request.action === "next-round") tournament = materializeTournamentRound(tournaments.nextRound(request.tournamentId).id);
      else if (request.action === "forfeit") {
        if (!request.pairingId) throw new TournamentError("Choose a pairing.");
        const detail = tournaments.detail(request.tournamentId); const pairing = detail.pairings.find((value) => value.id === request.pairingId);
        tournament = pairing?.roomId ? (publishRoom(rooms.adminForfeit(pairing.roomId, request.winner ?? null)), tournaments.detail(detail.id)) : tournaments.forfeit(detail.id, request.pairingId, request.winner ?? null);
      } else if (request.action === "correct-result") {
        if (!request.pairingId || !request.result) throw new TournamentError("Choose a pairing and corrected result.");
        const detail = tournaments.detail(request.tournamentId); const pairing = detail.pairings.find((value) => value.id === request.pairingId);
        if (!pairing) throw new TournamentError("Pairing not found.");
        if (pairing.roomId) {
          const reversible = ratings.latestReversibleGameForRoom(pairing.roomId);
          if (reversible) ratings.reverse(reversible, socket.data.username!);
        }
        tournament = tournaments.correctResult(detail.id, pairing.id, request.result);
        if (pairing.roomId && pairing.white && pairing.black) ratings.processCompletedGame({
          gameId: `${pairing.gameId ?? pairing.id}:correction:${Date.now()}`, roomId: pairing.roomId, mode: "human", access: detail.settings.access,
          initialTimeMs: detail.settings.initialTimeMs, white: pairing.white, black: pairing.black, result: request.result, tournamentId: detail.id,
        });
      } else if (request.action === "disqualify") {
        if (!request.username) throw new TournamentError("Choose a participant.");
        const before = tournaments.detail(request.tournamentId);
        const activePairing = before.pairings.find((pairing) => pairing.round === before.currentRound && pairing.roomId && !["finished", "forfeit", "double-forfeit", "bye"].includes(pairing.status) && [pairing.white, pairing.black].some((name) => name?.toLowerCase() === request.username!.toLowerCase()));
        tournament = tournaments.disqualify(request.tournamentId, request.username);
        if (activePairing?.roomId) {
          const winner: "white" | "black" = activePairing.white?.toLowerCase() === request.username.toLowerCase() ? "black" : "white";
          publishRoom(rooms.adminForfeit(activePairing.roomId, winner));
        }
      } else {
        tournament = tournaments.transition(request.tournamentId, request.action);
        if (request.action === "pause" || request.action === "resume") {
          for (const room of rooms.setTournamentPaused(tournament.id, request.action === "pause")) io.to(room.id).emit("room:state", room);
        } else if (request.action === "cancel") {
          for (const room of rooms.tournamentRooms(tournament.id).filter((value) => value.status !== "finished")) publishRoom(rooms.adminCancel(room.id));
        }
      }
      recordActivity({ category: "game", action: `tournament-${request.action}`, actor: socket.data.username!, target: request.tournamentId, reason: request.reason });
      emitTournamentUpdate(tournament); respond(tournament);
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:rating:reverse", (request: { gameId: string; reason: string }, respond: (response: unknown) => void) => {
    try {
      requireAdmin(socket, ["owner", "admin"]); if (!request.reason.trim()) throw new RatingError("A reversal reason is required.");
      const entries = ratings.reverse(request.gameId, socket.data.username!);
      recordActivity({ category: "fair-play", action: "rating-reversed", actor: socket.data.username!, target: request.gameId, reason: request.reason }); respond({ entries });
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:users", (respond: (response: AdminUserSummary[] | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      respond(decorateUsers(auth.listUsers(socket.data.sessionToken!)));
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("admin:dashboard:get", (respond: (response: AdminDashboard | { error: ServerError }) => void) => {
    try {
      requireAdmin(socket);
      respond(dashboard());
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("admin:config:update", (request: AdminSiteConfig, respond: (response: AdminSiteConfig | { error: ServerError }) => void) => {
    try {
      requireAdmin(socket, ["owner", "admin"]);
      const updated = config.update(request);
      rooms.configureTimeControls(updated.timeControlsMs);
      analyzer.configure(updated.analysisTimeMs);
      io.emit("site:config", updated);
      recordActivity({ category: "config", action: "site-config-updated", actor: socket.data.username!, details: updated.maintenanceMode ? "maintenance enabled" : "maintenance disabled" });
      respond(updated);
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:security:begin", (respond: (response: AdminSecuritySetup | { error: ServerError }) => void) => {
    try { requireAdmin(socket); respond(auth.beginAdminSecurity(socket.data.sessionToken!)); }
    catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:security:complete", async (request: AdminSecuritySetupRequest, respond: (response: AuthResponse | { error: ServerError }) => void) => {
    try {
      requireAdmin(socket);
      const response = await auth.completeAdminSecurity(socket.data.sessionToken!, request);
      setSocketAuth(socket, response);
      recordActivity({ category: "auth", action: "admin-2fa-enabled", actor: response.user.username });
      respond(response);
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:game:spectate", (request: { roomId: string; gameId?: string }, respond: (response: { room: RoomSnapshot } | { error: ServerError }) => void) => {
    try {
      requireAdmin(socket);
      const room = snapshotForAdmin(request.roomId, request.gameId);
      socket.join(room.id);
      recordActivity({ category: "game", action: "spectate", actor: socket.data.username!, target: room.id });
      respond({ room });
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:game:cancel", (request: AdminGameActionRequest, respond: (response: { room: RoomSnapshot } | { error: ServerError }) => void) => {
    try {
      requireAdmin(socket, ["owner", "admin"]);
      if (!request.reason.trim()) throw new AuthError("A reason is required.");
      const room = publishRoom(rooms.adminCancel(request.roomId));
      recordActivity({ category: "game", action: "game-cancelled", actor: socket.data.username!, target: room.id, reason: request.reason });
      respond({ room });
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:game:result", (request: AdminGameActionRequest, respond: (response: { room: RoomSnapshot } | { error: ServerError }) => void) => {
    try {
      requireAdmin(socket, ["owner", "admin"]);
      if (!request.reason.trim()) throw new AuthError("A reason is required.");
      const room = publishRoom(rooms.adminDeclareResult(request.roomId, request.winner ?? null));
      recordActivity({ category: "game", action: "result-declared", actor: socket.data.username!, target: room.id, reason: request.reason, details: request.winner ?? "draw" });
      respond({ room });
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:game:reconnect", (request: AdminGameActionRequest, respond: (response: { room: RoomSnapshot } | { error: ServerError }) => void) => {
    try {
      requireAdmin(socket, ["owner", "admin"]);
      if (!request.reason.trim() || !request.username) throw new AuthError("A user and reason are required.");
      const target = [...io.sockets.sockets.values()].find((candidate) => candidate.data.username?.toLowerCase() === request.username!.toLowerCase());
      if (!target) throw new RoomError("That user is not online.");
      const joined = rooms.adminReconnect(request.roomId, request.username, target.id);
      target.join(joined.room.id);
      target.emit("room:reconnected", joined);
      io.to(joined.room.id).emit("room:state", joined.room);
      recordActivity({ category: "game", action: "player-reconnected", actor: socket.data.username!, target: `${joined.room.id}:${request.username}`, reason: request.reason });
      respond({ room: joined.room });
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:game:analyze", async (request: { roomId: string; gameId?: string }, respond: (response: GameAnalysis | { error: ServerError }) => void) => {
    let jobStarted = false;
    try {
      requireAdmin(socket);
      analysisJobs += 1;
      jobStarted = true;
      emitAdminDashboard();
      const game = gameForAdminAnalysis(request.roomId, request.gameId);
      const analysis = await analyzer.analyze(game);
      recordActivity({ category: "analysis", action: "admin-analysis", actor: socket.data.username!, target: request.roomId, details: `${game.moves.length} moves` });
      respond(analysis);
    } catch (error) {
      respond({ error: errorResponse(error) });
    } finally {
      if (jobStarted) analysisJobs -= 1;
      emitAdminDashboard();
    }
  });

  socket.on("admin:user:profile", (request: BanUserRequest, respond: (response: AdminUserProfile | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      const profile = auth.profile(socket.data.sessionToken!, request.username);
      profile.games = [...rooms.adminGames().filter((game) => game.status !== "finished" && [game.white, game.black].some((name) => name.toLowerCase() === request.username.toLowerCase())), ...history.forUser(request.username)];
      respond(profile);
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("admin:fairplay:create", async (request: FairPlayReviewRequest, respond: (response: FairPlayReview | { error: ServerError }) => void) => {
    let jobStarted = false;
    try {
      requireAdmin(socket, ["owner", "admin", "moderator"]);
      if (!config.get().featureFlags.fairPlayReview) throw new AuthError("Fair-play review is currently disabled.");
      if (!request.roomId || !request.username || !request.reason.trim()) throw new AuthError("A room, user, and review reason are required.");
      analysisJobs += 1;
      jobStarted = true;
      emitAdminDashboard();
      const selectedGame = snapshotForAdmin(request.roomId, request.gameId);
      const game = selectedGame.game;
      const analysis = await analyzer.analyze(game);
      const player = selectedGame.players.find((candidate) => candidate.kind === "human" && candidate.username?.toLowerCase() === request.username!.toLowerCase());
      if (!player) throw new RoomError("That user did not play in this game.");
      let timingsMs: number[] = [];
      try {
        if (rooms.snapshotById(request.roomId).gameInstanceId === selectedGame.gameInstanceId) timingsMs = rooms.adminMoveTimings(request.roomId, request.username);
      } catch { /* Archived games created before timing persistence can still be reviewed. */ }
      const review = fairPlay.create({ username: request.username, roomId: request.roomId, actor: socket.data.username!, reason: request.reason, color: player.color, analysis, timingsMs });
      recordActivity({ category: "fair-play", action: "review-created", actor: socket.data.username!, target: request.username, reason: request.reason, details: request.roomId });
      respond(review);
    } catch (error) {
      respond({ error: errorResponse(error) });
    } finally {
      if (jobStarted) analysisJobs -= 1;
      emitAdminDashboard();
    }
  });

  socket.on("admin:fairplay:decide", (request: FairPlayReviewRequest, respond: (response: FairPlayReview | { error: ServerError }) => void) => {
    try {
      requireAdmin(socket, ["owner", "admin", "moderator"]);
      if (!request.reviewId || !request.decision || !request.reason.trim()) throw new AuthError("A review decision and reason are required.");
      const review = fairPlay.decide(request.reviewId, request.decision, socket.data.username!, request.reason);
      recordActivity({ category: "fair-play", action: `review-${request.decision}`, actor: socket.data.username!, target: review.username, reason: request.reason, details: review.roomId });
      respond(review);
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:user:warn", (request: AdminUserActionRequest, respond: (response: AdminUserSummary[] | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      const users = auth.warnUser(socket.data.sessionToken!, request.username, request.reason);
      const warnedSockets = [...io.sockets.sockets.values()].filter((candidate) => candidate.data.username?.toLowerCase() === request.username.toLowerCase());
      if (warnedSockets.length) {
        const warnings = auth.claimWarningsForUser(request.username);
        for (const warnedSocket of warnedSockets) for (const warning of warnings) warnedSocket.emit("admin:warning", warning);
      }
      recordActivity({ category: "moderation", action: "warning", actor: socket.data.username!, target: request.username, reason: request.reason });
      respond(decorateUsers(users));
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:user:suspend", (request: AdminUserActionRequest, respond: (response: AdminUserSummary[] | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      const users = auth.suspendUser(socket.data.sessionToken!, request.username, request.reason, request.durationMinutes ?? 60);
      recordActivity({ category: "moderation", action: "temporary-suspension", actor: socket.data.username!, target: request.username, reason: request.reason, details: `${request.durationMinutes ?? 60} minutes` });
      disconnectUser(request.username, "admin:suspended");
      respond(decorateUsers(users));
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:user:signout", (request: AdminUserActionRequest, respond: (response: AdminUserSummary[] | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      const users = auth.forceSignOut(socket.data.sessionToken!, request.username);
      recordActivity({ category: "moderation", action: "force-sign-out", actor: socket.data.username!, target: request.username, reason: request.reason });
      disconnectUser(request.username, "admin:signed-out");
      respond(decorateUsers(users));
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:user:note", (request: AdminUserActionRequest, respond: (response: AdminUserProfile | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      const profile = auth.addNote(socket.data.sessionToken!, request.username, request.note ?? request.reason);
      recordActivity({ category: "moderation", action: "private-note", actor: socket.data.username!, target: request.username, reason: request.reason });
      respond(profile);
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:user:role", (request: AdminUserActionRequest, respond: (response: AdminUserSummary[] | { error: ServerError }) => void) => {
    try {
      requireAdmin(socket, ["owner"]);
      const users = auth.setRole(socket.data.sessionToken!, request.username, request.role ?? null);
      recordActivity({ category: "moderation", action: "role-changed", actor: socket.data.username!, target: request.username, reason: request.reason, details: request.role ?? "player" });
      disconnectUser(request.username, "admin:signed-out");
      respond(decorateUsers(users));
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("admin:ban", (request: BanUserRequest, respond: (response: AdminUserSummary[] | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      if (!request.reason?.trim()) throw new AuthError("A permanent ban reason is required.");
      const users = auth.banUser(socket.data.sessionToken!, request.username);
      recordActivity({ category: "moderation", action: "permanent-ban", actor: socket.data.username!, target: request.username, reason: request.reason ?? "No reason supplied" });
      disconnectUser(request.username, "admin:banned");
      respond(decorateUsers(users));
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("admin:unban", (request: BanUserRequest, respond: (response: AdminUserSummary[] | { error: ServerError }) => void) => {
    try {
      requireAuthenticated(socket);
      if (!request.reason?.trim()) throw new AuthError("An unban reason is required.");
      const users = auth.unbanUser(socket.data.sessionToken!, request.username);
      recordActivity({ category: "moderation", action: "unban", actor: socket.data.username!, target: request.username, reason: request.reason ?? "Ban lifted" });
      respond(decorateUsers(users));
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("room:create", (request: CreateHumanRoomRequest, respond: (response: unknown) => void) => {
    try {
      requireAuthenticated(socket);
      requireSiteAvailable(socket);
      matchmaking.cancel(socket.id);
      if (!request || !["rated", "casual"].includes(request.access)) throw new RoomError("Choose rated or casual play.");
      if (!config.get().timeControlsMs.includes(request.initialTimeMs)) throw new RoomError("Choose one of the enabled time controls.");
      if (request.access === "rated" && auth.isSuspended(socket.data.username!)) throw new AuthError("Suspended accounts cannot create rated games.");
      const pool = ratingPoolForTimeControl(request.initialTimeMs);
      const startingRating = request.access === "rated" && pool ? ratings.rating(socket.data.username!, pool).rating : 1200;
      const response = rooms.createRoom(socket.id, socket.data.username!, request, startingRating);
      socket.join(response.room.id);
      respond(response);
      io.to(response.room.id).emit("room:state", response.room);
      recordActivity({ category: "game", action: "room-created", actor: socket.data.username!, target: response.room.id, details: `${request.access} ${request.initialTimeMs}ms` });
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("matchmaking:join", (request: CreateHumanRoomRequest, respond: (response: unknown) => void) => {
    try {
      requireAuthenticated(socket); requireSiteAvailable(socket);
      if (!request || !["rated", "casual"].includes(request.access)) throw new MatchmakingError("Choose rated or casual matchmaking.");
      if (!config.get().timeControlsMs.includes(request.initialTimeMs)) throw new MatchmakingError("Choose one of the enabled time controls.");
      if (request.access === "rated" && auth.isSuspended(socket.data.username!)) throw new AuthError("Suspended accounts cannot enter rated matchmaking.");
      if (rooms.isSocketInUnfinishedRoom(socket.id)) throw new MatchmakingError("Leave your current game before searching for another opponent.");
      const result = matchmaking.join({ socketId: socket.id, username: socket.data.username!, access: request.access, initialTimeMs: request.initialTimeMs, joinedAt: Date.now() });
      if (result.status === "queued") {
        recordActivity({ category: "game", action: "matchmaking-queued", actor: socket.data.username!, details: `${request.access} ${request.initialTimeMs}ms` });
        respond({ status: "queued", access: request.access, initialTimeMs: request.initialTimeMs });
        return;
      }
      const firstSocket = io.sockets.sockets.get(result.first.socketId);
      if (!firstSocket) {
        matchmaking.join(result.second);
        respond({ status: "queued", access: request.access, initialTimeMs: request.initialTimeMs });
        return;
      }
      const [whiteTicket, blackTicket] = Math.random() < 0.5 ? [result.first, result.second] : [result.second, result.first];
      const whiteSocket = io.sockets.sockets.get(whiteTicket.socketId)!;
      const blackSocket = io.sockets.sockets.get(blackTicket.socketId)!;
      const pool = ratingPoolForTimeControl(request.initialTimeMs);
      const whiteRating = request.access === "rated" && pool ? ratings.rating(whiteTicket.username, pool).rating : 1200;
      const blackRating = request.access === "rated" && pool ? ratings.rating(blackTicket.username, pool).rating : 1200;
      const whiteJoin = rooms.createRoom(whiteTicket.socketId, whiteTicket.username, request, whiteRating);
      const blackJoin = rooms.joinRoom({ roomId: whiteJoin.room.id }, blackTicket.socketId, blackTicket.username, blackRating);
      let room = blackJoin.room;
      if (room.access === "rated" && room.ratingPool) room = configureRoomRatingDisplay(room.id);
      whiteSocket.join(room.id); blackSocket.join(room.id);
      whiteSocket.emit("matchmaking:matched", { ...whiteJoin, room });
      blackSocket.emit("matchmaking:matched", { ...blackJoin, room });
      io.to(room.id).emit("room:state", room);
      recordActivity({ category: "game", action: "matchmaking-matched", actor: whiteTicket.username, target: blackTicket.username, details: `${room.id} · ${request.access} ${request.initialTimeMs}ms` });
      respond({ status: "matched", access: request.access, initialTimeMs: request.initialTimeMs });
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("matchmaking:cancel", (respond: (response: unknown) => void) => {
    const cancelled = matchmaking.cancel(socket.id);
    if (cancelled && socket.data.username) recordActivity({ category: "game", action: "matchmaking-cancelled", actor: socket.data.username });
    respond({ status: "cancelled" });
  });

  socket.on("computer:create", (request: CreateComputerRoomRequest, respond: (response: unknown) => void) => {
    try {
      requireAuthenticated(socket);
      requireSiteAvailable(socket);
      matchmaking.cancel(socket.id);
      const currentConfig = config.get();
      if (!currentConfig.featureFlags.computerGames || !currentConfig.computerLevels.includes(request.level)) throw new RoomError("That computer mode is currently unavailable.");
      const response = rooms.createComputerRoom(request, socket.id, socket.data.username!);
      socket.join(response.room.id);
      respond(response);
      io.to(response.room.id).emit("room:state", response.room);
      recordActivity({ category: "game", action: "computer-game-created", actor: socket.data.username!, target: response.room.id, details: request.level });
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("room:join", (request: JoinRoomRequest, respond: (response: unknown) => void) => {
    try {
      requireAuthenticated(socket);
      requireSiteAvailable(socket);
      matchmaking.cancel(socket.id);
      const preview = rooms.snapshotById(request.roomId);
      if (preview.access === "rated" && auth.isSuspended(socket.data.username!)) throw new AuthError("Suspended accounts cannot join rated games.");
      const startingRating = preview.access === "rated" && preview.ratingPool ? ratings.rating(socket.data.username!, preview.ratingPool).rating : 1200;
      let response = rooms.joinRoom(request, socket.id, socket.data.username!, startingRating);
      if (response.room.access === "rated" && response.room.players.length === 2 && response.room.game.moves.length === 0) response = { ...response, room: configureRoomRatingDisplay(response.room.id) };
      socket.join(response.room.id);
      respond(response);
      io.to(response.room.id).emit("room:state", response.room);
      recordActivity({ category: "game", action: "room-joined", actor: socket.data.username!, target: response.room.id });
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("room:leave", (request: LeaveRoomRequest, respond: (response: unknown) => void) => {
    try {
      requireAuthenticated(socket);
      const room = rooms.leave(request, socket.id);
      socket.leave(room.id);
      respond({ room });
      io.to(room.id).emit("room:state", room);
      emitAdminDashboard();
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("game:move", (request: MoveRequest, respond: (response: unknown) => void) => {
    try {
      requireAuthenticated(socket);
      requireSiteAvailable(socket);
      const room = publishRoom(rooms.move(request, socket.id));
      respond({ room });
      playComputerTurn(room.id);
      emitAdminDashboard();
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("game:resign", (request: ResignGameRequest, respond: (response: unknown) => void) => {
    try {
      requireAuthenticated(socket);
      const room = publishRoom(rooms.resign(request, socket.id));
      respond({ room });
      emitAdminDashboard();
    } catch (error) { respond({ error: errorResponse(error) }); }
  });

  socket.on("game:restart", (request: RestartGameRequest, respond: (response: unknown) => void) => {
    try {
      requireAuthenticated(socket);
      let room = rooms.restart(request, socket.id);
      if (room.access === "rated" && room.ratingPool) room = configureRoomRatingDisplay(room.id);
      respond({ room });
      io.to(room.id).emit("room:state", room);
      emitAdminDashboard();
    } catch (error) {
      respond({ error: errorResponse(error) });
    }
  });

  socket.on("game:analyze", async (request: AnalyzeGameRequest, respond: (response: GameAnalysis | { error: ServerError }) => void) => {
    let jobStarted = false;
    try {
      requireAuthenticated(socket);
      if (!config.get().featureFlags.analysis) throw new RoomError("Game analysis is currently disabled.");
      const game = rooms.analysisGame(request, socket.id);
      analysisJobs += 1;
      jobStarted = true;
      emitAdminDashboard();
      respond(await analyzer.analyze(game));
      recordActivity({ category: "analysis", action: "analysis-completed", actor: socket.data.username!, target: request.roomId, details: `${game.moves.length} moves` });
    } catch (error) {
      app.log.error(error, "Game analysis failed");
      recordActivity({ category: "server", action: "analysis-error", actor: socket.data.username ?? "anonymous", target: request.roomId, details: error instanceof Error ? error.message : "Unknown error" });
      respond({ error: errorResponse(error) });
    } finally {
      if (jobStarted) analysisJobs -= 1;
      emitAdminDashboard();
    }
  });

  socket.on("disconnect", () => {
    matchmaking.cancel(socket.id);
    for (const room of rooms.disconnect(socket.id)) io.to(room.id).emit("room:state", room);
    if (socket.data.username) recordActivity({ category: "auth", action: "disconnect", actor: socket.data.username });
  });
});

function disconnectUser(username: string, event: string) {
  for (const connectedSocket of io.sockets.sockets.values()) {
    if (connectedSocket.data.username?.toLowerCase() === username.toLowerCase()) {
      connectedSocket.emit(event);
      connectedSocket.disconnect(true);
    }
  }
}

const port = Number(process.env.PORT ?? 3001);
await app.listen({ port, host: "0.0.0.0" });
