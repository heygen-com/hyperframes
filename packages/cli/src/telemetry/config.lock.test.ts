// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let home: string;
let configDir: string;
const saved = { HOME: process.env.HOME, USERPROFILE: process.env.USERPROFILE };

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), "hf-config-lock-"));
  configDir = join(home, ".hyperframes");
  mkdirSync(configDir, { recursive: true });
  process.env.HOME = home;
  process.env.USERPROFILE = home;
  // A worker thread keeps the real home; never write a test answer into it.
  if (homedir() !== home) throw new Error("these tests need a process per test file");
  vi.resetModules();
});

afterEach(() => {
  process.env.HOME = saved.HOME;
  process.env.USERPROFILE = saved.USERPROFILE;
  rmSync(home, { recursive: true, force: true });
});

const consentOnDisk = () =>
  JSON.parse(readFileSync(join(configDir, "config.json"), "utf-8")).localEmbeddingEnabled;

/** Another CLI process: takes the settings lock, saves the person's no after a pause, lets go. */
function anotherProcessSavesNo(): Promise<void> {
  const script = `
    const fs = require("fs");
    const dir = process.argv[1];
    fs.writeFileSync(dir + "/config.json.lock", "", { flag: "wx" });
    process.stdout.write("locked\\n");
    setTimeout(() => {
      fs.writeFileSync(dir + "/config.json.other.tmp", JSON.stringify({ localEmbeddingEnabled: false }));
      fs.renameSync(dir + "/config.json.other.tmp", dir + "/config.json");
      fs.rmSync(dir + "/config.json.lock");
    }, 300);`;
  const child = spawn(process.execPath, ["-e", script, configDir]);
  return new Promise((locked, failed) => {
    child.stdout.on("data", () => locked());
    child.on("error", failed);
  });
}

describe("config writes across processes", () => {
  it("waits for another process's settings write, then keeps the no it saved", async () => {
    const { readConfig, updateLocalModelConsent } = await import("./config.js");
    expect(readConfig().localEmbeddingEnabled).toBeUndefined();
    await anotherProcessSavesNo();

    expect(updateLocalModelConsent((onDisk) => onDisk ?? true)).toBe(false);
    expect(consentOnDisk()).toBe(false);
  });

  it("reads a no saved elsewhere even when keeping it writes nothing", async () => {
    const { readConfig, updateLocalModelConsent } = await import("./config.js");
    const early = readConfig();
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ ...early, localEmbeddingEnabled: false }),
    );

    expect(updateLocalModelConsent((onDisk) => onDisk ?? true)).toBe(false);
    expect(readConfig().localEmbeddingEnabled).toBe(false);
  });

  it("never lets a copy read before another process's no put the question back", async () => {
    const { readConfig, writeConfig } = await import("./config.js");
    const early = readConfig();
    writeFileSync(
      join(configDir, "config.json"),
      JSON.stringify({ ...early, localEmbeddingEnabled: false }),
    );

    writeConfig({ ...early, commandCount: early.commandCount + 1 });
    expect(consentOnDisk()).toBe(false);
  });
});
