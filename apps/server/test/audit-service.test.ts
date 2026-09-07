import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AuditService } from "../src/audit-service.js";

describe("AuditService", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  it("writes append-only JSON lines and returns the newest activity first", () => {
    const directory = mkdtempSync(join(tmpdir(), "chessss-audit-"));
    directories.push(directory);
    const file = join(directory, "audit.jsonl");
    const audit = new AuditService(file);
    audit.record({ category: "auth", action: "sign-in", actor: "alice" });
    audit.record({ category: "moderation", action: "warning", actor: "Admin", target: "alice", reason: "test" });

    expect(audit.recent().map((entry) => entry.action)).toEqual(["warning", "sign-in"]);
    expect(audit.recent()[0]?.previousHash).toBe(audit.recent()[1]?.integrityHash);
    expect(readFileSync(file, "utf8").trim().split("\n")).toHaveLength(2);
  });
});
