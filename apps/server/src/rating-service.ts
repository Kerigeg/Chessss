import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ChessColor, GameMode, GameResult, LeaderboardRequest, LeaderboardResponse, PublicRatingProfile, RatedGameOutcome, RatingHistoryEntry, RatingPool, RatingRecord } from "@chessss/shared";

const STARTING_RATING = 1200;
const PROVISIONAL_GAMES = 10;
const LEADERBOARD_GAMES = 5;
const ACTIVE_PERIOD_MS = 30 * 24 * 60 * 60_000;
const REPEAT_WINDOW_MS = 24 * 60 * 60_000;
const FULL_RATED_MATCHES_PER_WINDOW = 3;
const POOLS: RatingPool[] = ["bullet", "blitz", "rapid"];

interface ProcessedResult extends RatedGameOutcome { processedAt: string; }

interface RatingDatabase {
  version: 1;
  records: RatingRecord[];
  history: RatingHistoryEntry[];
  processed: ProcessedResult[];
  encounters: Array<{ gameId: string; players: [string, string]; timestamp: string }>;
}

export interface RatingGameInput {
  gameId: string;
  roomId: string;
  mode: GameMode;
  access: "rated" | "casual";
  initialTimeMs: number;
  white: string;
  black: string;
  result: GameResult | null;
  tournamentId?: string;
}

export class RatingError extends Error {}

export function ratingPoolForTimeControl(initialTimeMs: number): RatingPool | null {
  if (initialTimeMs < 180_000) return "bullet";
  if (initialTimeMs <= 420_000) return "blitz";
  if (initialTimeMs <= 1_800_000) return "rapid";
  return null;
}

export function expectedScore(playerRating: number, opponentRating: number): number {
  return 1 / (1 + 10 ** ((opponentRating - playerRating) / 400));
}

export function calculateElo(playerRating: number, opponentRating: number, score: number, ratedGames: number): number {
  const k = ratedGames < PROVISIONAL_GAMES ? 40 : 20;
  return Math.round(playerRating + k * (score - expectedScore(playerRating, opponentRating)));
}

export class RatingService {
  private database: RatingDatabase;

  constructor(private readonly filePath = resolve(process.cwd(), "data", "ratings.json"), private readonly now: () => number = () => Date.now()) {
    this.database = this.load();
  }

  ensurePlayer(username: string) {
    const candidate = structuredClone(this.database);
    const timestamp = new Date(this.now()).toISOString();
    let changed = false;
    for (const pool of POOLS) if (!this.findRecord(candidate, username, pool)) {
      candidate.records.push(this.newRecord(username, pool, timestamp));
      changed = true;
    }
    if (changed) this.commit(candidate);
  }

  rating(username: string, pool: RatingPool): RatingRecord {
    this.ensurePlayer(username);
    return structuredClone(this.findRecord(this.database, username, pool)!);
  }

  estimate(username: string, opponent: string, pool: RatingPool): { win: number; draw: number; loss: number } {
    const player = this.rating(username, pool);
    const opponentRecord = this.rating(opponent, pool);
    return {
      win: calculateElo(player.rating, opponentRecord.rating, 1, player.ratedGames) - player.rating,
      draw: calculateElo(player.rating, opponentRecord.rating, 0.5, player.ratedGames) - player.rating,
      loss: calculateElo(player.rating, opponentRecord.rating, 0, player.ratedGames) - player.rating,
    };
  }

  processCompletedGame(input: RatingGameInput): RatedGameOutcome {
    const existing = this.database.processed.find((result) => result.gameId === input.gameId);
    if (existing) {
      const { processedAt: _processedAt, ...outcome } = existing;
      return structuredClone(outcome);
    }

    const pool = ratingPoolForTimeControl(input.initialTimeMs);
    const ineligibleReason = this.ineligibleReason(input, pool);
    if (ineligibleReason) return this.recordUnrated(input, pool, ineligibleReason);

    const candidate = structuredClone(this.database);
    const timestamp = new Date(this.now()).toISOString();
    this.ensureRecord(candidate, input.white, pool!, timestamp);
    this.ensureRecord(candidate, input.black, pool!, timestamp);
    const white = this.findRecord(candidate, input.white, pool!)!;
    const black = this.findRecord(candidate, input.black, pool!)!;
    const whiteBefore = white.rating;
    const blackBefore = black.rating;
    const whiteScore = input.result!.winner === null ? 0.5 : input.result!.winner === "white" ? 1 : 0;
    const blackScore = 1 - whiteScore;
    const whiteAfter = calculateElo(whiteBefore, blackBefore, whiteScore, white.ratedGames);
    const blackAfter = calculateElo(blackBefore, whiteBefore, blackScore, black.ratedGames);

    this.updateRecord(white, whiteAfter, whiteScore, timestamp);
    this.updateRecord(black, blackAfter, blackScore, timestamp);
    const outcome: RatedGameOutcome = {
      gameId: input.gameId,
      roomId: input.roomId,
      pool,
      rated: true,
      white: { username: input.white, ratingBefore: whiteBefore, ratingAfter: whiteAfter, ratingChange: whiteAfter - whiteBefore, opponentRating: blackBefore },
      black: { username: input.black, ratingBefore: blackBefore, ratingAfter: blackAfter, ratingChange: blackAfter - blackBefore, opponentRating: whiteBefore },
    };
    candidate.history.push(
      this.historyEntry(input, "white", whiteBefore, whiteAfter, whiteScore, pool!, timestamp),
      this.historyEntry(input, "black", blackBefore, blackAfter, blackScore, pool!, timestamp),
    );
    candidate.processed.push({ ...outcome, processedAt: timestamp });
    candidate.encounters.push({ gameId: input.gameId, players: this.playerKey(input.white, input.black), timestamp });
    this.commit(candidate);
    return structuredClone(outcome);
  }

  leaderboard(request: LeaderboardRequest, isEligibleAccount: (username: string) => boolean = () => true): LeaderboardResponse {
    const pageSize = Math.min(100, Math.max(1, Math.floor(request.pageSize ?? 25)));
    const page = Math.max(1, Math.floor(request.page ?? 1));
    const search = request.search?.trim().toLowerCase() ?? "";
    const cutoff = this.now() - ACTIVE_PERIOD_MS;
    const view = request.view ?? "all-time";
    const year = new Date(this.now()).getUTCFullYear();
    const seasonStart = Date.UTC(year, 0, 1);
    const reversed = new Set(this.database.history.flatMap((entry) => entry.reversalOf ? [entry.reversalOf] : []));
    const records = this.database.records.map((record) => {
      if (view === "all-time") return record;
      const games = this.database.history.filter((entry) => entry.username.toLowerCase() === record.username.toLowerCase() && entry.pool === record.pool && !entry.reversalOf && !reversed.has(entry.gameId) && new Date(entry.timestamp).getTime() >= seasonStart);
      let streak = 0; let best = 0;
      for (const game of games) { streak = game.result === "win" ? streak + 1 : 0; best = Math.max(best, streak); }
      return { ...record, ratedGames: games.length, wins: games.filter((game) => game.result === "win").length, draws: games.filter((game) => game.result === "draw").length, losses: games.filter((game) => game.result === "loss").length, currentWinStreak: streak, bestWinStreak: best, lastActivityAt: games.at(-1)?.timestamp };
    });
    const ranked = records
      .filter((record) => record.pool === request.pool && record.ratedGames >= LEADERBOARD_GAMES && Boolean(record.lastActivityAt) && new Date(record.lastActivityAt!).getTime() >= cutoff)
      .filter((record) => isEligibleAccount(record.username) && (!search || record.username.toLowerCase().includes(search)))
      .sort((left, right) => right.rating - left.rating || right.ratedGames - left.ratedGames || (right.lastActivityAt ?? "").localeCompare(left.lastActivityAt ?? "") || left.username.localeCompare(right.username));
    const start = (page - 1) * pageSize;
    return {
      pool: request.pool,
      view,
      page,
      pageSize,
      total: ranked.length,
      entries: ranked.slice(start, start + pageSize).map((record, index) => ({ ...structuredClone(record), rank: start + index + 1, latestRatingChange: this.latestChange(record.username, request.pool) })),
    };
  }

  profile(username: string, includeEligibilityProgress = false): PublicRatingProfile {
    this.ensurePlayer(username);
    const display = this.database.records.find((record) => record.username.toLowerCase() === username.toLowerCase())?.username ?? username;
    const ratings = this.database.records.filter((record) => record.username.toLowerCase() === username.toLowerCase()).map((record) => structuredClone(record));
    const history = this.database.history.filter((entry) => entry.username.toLowerCase() === username.toLowerCase()).slice(-50).reverse().map((entry) => structuredClone(entry));
    return {
      username: display,
      ratings,
      history,
      ...(includeEligibilityProgress ? { leaderboardProgress: Object.fromEntries(ratings.map((record) => [record.pool, { qualifyingGames: Math.min(LEADERBOARD_GAMES, record.ratedGames), gamesRequired: LEADERBOARD_GAMES }])) } : {}),
    };
  }

  processed(gameId: string): RatedGameOutcome | null {
    return structuredClone(this.database.processed.find((entry) => entry.gameId === gameId) ?? null);
  }

  latestReversibleGameForRoom(roomId: string): string | null {
    const reversed = new Set(this.database.history.flatMap((entry) => entry.reversalOf ? [entry.reversalOf] : []));
    return [...this.database.processed].reverse().find((entry) => entry.roomId === roomId && entry.rated && !reversed.has(entry.gameId))?.gameId ?? null;
  }

  reverse(gameId: string, actor: string): RatingHistoryEntry[] {
    const original = this.database.processed.find((entry) => entry.gameId === gameId && entry.rated);
    if (!original?.white || !original.black || !original.pool) throw new RatingError("That game has no rating transaction to reverse.");
    if (this.database.history.some((entry) => entry.reversalOf === gameId)) throw new RatingError("That rating transaction has already been reversed.");
    const candidate = structuredClone(this.database);
    const timestamp = new Date(this.now()).toISOString();
    const entries: RatingHistoryEntry[] = [];
    for (const side of ["white", "black"] as const) {
      const player = original[side]!;
      const record = this.findRecord(candidate, player.username, original.pool)!;
      const before = record.rating;
      record.rating -= player.ratingChange;
      const originalHistory = candidate.history.find((entry) => entry.gameId === gameId && entry.username.toLowerCase() === player.username.toLowerCase());
      record.ratedGames = Math.max(0, record.ratedGames - 1);
      if (originalHistory?.result === "win") record.wins = Math.max(0, record.wins - 1);
      if (originalHistory?.result === "draw") record.draws = Math.max(0, record.draws - 1);
      if (originalHistory?.result === "loss") record.losses = Math.max(0, record.losses - 1);
      record.provisional = record.ratedGames < PROVISIONAL_GAMES;
      const reversedGameIds = new Set(candidate.history.flatMap((entry) => entry.reversalOf ? [entry.reversalOf] : []));
      reversedGameIds.add(gameId);
      const validResults = candidate.history
        .filter((entry) => entry.username.toLowerCase() === player.username.toLowerCase() && entry.pool === original.pool && !entry.reversalOf && !reversedGameIds.has(entry.gameId))
        .sort((left, right) => left.timestamp.localeCompare(right.timestamp));
      let streak = 0; let best = 0;
      for (const result of validResults) { streak = result.result === "win" ? streak + 1 : 0; best = Math.max(best, streak); }
      record.currentWinStreak = streak; record.bestWinStreak = best;
      record.lastActivityAt = timestamp;
      const entry: RatingHistoryEntry = {
        id: randomUUID(), gameId: `${gameId}:reversal`, roomId: original.roomId, username: player.username,
        opponent: side === "white" ? original.black.username : original.white.username, pool: original.pool,
        ratingBefore: before, ratingAfter: record.rating, ratingChange: -player.ratingChange, result: "draw",
        resultMethod: "admin-decision", timestamp, reversalOf: gameId,
      };
      candidate.history.push(entry);
      entries.push(entry);
    }
    candidate.encounters = candidate.encounters.filter((encounter) => encounter.gameId !== gameId);
    candidate.processed.push({ gameId: `${gameId}:reversal`, roomId: original.roomId, pool: original.pool, rated: false, reason: `Reversed by ${actor}`, processedAt: timestamp });
    this.commit(candidate);
    return entries;
  }

  private ineligibleReason(input: RatingGameInput, pool: RatingPool | null): string | null {
    if (input.mode !== "human") return "Computer games are unrated.";
    if (input.access !== "rated") return "This was a casual game.";
    if (!pool) return "This time control has no rating pool.";
    if (!input.result) return "The game has no accepted result.";
    if (["admin-decision", "forfeit", "cancelled"].includes(input.result.kind)) return "Administrative and cancelled results do not affect ratings.";
    const players = this.playerKey(input.white, input.black);
    const cutoff = this.now() - REPEAT_WINDOW_MS;
    const recent = this.database.encounters.filter((entry) => entry.players[0] === players[0] && entry.players[1] === players[1] && new Date(entry.timestamp).getTime() >= cutoff).length;
    if (recent >= FULL_RATED_MATCHES_PER_WINDOW) return "Only the first three rated games between the same players within 24 hours affect ratings.";
    return null;
  }

  private recordUnrated(input: RatingGameInput, pool: RatingPool | null, reason: string): RatedGameOutcome {
    const candidate = structuredClone(this.database);
    const timestamp = new Date(this.now()).toISOString();
    const outcome: RatedGameOutcome = { gameId: input.gameId, roomId: input.roomId, pool, rated: false, reason };
    candidate.processed.push({ ...outcome, processedAt: timestamp });
    this.commit(candidate);
    return outcome;
  }

  private updateRecord(record: RatingRecord, rating: number, score: number, timestamp: string) {
    record.rating = rating;
    record.peakRating = Math.max(record.peakRating, rating);
    record.ratedGames += 1;
    record.provisional = record.ratedGames < PROVISIONAL_GAMES;
    if (score === 1) { record.wins += 1; record.currentWinStreak += 1; record.bestWinStreak = Math.max(record.bestWinStreak, record.currentWinStreak); }
    else if (score === 0.5) { record.draws += 1; record.currentWinStreak = 0; }
    else { record.losses += 1; record.currentWinStreak = 0; }
    record.lastRatedGameAt = timestamp;
    record.lastActivityAt = timestamp;
  }

  private historyEntry(input: RatingGameInput, color: ChessColor, before: number, after: number, score: number, pool: RatingPool, timestamp: string): RatingHistoryEntry {
    return {
      id: randomUUID(), gameId: input.gameId, roomId: input.roomId,
      username: color === "white" ? input.white : input.black,
      opponent: color === "white" ? input.black : input.white,
      pool, ratingBefore: before, ratingAfter: after, ratingChange: after - before,
      result: score === 1 ? "win" : score === 0.5 ? "draw" : "loss",
      resultMethod: input.result!.kind, timestamp, tournamentId: input.tournamentId,
    };
  }

  private latestChange(username: string, pool: RatingPool): number {
    return [...this.database.history].reverse().find((entry) => entry.username.toLowerCase() === username.toLowerCase() && entry.pool === pool)?.ratingChange ?? 0;
  }

  private playerKey(left: string, right: string): [string, string] {
    return [left.toLowerCase(), right.toLowerCase()].sort() as [string, string];
  }

  private findRecord(database: RatingDatabase, username: string, pool: RatingPool): RatingRecord | undefined {
    return database.records.find((record) => record.pool === pool && record.username.toLowerCase() === username.toLowerCase());
  }

  private ensureRecord(database: RatingDatabase, username: string, pool: RatingPool, timestamp: string) {
    if (!this.findRecord(database, username, pool)) database.records.push(this.newRecord(username, pool, timestamp));
  }

  private newRecord(username: string, pool: RatingPool, timestamp: string): RatingRecord {
    return { username, pool, rating: STARTING_RATING, peakRating: STARTING_RATING, ratedGames: 0, wins: 0, draws: 0, losses: 0, provisional: true, currentWinStreak: 0, bestWinStreak: 0, lastActivityAt: timestamp };
  }

  private load(): RatingDatabase {
    const empty: RatingDatabase = { version: 1, records: [], history: [], processed: [], encounters: [] };
    if (!existsSync(this.filePath)) return empty;
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<RatingDatabase>;
      return {
        version: 1,
        records: Array.isArray(parsed.records) ? parsed.records.filter((record) => record && POOLS.includes(record.pool) && typeof record.username === "string") : [],
        history: Array.isArray(parsed.history) ? parsed.history.filter((entry) => entry && typeof entry.gameId === "string") : [],
        processed: Array.isArray(parsed.processed) ? parsed.processed.filter((entry) => entry && typeof entry.gameId === "string") : [],
        encounters: Array.isArray(parsed.encounters) ? parsed.encounters.filter((entry) => entry && Array.isArray(entry.players)) : [],
      };
    } catch { throw new RatingError("The rating database could not be read."); }
  }

  private commit(candidate: RatingDatabase) {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(candidate, null, 2), { mode: 0o600 });
    renameSync(temporary, this.filePath);
    this.database = candidate;
  }
}
