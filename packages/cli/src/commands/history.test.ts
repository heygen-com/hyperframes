// @vitest-environment node
import { spawn } from "node:child_process";
import { mkdtempSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createAdaptorServer } from "@hono/node-server";
import {
  createStudioApi,
  openProjectHistory,
  type StudioApiAdapter,
} from "@hyperframes/studio-server";
import { runCommand } from "citty";
import { Hono } from "hono";
import { afterEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import { historyDeps } from "../utils/historyOwner.js";
import historyCommand from "./history.js";

const pause = (ms: number) => new Promise((settle) => setTimeout(settle, ms));

const tracked = vi.hoisted(() => [] as Array<{ action: string; via: string }>);
vi.mock("../telemetry/events.js", () => ({
  trackHistoryAction: (props: { action: string; via: string }) => tracked.push(props),
}));

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
  tracked.length = 0;
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** A project of index.html "A" and notes.html "N", its history kept in a temp root, no preview running. */
function project() {
  const dir = tempDir("hf-history-cli-");
  writeFileSync(join(dir, "index.html"), "A");
  writeFileSync(join(dir, "notes.html"), "N");
  historyDeps.historyRoot = tempDir("hf-history-cli-root-");
  historyDeps.findServer = async () => null;
  historyDeps.turnIdleMs = 60_000;
  const write = (path: string, text: string) => writeFileSync(join(dir, path), text);
  const read = (path: string) => readFileSync(join(dir, path), "utf-8");
  async function hf(...args: string[]) {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await runCommand(historyCommand, { rawArgs: [...args, "--dir", dir] });
      const out = log.mock.calls.map((call) => call.join(" ")).join("\n");
      const err = error.mock.calls.map((call) => call.join(" ")).join("\n");
      return { out, err, code: consumeCommandResult().exitCode };
    } finally {
      log.mockRestore();
      error.mockRestore();
    }
  }
  const json = async (...args: string[]) => JSON.parse((await hf(...args, "--json")).out);
  /** One agent turn that writes `path`. */
  async function turn(name: string, label: string, path: string, text: string) {
    await hf("begin", "--who", name, "--label", label);
    write(path, text);
    return (await json("end")).entry;
  }
  return { dir, write, read, hf, json, turn };
}

/** A running preview over the project's history, as `hyperframes preview` serves it. */
async function preview(dir: string) {
  const history = await openProjectHistory({
    projectDir: dir,
    historyRoot: historyDeps.historyRoot,
    quietMs: 20,
  });
  const adapter = {
    listProjects: () => [],
    resolveProject: (id: string) => (id === "demo" ? { id, dir } : null),
    history: () => history,
  } as unknown as StudioApiAdapter;
  const server = createAdaptorServer({
    fetch: new Hono().route("/api", createStudioApi(adapter)).fetch,
  });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  cleanup.push(async () => {
    server.close();
    await history.close();
  });
  const { port } = server.address() as AddressInfo;
  historyDeps.findServer = async () =>
    ({
      port,
      host: "127.0.0.1",
      projectName: "demo",
      projectDir: dir,
      version: "test",
      pid: null,
    }) as never;
  return history;
}

describe.each(["direct", "preview"])("hyperframes history (%s)", (mode) => {
  async function setup() {
    const p = project();
    await p.hf(); // the first open records the baseline
    const held = mode === "preview" ? await preview(p.dir) : null;
    /** A person's edit, taken in as preview's file watcher would. */
    async function personWrites(path: string, text: string) {
      p.write(path, text);
      if (!held) return;
      held.noteChange(path);
      await vi.waitFor(() => expect(held.list().at(-1)?.files[0]?.path).toBe(path));
    }
    return { ...p, personWrites };
  }

  it("an agent's labelled turn, a person's edit after it: --since shows both, undo of the turn keeps the edit", async () => {
    const { read, json, hf, turn, personWrites } = await setup();
    const startedAt = new Date(Date.now() - 1).toISOString();
    await turn("claude", "Bigger title", "index.html", "A2");
    await personWrites("notes.html", "N2");

    const both = (await json("--since", startedAt)).entries;
    expect(both.map((entry: { who: object; files: string[] }) => [entry.who, entry.files])).toEqual(
      [
        [{ kind: "outside", name: "Outside" }, ["notes.html"]],
        [{ kind: "agent", name: "claude" }, ["index.html"]],
      ],
    );
    const mine = (await json("--since", "mine", "--who", "claude")).entries;
    expect(mine).toMatchObject([{ who: { name: "Outside" }, files: ["notes.html"] }]);

    const undo = await hf("undo", "--who", "claude");
    expect(undo.code, undo.err).toBe(0);
    expect([read("index.html"), read("notes.html")]).toEqual(["A", "N2"]);
    expect(tracked.map((event) => event.via)).toContain(mode);
    expect(tracked.map((event) => event.action)).toEqual(
      expect.arrayContaining(["begin", "end", "list", "undo"]),
    );
  });

  it("a turn left open ends after the idle limit: a person's later edit stays theirs through undo of the turn", async () => {
    const { write, read, hf, personWrites } = await setup();
    historyDeps.turnIdleMs = 300;
    await hf("begin", "--who", "claude", "--label", "Retitle");
    write("index.html", "A2");
    await pause(600);
    await personWrites("notes.html", "N2");

    const undo = await hf("undo", "--who", "claude");
    expect(undo.code, undo.err).toBe(0);
    expect([read("index.html"), read("notes.html")]).toEqual(["A", "N2"]);
  });

  it("undo by one agent leaves another agent's open turn open", async () => {
    const { write, read, json, hf, turn } = await setup();
    await turn("gemini", "Notes", "notes.html", "N2");
    await hf("begin", "--who", "claude", "--label", "Bigger title");
    write("index.html", "A2");

    expect((await hf("undo", "--who", "gemini")).code).toBe(0);
    expect(read("notes.html")).toBe("N");
    expect((await hf("end")).code).toBe(0);
    const claude = (await json()).entries.filter(
      (e: { who: { name: string } }) => e.who.name === "claude",
    );
    expect(claude).toMatchObject([{ files: ["index.html"] }]);
  });

  it("undo of an id without --who is the person's, and leaves an agent's open turn open", async () => {
    const { write, json, hf, turn } = await setup();
    const notes = await turn("gemini", "Notes", "notes.html", "N2");
    await hf("begin", "--who", "claude", "--label", "Bigger title");
    write("index.html", "A2");

    expect((await json("undo", notes.id)).entry.who).toEqual({ kind: "person", name: "You" });
    expect((await hf("end")).code).toBe(0);
  });

  it("undo refuses a conflict with exit 2, names the newer entries and both choices, then takes one", async () => {
    const { read, hf, turn } = await setup();
    const first = await turn("claude", "First", "index.html", "A2");
    await turn("gemini", "Second", "index.html", "A3");

    const refused = await hf("undo", first.id.slice(0, 8));
    expect(refused.code).toBe(2);
    expect(refused.out).toContain("Second");
    expect(refused.out).toMatch(/--just-this[\s\S]*--back-to-before/);
    expect(read("index.html")).toBe("A3");

    expect((await hf("undo", first.id, "--just-this")).code).toBe(0);
    expect(read("index.html")).toBe("A");
  });

  it("show lists an entry's files and --diff prints the text change", async () => {
    const { hf, turn } = await setup();
    const entry = await turn("claude", "Retitle", "index.html", "A2");
    expect((await hf("show", entry.id)).out).toContain("M index.html");
    const diff = (await hf("show", entry.id.slice(0, 8), "--diff")).out;
    expect(diff).toMatch(/-A\n\\ No newline at end of file\n\+A2/);
  });

  it("peek reads a file as it was without writing, and restore puts every file back", async () => {
    const { read, hf, turn } = await setup();
    const entry = await turn("claude", "Retitle", "index.html", "A2");
    await turn("claude", "Again", "index.html", "A3");

    const stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    await hf("peek", entry.id, "index.html");
    expect(String(stdout.mock.calls[0]?.[0])).toBe("A2");
    stdout.mockRestore();
    expect(read("index.html")).toBe("A3");

    expect((await hf("restore", "start")).code).toBe(0);
    expect(read("index.html")).toBe("A");
  });

  it("pin marks an entry kept, --off unmarks it", async () => {
    const { json, hf, turn } = await setup();
    const entry = await turn("claude", "Retitle", "index.html", "A2");
    await hf("pin", entry.id);
    expect((await json()).entries[0]).toMatchObject({ id: entry.id, pinned: true });
    await hf("pin", entry.id, "--off");
    expect((await json()).entries[0]).toMatchObject({ pinned: false });
  });
});

describe("hyperframes history, one owner", () => {
  it("goes through a running preview, so the log keeps one baseline and every entry once", async () => {
    const { dir, json, turn } = project();
    const held = await preview(dir);
    await turn("claude", "Retitle", "index.html", "A2");
    await json();
    const log = readFileSync(join(historyDeps.historyRoot, held.projectId, "log.jsonl"), "utf-8");
    const records = log
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row).type);
    expect(records).toEqual(["baseline", "entry"]);
  });

  it("a turn begun through a preview that stopped without closing it is still the agent's", async () => {
    const { dir, write, json, hf } = project();
    await hf();
    const turn = {
      via: "preview",
      id: "turn-1",
      who: { kind: "agent", name: "claude" },
      label: "Retitle",
      startedAt: 1,
      lastWriteAt: Date.now(),
    };
    writeFileSync(join(dir, ".hyperframes", "history-turn.json"), JSON.stringify(turn));
    write("index.html", "A2");

    expect((await json("end")).entry).toMatchObject({
      id: "turn-1",
      who: turn.who,
      files: ["index.html"],
    });
  });

  it("a turn whose writes come closer together than the idle limit stays the agent's past it", async () => {
    const { dir, write, json, hf } = project();
    await hf();
    historyDeps.turnIdleMs = 400;
    // Written "later" by their times, so the test never races the clock.
    const writeAt = (path: string, at: number) => {
      write(path, "2");
      utimesSync(join(dir, path), at / 1000, at / 1000);
    };
    await hf("begin", "--who", "claude", "--label", "Retitle");
    const at = Date.now() + 300;
    writeAt("index.html", at);
    await hf(); // a command mid-turn files the turn so far; the rest counts from index.html
    writeAt("notes.html", at + 300);
    writeAt("extra.html", at + 600);
    await hf("end");
    const entries = (await json()).entries.reverse();
    expect(
      entries.map((entry: { who: object; files: string[] }) => [entry.who, entry.files]),
    ).toEqual([
      [{ kind: "agent", name: "claude" }, ["index.html"]],
      [{ kind: "agent", name: "claude" }, ["extra.html", "notes.html"]],
    ]);
  });

  it("undo --who refuses when the agent's last turn recorded nothing, and leaves its earlier turn alone", async () => {
    const { dir, read, write, hf, turn } = project();
    await hf();
    historyDeps.turnIdleMs = 400;
    await turn("claude", "Earlier", "notes.html", "N2");
    await hf("begin", "--who", "claude", "--label", "Retitle");
    // The only change lands past the idle limit (the person's edit over the agent's), so it is Outside.
    write("index.html", "A2");
    const later = Date.now() + 60_000;
    utimesSync(join(dir, "index.html"), later / 1000, later / 1000);

    const refused = await hf("undo", "--who", "claude");
    expect([refused.code, refused.err]).toEqual([
      2,
      "claude's last turn has no change still in effect; undo an older entry by its id",
    ]);
    expect([read("index.html"), read("notes.html")]).toEqual(["A2", "N2"]);
  });

  it("undo --who reverts every part of a turn that a mid-turn command split", async () => {
    const { read, write, hf, json } = project();
    await hf();
    await hf("begin", "--who", "claude", "--label", "Retitle");
    write("index.html", "A2");
    await hf(); // files the turn so far as its first part
    write("notes.html", "N2");
    expect((await json("end")).parts).toHaveLength(2);

    const undo = await hf("undo", "--who", "claude");
    expect(undo.code, undo.err).toBe(0);
    expect([read("index.html"), read("notes.html")]).toEqual(["A", "N"]);
  });

  it("undo --who of a split turn with a conflict changes nothing and offers the choices for the whole turn", async () => {
    const { read, write, hf } = project();
    await hf();
    await hf("begin", "--who", "claude", "--label", "Retitle");
    write("index.html", "A2");
    await hf(); // files the turn so far as its first part
    write("notes.html", "N2");
    await hf("end");
    write("index.html", "A3"); // the person's edit over the first part

    const refused = await hf("undo", "--who", "claude");
    expect(refused.code).toBe(2);
    expect(refused.out).toContain("hyperframes history undo --who claude --just-this");
    expect([read("index.html"), read("notes.html")], "no part stays undone").toEqual(["A3", "N2"]);

    expect((await hf("undo", "--who", "claude", "--just-this")).code).toBe(0);
    expect([read("index.html"), read("notes.html")]).toEqual(["A", "N"]);
  });

  it("a turn marker with no last write time has ended, so the next edit is not the agent's", async () => {
    const { dir, write, json, hf } = project();
    await hf();
    const who = { kind: "agent", name: "claude" };
    const marker = { via: "direct", id: "turn-1", who, label: "Retitle", startedAt: 1 };
    writeFileSync(join(dir, ".hyperframes", "history-turn.json"), JSON.stringify(marker));
    write("index.html", "A2");

    expect((await json()).entries[0]).toMatchObject({ who: { kind: "outside" } });
  });

  it("a CLI run waits while another process holds the history, instead of forking its log", async () => {
    const { dir, write } = project();
    const home = tempDir("hf-history-cli-home-");
    const historyRoot = join(home, ".cache", "hyperframes", "history");
    const held = await openProjectHistory({ projectDir: dir, historyRoot });
    write("index.html", "A2");
    const cli = resolve(fileURLToPath(import.meta.url), "..", "..", "cli.ts");
    const child = spawn("bun", ["run", cli, "history", "--dir", dir], {
      env: {
        ...process.env,
        HOME: home,
        HYPERFRAMES_SKIP_UPDATE_CHECK: "1",
        HYPERFRAMES_NO_TELEMETRY: "1",
      },
    });
    const exited = new Promise<number | null>((done) => child.on("exit", done));
    const logFile = join(historyRoot, held.projectId, "log.jsonl");
    await new Promise((settle) => setTimeout(settle, 1500));
    expect(
      readFileSync(logFile, "utf-8").trim().split("\n"),
      "nothing written while held",
    ).toHaveLength(1);

    await held.close(); // commits the outside edit once
    expect(await exited).toBe(0);
    const types = readFileSync(logFile, "utf-8")
      .trim()
      .split("\n")
      .map((row) => JSON.parse(row).type);
    expect(types).toEqual(["baseline", "entry"]);
  });
});

describe("hyperframes history, refusals", () => {
  it("undo --who refuses once the agent's newest entry is already undone", async () => {
    const { read, hf, turn } = project();
    await hf();
    await turn("claude", "Retitle", "index.html", "A2");
    expect((await hf("undo", "--who", "claude")).code).toBe(0);

    const again = await hf("undo", "--who", "claude");
    expect([again.code, again.err]).toEqual([
      2,
      "claude's last turn has no change still in effect; undo an older entry by its id",
    ]);
    expect(read("index.html")).toBe("A");
  });

  it("restore refuses a ref that is neither an entry nor a date, instead of reading it as a time", async () => {
    const { read, write, hf, json, turn } = project();
    await hf();
    await turn("claude", "Retitle", "index.html", "A2");
    write("added.html", "new");
    const ids = (await json()).entries.map((entry: { id: string }) => entry.id);
    const digit = [..."0123456789"].find((d) => !ids.some((id: string) => id.startsWith(d)))!;

    const refused = await hf("restore", digit);
    expect([refused.code, refused.err]).toEqual([2, `No entry "${digit}" in this history`]);
    expect((await hf("restore", "2026-02-31")).err).toBe('"2026-02-31" is not a date');
    expect(read("added.html")).toBe("new");
  });

  it("--json refusals go to stdout as {ok: false, error}", async () => {
    const { hf } = project();
    await hf();
    const refused = await hf("show", "zzzz", "--json");
    expect(refused.code).toBe(2);
    expect(JSON.parse(refused.out)).toMatchObject({
      ok: false,
      error: 'No entry "zzzz" in this history',
    });
    expect((await hf("--limit", "0")).code).toBe(2);
  });

  it("refuses a folder with no index.html, and records nothing for it", async () => {
    project();
    const folder = tempDir("hf-history-cli-not-a-project-");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(runCommand(historyCommand, { rawArgs: ["--dir", folder] })).rejects.toThrow();
    error.mockRestore();
    expect(readdirSync(historyDeps.historyRoot)).toEqual([]);
  });

  it("exits 2 with the holder's pid when another process keeps the history past the wait", async () => {
    const { dir, hf } = project();
    await openProjectHistory({ projectDir: dir, historyRoot: historyDeps.historyRoot }).then(
      (held) => cleanup.push(() => held.close()),
    );
    const busy = await hf();
    expect([busy.code, busy.err]).toEqual([
      2,
      `This project's history is open in another process (pid ${process.pid}).`,
    ]);
  }, 15_000);
});
