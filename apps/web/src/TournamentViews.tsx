import { useEffect, useMemo, useState, type FormEvent } from "react";
import type { Socket } from "socket.io-client";
import type { GameAccess, JoinRoomResponse, RoomSnapshot, ServerError, TournamentActionRequest, TournamentDeleteResponse, TournamentDetail, TournamentListRequest, TournamentSettings, TournamentSummary } from "@chessss/shared";

type Ack<T extends object> = T | { error: ServerError };
const hasError = <T extends object,>(response: Ack<T>): response is { error: ServerError } => "error" in response;
const tabs: Array<NonNullable<TournamentListRequest["tab"]>> = ["upcoming", "live", "completed", "mine"];
const formatTime = (milliseconds: number) => `${Math.round(milliseconds / 60_000)} min`;

function countdown(target: string, now: number) {
  const difference = new Date(target).getTime() - now;
  if (difference <= 0) return "Now";
  const minutes = Math.floor(difference / 60_000);
  const days = Math.floor(minutes / 1_440);
  const hours = Math.floor((minutes % 1_440) / 60);
  return days ? `${days}d ${hours}h` : hours ? `${hours}h ${minutes % 60}m` : `${Math.max(1, minutes)}m`;
}

export function TournamentView({ socket, username, onNotice, onJoinGame, onSpectate, enabledTimeControls }: { socket: Socket; username: string; onNotice: (message: string) => void; onJoinGame: (response: JoinRoomResponse) => void; onSpectate: (room: RoomSnapshot) => void; enabledTimeControls: number[] }) {
  const [tab, setTab] = useState<NonNullable<TournamentListRequest["tab"]>>("upcoming");
  const [list, setList] = useState<TournamentSummary[]>([]);
  const [detail, setDetail] = useState<TournamentDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [organizerAction, setOrganizerAction] = useState<TournamentActionRequest | null>(null);
  const [organizerReason, setOrganizerReason] = useState("");
  const [status, setStatus] = useState("");
  const notify = (message: string) => { setStatus(message); onNotice(message); };
  const [now, setNow] = useState(Date.now());

  function loadList() { socket.emit("tournament:list", { tab }, (response: Ack<TournamentSummary[]>) => hasError(response) ? notify(response.error.message) : setList(response)); }
  function loadDetail(tournamentId: string) { socket.emit("tournament:detail", { tournamentId }, (response: Ack<TournamentDetail>) => hasError(response) ? notify(response.error.message) : setDetail(response)); }
  useEffect(loadList, [socket, tab]);
  useEffect(() => { const timer = window.setInterval(() => setNow(Date.now()), 1_000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    const update = (value: TournamentDetail) => { setDetail((current) => current?.id === value.id ? value : current); loadList(); };
    const deleted = ({ tournamentId }: { tournamentId: string }) => { setDetail((current) => current?.id === tournamentId ? null : current); loadList(); };
    socket.on("tournament:updated", update); socket.on("tournament:deleted", deleted); return () => { socket.off("tournament:updated", update); socket.off("tournament:deleted", deleted); };
  }, [socket, tab]);

  function playerAction(event: "tournament:register" | "tournament:withdraw" | "tournament:check-in") {
    if (!detail) return;
    socket.emit(event, { tournamentId: detail.id }, (response: Ack<TournamentDetail>) => {
      if (hasError(response)) return notify(response.error.message);
      setDetail(response); notify(event.endsWith("register") ? response.state === "check-in" ? "Registration and check-in confirmed." : "Tournament registration confirmed." : event.endsWith("withdraw") ? "You withdrew from the tournament." : "Check-in confirmed.");
    });
  }

  function join(pairingId: string) {
    if (!detail) return;
    socket.emit("tournament:game:join", { tournamentId: detail.id, pairingId }, (response: Ack<JoinRoomResponse>) => hasError(response) ? notify(response.error.message) : onJoinGame(response));
  }

  function spectate(roomId: string) {
    if (!detail) return;
    socket.emit("tournament:spectate", { tournamentId: detail.id, roomId }, (response: Ack<{ room: RoomSnapshot }>) => hasError(response) ? notify(response.error.message) : onSpectate(response.room));
  }

  function manage(action: NonNullable<TournamentActionRequest["action"]>) {
    if (!detail) return;
    const request: TournamentActionRequest = { tournamentId: detail.id, action };
    if (action === "cancel") { setOrganizerAction(request); setOrganizerReason(""); return; }
    runOrganizerAction(request);
  }

  function runOrganizerAction(request: TournamentActionRequest, reason?: string) {
    socket.emit("admin:tournament:action", { ...request, reason }, (response: Ack<TournamentDetail | TournamentDeleteResponse>) => {
      if (hasError(response)) return notify(response.error.message);
      if ("deletedTournamentId" in response) { setDetail(null); loadList(); return; }
      setOrganizerAction(null); setOrganizerReason(""); setDetail(response); loadList(); notify(`Tournament ${request.action?.replaceAll("-", " ")} completed.`);
    });
  }

  if (!detail) return <section className="ranking-page tournament-page card">
    <div className="section-heading"><div><p className="eyebrow">SWISS EVENTS</p><h2>Tournaments</h2></div><button onClick={() => setCreating((value) => !value)}>{creating ? "Close form" : "Create tournament"}</button></div>
    {creating && <TournamentDraftForm socket={socket} enabledTimeControls={enabledTimeControls} onNotice={notify} onCancel={() => setCreating(false)} onSaved={(tournament) => { setCreating(false); setDetail(tournament); loadList(); }} />}
    {status && <p className="notice" role="status">{status}</p>}
    <div className="pool-tabs tournament-tabs">{tabs.map((value) => <button className={tab === value ? "active" : ""} onClick={() => setTab(value)} key={value}>{value}</button>)}</div>
    <div className="tournament-grid">{list.length ? list.map((tournament) => <article className="tournament-card" key={tournament.id}>
      <div><span className={`tournament-state ${tournament.state}`}>{tournament.state}</span><span>{tournament.settings.access.toUpperCase()}</span></div>
      <h3>{tournament.settings.name}</h3><p>{tournament.settings.description || "Swiss tournament"}</p>
      <dl><div><dt>Format</dt><dd>{tournament.settings.rounds}-round Swiss</dd></div><div><dt>Clock</dt><dd>{formatTime(tournament.settings.initialTimeMs)}</dd></div><div><dt>Players</dt><dd>{tournament.playerCount}/{tournament.settings.capacity}</dd></div><div><dt>Starts</dt><dd>{new Date(tournament.settings.startAt).toLocaleString()}</dd></div></dl>
      <button onClick={() => loadDetail(tournament.id)}>View tournament</button>
    </article>) : <p>No tournaments in this section.</p>}</div>
  </section>;

  const me = detail.participants.find((participant) => participant.username.toLowerCase() === username.toLowerCase());
  const myPairing = [...detail.pairings].reverse().find((pairing) => pairing.round === detail.currentRound && [pairing.white, pairing.black].some((name) => name?.toLowerCase() === username.toLowerCase()));
  const canRegister = detail.state === "check-in" || (detail.state === "registration" && now >= new Date(detail.settings.registrationOpensAt).getTime() && now <= new Date(detail.settings.registrationClosesAt).getTime());
  const eligiblePlayers = detail.participants.filter((participant) => !participant.withdrawn && !participant.disqualified && (detail.state !== "check-in" || participant.checkedIn)).length;
  const countdownTarget = detail.state === "registration" ? detail.settings.registrationClosesAt : detail.state === "check-in" ? detail.settings.startAt : detail.settings.startAt;
  const isCreator = detail.createdBy.toLowerCase() === username.toLowerCase();
  return <section className="ranking-page tournament-page card">
    <button className="back" onClick={() => { setDetail(null); loadList(); }}>← All tournaments</button>
    <div className="tournament-hero"><div><p className="eyebrow">{detail.state.toUpperCase()} · ROUND {detail.currentRound}/{detail.settings.rounds}</p><h2>{detail.settings.name}</h2><p>{detail.settings.description}</p></div><div className="countdown"><small>{detail.state === "registration" ? "Registration closes" : detail.state === "check-in" ? "Tournament starts" : "Scheduled start"}</small><strong>{countdown(countdownTarget, now)}</strong></div></div>
    <div className="tournament-facts"><span>{detail.settings.rounds}-round Swiss</span><span>{formatTime(detail.settings.initialTimeMs)}</span><span>{detail.settings.access === "rated" ? "Rated" : "Casual"}</span><span>{detail.playerCount}/{detail.settings.capacity} players</span>{isCreator && <span>Created by you</span>}</div>
    {detail.state === "draft" && isCreator && <div className="draft-notice"><p>This draft is private while it waits for an admin or moderator to approve and open registration.</p><button onClick={() => setEditing((value) => !value)}>{editing ? "Close editor" : "Edit draft"}</button></div>}
    {editing && detail.state === "draft" && <TournamentDraftForm key={detail.id} socket={socket} enabledTimeControls={enabledTimeControls} existing={detail} onNotice={notify} onCancel={() => setEditing(false)} onSaved={(tournament) => { setEditing(false); setDetail(tournament); loadList(); }} />}
    {isCreator && !["draft", "completed", "cancelled"].includes(detail.state) && <div className="organizer-controls"><strong>Organizer controls</strong><small>{eligiblePlayers} eligible player{eligiblePlayers === 1 ? "" : "s"} · 2 required to start</small><div className="tournament-actions">{detail.state === "registration" && <><button onClick={() => manage("begin-check-in")}>Begin check-in</button><button disabled={eligiblePlayers < 2} title={eligiblePlayers < 2 ? "At least two eligible players are required" : undefined} onClick={() => manage("start")}>Start now</button></>}{detail.state === "check-in" && <button disabled={eligiblePlayers < 2} title={eligiblePlayers < 2 ? "At least two checked-in players are required" : undefined} onClick={() => manage("start")}>Start tournament</button>}{detail.state === "active" && <><button onClick={() => manage("pause")}>Pause</button><button onClick={() => manage("next-round")}>Start next round</button></>}{detail.state === "paused" && <button onClick={() => manage("resume")}>Resume</button>}<button className="danger" onClick={() => manage("cancel")}>Cancel tournament</button></div></div>}
    {organizerAction && <form className="action-confirmation" onSubmit={(event) => { event.preventDefault(); const reason = organizerReason.trim(); if (!reason) return onNotice("An audit reason is required."); runOrganizerAction(organizerAction, reason); }}><strong>Confirm tournament cancellation</strong><label>Audit reason<input autoFocus value={organizerReason} onChange={(event) => setOrganizerReason(event.target.value)} placeholder="Explain why this tournament should be cancelled" required /></label><div><button className="danger" type="submit">Confirm cancellation</button><button type="button" onClick={() => { setOrganizerAction(null); setOrganizerReason(""); }}>Keep tournament</button></div></form>}
    {status && <p className="notice" role="status">{status}</p>}
    <div className="tournament-actions">{canRegister && (!me || me.withdrawn) && <button className="primary" onClick={() => playerAction("tournament:register")}>Register</button>}{["registration", "check-in"].includes(detail.state) && !canRegister && (!me || me.withdrawn) && <span>Registration is currently closed.</span>}{["registration", "check-in"].includes(detail.state) && me && !me.withdrawn && <button onClick={() => playerAction("tournament:withdraw")}>Withdraw</button>}{detail.state === "check-in" && me && !me.checkedIn && !me.withdrawn && <button className="primary" onClick={() => playerAction("tournament:check-in")}>Check in</button>}{myPairing?.roomId && !["finished", "forfeit", "double-forfeit"].includes(myPairing.status) && <button className="primary" onClick={() => join(myPairing.id)}>Join your tournament game</button>}</div>
    <div className="tournament-columns"><section><h3>Standings</h3><div className="standings-table"><div><b>#</b><b>Player</b><b>Pts</b><b>BH</b><b>Wins</b></div>{detail.participants.map((participant, index) => <div className={participant.username.toLowerCase() === username.toLowerCase() ? "you" : ""} key={participant.username}><span>{participant.finalPlace ?? index + 1}</span><strong>{participant.username}{participant.withdrawn ? " (withdrawn)" : participant.disqualified ? " (DQ)" : ""}</strong><span>{participant.score}</span><span>{participant.buchholz}</span><span>{participant.wins}</span></div>)}</div></section>
      <section><h3>Round {detail.currentRound || "—"} pairings</h3><div className="pairing-list">{detail.pairings.filter((pairing) => pairing.round === detail.currentRound).map((pairing) => <article key={pairing.id}><div><strong>{pairing.bye ? `${pairing.bye} receives a bye` : `${pairing.white} vs ${pairing.black}`}</strong><small>{pairing.status}{pairing.result ? ` · ${pairing.result.winner ?? "draw"} · ${pairing.result.kind}` : ""}</small></div>{pairing.roomId && detail.settings.spectatingAllowed && ![pairing.white, pairing.black].some((name) => name?.toLowerCase() === username.toLowerCase()) && <button onClick={() => spectate(pairing.roomId!)}>Spectate</button>}</article>)}</div></section></div>
    <details><summary>Participants and previous rounds</summary><p>{detail.participants.map((participant) => participant.username).join(", ")}</p>{Array.from({ length: Math.max(0, detail.currentRound - 1) }, (_, index) => index + 1).map((round) => <div key={round}><h4>Round {round}</h4>{detail.pairings.filter((pairing) => pairing.round === round).map((pairing) => <p key={pairing.id}>{pairing.bye ? `${pairing.bye} — bye` : `${pairing.white} vs ${pairing.black} — ${pairing.result?.winner ?? "draw"}`}</p>)}</div>)}</details>
  </section>;
}

function isoFromLocal(value: string) { return new Date(value).toISOString(); }
function localDefault(offsetMinutes: number) { const value = new Date(Date.now() + offsetMinutes * 60_000); value.setSeconds(0, 0); return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }

function localFromIso(value: string) { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }

function TournamentDraftForm({ socket, enabledTimeControls, existing, onNotice, onSaved, onCancel }: { socket: Socket; enabledTimeControls: number[]; existing?: TournamentDetail; onNotice: (message: string) => void; onSaved: (tournament: TournamentDetail) => void; onCancel: () => void }) {
  const settings = existing?.settings;
  const [name, setName] = useState(settings?.name ?? "Weekend Swiss");
  const [description, setDescription] = useState(settings?.description ?? "");
  const [capacity, setCapacity] = useState(settings?.capacity ?? 16);
  const [rounds, setRounds] = useState(settings?.rounds ?? 5);
  const [time, setTime] = useState(settings?.initialTimeMs ?? enabledTimeControls[2] ?? enabledTimeControls[0] ?? 300_000);
  const [access, setAccess] = useState<GameAccess>(settings?.access ?? "rated");
  const [registrationOpen, setRegistrationOpen] = useState(settings ? localFromIso(settings.registrationOpensAt) : localDefault(5));
  const [registrationClose, setRegistrationClose] = useState(settings ? localFromIso(settings.registrationClosesAt) : localDefault(60));
  const [startAt, setStartAt] = useState(settings ? localFromIso(settings.startAt) : localDefault(90));

  function save(event: FormEvent) {
    event.preventDefault();
    try {
      const next: TournamentSettings = { name, description, capacity, rounds, initialTimeMs: time, access, registrationOpensAt: isoFromLocal(registrationOpen), registrationClosesAt: isoFromLocal(registrationClose), checkInOpensAt: isoFromLocal(registrationClose), startAt: isoFromLocal(startAt), roundStartDelayMs: settings?.roundStartDelayMs ?? 30_000, noShowDeadlineMs: settings?.noShowDeadlineMs ?? 300_000, spectatingAllowed: settings?.spectatingAllowed ?? true };
      socket.emit(existing ? "admin:tournament:update" : "tournament:create", existing ? { tournamentId: existing.id, settings: next } : { settings: next }, (response: Ack<TournamentDetail>) => {
        if (hasError(response)) return onNotice(response.error.message);
        onNotice(existing ? "Tournament draft updated." : "Tournament draft submitted for staff approval."); onSaved(response);
      });
    } catch { onNotice("Please complete all tournament dates."); }
  }

  return <form className="tournament-form" onSubmit={save}><label>Name<input maxLength={80} value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Description<input maxLength={500} value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Capacity<input type="number" min="4" max="32" value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} required /></label><label>Rounds<input type="number" min="3" max="7" value={rounds} onChange={(event) => setRounds(Number(event.target.value))} required /></label><label>Clock<select value={time} onChange={(event) => setTime(Number(event.target.value))}>{enabledTimeControls.map((value) => <option value={value} key={value}>{formatTime(value)}</option>)}</select></label><label>Mode<select value={access} onChange={(event) => setAccess(event.target.value as GameAccess)}><option value="rated">Rated</option><option value="casual">Casual</option></select></label><label>Registration opens<input type="datetime-local" value={registrationOpen} onChange={(event) => setRegistrationOpen(event.target.value)} required /></label><label>Registration closes / check-in<input type="datetime-local" value={registrationClose} onChange={(event) => setRegistrationClose(event.target.value)} required /></label><label>Start time<input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} required /></label><div className="form-actions"><button className="primary" type="submit">{existing ? "Save draft" : "Submit for approval"}</button><button type="button" onClick={onCancel}>Cancel</button></div></form>;
}

export function TournamentAdminPanel({ socket, username, onNotice, enabledTimeControls }: { socket: Socket; username: string; onNotice: (message: string) => void; enabledTimeControls: number[] }) {
  const [tournaments, setTournaments] = useState<TournamentSummary[]>([]);
  const [selected, setSelected] = useState<TournamentDetail | null>(null);
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [pendingAction, setPendingAction] = useState<TournamentActionRequest | null>(null);
  const [actionReason, setActionReason] = useState("");
  const [name, setName] = useState("Weekend Swiss"); const [description, setDescription] = useState("");
  const [capacity, setCapacity] = useState(16); const [rounds, setRounds] = useState(5); const [time, setTime] = useState(enabledTimeControls[2] ?? 300_000); const [access, setAccess] = useState<GameAccess>("rated");
  const [registrationOpen, setRegistrationOpen] = useState(localDefault(5)); const [registrationClose, setRegistrationClose] = useState(localDefault(60)); const [startAt, setStartAt] = useState(localDefault(90));
  const all = useMemo(() => [...tournaments].sort((left, right) => right.settings.startAt.localeCompare(left.settings.startAt)), [tournaments]);
  function load() { Promise.all(["upcoming", "live", "completed"].map((tab) => new Promise<TournamentSummary[]>((resolve) => socket.emit("tournament:list", { tab, includeDrafts: tab === "upcoming" }, (response: Ack<TournamentSummary[]>) => resolve(hasError(response) ? [] : response))))).then((groups) => setTournaments(groups.flat())); }
  useEffect(load, [socket]);
  useEffect(() => { const deleted = ({ tournamentId }: { tournamentId: string }) => { setSelected((current) => current?.id === tournamentId ? null : current); load(); }; socket.on("tournament:deleted", deleted); return () => { socket.off("tournament:deleted", deleted); }; }, [socket]);
  function open(id: string) { setPendingAction(null); setActionReason(""); socket.emit("tournament:detail", { tournamentId: id }, (response: Ack<TournamentDetail>) => hasError(response) ? onNotice(response.error.message) : setSelected(response)); }
  function create(event: FormEvent) {
    event.preventDefault();
    const settings: TournamentSettings = { name, description, capacity, rounds, initialTimeMs: time, access, registrationOpensAt: isoFromLocal(registrationOpen), registrationClosesAt: isoFromLocal(registrationClose), checkInOpensAt: isoFromLocal(registrationClose), startAt: isoFromLocal(startAt), roundStartDelayMs: 30_000, noShowDeadlineMs: 300_000, spectatingAllowed: true };
    const eventName = editingId ? "admin:tournament:update" : "tournament:create";
    socket.emit(eventName, editingId ? { tournamentId: editingId, settings } : { settings }, (response: Ack<TournamentDetail>) => { if (hasError(response)) return onNotice(response.error.message); setCreating(false); setEditingId(null); setSelected(response); load(); onNotice(editingId ? "Tournament draft updated." : "Tournament draft created."); });
  }
  function beginEdit() {
    if (!selected) return;
    const local = (value: string) => { const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
    setName(selected.settings.name); setDescription(selected.settings.description); setCapacity(selected.settings.capacity); setRounds(selected.settings.rounds); setTime(selected.settings.initialTimeMs); setAccess(selected.settings.access);
    setRegistrationOpen(local(selected.settings.registrationOpensAt)); setRegistrationClose(local(selected.settings.registrationClosesAt)); setStartAt(local(selected.settings.startAt)); setEditingId(selected.id); setCreating(true);
  }
  function action(request: TournamentActionRequest) {
    if (!selected) return;
    const needsReason = ["cancel", "delete", "forfeit", "correct-result", "disqualify"].includes(request.action ?? "");
    if (needsReason) { setPendingAction(request); setActionReason(""); return; }
    runAction(request);
  }
  function runAction(request: TournamentActionRequest, reason?: string) {
    if (!selected) return;
    socket.emit("admin:tournament:action", { ...request, tournamentId: selected.id, reason }, (response: Ack<TournamentDetail | TournamentDeleteResponse>) => {
      if (hasError(response)) return onNotice(response.error.message);
      if ("deletedTournamentId" in response) { setPendingAction(null); setActionReason(""); setSelected(null); load(); onNotice("Tournament permanently deleted."); return; }
      setPendingAction(null); setActionReason(""); setSelected(response); load(); onNotice(`Tournament ${request.action?.replaceAll("-", " ")} completed.`);
    });
  }
  function staffPlayerAction(event: "tournament:register" | "tournament:withdraw" | "tournament:check-in") {
    if (!selected) return;
    socket.emit(event, { tournamentId: selected.id }, (response: Ack<TournamentDetail>) => {
      if (hasError(response)) return onNotice(response.error.message);
      setSelected(response); load();
      onNotice(event.endsWith("withdraw") ? "You withdrew from the tournament." : event.endsWith("check-in") ? "Check-in confirmed." : response.state === "check-in" ? "Registration and check-in confirmed." : "Tournament registration confirmed.");
    });
  }
  const selectedMe = selected?.participants.find((participant) => participant.username.toLowerCase() === username.toLowerCase());
  const eligibleCount = selected?.participants.filter((participant) => !participant.withdrawn && !participant.disqualified && (selected.state !== "check-in" || participant.checkedIn)).length ?? 0;
  const maySelfRegister = Boolean(selected && (selected.state === "check-in" || (selected.state === "registration" && Date.now() >= new Date(selected.settings.registrationOpensAt).getTime() && Date.now() <= new Date(selected.settings.registrationClosesAt).getTime())));
  return <section className="admin-section activity-section tournament-admin"><div className="section-heading"><h3>Tournament control</h3><button onClick={() => { setEditingId(null); setCreating((value) => !value); }}>{creating ? "Close form" : "Create tournament"}</button></div>
    {creating && <form className="tournament-form" onSubmit={create}><label>Name<input value={name} onChange={(event) => setName(event.target.value)} required /></label><label>Description<input value={description} onChange={(event) => setDescription(event.target.value)} /></label><label>Capacity<input type="number" min="4" max="32" value={capacity} onChange={(event) => setCapacity(Number(event.target.value))} /></label><label>Rounds<input type="number" min="3" max="7" value={rounds} onChange={(event) => setRounds(Number(event.target.value))} /></label><label>Clock<select value={time} onChange={(event) => setTime(Number(event.target.value))}>{enabledTimeControls.map((value) => <option value={value} key={value}>{formatTime(value)}</option>)}</select></label><label>Mode<select value={access} onChange={(event) => setAccess(event.target.value as GameAccess)}><option value="rated">Rated</option><option value="casual">Casual</option></select></label><label>Registration opens<input type="datetime-local" value={registrationOpen} onChange={(event) => setRegistrationOpen(event.target.value)} /></label><label>Registration closes / check-in<input type="datetime-local" value={registrationClose} onChange={(event) => setRegistrationClose(event.target.value)} /></label><label>Start time<input type="datetime-local" value={startAt} onChange={(event) => setStartAt(event.target.value)} /></label><button className="primary" type="submit">{editingId ? "Save draft" : "Create draft"}</button></form>}
    <div className="admin-tournament-list">{all.map((tournament) => <button className={selected?.id === tournament.id ? "active" : ""} onClick={() => open(tournament.id)} key={tournament.id}><strong>{tournament.settings.name}</strong><small>{tournament.state} · R{tournament.currentRound}/{tournament.settings.rounds} · {tournament.playerCount}/{tournament.settings.capacity}</small></button>)}</div>
    {selected && <div className="tournament-eligibility"><strong>{eligibleCount} eligible player{eligibleCount === 1 ? "" : "s"}</strong><span>At least 2 eligible players are required to start.</span><div className="admin-actions">{maySelfRegister && (!selectedMe || selectedMe.withdrawn) && <button className="primary" onClick={() => staffPlayerAction("tournament:register")}>Register yourself</button>}{["registration", "check-in"].includes(selected.state) && selectedMe && !selectedMe.withdrawn && <button onClick={() => staffPlayerAction("tournament:withdraw")}>Withdraw yourself</button>}{selected.state === "check-in" && selectedMe && !selectedMe.withdrawn && !selectedMe.checkedIn && <button className="primary" onClick={() => staffPlayerAction("tournament:check-in")}>Check yourself in</button>}<button className="danger" onClick={() => action({ tournamentId: selected.id, action: "delete" })}>Delete permanently</button></div></div>}
    {selected && <div className="admin-tournament-detail"><strong>{selected.settings.name}</strong><span>{selected.state} · {selected.settings.access} · {formatTime(selected.settings.initialTimeMs)} · created by {selected.createdBy}</span><div className="admin-actions">{selected.state === "draft" && <><button onClick={beginEdit}>Edit draft</button><button onClick={() => action({ tournamentId: selected.id, action: "open-registration" })}>Approve & open registration</button></>}{selected.state === "registration" && <><button onClick={() => action({ tournamentId: selected.id, action: "begin-check-in" })}>Begin check-in</button><button onClick={() => action({ tournamentId: selected.id, action: "start" })}>Start now</button></>}{selected.state === "check-in" && <button onClick={() => action({ tournamentId: selected.id, action: "start" })}>Start tournament</button>}{selected.state === "active" && <><button onClick={() => action({ tournamentId: selected.id, action: "pause" })}>Pause</button><button onClick={() => action({ tournamentId: selected.id, action: "next-round" })}>Start next round</button></>}{selected.state === "paused" && <button onClick={() => action({ tournamentId: selected.id, action: "resume" })}>Resume</button>}{!["completed", "cancelled"].includes(selected.state) && <button className="danger" onClick={() => action({ tournamentId: selected.id, action: "cancel" })}>Cancel</button>}</div>{pendingAction && <form className="action-confirmation" onSubmit={(event) => { event.preventDefault(); const reason = actionReason.trim(); if (!reason) return onNotice("An audit reason is required."); runAction(pendingAction, reason); }}><strong>Confirm {pendingAction.action?.replaceAll("-", " ")}</strong><label>Audit reason<input autoFocus value={actionReason} onChange={(event) => setActionReason(event.target.value)} placeholder="Explain why this action is needed" required /></label><div><button className="danger" type="submit">Confirm action</button><button type="button" onClick={() => { setPendingAction(null); setActionReason(""); }}>Keep tournament</button></div></form>}<div className="pairing-list">{selected.pairings.filter((pairing) => pairing.round === selected.currentRound).map((pairing) => <article key={pairing.id}><div><strong>{pairing.bye ? `${pairing.bye} — bye` : `${pairing.white} vs ${pairing.black}`}</strong><small>{pairing.status}</small></div>{!pairing.bye && !["finished", "forfeit", "double-forfeit"].includes(pairing.status) ? <><button onClick={() => action({ tournamentId: selected.id, action: "forfeit", pairingId: pairing.id, winner: "white" })}>White forfeit win</button><button onClick={() => action({ tournamentId: selected.id, action: "forfeit", pairingId: pairing.id, winner: "black" })}>Black forfeit win</button><button onClick={() => action({ tournamentId: selected.id, action: "forfeit", pairingId: pairing.id, winner: null })}>Double forfeit</button></> : !pairing.bye && <><button onClick={() => action({ tournamentId: selected.id, action: "correct-result", pairingId: pairing.id, result: { kind: "admin-decision", winner: "white" } })}>Correct: White</button><button onClick={() => action({ tournamentId: selected.id, action: "correct-result", pairingId: pairing.id, result: { kind: "admin-decision", winner: "black" } })}>Correct: Black</button><button onClick={() => action({ tournamentId: selected.id, action: "correct-result", pairingId: pairing.id, result: { kind: "admin-decision", winner: null } })}>Correct: Draw</button></>}</article>)}</div><h4>Participants</h4><div className="admin-actions">{selected.participants.filter((participant) => !participant.disqualified).map((participant) => <button key={participant.username} onClick={() => action({ tournamentId: selected.id, action: "disqualify", username: participant.username })}>Disqualify {participant.username}</button>)}</div></div>}
  </section>;
}
