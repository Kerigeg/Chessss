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

    expect(signedUp.user).toEqual({ username: "Player_One" });
    expect(auth.restore(signedUp.sessionToken).user).toEqual({ username: "Player_One" });
  });

  it("rejects duplicate usernames and an incorrect password", () => {
    const auth = service();
    auth.signUp({ username: "player", password: "safe-password" });

    expect(() => auth.signUp({ username: "PLAYER", password: "other-password" })).toThrow(AuthError);
    expect(() => auth.signIn({ username: "player", password: "wrong-pass" })).toThrow(AuthError);
  });
});
