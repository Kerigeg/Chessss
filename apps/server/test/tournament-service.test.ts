import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { TournamentSettings } from "@chessss/shared";
import { TournamentService } from "../src/tournament-service.js";

const now = new Date("2026-08-31T12:00:00.000Z").getTime();
const settings: TournamentSettings = {
  name: "Sunday Swiss", description: "Test tournament", capacity: 8, rounds: 3, initialTimeMs: 300_000, access: "rated",
  registrationOpensAt: "2026-08-31T11:00:00.000Z", registrationClosesAt: "2026-08-31T13:00:00.000Z",
  checkInOpensAt: "2026-08-31T12:30:00.000Z", startAt: "2026-08-31T14:00:00.000Z", roundStartDelayMs: 0, noShowDeadlineMs: 300_000, spectatingAllowed: true,
};

function service(path?: string) { return new TournamentService(path ?? join(mkdtempSync(join(tmpdir(), "chessss-tournament-")), "tournaments.json"), () => now); }

describe("TournamentService", () => {
  it("persists registration, check-in, pairings, and idempotent standings", () => {
    const path = join(mkdtempSync(join(tmpdir(), "chessss-tournament-persist-")), "tournaments.json");
    const tournaments = service(path);
    let tournament = tournaments.create(settings, "Owner");
    tournaments.transition(tournament.id, "open-registration");
    for (const username of ["Alice", "Bob", "Cara", "Dan"]) tournaments.register(tournament.id, username);
    tournaments.transition(tournament.id, "begin-check-in");
    for (const username of ["Alice", "Bob", "Cara", "Dan"]) tournaments.checkIn(tournament.id, username);
    tournament = tournaments.start(tournament.id);
    expect(tournament.currentRound).toBe(1);
    expect(tournament.pairings).toHaveLength(2);
    const pairing = tournament.pairings[0]!;
    tournaments.attachRoom(tournament.id, pairing.id, "ROOM1", "GAME1");
    const updated = tournaments.processGame("GAME1", { kind: "checkmate", winner: "white" })!;
    expect(updated.participants.find((player) => player.username === pairing.white)?.score).toBe(1);
    expect(tournaments.processGame("GAME1", { kind: "checkmate", winner: "white" })).toBeNull();
    expect(new TournamentService(path, () => now).detail(tournament.id).pairings.find((value) => value.id === pairing.id)?.status).toBe("finished");
  });

  it("awards forfeit points without requiring a played game", () => {
    const tournaments = service();
    const created = tournaments.create({ ...settings, noShowDeadlineMs: 0 }, "Owner");
    tournaments.transition(created.id, "open-registration");
    for (const username of ["A", "B", "C", "D"]) tournaments.register(created.id, username);
    const started = tournaments.start(created.id);
    const pairing = started.pairings[0]!;
    const result = tournaments.forfeit(started.id, pairing.id, "black");
    expect(result.participants.find((player) => player.username === pairing.black)?.score).toBe(1);
    expect(result.pairings.find((value) => value.id === pairing.id)).toMatchObject({ status: "forfeit", result: { kind: "forfeit", winner: "black" } });
  });

  it("keeps player-created drafts private and includes them in the creator's list", () => {
    const tournaments = service();
    const created = tournaments.create(settings, "Alice");
    expect(tournaments.list({ tab: "upcoming", includeDrafts: true }, "Bob")).toEqual([]);
    expect(tournaments.list({ tab: "mine" }, "Alice")).toMatchObject([{ id: created.id, state: "draft" }]);
    expect(tournaments.list({ tab: "upcoming", includeDrafts: true }, "Moderator", true)).toMatchObject([{ id: created.id }]);
  });

  it("does not let a withdrawn player overfill a tournament by registering again", () => {
    const tournaments = service();
    const created = tournaments.create({ ...settings, capacity: 4 }, "Owner");
    tournaments.transition(created.id, "open-registration");
    for (const username of ["A", "B", "C", "D"]) tournaments.register(created.id, username);
    tournaments.withdraw(created.id, "A");
    tournaments.register(created.id, "E");
    expect(() => tournaments.register(created.id, "A")).toThrow("full");
    expect(tournaments.detail(created.id).playerCount).toBe(4);
  });

  it("allows late registration during check-in while the registration window is still open", () => {
    const tournaments = service();
    const created = tournaments.create(settings, "Owner");
    tournaments.transition(created.id, "open-registration");
    tournaments.transition(created.id, "begin-check-in");
    const registered = tournaments.register(created.id, "LatePlayer");
    expect(registered.participants.find((value) => value.username === "LatePlayer")).toMatchObject({ checkedIn: true, withdrawn: false });
  });

  it("keeps registration open after check-in begins even when the scheduled registration time has passed", () => {
    const tournaments = new TournamentService(join(mkdtempSync(join(tmpdir(), "chessss-tournament-late-checkin-")), "tournaments.json"), () => new Date("2026-08-31T13:30:00.000Z").getTime());
    const created = tournaments.create(settings, "Owner");
    tournaments.transition(created.id, "open-registration");
    expect(() => tournaments.register(created.id, "TooLateForRegistration")).toThrow("scheduled window");
    tournaments.transition(created.id, "begin-check-in");
    expect(tournaments.register(created.id, "LateCheckIn").participants[0]).toMatchObject({ username: "LateCheckIn", checkedIn: true });
  });

  it("can start a small tournament with two eligible players", () => {
    const tournaments = service();
    const created = tournaments.create(settings, "Owner");
    tournaments.transition(created.id, "open-registration");
    tournaments.register(created.id, "A");
    tournaments.register(created.id, "B");
    const active = tournaments.start(created.id);
    expect(active.state).toBe("active");
    expect(active.pairings).toHaveLength(1);
  });

  it("cancels unfinished pairings without later changing the event to completed", () => {
    const tournaments = service();
    const created = tournaments.create(settings, "Owner");
    tournaments.transition(created.id, "open-registration");
    for (const username of ["A", "B", "C", "D"]) tournaments.register(created.id, username);
    const active = tournaments.start(created.id);
    const pairing = active.pairings[0]!;
    tournaments.attachRoom(active.id, pairing.id, "ROOM1", "GAME1");
    const cancelled = tournaments.transition(active.id, "cancel");
    expect(cancelled.pairings.every((value) => value.status === "finished" || value.status === "bye")).toBe(true);
    tournaments.processGame("GAME1", { kind: "cancelled", winner: null });
    expect(tournaments.detail(active.id).state).toBe("cancelled");
  });

  it("awards the opponent a forfeit when an active player is disqualified", () => {
    const tournaments = service();
    const created = tournaments.create(settings, "Owner");
    tournaments.transition(created.id, "open-registration");
    for (const username of ["A", "B", "C", "D"]) tournaments.register(created.id, username);
    const active = tournaments.start(created.id);
    const pairing = active.pairings[0]!;
    const disqualified = tournaments.disqualify(active.id, pairing.white!);
    expect(disqualified.pairings.find((value) => value.id === pairing.id)).toMatchObject({ status: "forfeit", result: { kind: "forfeit", winner: "black" } });
    expect(disqualified.participants.find((value) => value.username === pairing.black)?.score).toBe(1);
  });

  it("validates the complete check-in schedule", () => {
    const tournaments = service();
    expect(() => tournaments.create({ ...settings, checkInOpensAt: "2026-08-31T10:59:00.000Z" }, "Owner")).toThrow("schedule");
    expect(() => tournaments.create({ ...settings, checkInOpensAt: "2026-08-31T14:01:00.000Z" }, "Owner")).toThrow("schedule");
  });

  it("permanently deletes a tournament while retaining late-event idempotency", () => {
    const path = join(mkdtempSync(join(tmpdir(), "chessss-tournament-delete-")), "tournaments.json");
    const tournaments = service(path);
    const created = tournaments.create(settings, "Organizer");
    tournaments.transition(created.id, "open-registration");
    tournaments.register(created.id, "A");
    tournaments.register(created.id, "B");
    const active = tournaments.start(created.id);
    const pairing = active.pairings[0]!;
    tournaments.attachRoom(active.id, pairing.id, "ROOM1", "GAME1");
    tournaments.processGame("GAME1", { kind: "checkmate", winner: "white" });
    expect(tournaments.delete(active.id).id).toBe(active.id);
    expect(() => tournaments.detail(active.id)).toThrow("not found");
    const reloaded = new TournamentService(path, () => now);
    expect(reloaded.list({ tab: "completed" }, "Moderator", true)).toEqual([]);
    expect(reloaded.processGame("GAME1", { kind: "checkmate", winner: "white" })).toBeNull();
  });
});
