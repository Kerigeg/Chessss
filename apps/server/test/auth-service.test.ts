import { mkdtempSync, rmSync } from "node:fs";
import { createHmac } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AuthError, AuthService } from "../src/auth-service.js";

describe("AuthService", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    vi.useRealTimers();
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function service() {
    const directory = mkdtempSync(join(tmpdir(), "chessss-auth-"));
    temporaryDirectories.push(directory);
    return new AuthService(join(directory, "users.json"));
  }

  function totp(secret: string): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = secret.split("").map((character) => alphabet.indexOf(character).toString(2).padStart(5, "0")).join("");
    const key = Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
    const counter = Buffer.alloc(8);
    counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000)));
    const digest = createHmac("sha1", key).update(counter).digest();
    const position = digest[digest.length - 1]! & 0x0f;
    return ((digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000).toString().padStart(6, "0");
  }

  it("creates an account and restores its session", async () => {
    const auth = service();
    const signedUp = await auth.signUp({ username: "Player_One", password: "safe-password" });

    expect(signedUp.user).toEqual({ username: "Player_One", isAdmin: false });
    expect(auth.restore(signedUp.sessionToken).user).toEqual({ username: "Player_One", isAdmin: false });
  });

  it("allows an administrator authenticated with the admin code to ban an account", async () => {
    const auth = service();
    await auth.signUp({ username: "player", password: "safe-password" });
    const admin = await auth.signInAdmin({ username: "Admin", adminCode: "KV99" });

    auth.banUser(admin.sessionToken, "player");

    expect(admin.user).toEqual({ username: "Admin", isAdmin: true, role: "owner" });
    await expect(auth.signIn({ username: "player", password: "safe-password" })).rejects.toThrow("banned");

    auth.unbanUser(admin.sessionToken, "player");
    expect((await auth.signIn({ username: "player", password: "safe-password" })).user.username).toBe("player");
  });

  it("supports warnings, temporary suspensions, private notes, and forced sign-out", async () => {
    const auth = service();
    const player = await auth.signUp({ username: "managed_player", password: "safe-password" });
    const admin = await auth.signInAdmin({ username: "Admin", adminCode: "KV99" });

    auth.warnUser(admin.sessionToken, "managed_player", "Unsporting chat");
    const warnedSignIn = await auth.signIn({ username: "managed_player", password: "safe-password" });
    expect(warnedSignIn.warnings).toEqual([expect.objectContaining({ reason: "Unsporting chat", actor: "Admin" })]);
    expect((await auth.signIn({ username: "managed_player", password: "safe-password" })).warnings).toBeUndefined();
    const profile = auth.addNote(admin.sessionToken, "managed_player", "Watch the next two games");
    expect(profile.warningCount).toBe(1);
    expect(profile.notes[0]?.text).toBe("Watch the next two games");

    auth.forceSignOut(admin.sessionToken, "managed_player");
    expect(() => auth.restore(player.sessionToken)).toThrow("expired");

    auth.suspendUser(admin.sessionToken, "managed_player", "Repeated warning", 60);
    await expect(auth.signIn({ username: "managed_player", password: "safe-password" })).rejects.toThrow("suspended");
  });

  it("rejects an incorrect administrator code", async () => {
    const auth = service();
    await expect(auth.signInAdmin({ username: "Admin", adminCode: "wrong" })).rejects.toThrow("Incorrect administrator credentials");
  });

  it("upgrades an admin to an individual password and TOTP login", async () => {
    const auth = service();
    const legacy = await auth.signInAdmin({ username: "Admin", adminCode: "KV99" });
    expect((await auth.signInAdmin({ username: "Admin", adminCode: "KV99" })).user.role).toBe("owner");
    const setup = auth.beginAdminSecurity(legacy.sessionToken);
    const upgraded = await auth.completeAdminSecurity(legacy.sessionToken, { password: "individual-admin-password", secret: setup.secret, oneTimeCode: totp(setup.secret) });

    await expect(auth.signInAdmin({ username: "Admin", adminCode: "KV99" })).rejects.toThrow("two-factor");
    await expect(auth.signInAdmin({ username: "Admin", password: "individual-admin-password", oneTimeCode: "000000" })).rejects.toThrow("two-factor");
    expect((await auth.signInAdmin({ username: "Admin", password: "individual-admin-password", oneTimeCode: totp(setup.secret) })).user.role).toBe("owner");
    expect(() => auth.restore(legacy.sessionToken)).toThrow("expired");
    expect(auth.restore(upgraded.sessionToken).user.isAdmin).toBe(true);
  });

  it("enforces owner, moderator, and analyst permission boundaries", async () => {
    const auth = service();
    await auth.signUp({ username: "mod_user", password: "safe-password" });
    await auth.signUp({ username: "analyst_user", password: "safe-password" });
    await auth.signUp({ username: "staff_admin", password: "safe-password" });
    await auth.signUp({ username: "target_user", password: "safe-password" });
    const owner = await auth.signInAdmin({ username: "Admin", adminCode: "KV99" });
    auth.setRole(owner.sessionToken, "mod_user", "moderator");
    auth.setRole(owner.sessionToken, "analyst_user", "analyst");
    auth.setRole(owner.sessionToken, "staff_admin", "admin");
    const moderator = await auth.signInAdmin({ username: "mod_user", password: "safe-password" });
    const analyst = await auth.signInAdmin({ username: "analyst_user", password: "safe-password" });

    expect(() => auth.warnUser(moderator.sessionToken, "target_user", "Review conduct")).not.toThrow();
    expect(() => auth.warnUser(moderator.sessionToken, "staff_admin", "Not permitted")).toThrow("Owner");
    expect(() => auth.forceSignOut(moderator.sessionToken, "target_user")).toThrow("role");
    expect(() => auth.warnUser(analyst.sessionToken, "target_user", "Should be read only")).toThrow("role");
    expect(() => auth.warnUser(owner.sessionToken, "staff_admin", "Owner warning")).not.toThrow();
    expect(() => auth.suspendUser(owner.sessionToken, "staff_admin", "Owner suspension", 10)).not.toThrow();
    expect(() => auth.banUser(owner.sessionToken, "staff_admin")).not.toThrow();
    expect(() => auth.unbanUser(owner.sessionToken, "staff_admin")).not.toThrow();
    expect(() => auth.banUser(owner.sessionToken, "Admin")).toThrow("Owner accounts");
    expect(auth.listUsers(analyst.sessionToken)).toHaveLength(5);
  });

  it("expires inactive administrator sessions after thirty minutes", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-24T12:00:00Z"));
    const auth = service();
    const admin = await auth.signInAdmin({ username: "Admin", adminCode: "KV99" });
    vi.advanceTimersByTime(30 * 60_000 + 1);
    expect(() => auth.restore(admin.sessionToken)).toThrow("inactivity");
  });

  it("rejects duplicate usernames and an incorrect password", async () => {
    const auth = service();
    await auth.signUp({ username: "player", password: "safe-password" });

    await expect(auth.signUp({ username: "PLAYER", password: "other-password" })).rejects.toThrow(AuthError);
    await expect(auth.signIn({ username: "player", password: "wrong-pass" })).rejects.toThrow(AuthError);
  });

  it("does not let a regular player promote themselves through the admin portal", async () => {
    const auth = service();
    await auth.signUp({ username: "ordinary_player", password: "safe-password" });

    await expect(auth.signInAdmin({ username: "ordinary_player", password: "safe-password" })).rejects.toThrow("administrator credentials");
    expect((await auth.signIn({ username: "ordinary_player", password: "safe-password" })).user.isAdmin).toBe(false);
  });
});
