import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ChessColor, GameResult, TournamentDetail, TournamentListRequest, TournamentPairing, TournamentParticipant, TournamentSettings, TournamentState, TournamentSummary } from "@chessss/shared";
import { createSwissPairings } from "./swiss-pairing.js";

interface TournamentDatabase {
  version: 1;
  tournaments: TournamentDetail[];
  processedGameIds: string[];
}

export class TournamentError extends Error {}

const TERMINAL_PAIRING_STATES = new Set<TournamentPairing["status"]>(["finished", "forfeit", "double-forfeit", "bye"]);

export class TournamentService {
  private database: TournamentDatabase;

  constructor(private readonly filePath = resolve(process.cwd(), "data", "tournaments.json"), private readonly now: () => number = () => Date.now()) {
    this.database = this.load();
  }

  create(settings: TournamentSettings, actor: string): TournamentDetail {
    this.validateSettings(settings);
    const timestamp = this.timestamp();
    const tournament: TournamentDetail = {
      id: randomUUID(), state: "draft", settings: structuredClone(settings), playerCount: 0, currentRound: 0,
      createdAt: timestamp, createdBy: actor, participants: [], pairings: [],
    };
    this.mutate((database) => database.tournaments.push(tournament));
    return this.detail(tournament.id);
  }

  update(tournamentId: string, settings: TournamentSettings): TournamentDetail {
    this.validateSettings(settings);
    this.mutate((database) => {
      const tournament = this.find(database, tournamentId);
      if (tournament.state !== "draft") throw new TournamentError("Only draft tournaments can be edited.");
      tournament.settings = structuredClone(settings);
    });
    return this.detail(tournamentId);
  }

  list(request: TournamentListRequest = {}, username?: string, canManage = false): TournamentSummary[] {
    const values = this.database.tournaments.filter((tournament) => {
      const isCreator = Boolean(username) && this.sameUser(tournament.createdBy, username!);
      if (tournament.state === "draft" && !canManage && !isCreator) return false;
      if (request.tab === "mine") return Boolean(username) && (isCreator || tournament.participants.some((participant) => this.sameUser(participant.username, username!)));
      if (request.tab === "live") return ["active", "paused"].includes(tournament.state);
      if (request.tab === "completed") return ["completed", "cancelled"].includes(tournament.state);
      return ["registration", "check-in", ...(request.includeDrafts ? ["draft" as const] : [])].includes(tournament.state as "draft" | "registration" | "check-in");
    });
    return values.sort((left, right) => left.settings.startAt.localeCompare(right.settings.startAt) || left.id.localeCompare(right.id)).map((value) => this.summary(value));
  }

  detail(tournamentId: string): TournamentDetail {
    const tournament = structuredClone(this.find(this.database, tournamentId));
    this.recalculate(tournament);
    tournament.participants.sort((left, right) => this.compareStandings(tournament, left, right));
    return tournament;
  }

  transition(tournamentId: string, action: "open-registration" | "begin-check-in" | "pause" | "resume" | "cancel"): TournamentDetail {
    const allowed: Record<typeof action, TournamentState[]> = {
      "open-registration": ["draft"], "begin-check-in": ["registration"], pause: ["active"], resume: ["paused"], cancel: ["draft", "registration", "check-in", "active", "paused"],
    };
    const target: Record<typeof action, TournamentState> = {
      "open-registration": "registration", "begin-check-in": "check-in", pause: "paused", resume: "active", cancel: "cancelled",
    };
    this.mutate((database) => {
      const tournament = this.find(database, tournamentId);
      if (!allowed[action].includes(tournament.state)) throw new TournamentError(`Cannot ${action.replaceAll("-", " ")} from the current state.`);
      tournament.state = target[action];
      if (action === "cancel") {
        for (const pairing of tournament.pairings.filter((candidate) => !TERMINAL_PAIRING_STATES.has(candidate.status))) {
          pairing.result = { kind: "cancelled", winner: null };
          pairing.resultMethod = "cancelled";
          pairing.status = "finished";
          pairing.completedAt = this.timestamp();
        }
        this.recalculate(tournament);
      }
    });
    return this.detail(tournamentId);
  }

  register(tournamentId: string, username: string): TournamentDetail {
    this.mutate((database) => {
      const tournament = this.find(database, tournamentId);
      if (!["registration", "check-in"].includes(tournament.state)) throw new TournamentError("Registration is not open.");
      const now = this.now();
      if (tournament.state === "registration" && (now < new Date(tournament.settings.registrationOpensAt).getTime() || now > new Date(tournament.settings.registrationClosesAt).getTime())) throw new TournamentError("Registration is outside its scheduled window.");
      const existing = tournament.participants.find((participant) => this.sameUser(participant.username, username));
      if (existing && !existing.withdrawn) throw new TournamentError("You are already registered for this tournament.");
      if (tournament.participants.filter((participant) => !participant.withdrawn).length >= tournament.settings.capacity) throw new TournamentError("This tournament is full.");
      if (existing) { existing.withdrawn = false; existing.checkedIn = tournament.state === "check-in"; return; }
      tournament.participants.push(this.newParticipant(username, tournament.participants.length + 1));
      if (tournament.state === "check-in") tournament.participants.at(-1)!.checkedIn = true;
      tournament.playerCount = tournament.participants.filter((participant) => !participant.withdrawn).length;
    });
    return this.detail(tournamentId);
  }

  withdraw(tournamentId: string, username: string): TournamentDetail {
    this.mutate((database) => {
      const tournament = this.find(database, tournamentId);
      if (!["registration", "check-in"].includes(tournament.state)) throw new TournamentError("You can only withdraw before the event starts.");
      const participant = this.participant(tournament, username);
      if (participant.withdrawn) throw new TournamentError("You have already withdrawn from this tournament.");
      participant.withdrawn = true;
      participant.checkedIn = false;
      tournament.playerCount = tournament.participants.filter((participant) => !participant.withdrawn).length;
    });
    return this.detail(tournamentId);
  }

  checkIn(tournamentId: string, username: string): TournamentDetail {
    this.mutate((database) => {
      const tournament = this.find(database, tournamentId);
      if (tournament.state !== "check-in") throw new TournamentError("Check-in is not open.");
      const participant = this.participant(tournament, username);
      if (participant.withdrawn) throw new TournamentError("Withdrawn players cannot check in.");
      participant.checkedIn = true;
    });
    return this.detail(tournamentId);
  }

  start(tournamentId: string): TournamentDetail {
    this.mutate((database) => {
      const tournament = this.find(database, tournamentId);
      if (!["registration", "check-in"].includes(tournament.state)) throw new TournamentError("This tournament cannot be started now.");
      if (tournament.state === "check-in") for (const participant of tournament.participants) if (!participant.checkedIn) participant.withdrawn = true;
      if (this.activePlayers(tournament).length < 2) throw new TournamentError("At least two eligible players are required to start.");
      tournament.state = "active";
      this.generateRound(tournament);
    });
    return this.detail(tournamentId);
  }

  nextRound(tournamentId: string): TournamentDetail {
    this.mutate((database) => {
      const tournament = this.find(database, tournamentId);
      if (tournament.state !== "active") throw new TournamentError("The tournament is not active.");
      if (!this.roundComplete(tournament)) throw new TournamentError("The current round has unfinished games.");
      if (tournament.currentRound >= tournament.settings.rounds) { this.complete(tournament); return; }
      this.generateRound(tournament);
    });
    return this.detail(tournamentId);
  }

  attachRoom(tournamentId: string, pairingId: string, roomId: string, gameId: string): TournamentDetail {
    this.mutate((database) => {
      const tournament = this.find(database, tournamentId);
      const pairing = this.pairing(tournament, pairingId);
      if (pairing.bye || TERMINAL_PAIRING_STATES.has(pairing.status)) throw new TournamentError("That pairing does not need a game room.");
      if (pairing.roomId && (pairing.roomId !== roomId || pairing.gameId !== gameId)) throw new TournamentError("That pairing already has a room.");
      pairing.roomId = roomId;
      pairing.gameId = gameId;
      pairing.status = "waiting";
    });
    return this.detail(tournamentId);
  }

  markPairingActive(tournamentId: string, pairingId: string): TournamentDetail {
    this.mutate((database) => {
      const pairing = this.pairing(this.find(database, tournamentId), pairingId);
      if (pairing.status === "waiting") { pairing.status = "active"; pairing.startedAt ??= this.timestamp(); }
    });
    return this.detail(tournamentId);
  }

  processGame(gameId: string, result: GameResult): TournamentDetail | null {
    if (this.database.processedGameIds.includes(gameId)) return null;
    let tournamentId: string | undefined;
    this.mutate((database) => {
      for (const tournament of database.tournaments) {
        const pairing = tournament.pairings.find((candidate) => candidate.gameId === gameId);
        if (!pairing) continue;
        tournamentId = tournament.id;
        if (TERMINAL_PAIRING_STATES.has(pairing.status)) { database.processedGameIds.push(gameId); return; }
        this.applyResult(tournament, pairing, result, result.kind === "cancelled" ? "finished" : "finished");
        database.processedGameIds.push(gameId);
        if (["active", "paused"].includes(tournament.state) && tournament.currentRound >= tournament.settings.rounds && this.roundComplete(tournament)) this.complete(tournament);
        return;
      }
      throw new TournamentError("No tournament pairing matches that game.");
    });
    return tournamentId ? this.detail(tournamentId) : null;
  }

  forfeit(tournamentId: string, pairingId: string, winner: ChessColor | null): TournamentDetail {
    this.mutate((database) => {
      const tournament = this.find(database, tournamentId);
      const pairing = this.pairing(tournament, pairingId);
      if (TERMINAL_PAIRING_STATES.has(pairing.status)) throw new TournamentError("That pairing is already complete.");
      const deadline = new Date(pairing.startedAt ?? this.timestamp()).getTime() + tournament.settings.noShowDeadlineMs;
      if (this.now() < deadline) throw new TournamentError("The no-show deadline has not passed.");
      this.applyResult(tournament, pairing, { kind: "forfeit", winner }, winner ? "forfeit" : "double-forfeit");
      if (pairing.gameId && !database.processedGameIds.includes(pairing.gameId)) database.processedGameIds.push(pairing.gameId);
      if (["active", "paused"].includes(tournament.state) && tournament.currentRound >= tournament.settings.rounds && this.roundComplete(tournament)) this.complete(tournament);
    });
    return this.detail(tournamentId);
  }

  disqualify(tournamentId: string, username: string): TournamentDetail {
    this.mutate((database) => {
      const tournament = this.find(database, tournamentId);
      if (["completed", "cancelled"].includes(tournament.state)) throw new TournamentError("A finished tournament cannot be changed.");
      const participant = this.participant(tournament, username);
      if (participant.disqualified) throw new TournamentError("That participant is already disqualified.");
      participant.disqualified = true;
      const pairing = tournament.pairings.find((candidate) => candidate.round === tournament.currentRound && !TERMINAL_PAIRING_STATES.has(candidate.status) && [candidate.white, candidate.black].some((name) => name && this.sameUser(name, username)));
      if (pairing?.white && pairing.black) {
        const winner: ChessColor = this.sameUser(pairing.white, username) ? "black" : "white";
        this.applyResult(tournament, pairing, { kind: "forfeit", winner }, "forfeit");
        if (pairing.gameId && !database.processedGameIds.includes(pairing.gameId)) database.processedGameIds.push(pairing.gameId);
      }
    });
    return this.detail(tournamentId);
  }

  replaceMissingRoom(tournamentId: string, pairingId: string): TournamentDetail {
    this.mutate((database) => {
      const pairing = this.pairing(this.find(database, tournamentId), pairingId);
      if (TERMINAL_PAIRING_STATES.has(pairing.status)) throw new TournamentError("A completed pairing cannot receive a new room.");
      delete pairing.roomId;
      delete pairing.gameId;
      pairing.status = "waiting";
    });
    return this.detail(tournamentId);
  }

  delete(tournamentId: string): TournamentDetail {
    const tournament = this.detail(tournamentId);
    this.mutate((database) => {
      const index = database.tournaments.findIndex((candidate) => candidate.id === tournamentId);
      if (index < 0) throw new TournamentError("Tournament not found.");
      database.tournaments.splice(index, 1);
    });
    return tournament;
  }

  standings(tournamentId: string): TournamentParticipant[] { return this.detail(tournamentId).participants; }

  correctResult(tournamentId: string, pairingId: string, result: GameResult): TournamentDetail {
    this.mutate((database) => {
      const tournament = this.find(database, tournamentId);
      const pairing = this.pairing(tournament, pairingId);
      if (!TERMINAL_PAIRING_STATES.has(pairing.status) || pairing.status === "bye") throw new TournamentError("Only a completed played pairing can be corrected.");
      pairing.result = structuredClone(result);
      pairing.resultMethod = result.kind;
      pairing.status = result.kind === "forfeit" ? (result.winner ? "forfeit" : "double-forfeit") : "finished";
      pairing.completedAt = this.timestamp();
      this.recalculate(tournament);
      if (tournament.state === "completed") this.complete(tournament);
    });
    return this.detail(tournamentId);
  }

  private generateRound(tournament: TournamentDetail) {
    tournament.currentRound += 1;
    const drafts = createSwissPairings(this.activePlayers(tournament));
    for (const draft of drafts) {
      const pairing: TournamentPairing = {
        id: randomUUID(), tournamentId: tournament.id, round: tournament.currentRound,
        ...draft, status: draft.bye ? "bye" : "waiting",
        startedAt: draft.bye ? undefined : new Date(this.now() + tournament.settings.roundStartDelayMs).toISOString(),
      };
      tournament.pairings.push(pairing);
      if (draft.bye) {
        const player = this.participant(tournament, draft.bye);
        player.byeReceived = true;
        pairing.result = { kind: "forfeit", winner: null };
        pairing.resultMethod = "forfeit";
        pairing.completedAt = this.timestamp();
      } else {
        this.participant(tournament, draft.white!).colorHistory.push("white");
        this.participant(tournament, draft.black!).colorHistory.push("black");
      }
    }
    this.recalculate(tournament);
  }

  private applyResult(tournament: TournamentDetail, pairing: TournamentPairing, result: GameResult, status: TournamentPairing["status"]) {
    pairing.result = structuredClone(result);
    pairing.resultMethod = result.kind;
    pairing.status = status;
    pairing.completedAt = this.timestamp();
    this.recalculate(tournament);
  }

  private recalculate(tournament: TournamentDetail) {
    for (const participant of tournament.participants) {
      participant.score = 0; participant.buchholz = 0; participant.wins = 0; participant.cumulativeScore = 0; participant.opponentHistory = [];
    }
    for (let round = 1; round <= tournament.currentRound; round += 1) {
      for (const pairing of tournament.pairings.filter((candidate) => candidate.round === round && TERMINAL_PAIRING_STATES.has(candidate.status))) {
        if (pairing.status === "bye" && pairing.bye) {
          const player = this.participant(tournament, pairing.bye);
          player.score += 1; player.wins += 1;
        } else if (pairing.result && pairing.result.kind !== "cancelled" && pairing.white && pairing.black) {
          const white = this.participant(tournament, pairing.white);
          const black = this.participant(tournament, pairing.black);
          white.opponentHistory.push(black.username); black.opponentHistory.push(white.username);
          const whiteScore = pairing.result.winner === null ? (pairing.result.kind === "forfeit" ? 0 : 0.5) : pairing.result.winner === "white" ? 1 : 0;
          const blackScore = pairing.result.winner === null ? (pairing.result.kind === "forfeit" ? 0 : 0.5) : 1 - whiteScore;
          white.score += whiteScore; black.score += blackScore;
          if (whiteScore === 1) white.wins += 1;
          if (blackScore === 1) black.wins += 1;
        }
      }
      for (const participant of tournament.participants) participant.cumulativeScore += participant.score;
    }
    const scores = new Map(tournament.participants.map((participant) => [participant.username.toLowerCase(), participant.score]));
    for (const participant of tournament.participants) participant.buchholz = participant.opponentHistory.reduce((sum, opponent) => sum + (scores.get(opponent.toLowerCase()) ?? 0), 0);
    tournament.playerCount = tournament.participants.filter((participant) => !participant.withdrawn).length;
  }

  private compareStandings(tournament: TournamentDetail, left: TournamentParticipant, right: TournamentParticipant) {
    const headToHead = tournament.pairings.find((pairing) => pairing.result?.winner && pairing.white && pairing.black && [pairing.white.toLowerCase(), pairing.black.toLowerCase()].includes(left.username.toLowerCase()) && [pairing.white.toLowerCase(), pairing.black.toLowerCase()].includes(right.username.toLowerCase()));
    const headWinner = headToHead?.result?.winner ? (headToHead.result.winner === "white" ? headToHead.white : headToHead.black) : undefined;
    return right.score - left.score || right.buchholz - left.buchholz || right.wins - left.wins
      || (headWinner ? (this.sameUser(headWinner, left.username) ? -1 : 1) : 0)
      || right.cumulativeScore - left.cumulativeScore || left.seed - right.seed;
  }

  private complete(tournament: TournamentDetail) {
    tournament.state = "completed";
    this.recalculate(tournament);
    [...tournament.participants].sort((left, right) => this.compareStandings(tournament, left, right)).forEach((participant, index) => { participant.finalPlace = index + 1; });
  }

  private roundComplete(tournament: TournamentDetail) {
    const round = tournament.pairings.filter((pairing) => pairing.round === tournament.currentRound);
    return round.length > 0 && round.every((pairing) => TERMINAL_PAIRING_STATES.has(pairing.status));
  }

  private activePlayers(tournament: TournamentDetail) { return tournament.participants.filter((participant) => !participant.withdrawn && !participant.disqualified); }
  private pairing(tournament: TournamentDetail, pairingId: string) { const value = tournament.pairings.find((candidate) => candidate.id === pairingId); if (!value) throw new TournamentError("Pairing not found."); return value; }
  private participant(tournament: TournamentDetail, username: string) { const value = tournament.participants.find((candidate) => this.sameUser(candidate.username, username)); if (!value) throw new TournamentError("You are not registered for this tournament."); return value; }
  private sameUser(left: string, right: string) { return left.toLowerCase() === right.toLowerCase(); }
  private summary(tournament: TournamentDetail): TournamentSummary { return { id: tournament.id, state: tournament.state, settings: structuredClone(tournament.settings), playerCount: tournament.playerCount, currentRound: tournament.currentRound }; }
  private timestamp() { return new Date(this.now()).toISOString(); }

  private newParticipant(username: string, seed: number): TournamentParticipant {
    return { username, registeredAt: this.timestamp(), checkedIn: false, score: 0, buchholz: 0, wins: 0, cumulativeScore: 0, colorHistory: [], opponentHistory: [], byeReceived: false, withdrawn: false, disqualified: false, seed };
  }

  private validateSettings(settings: TournamentSettings) {
    if (!settings.name.trim() || settings.name.trim().length > 80) throw new TournamentError("Tournament name must be 1–80 characters.");
    if (!Number.isInteger(settings.capacity) || settings.capacity < 4 || settings.capacity > 32) throw new TournamentError("Tournament capacity must be 4–32 players.");
    if (!Number.isInteger(settings.rounds) || settings.rounds < 3 || settings.rounds > 7) throw new TournamentError("Swiss tournaments must have 3–7 rounds.");
    if (!Number.isFinite(settings.initialTimeMs) || settings.initialTimeMs <= 0) throw new TournamentError("Choose a valid time control.");
    if (settings.description.length > 500) throw new TournamentError("Tournament description must be 500 characters or fewer.");
    if (!Number.isInteger(settings.roundStartDelayMs) || settings.roundStartDelayMs < 0 || settings.roundStartDelayMs > 15 * 60_000) throw new TournamentError("Round delay must be between 0 and 15 minutes.");
    if (!Number.isInteger(settings.noShowDeadlineMs) || settings.noShowDeadlineMs < 0 || settings.noShowDeadlineMs > 60 * 60_000) throw new TournamentError("No-show deadline must be between 0 and 60 minutes.");
    const registrationOpen = new Date(settings.registrationOpensAt).getTime();
    const registrationClose = new Date(settings.registrationClosesAt).getTime();
    const checkInOpen = settings.checkInOpensAt ? new Date(settings.checkInOpensAt).getTime() : registrationClose;
    const start = new Date(settings.startAt).getTime();
    if ([registrationOpen, registrationClose, checkInOpen, start].some(Number.isNaN) || registrationOpen >= registrationClose || registrationClose > start || checkInOpen < registrationOpen || checkInOpen > start) throw new TournamentError("Tournament schedule is invalid.");
  }

  private find(database: TournamentDatabase, tournamentId: string) { const value = database.tournaments.find((candidate) => candidate.id === tournamentId); if (!value) throw new TournamentError("Tournament not found."); return value; }
  private mutate(operation: (database: TournamentDatabase) => void) { const candidate = structuredClone(this.database); operation(candidate); this.commit(candidate); }
  private load(): TournamentDatabase {
    const empty: TournamentDatabase = { version: 1, tournaments: [], processedGameIds: [] };
    if (!existsSync(this.filePath)) return empty;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<TournamentDatabase>;
      return { version: 1, tournaments: Array.isArray(parsed.tournaments) ? parsed.tournaments.filter((value) => value && typeof value.id === "string" && Array.isArray(value.participants) && Array.isArray(value.pairings)) : [], processedGameIds: Array.isArray(parsed.processedGameIds) ? parsed.processedGameIds.filter((value): value is string => typeof value === "string") : [] };
    } catch { throw new TournamentError("The tournament database could not be read."); }
  }
  private commit(database: TournamentDatabase) { mkdirSync(dirname(this.filePath), { recursive: true }); const temporary = `${this.filePath}.tmp`; writeFileSync(temporary, JSON.stringify(database, null, 2), { mode: 0o600 }); renameSync(temporary, this.filePath); this.database = database; }
}
