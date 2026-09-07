import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { ConfigService } from "../src/config-service.js";

describe("ConfigService", () => {
  const directories: string[] = [];
  afterEach(() => directories.splice(0).forEach((directory) => rmSync(directory, { recursive: true, force: true })));

  it("persists validated operational controls", () => {
    const directory = mkdtempSync(join(tmpdir(), "chessss-config-"));
    directories.push(directory);
    const file = join(directory, "config.json");
    const service = new ConfigService(file);
    const updated = service.update({ ...service.get(), announcement: "Tournament at 8", maintenanceMode: true, analysisTimeMs: 250 });
    expect(updated).toMatchObject({ announcement: "Tournament at 8", maintenanceMode: true, analysisTimeMs: 250 });
    expect(new ConfigService(file).get().announcement).toBe("Tournament at 8");
  });
});
