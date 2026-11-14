import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ArgsDef } from "citty";
import { runCommand } from "citty";
import { consumeCommandResult } from "../utils/commandResult.js";
import init from "./init.js";

vi.mock("../telemetry/events.js", () => ({ trackInitTemplate: vi.fn() }));
vi.mock("./skills.js", () => ({
  updateSkills: vi.fn(async () => ({ installed: ["hyperframes"], presenceOnly: false })),
}));

let dir: string;
let printed: string[];

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "hf-init-skills-"));
  printed = [];
  vi.stubEnv("HYPERFRAMES_SKIP_SKILLS", "");
  vi.spyOn(console, "log").mockImplementation((...args) => void printed.push(args.join(" ")));
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  consumeCommandResult();
});

it("says the skills it installed are global and how to leave them alone", async () => {
  await runCommand(init, {
    rawArgs: [join(dir, "proj"), "--example", "blank", "--non-interactive"],
  });
  const output = printed.join("\n");
  expect(output).toContain("These skills are global");
  expect(output).toContain("--skip-skills");
});

it("names the global skill folders in the --skip-skills help", () => {
  const args = init.args as ArgsDef;
  const skip = args["skip-skills"];
  const description = skip && typeof skip === "object" ? String(skip.description) : "";
  expect(description).toContain("~/.claude/skills");
  expect(description).toContain("HYPERFRAMES_SKIP_SKILLS=1");
});
