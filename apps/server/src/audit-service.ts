import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { AdminActivity } from "@chessss/shared";

export class AuditService {
  private readonly entries: AdminActivity[];

  constructor(private readonly filePath = resolve(process.cwd(), "data", "admin-audit.jsonl")) {
    this.entries = this.load();
  }

  record(entry: Omit<AdminActivity, "id" | "timestamp">): AdminActivity {
    const base: AdminActivity = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...entry,
    };
    const previousHash = this.entries.at(-1)?.integrityHash ?? "";
    const activity: AdminActivity = { ...base, previousHash, integrityHash: this.hash(previousHash, base) };
    mkdirSync(dirname(this.filePath), { recursive: true });
    appendFileSync(this.filePath, `${JSON.stringify(activity)}\n`, { encoding: "utf8", mode: 0o600 });
    this.entries.push(activity);
    return activity;
  }

  recent(limit = 100): AdminActivity[] {
    return this.entries.slice(-Math.max(1, limit)).reverse();
  }

  private load(): AdminActivity[] {
    if (!existsSync(this.filePath)) return [];
    const entries: AdminActivity[] = [];
    let previousIntegrityHash = "";
    for (const line of readFileSync(this.filePath, "utf8").split("\n").filter(Boolean)) {
      const entry = JSON.parse(line) as AdminActivity;
      if (entry.integrityHash) {
        const { integrityHash, previousHash = "", ...base } = entry;
        if (previousHash !== previousIntegrityHash || integrityHash !== this.hash(previousHash, base)) throw new Error("Audit integrity check failed.");
        previousIntegrityHash = integrityHash;
      } else if (previousIntegrityHash) {
        throw new Error("Legacy audit entries cannot follow integrity-protected entries.");
      }
      entries.push(entry);
    }
    return entries;
  }

  private hash(previousHash: string, entry: AdminActivity): string {
    return createHash("sha256").update(previousHash).update(JSON.stringify(entry)).digest("hex");
  }
}
