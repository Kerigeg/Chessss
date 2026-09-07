import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { AdminSiteConfig, ComputerLevel } from "@chessss/shared";

const DEFAULT_CONFIG: AdminSiteConfig = {
  timeControlsMs: [60_000, 180_000, 300_000, 600_000, 1_800_000, 2_700_000],
  computerLevels: ["beginner", "medium", "high", "hell", "stockfish"],
  analysisTimeMs: 120,
  analysisTimeoutMs: 60_000,
  announcement: "",
  maintenanceMode: false,
  featureFlags: { analysis: true, computerGames: true, fairPlayReview: true },
};

export class ConfigError extends Error {}

export class ConfigService {
  private config: AdminSiteConfig;
  constructor(private readonly filePath = resolve(process.cwd(), "data", "site-config.json")) { this.config = this.load(); }

  get(): AdminSiteConfig { return structuredClone(this.config); }

  update(next: AdminSiteConfig): AdminSiteConfig {
    const levels = next.computerLevels.filter((level): level is ComputerLevel => DEFAULT_CONFIG.computerLevels.includes(level));
    if (!next.timeControlsMs.length || next.timeControlsMs.some((value) => !Number.isInteger(value) || value < 30_000 || value > 10_800_000)) throw new ConfigError("Time controls must be between 30 seconds and 3 hours.");
    if (!levels.length) throw new ConfigError("At least one computer level must remain enabled.");
    if (next.analysisTimeMs < 25 || next.analysisTimeMs > 5_000) throw new ConfigError("Analysis strength must be between 25 and 5000 milliseconds per position.");
    if (next.analysisTimeoutMs < 5_000 || next.analysisTimeoutMs > 300_000) throw new ConfigError("Analysis timeout must be between 5 and 300 seconds.");
    this.config = { ...next, computerLevels: levels, announcement: next.announcement.trim().slice(0, 500) };
    this.persist();
    return this.get();
  }

  private load(): AdminSiteConfig {
    if (!existsSync(this.filePath)) return structuredClone(DEFAULT_CONFIG);
    try { return { ...structuredClone(DEFAULT_CONFIG), ...(JSON.parse(readFileSync(this.filePath, "utf8")) as Partial<AdminSiteConfig>) }; }
    catch { throw new ConfigError("The site configuration could not be read."); }
  }

  private persist() {
    mkdirSync(dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    writeFileSync(temporary, JSON.stringify(this.config, null, 2), { mode: 0o600 });
    renameSync(temporary, this.filePath);
  }
}
