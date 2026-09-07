import { useEffect, useState } from "react";
import type { Socket } from "socket.io-client";
import type { LeaderboardResponse, PublicRatingProfile, RatingPool, ServerError } from "@chessss/shared";

type Ack<T extends object> = T | { error: ServerError };
const pools: RatingPool[] = ["bullet", "blitz", "rapid"];
const hasError = <T extends object,>(response: Ack<T>): response is { error: ServerError } => "error" in response;

export function LeaderboardView({ socket, onNotice }: { socket: Socket; onNotice: (message: string) => void }) {
  const [pool, setPool] = useState<RatingPool>("blitz");
  const [view, setView] = useState<"season" | "all-time">("all-time");
  const [search, setSearch] = useState("");
  const [board, setBoard] = useState<LeaderboardResponse | null>(null);
  const [profile, setProfile] = useState<PublicRatingProfile | null>(null);

  useEffect(() => {
    socket.emit("rating:leaderboard", { pool, view, pageSize: 50, search }, (response: Ack<LeaderboardResponse>) => {
      if (hasError(response)) return onNotice(response.error.message);
      setBoard(response);
    });
  }, [socket, pool, view, search, onNotice]);

  function openProfile(username: string) {
    socket.emit("rating:profile", { username }, (response: Ack<PublicRatingProfile>) => {
      if (hasError(response)) return onNotice(response.error.message);
      setProfile(response);
    });
  }

  if (profile) return <RatingProfileCard profile={profile} onClose={() => setProfile(null)} />;
  return <section className="ranking-page card">
    <p className="eyebrow">COMPETITIVE</p><h2>Leaderboards</h2>
    <div className="ranking-toolbar"><div className="pool-tabs">{pools.map((value) => <button className={pool === value ? "active" : ""} onClick={() => setPool(value)} key={value}>{value}</button>)}</div><div className="pool-tabs"><button className={view === "season" ? "active" : ""} onClick={() => setView("season")}>Current season</button><button className={view === "all-time" ? "active" : ""} onClick={() => setView("all-time")}>All-time</button></div><input aria-label="Search leaderboard" placeholder="Search player…" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
    <div className="ranking-table ranking-header"><span>#</span><span>Player</span><span>Rating</span><span>Last</span><span>Games</span><span>W/D/L</span><span>Streak</span><span>Active</span></div>
    {board?.entries.length ? board.entries.map((entry) => <button className="ranking-table ranking-row" key={entry.username} onClick={() => openProfile(entry.username)}>
      <span>{entry.rank}</span><strong>{entry.username}{entry.provisional && <small>PROVISIONAL</small>}</strong><span>{entry.rating}</span><span className={entry.latestRatingChange >= 0 ? "gain" : "loss"}>{entry.latestRatingChange >= 0 ? "+" : ""}{entry.latestRatingChange}</span><span>{entry.ratedGames}</span><span>{entry.wins}/{entry.draws}/{entry.losses}</span><span>{entry.currentWinStreak}</span><span>{entry.lastActivityAt ? new Date(entry.lastActivityAt).toLocaleDateString() : "—"}</span>
    </button>) : <p>No eligible players in this pool yet. Five rated games are required.</p>}
  </section>;
}

export function OwnProfileView({ socket, username, onNotice }: { socket: Socket; username: string; onNotice: (message: string) => void }) {
  const [profile, setProfile] = useState<PublicRatingProfile | null>(null);
  useEffect(() => { socket.emit("rating:profile", { username }, (response: Ack<PublicRatingProfile>) => hasError(response) ? onNotice(response.error.message) : setProfile(response)); }, [socket, username, onNotice]);
  return profile ? <RatingProfileCard profile={profile} /> : <section className="ranking-page card"><p>Loading rating profile…</p></section>;
}

function RatingProfileCard({ profile, onClose }: { profile: PublicRatingProfile; onClose?: () => void }) {
  return <section className="ranking-page card">
    {onClose && <button className="back" onClick={onClose}>← Leaderboard</button>}
    <p className="eyebrow">PLAYER PROFILE</p><h2>{profile.username}</h2>
    <div className="rating-cards">{profile.ratings.map((rating) => <article key={rating.pool}><span>{rating.pool}</span><strong>{rating.rating}</strong><small>Peak {rating.peakRating} · {rating.ratedGames} games</small><small>{rating.wins}W {rating.draws}D {rating.losses}L {rating.provisional ? "· PROVISIONAL" : ""}</small>{profile.leaderboardProgress?.[rating.pool] && <small>{profile.leaderboardProgress[rating.pool]!.qualifyingGames}/{profile.leaderboardProgress[rating.pool]!.gamesRequired} games toward leaderboard</small>}</article>)}</div>
    <h3>Recent rated games</h3><div className="rating-history">{profile.history.length ? profile.history.map((entry) => <article key={entry.id}><div><strong>{entry.result.toUpperCase()} vs {entry.opponent}</strong><small>{entry.pool} · {entry.resultMethod} · {new Date(entry.timestamp).toLocaleString()}</small></div><span className={entry.ratingChange >= 0 ? "gain" : "loss"}>{entry.ratingBefore} → {entry.ratingAfter} ({entry.ratingChange >= 0 ? "+" : ""}{entry.ratingChange})</span></article>) : <p>No rated games yet.</p>}</div>
    <h3>Tournament history</h3><div className="rating-history">{profile.tournaments?.length ? profile.tournaments.map((tournament) => <article key={tournament.id}><div><strong>{tournament.settings.name}</strong><small>{tournament.state} · {tournament.settings.rounds}-round Swiss · {tournament.settings.access}</small></div><span>Round {tournament.currentRound}</span></article>) : <p>No tournament entries yet.</p>}</div>
  </section>;
}
