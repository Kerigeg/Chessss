import { createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { randomUUID } from "node:crypto";
import type { AdminLoginRequest, AdminNote, AdminRole, AdminUserProfile, AdminUserSummary, AuthResponse, AuthUser, CredentialsRequest, UserWarning } from "@chessss/shared";

const DEFAULT_ADMIN_CODE = "KV99";

interface StoredUser {
  username: string;
  passwordHash: string;
  passwordSalt: string;
  sessionHashes: string[];
  banned?: boolean;
  admin?: boolean;
  role?: AdminRole;
  createdAt?: string;
  lastSignInAt?: string;
  suspendedUntil?: string;
  warnings?: Array<UserWarning & { deliveredAt?: string }>;
  notes?: AdminNote[];
  sessionActivity?: Record<string, string>;
  adminPasswordHash?: string;
  adminPasswordSalt?: string;
  totpSecret?: string;
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

  async signUp(request: CredentialsRequest): Promise<AuthResponse> {
    const username = this.validateUsername(request.username);
    this.validatePassword(request.password);
    if (username.toLowerCase() === "admin") throw new AuthError("That username is reserved for administrator access.");
    if (this.findUser(username)) throw new AuthError("That username is already taken.");

    const passwordSalt = randomBytes(16).toString("hex");
    const user: StoredUser = {
      username,
      passwordSalt,
      passwordHash: await this.hashPassword(request.password, passwordSalt),
      sessionHashes: [],
      createdAt: new Date().toISOString(),
    };
    this.database.users.push(user);
    return this.createSession(user);
  }

  async signIn(request: CredentialsRequest): Promise<AuthResponse> {
    const username = this.validateUsername(request.username);
    const user = this.findUser(username);
    if (!user || !await this.passwordMatches(user, request.password)) throw new AuthError("Incorrect username or password.");
    if (this.isAdmin(user) || username.toLowerCase() === "admin") throw new AuthError("Use the administrator login portal for this account.");
    if (user.banned) throw new AuthError("This account has been banned.");
    this.ensureNotSuspended(user);
    return this.createSession(user);
  }

  async signInAdmin(request: AdminLoginRequest): Promise<AuthResponse> {
    const username = this.validateUsername(request.username);
    let user = this.findUser(username);
    if (user?.adminPasswordHash && user.adminPasswordSalt && user.totpSecret) {
      const password = request.password ?? request.adminCode ?? "";
      const actual = Buffer.from(await this.hashPassword(password, user.adminPasswordSalt), "hex");
      const expected = Buffer.from(user.adminPasswordHash, "hex");
      if (actual.length !== expected.length || !timingSafeEqual(actual, expected) || !this.verifyTotp(user.totpSecret, request.oneTimeCode ?? "")) {
        throw new AuthError("Incorrect administrator password or two-factor code.");
      }
    } else {
      const legacyCode = request.adminCode ?? "";
      const legacyValid = this.safeEqual(this.hashSession(legacyCode), this.hashSession(this.adminCode));
      const individualPasswordValid = Boolean(user && this.isAdmin(user) && request.password && await this.passwordMatches(user, request.password));
      const isUnconfiguredOwner = username.toLowerCase() === "admin" && (!user || this.role(user) === "owner");
      const ownerBootstrapValid = isUnconfiguredOwner && legacyValid;
      if (!ownerBootstrapValid && !individualPasswordValid) throw new AuthError("Incorrect administrator credentials.");
    }

    if (user?.banned) throw new AuthError("This account has been banned.");
    if (!user) {
      if (username.toLowerCase() !== "admin") throw new AuthError("Ask the owner to assign an administrator role to an existing player account.");
      const passwordSalt = randomBytes(16).toString("hex");
      user = {
        username,
        passwordSalt,
        passwordHash: await this.hashPassword(randomBytes(32).toString("base64url"), passwordSalt),
        sessionHashes: [],
        admin: true,
        role: username.toLowerCase() === "admin" ? "owner" : "admin",
        createdAt: new Date().toISOString(),
      };
      this.database.users.push(user);
    } else {
      user.admin = true;
      user.role ??= username.toLowerCase() === "admin" ? "owner" : "admin";
    }
    return this.createSession(user);
  }

  beginAdminSecurity(sessionToken: string): { secret: string } {
    this.requireAdmin(sessionToken);
    return { secret: this.base32Encode(randomBytes(20)) };
  }

  async completeAdminSecurity(sessionToken: string, request: { password: string; secret: string; oneTimeCode: string }): Promise<AuthResponse> {
    const current = this.restore(sessionToken);
    if (!current.user.isAdmin) throw new AuthError("Administrator access is required.");
    this.validatePassword(request.password);
    if (!this.verifyTotp(request.secret, request.oneTimeCode)) throw new AuthError("The two-factor code is not valid for that secret.");
    const user = this.requiredUser(current.user.username);
    const salt = randomBytes(16).toString("hex");
    user.adminPasswordSalt = salt;
    user.adminPasswordHash = await this.hashPassword(request.password, salt);
    user.totpSecret = request.secret;
    user.sessionHashes = [];
    user.sessionActivity = {};
    this.persist();
    return this.createSession(user);
  }

  restore(sessionToken: string): AuthResponse {
    const sessionHash = this.hashSession(sessionToken);
    const user = this.database.users.find((candidate) => candidate.sessionHashes.some((hash) => this.safeEqual(hash, sessionHash)));
    if (!user) throw new AuthError("Your session has expired. Please sign in again.");
    const lastActivity = user.sessionActivity?.[sessionHash];
    if (this.isAdmin(user) && lastActivity && Date.now() - new Date(lastActivity).getTime() > 30 * 60_000) {
      user.sessionHashes = user.sessionHashes.filter((hash) => hash !== sessionHash);
      delete user.sessionActivity?.[sessionHash];
      this.persist();
      throw new AuthError("Your administrator session expired after 30 minutes of inactivity.");
    }
    if (user.banned) throw new AuthError("This account has been banned.");
    this.ensureNotSuspended(user);
    user.sessionActivity ??= {};
    user.sessionActivity[sessionHash] = new Date().toISOString();
    const warnings = this.claimPendingWarnings(user);
    if (this.isAdmin(user) || warnings.length) this.persist();
    return { user: this.publicUser(user), sessionToken, ...(warnings.length ? { warnings } : {}) };
  }

  signOut(sessionToken: string) {
    const sessionHash = this.hashSession(sessionToken);
    for (const user of this.database.users) {
      const next = user.sessionHashes.filter((hash) => !this.safeEqual(hash, sessionHash));
      if (next.length !== user.sessionHashes.length) {
        user.sessionHashes = next;
        delete user.sessionActivity?.[sessionHash];
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
    return this.dashboardUsers();
  }

  dashboardUsers(): AdminUserSummary[] {
    return this.database.users.map((user) => {
      const role = this.role(user);
      return {
        username: user.username,
        banned: Boolean(user.banned),
        isAdmin: Boolean(role),
        ...(role ? { role } : {}),
        createdAt: user.createdAt,
        lastSignInAt: user.lastSignInAt,
        suspendedUntil: user.suspendedUntil,
        warningCount: user.warnings?.length ?? 0,
        adminSecurityEnabled: Boolean(user.adminPasswordHash && user.totpSecret),
      };
    });
  }

  banUser(sessionToken: string, username: string): AdminUserSummary[] {
    const actor = this.requireRole(sessionToken, ["owner", "admin", "moderator"]);
    const user = this.findUser(username);
    if (!user) throw new AuthError("That account does not exist.");
    this.ensureModerationAllowed(actor, user);
    user.banned = true;
    user.sessionHashes = [];
    user.sessionActivity = {};
    this.persist();
    return this.listUsers(sessionToken);
  }

  unbanUser(sessionToken: string, username: string): AdminUserSummary[] {
    const actor = this.requireRole(sessionToken, ["owner", "admin", "moderator"]);
    const user = this.findUser(username);
    if (!user) throw new AuthError("That account does not exist.");
    this.ensureModerationAllowed(actor, user);
    user.banned = false;
    this.persist();
    return this.listUsers(sessionToken);
  }

  forceSignOut(sessionToken: string, username: string): AdminUserSummary[] {
    const actor = this.requireRole(sessionToken, ["owner", "admin"]);
    const user = this.requiredUser(username);
    this.ensureModerationAllowed(actor, user);
    user.sessionHashes = [];
    this.persist();
    return this.listUsers(sessionToken);
  }

  warnUser(sessionToken: string, username: string, reason: string): AdminUserSummary[] {
    const actor = this.requireRole(sessionToken, ["owner", "admin", "moderator"]);
    const user = this.requiredUser(username);
    this.ensureModerationAllowed(actor, user);
    user.warnings ??= [];
    user.warnings.push({ reason: this.requiredText(reason, "A warning reason is required."), actor: actor.username, createdAt: new Date().toISOString() });
    this.persist();
    return this.listUsers(sessionToken);
  }

  claimWarningsForUser(username: string): UserWarning[] {
    const warnings = this.claimPendingWarnings(this.requiredUser(username));
    if (warnings.length) this.persist();
    return warnings;
  }

  suspendUser(sessionToken: string, username: string, reason: string, durationMinutes: number): AdminUserSummary[] {
    const actor = this.requireRole(sessionToken, ["owner", "admin", "moderator"]);
    if (!Number.isFinite(durationMinutes) || durationMinutes < 1 || durationMinutes > 43_200) throw new AuthError("Suspension must be between 1 minute and 30 days.");
    const user = this.requiredUser(username);
    this.ensureModerationAllowed(actor, user);
    user.suspendedUntil = new Date(Date.now() + durationMinutes * 60_000).toISOString();
    user.sessionHashes = [];
    user.warnings ??= [];
    user.warnings.push({ reason: this.requiredText(reason, "A suspension reason is required."), actor: actor.username, createdAt: new Date().toISOString() });
    this.persist();
    return this.listUsers(sessionToken);
  }

  addNote(sessionToken: string, username: string, text: string): AdminUserProfile {
    const actor = this.requireRole(sessionToken, ["owner", "admin", "moderator"]);
    const user = this.requiredUser(username);
    user.notes ??= [];
    user.notes.push({ id: randomUUID(), author: actor.username, text: this.requiredText(text, "A note is required."), createdAt: new Date().toISOString() });
    this.persist();
    return this.profile(sessionToken, username);
  }

  setRole(sessionToken: string, username: string, role: AdminRole | null): AdminUserSummary[] {
    const actor = this.requireRole(sessionToken, ["owner"]);
    const user = this.requiredUser(username);
    if (user.username.toLowerCase() === actor.username.toLowerCase()) throw new AuthError("Use another owner account to change your own role.");
    user.role = role ?? undefined;
    user.admin = Boolean(role);
    user.sessionHashes = [];
    user.sessionActivity = {};
    this.persist();
    return this.listUsers(sessionToken);
  }

  profile(sessionToken: string, username: string): AdminUserProfile {
    this.requireAdmin(sessionToken);
    const user = this.requiredUser(username);
    const summary = this.listUsers(sessionToken).find((candidate) => candidate.username.toLowerCase() === user.username.toLowerCase())!;
    return { ...summary, notes: user.notes ?? [], warnings: user.warnings ?? [], games: [] };
  }

  roleForSession(sessionToken: string): AdminRole | null {
    try { return this.restore(sessionToken).user.role ?? null; } catch { return null; }
  }

  accountCreationDates(): string[] { return this.database.users.map((user) => user.createdAt ?? "legacy"); }

  isPubliclyEligible(username: string): boolean {
    const user = this.findUser(username);
    return Boolean(user && !user.banned);
  }

  isSuspended(username: string): boolean {
    const user = this.findUser(username);
    return Boolean(user?.suspendedUntil && new Date(user.suspendedUntil).getTime() > Date.now());
  }

  private createSession(user: StoredUser): AuthResponse {
    const sessionToken = randomBytes(32).toString("base64url");
    user.sessionHashes.push(this.hashSession(sessionToken));
    user.sessionActivity ??= {};
    user.sessionActivity[this.hashSession(sessionToken)] = new Date().toISOString();
    user.lastSignInAt = new Date().toISOString();
    const warnings = this.claimPendingWarnings(user);
    this.persist();
    return { user: this.publicUser(user), sessionToken, ...(warnings.length ? { warnings } : {}) };
  }

  private claimPendingWarnings(user: StoredUser): UserWarning[] {
    const deliveredAt = new Date().toISOString();
    return (user.warnings ?? []).filter((warning) => !warning.deliveredAt).map((warning) => {
      warning.deliveredAt = deliveredAt;
      return { reason: warning.reason, actor: warning.actor, createdAt: warning.createdAt };
    });
  }

  private publicUser(user: StoredUser): AuthUser {
    const role = this.role(user);
    return { username: user.username, isAdmin: Boolean(role), ...(role ? { role } : {}) };
  }

  private isAdmin(user: StoredUser): boolean {
    return Boolean(this.role(user));
  }

  private requireAdmin(sessionToken: string) {
    const user = this.userForSession(sessionToken);
    if (!user.isAdmin) throw new AuthError("Administrator access is required.");
    return user;
  }

  private requireRole(sessionToken: string, allowed: AdminRole[]): AuthUser {
    const user = this.requireAdmin(sessionToken);
    if (!user.role || !allowed.includes(user.role)) throw new AuthError("Your administrator role cannot perform this action.");
    return user;
  }

  private ensureModerationAllowed(actor: AuthUser, target: StoredUser) {
    const targetRole = this.role(target);
    if (!targetRole) return;
    if (actor.role !== "owner") throw new AuthError("Only the Owner can moderate administrator accounts.");
    if (targetRole === "owner") throw new AuthError("Owner accounts cannot be moderated.");
  }

  private role(user?: StoredUser): AdminRole | null {
    if (!user) return null;
    if (user.role) return user.role;
    if (user.admin) return user.username.toLowerCase() === "admin" ? "owner" : "admin";
    return null;
  }

  private requiredUser(username: string): StoredUser {
    const user = this.findUser(username);
    if (!user) throw new AuthError("That account does not exist.");
    return user;
  }

  private requiredText(value: string, message: string): string {
    const text = value.trim();
    if (!text) throw new AuthError(message);
    return text.slice(0, 1_000);
  }

  private ensureNotSuspended(user: StoredUser) {
    if (!user.suspendedUntil) return;
    if (new Date(user.suspendedUntil).getTime() <= Date.now()) {
      delete user.suspendedUntil;
      this.persist();
      return;
    }
    throw new AuthError(`This account is suspended until ${user.suspendedUntil}.`);
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

  private hashPassword(password: string, salt: string): Promise<string> {
    return new Promise((resolve, reject) => {
      scrypt(password, salt, 64, (error, derivedKey) => error ? reject(error) : resolve(derivedKey.toString("hex")));
    });
  }

  private async passwordMatches(user: StoredUser, password: string): Promise<boolean> {
    const actual = Buffer.from(await this.hashPassword(password, user.passwordSalt), "hex");
    const expected = Buffer.from(user.passwordHash, "hex");
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }

  private hashSession(token: string): string {
    return createHash("sha256").update(token).digest("hex");
  }

  private safeEqual(left: string, right: string): boolean {
    return left.length === right.length && timingSafeEqual(Buffer.from(left), Buffer.from(right));
  }

  private verifyTotp(secret: string, code: string): boolean {
    if (!/^\d{6}$/.test(code)) return false;
    const key = this.base32Decode(secret);
    const counter = Math.floor(Date.now() / 30_000);
    return [-1, 0, 1].some((offset) => {
      const buffer = Buffer.alloc(8);
      buffer.writeBigUInt64BE(BigInt(counter + offset));
      const digest = createHmac("sha1", key).update(buffer).digest();
      const position = digest[digest.length - 1]! & 0x0f;
      const value = (digest.readUInt32BE(position) & 0x7fffffff) % 1_000_000;
      return this.safeEqual(value.toString().padStart(6, "0"), code);
    });
  }

  private base32Encode(value: Buffer): string {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    let bits = "";
    for (const byte of value) bits += byte.toString(2).padStart(8, "0");
    return bits.match(/.{1,5}/g)!.map((chunk) => alphabet[Number.parseInt(chunk.padEnd(5, "0"), 2)]).join("");
  }

  private base32Decode(value: string): Buffer {
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
    const bits = value.toUpperCase().replace(/=+$/, "").split("").map((character) => alphabet.indexOf(character).toString(2).padStart(5, "0")).join("");
    return Buffer.from((bits.match(/.{8}/g) ?? []).map((byte) => Number.parseInt(byte, 2)));
  }
}
