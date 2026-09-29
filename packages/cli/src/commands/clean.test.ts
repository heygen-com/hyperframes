import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  symlinkSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { runCommand } from "citty";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createOwnedRenderDir } from "@hyperframes/producer";
import { consumeCommandResult } from "../utils/commandResult.js";
import cleanCommand, { cleanLeftovers } from "./clean.js";

const history = vi.hoisted(() => ({ unreadable: false }));
vi.mock("@hyperframes/studio-server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@hyperframes/studio-server")>();
  return {
    ...actual,
    listProjectHistories: (root: string) => {
      if (history.unreadable) throw new Error("history unreadable");
      return actual.listProjectHistories(root);
    },
  };
});

const JOB = "0f8c2b1e-5d3a-4c7b-9e21-6a4f0d8b3c19";
const SEVEN_HOURS_AGO = (Date.now() - 7 * 60 * 60 * 1000) / 1000;

describe("cleanLeftovers", () => {
  let scratch: string;
  let project: string;
  let renders: string;
  let liveRender: ChildProcess;
  // This machine's real owner stamp, so planted owners differ from it only in pid.
  let stamp: object;

  /** A render temp dir holding one 1000-byte frame, optionally owned and optionally last written 7 h ago. */
  function plant(parent: string, name: string, owner?: number, stale = false): string {
    const dir = join(parent, name);
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "frame_000001.jpg"), Buffer.alloc(1000));
    if (owner) writeFileSync(join(dir, "owner.json"), JSON.stringify({ ...stamp, pid: owner }));
    if (stale)
      for (const path of [join(dir, "frame_000001.jpg"), dir])
        utimesSync(path, SEVEN_HOURS_AGO, SEVEN_HOURS_AGO);
    return dir;
  }

  const run = (overrides: { dryRun?: boolean; snapshots?: boolean } = {}) =>
    cleanLeftovers({
      projectDir: project,
      dryRun: overrides.dryRun ?? false,
      snapshots: overrides.snapshots ?? false,
      historyRoot: join(scratch, "history"),
      tempDir: join(scratch, "tmp"),
      debugDir: join(scratch, "debug"),
    });

  beforeEach(() => {
    scratch = realpathSync(mkdtempSync(join(tmpdir(), "hf-clean-")));
    project = join(scratch, "project");
    renders = join(project, "renders");
    mkdirSync(renders, { recursive: true });
    mkdirSync(join(scratch, "tmp"));
    writeFileSync(join(project, "index.html"), '<div data-composition-id="main"></div>');
    const own = createOwnedRenderDir(join(scratch, "self-"));
    stamp = JSON.parse(readFileSync(join(own, "owner.json"), "utf-8"));
    rmSync(own, { recursive: true });
    vi.stubEnv("HYPERFRAMES_EXTRACT_CACHE_DIR", join(scratch, "extract-cache"));
    // Stands in for a render in progress: a running process that owns its work dir.
    liveRender = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], {
      stdio: "ignore",
    });
  });
  afterEach(() => {
    liveRender.kill("SIGKILL");
    vi.unstubAllEnvs();
    rmSync(scratch, { recursive: true, force: true });
  });

  it("removes what dead renders left and keeps what a running render uses", async () => {
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    const abandoned = plant(renders, `work-${JOB}-aB3dE9`, dead);
    const staging = plant(renders, ".final.hf-transaction-Zx81Qa", dead);
    const beforeOwners = plant(renders, `work-${JOB}-Oo0000`, undefined, true);
    const oldDebug = plant(join(scratch, "debug"), JOB, undefined, true);
    const windowsLeftover = plant(join(scratch, "tmp"), "hf-render-Qw12Er", dead);
    const live = plant(renders, `work-${JOB}-Ll0000`, liveRender.pid);
    const freshOwnerless = plant(renders, `work-${JOB}-Ff0000`);
    const userFolder = plant(renders, "work-in-progress", undefined, true);
    const debugNotes = plant(join(scratch, "debug"), "my-notes", undefined, true);
    writeFileSync(join(renders, "final.mp4"), "the render");
    plant(project, "snapshots");

    const listed = await run({ dryRun: true });
    expect(listed.removed.map((item) => item.path).sort()).toEqual(
      [abandoned, staging, beforeOwners, oldDebug, windowsLeftover].sort(),
    );
    expect(listed.removed.every((item) => item.bytes >= 1000)).toBe(true);
    expect(existsSync(abandoned)).toBe(true);

    await run();
    expect(readdirSync(renders).sort()).toEqual(
      ["final.mp4", live, freshOwnerless, userFolder].map((path) => basename(path)).sort(),
    );
    expect(existsSync(oldDebug) || existsSync(windowsLeftover)).toBe(false);
    expect(existsSync(debugNotes)).toBe(true);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "reports a leftover it cannot remove and still removes the rest",
    async () => {
      const dead = spawnSync(process.execPath, ["-e", ""]).pid;
      const stuck = plant(renders, `work-${JOB}-St0000`, dead);
      const locked = join(stuck, "locked");
      mkdirSync(locked);
      writeFileSync(join(locked, "frame.jpg"), "x");
      chmodSync(locked, 0o555);
      const other = plant(join(scratch, "tmp"), "hf-render-Ot0000", dead);
      try {
        const result = await run();
        expect(result.errors).toHaveLength(1);
        expect(result.removed.map((item) => item.path)).toEqual([other]);
        expect(existsSync(other)).toBe(false);
      } finally {
        chmodSync(locked, 0o755);
      }
    },
  );

  it("leaves snapshots alone in a folder that is not a HyperFrames project", async () => {
    writeFileSync(join(project, "index.html"), "<title>my website</title>");
    const snapshots = plant(project, "snapshots");

    const result = await run({ snapshots: true });
    expect(result.alsoReclaimable).toEqual([]);
    expect(existsSync(snapshots)).toBe(true);
  });

  it.skipIf(process.platform === "win32" || process.getuid?.() === 0)(
    "still cleans when the history folder cannot be read",
    async () => {
      const history = join(scratch, "history");
      mkdirSync(history);
      chmodSync(history, 0o000);
      const dead = spawnSync(process.execPath, ["-e", ""]).pid;
      const leftover = plant(join(scratch, "tmp"), "hf-render-Hi0000", dead);
      try {
        const result = await run();
        expect(result.errors.length).toBeGreaterThan(0);
        expect(existsSync(leftover)).toBe(false);
      } finally {
        chmodSync(history, 0o755);
      }
    },
  );

  it("lists a leftover once when the project folder is a link to the temp dir", async () => {
    const dead = spawnSync(process.execPath, ["-e", ""]).pid;
    const leftover = plant(join(scratch, "tmp"), "hf-render-Ln0000", dead);
    symlinkSync(join(scratch, "tmp"), join(scratch, "tmp-link"));

    const result = await cleanLeftovers({
      projectDir: join(scratch, "tmp-link"),
      dryRun: true,
      snapshots: false,
      historyRoot: join(scratch, "history"),
      tempDir: join(scratch, "tmp"),
      debugDir: join(scratch, "debug"),
    });
    expect(result.removed.map((item) => item.path)).toEqual([leftover]);
  });

  it("exits 1 when something could not be read or removed", async () => {
    history.unreadable = true;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      await runCommand(cleanCommand, { rawArgs: [project, "--dry-run", "--json"] });
      expect(JSON.parse(String(log.mock.calls.at(-1)?.[0])).errors).toContain("history unreadable");
      expect(consumeCommandResult().exitCode).toBe(1);
    } finally {
      history.unreadable = false;
      log.mockRestore();
    }
  });

  it("lists snapshots as reclaimable and removes them only when asked", async () => {
    const snapshots = plant(project, "snapshots");

    const plain = await run();
    expect(plain.alsoReclaimable).toEqual([{ what: "Snapshots", path: snapshots, bytes: 1000 }]);
    expect(existsSync(snapshots)).toBe(true);

    await run({ snapshots: true });
    expect(existsSync(snapshots)).toBe(false);
  });
});
