import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuthError, AuthService } from "../src/auth-service.js";

describe("AuthService", () => {
  const temporaryDirectories: string[] = [];

  afterEach(() => {
    for (const directory of temporaryDirectories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function service() {
    const directory = mkdtempSync(join(tmpdir(), "chessss-auth-"));
    temporaryDirectories.push(directory);
    return new AuthService(join(directory, "users.json"));
  }

  it("creates an account and restores its session", () => {
    const auth = service();
    const signedUp = auth.signUp({ username: "Player_One", password: "safe-password" });

    expect(signedUp.user).toEqual({ username: "Player_One", isAdmin: false });
    expect(auth.restore(signedUp.sessionToken).user).toEqual({ username: "Player_One", isAdmin: false });
  });

  it("allows an administrator authenticated with the admin code to ban an account", () => {
    const auth = service();
    auth.signUp({ username: "player", password: "safe-password" });
    const admin = auth.signInAdmin({ username: "Admin", adminCode: "KV99" });

    auth.banUser(admin.sessionToken, "player");

    expect(admin.user).toEqual({ username: "Admin", isAdmin: true });
    expect(() => auth.signIn({ username: "player", password: "safe-password" })).toThrow("banned");

    auth.unbanUser(admin.sessionToken, "player");
    expect(auth.signIn({ username: "player", password: "safe-password" }).user.username).toBe("player");
  });

  it("rejects an incorrect administrator code", () => {
    const auth = service();
    expect(() => auth.signInAdmin({ username: "Admin", adminCode: "wrong" })).toThrow("Incorrect administrator code");
  });

  it("rejects duplicate usernames and an incorrect password", () => {
    const auth = service();
    auth.signUp({ username: "player", password: "safe-password" });

    expect(() => auth.signUp({ username: "PLAYER", password: "other-password" })).toThrow(AuthError);
    expect(() => auth.signIn({ username: "player", password: "wrong-pass" })).toThrow(AuthError);
  });
});
