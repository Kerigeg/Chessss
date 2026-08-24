import { createHash, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AdminLoginRequest, AdminUserSummary, AuthResponse, AuthUser, CredentialsRequest } from "@chessss/shared";

const DEFAULT_ADMIN_CODE = "KV99";

interface StoredUser {
  username: string;
  passwordHash: string;
  passwordSalt: string;
  sessionHashes: string[];
  banned?: boolean;
  admin?: boolean;
}

interface UserDatabase {
  users: StoredUser[];
}

export class AuthError extends Error {}

export class AuthService {
  private readonly database: UserDatabase;

  constructor(
    private readonly filePath = resolve(process.cwd(), "data", "users.json"),
    private readonly adminCode = process.env.ADMIN_CODE ?? DEFAULT_ADMIN_CODE,
  ) {
    this.database = this.load();
  }

  signUp(request: CredentialsRequest): AuthResponse {
    const username = this.validateUsername(request.username);
    this.validatePassword(request.password);
    if (username.toLowerCase() === "admin") throw new AuthError("That username is reserved for administrator access.");
    if (this.findUser(username)) throw new AuthError("That username is already taken.");

    const passwordSalt = randomBytes(16).toString("hex");
    const user: StoredUser = {
      username,
      passwordSalt,
      passwordHash: this.hashPassword(request.password, passwordSalt),
      sessionHashes: [],
    };
    this.database.users.push(user);
    return this.createSession(user);
  }

  signIn(request: CredentialsRequest): AuthResponse {
    const username = this.validateUsername(request.username);
    const user = this.findUser(username);
    if (!user || !this.passwordMatches(user, request.password)) throw new AuthError("Incorrect username or password.");
    if (this.isAdmin(user) || username.toLowerCase() === "admin") throw new AuthError("Use the administrator login portal for this account.");
    if (user.banned) throw new AuthError("This account has been banned.");
    return this.createSession(user);
  }

  signInAdmin(request: AdminLoginRequest): AuthResponse {
    const username = this.validateUsername(request.username);
    if (!this.safeEqual(this.hashSession(request.adminCode), this.hashSession(this.adminCode))) {
      throw new AuthError("Incorrect administrator code.");
    }

    let user = this.findUser(username);
    if (user?.banned) throw new AuthError("This account has been banned.");
    if (!user) {
      const passwordSalt = randomBytes(16).toString("hex");
      user = {
        username,
        passwordSalt,
        passwordHash: this.hashPassword(randomBytes(32).toString("base64url"), passwordSalt),
        sessionHashes: [],
        admin: true,
      };
      this.database.users.push(user);
    } else {
      user.admin = true;
    }
    return this.createSession(user);
  }

  restore(sessionToken: string): AuthResponse {
    const sessionHash = this.hashSession(sessionToken);
    const user = this.database.users.find((candidate) => candidate.sessionHashes.some((hash) => this.safeEqual(hash, sessionHash)));
    if (!user) throw new AuthError("Your session has expired. Please sign in again.");
    if (user.banned) throw new AuthError("This account has been banned.");
    return { user: this.publicUser(user), sessionToken };
  }

  signOut(sessionToken: string) {
    const sessionHash = this.hashSession(sessionToken);
    for (const user of this.database.users) {
      const next = user.sessionHashes.filter((hash) => !this.safeEqual(hash, sessionHash));
      if (next.length !== user.sessionHashes.length) {
        user.sessionHashes = next;
        this.persist();
        return;
      }
    }
  }

  userForSession(sessionToken: string): AuthUser {
    return this.restore(sessionToken).user;
  }

  listUsers(sessionToken: string): AdminUserSummary[] {
    this.requireAdmin(sessionToken);
    return this.database.users.map((user) => ({
      username: user.username,
      banned: Boolean(user.banned),
      isAdmin: this.isAdmin(user),
    }));
  }

  banUser(sessionToken: string, username: string): AdminUserSummary[] {
    this.requireAdmin(sessionToken);
    const user = this.findUser(username);
    if (!user) throw new AuthError("That account does not exist.");
    if (this.isAdmin(user)) throw new AuthError("The administrator account cannot be banned.");
    user.banned = true;
    user.sessionHashes = [];
    this.persist();
    return this.listUsers(sessionToken);
  }

  unbanUser(sessionToken: string, username: string): AdminUserSummary[] {
    this.requireAdmin(sessionToken);
    const user = this.findUser(username);
    if (!user) throw new AuthError("That account does not exist.");
    if (this.isAdmin(user)) throw new AuthError("The administrator account cannot be moderated.");
    user.banned = false;
    this.persist();
    return this.listUsers(sessionToken);
  }

  private createSession(user: StoredUser): AuthResponse {
    const sessionToken = randomBytes(32).toString("base64url");
    user.sessionHashes.push(this.hashSession(sessionToken));
    this.persist();
    return { user: this.publicUser(user), sessionToken };
  }

  private publicUser(user: StoredUser): AuthUser {
    return { username: user.username, isAdmin: this.isAdmin(user) };
  }

  private isAdmin(user: StoredUser): boolean {
    return Boolean(user.admin);
  }

  private requireAdmin(sessionToken: string) {
    const user = this.userForSession(sessionToken);
    if (!user.isAdmin) throw new AuthError("Administrator access is required.");
  }

  private load(): UserDatabase {
    if (!existsSync(this.filePath)) return { users: [] };
    try {
      const parsed = JSON.parse(readFileSync(this.filePath, "utf8")) as UserDatabase;
      if (!Array.isArray(parsed.users)) throw new Error("Invalid user database.");
      return parsed;
    } catch {
      throw new AuthError("The user database could not be read.");
    }
  }

  private persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporaryPath = `${this.filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(this.database, null, 2), { mode: 0o600 });
    renameSync(temporaryPath, this.filePath);
  }

  private findUser(username: string): StoredUser | undefined {
    return this.database.users.find((user) => user.username.toLowerCase() === username.toLowerCase());
  }

  private validateUsername(input: string): string {
    const username = input.trim();
    if (!/^[A-Za-z0-9_]{3,24}$/.test(username)) throw new AuthError("Username must be 3–24 letters, numbers, or underscores.");
    return username;
  }

  private validatePassword(password: string) {
    if (password.length < 8 || password.length > 128) throw new AuthError("Password must be between 8 and 128 characters.");
  }

  private hashPassword(password: string, salt: string): string {
    return scryptSync(password, salt, 64).toString("hex");
  }

  private passwordMatches(user: StoredUser, password: string): boolean {
    const actual = Buffer.from(this.hashPassword(password, user.passwordSalt), "hex");
    const expected = Buffer.from(user.passwordHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private hashSession(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private safeEqual(left: string, right: string): boolean {
    return left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
  }
}
