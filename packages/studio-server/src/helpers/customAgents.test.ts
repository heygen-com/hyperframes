import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  deleteCustomAgent,
  listCustomAgents,
  saveCustomAgent,
  toCustomAgentId,
} from "./customAgents";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function projectDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-custom-agents-"));
  dirs.push(dir);
  return dir;
}

describe("toCustomAgentId", () => {
  it("slugs the label and never collides", () => {
    expect(toCustomAgentId("Pi", [])).toBe("custom:pi");
    expect(toCustomAgentId("My Agent!", [])).toBe("custom:my-agent");
    expect(toCustomAgentId("Pi", ["custom:pi"])).toBe("custom:pi-2");
    expect(toCustomAgentId("Pi", ["custom:pi", "custom:pi-2"])).toBe("custom:pi-3");
  });

  it("falls back for a label with nothing sluggable in it", () => {
    expect(toCustomAgentId("***", [])).toBe("custom:agent");
  });
});

describe("custom agents on disk", () => {
  it("round-trips a registered harness", () => {
    const dir = projectDir();
    const saved = saveCustomAgent(dir, {
      label: "Pi",
      command: "pi",
      args: ["--headless"],
      modelFlag: "--model",
    });

    expect(saved.id).toBe("custom:pi");
    expect(listCustomAgents(dir)).toEqual([saved]);
    // Written as readable JSON: this file is meant to be hand-editable.
    expect(readFileSync(join(dir, ".hyperframes", "agents.json"), "utf-8")).toContain(
      '"label": "Pi"',
    );
  });

  it("removes one without touching the others", () => {
    const dir = projectDir();
    saveCustomAgent(dir, { label: "Pi", command: "pi", args: [] });
    const other = saveCustomAgent(dir, { label: "Mine", command: "mine", args: [] });

    expect(deleteCustomAgent(dir, "custom:pi")).toEqual([other]);
    expect(listCustomAgents(dir)).toEqual([other]);
  });

  it("survives a file that no longer parses", () => {
    const dir = projectDir();
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    writeFileSync(join(dir, ".hyperframes", "agents.json"), "{ not json");
    expect(listCustomAgents(dir)).toEqual([]);
  });

  it("drops entries that lost their required fields", () => {
    const dir = projectDir();
    mkdirSync(join(dir, ".hyperframes"), { recursive: true });
    writeFileSync(
      join(dir, ".hyperframes", "agents.json"),
      JSON.stringify({ agents: [{ id: "custom:x", label: "X" }] }),
    );
    expect(listCustomAgents(dir)).toEqual([]);
  });
});
