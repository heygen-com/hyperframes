import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { credentialPath } from "../auth/paths.js";
import { readConfig, writeConfig } from "../telemetry/config.js";
import { hyperframesConfigDir } from "./configDir.js";
import { writeProjectLink } from "./projectLink.js";
import { runningDir } from "./runningCli.js";

let dir = "";
afterEach(() => {
  vi.unstubAllEnvs();
  rmSync(dir, { recursive: true, force: true });
});

it("keeps every config file under HYPERFRAMES_CONFIG_DIR when it is set", () => {
  dir = mkdtempSync(join(tmpdir(), "hf-config-"));
  vi.stubEnv("HYPERFRAMES_CONFIG_DIR", dir);
  expect(hyperframesConfigDir("x")).toBe(join(dir, "x"));
  expect(runningDir()).toBe(join(dir, "running"));
  expect(credentialPath().startsWith(dir)).toBe(true);
  expect(writeConfig(readConfig())).toBe(true);
  expect(existsSync(join(dir, "config.json"))).toBe(true);
  writeProjectLink(join(dir, "project"), { projectId: "p", url: "https://example.test/p" });
  expect(existsSync(join(dir, "projects.json"))).toBe(true);
});
