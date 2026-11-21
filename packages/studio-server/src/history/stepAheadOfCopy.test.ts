// @vitest-environment node
import { fork } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    writeFile: vi.fn(actual.writeFile),
    open: vi.fn(actual.open),
    stat: vi.fn(actual.stat),
  };
});

import * as fsp from "node:fs/promises";
import { fileContentVersion, recordFileWriteReceipt } from "../helpers/fileVersion.js";
import { readLog, START, type HistoryWho } from "./historyLog.js";
import { blobPath } from "./blobStore.js";
import { openProjectHistory, type ProjectHistory } from "./projectHistory.js";

const {
  writeFile: realWriteFile,
  open: realOpen,
  stat: realStat,
} = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
const sha256 = (bytes: string | Buffer) => createHash("sha256").update(bytes).digest("hex");
const agent: HistoryWho = { kind: "agent", name: "Framey" };
const you: HistoryWho = { kind: "person", name: "You" };
const STILL_SAVING = "The project's starting copy is still being saved";
const NOT_KEPT = "An earlier version of parts/p1.js is not kept";
const temps: string[] = [];
const closes: (() => Promise<void>)[] = [];

afterEach(async () => {
  vi.mocked(fsp.writeFile).mockImplementation(realWriteFile);
  vi.mocked(fsp.open).mockImplementation(realOpen);
  vi.mocked(fsp.stat).mockImplementation(realStat);
  for (const close of closes.splice(0)) await close();
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const tempDir = (prefix: string) => {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  temps.push(dir);
  return dir;
};

/** index.html and parts/p1.js, whose first copy is pending once `stall` holds its read. */
function project() {
  const dir = tempDir("hf-step-ahead-");
  mkdirSync(join(dir, "parts"));
  writeFileSync(join(dir, "index.html"), "<html>before</html>");
  writeFileSync(join(dir, "parts", "p1.js"), "// before\n");
  const historyRoot = tempDir("hf-step-ahead-root-");
  const file = (path: string) => join(dir, path);
  const read = (path: string) => readFileSync(file(path), "utf8");
  let ahead = 0;
  const opts = {
    projectDir: dir,
    historyRoot,
    firstCopyFileMs: 100,
    now: () => Date.now() + ahead,
  };
  // History trusts a stat it has seen unchanged for longer than a file system's time step.
  const later = () => (ahead += 5000);
  return { dir, historyRoot, file, read, opts, later };
}

/** The first open of `path` waits until released, at the latest before the test's histories close. */
function stallRead(path: string): () => void {
  const releases: (() => void)[] = [];
  let stalled = false;
  vi.mocked(fsp.open).mockImplementation(async (...args: Parameters<typeof realOpen>) => {
    if (String(args[0]) === path && !stalled) {
      stalled = true;
      await new Promise<void>((answer) => releases.push(answer));
    }
    return realOpen(...args);
  });
  const release = () => releases.forEach((answer) => answer());
  closes.push(async () => release());
  return release;
}

/** The first filing of `bytes` into the blob store waits until released; the read before it is not held. */
function holdFiling(bytes: Buffer): { release: () => void; reached: Promise<void> } {
  const releases: (() => void)[] = [];
  let reach = () => {};
  const reached = new Promise<void>((held) => (reach = held));
  vi.mocked(fsp.writeFile).mockImplementation(async (...args: Parameters<typeof realWriteFile>) => {
    const [to, written] = args;
    if (!releases.length && String(to).includes("incoming-") && bytes.equals(written as Buffer)) {
      const wait = new Promise<void>((answer) => releases.push(answer));
      reach();
      await wait;
    }
    return realWriteFile(...args);
  });
  const release = () => releases.forEach((answer) => answer());
  closes.push(async () => release());
  return { release, reached };
}

async function open(opts: Parameters<typeof openProjectHistory>[0]) {
  const history = await openProjectHistory(opts);
  closes.push(() => history.close());
  return history;
}

const homeIn = (historyRoot: string) => {
  const homes = readdirSync(historyRoot, { withFileTypes: true }).filter((e) => e.isDirectory());
  return join(historyRoot, homes.find((e) => existsSync(join(historyRoot, e.name, "blobs")))!.name);
};

/** Every first copy is recorded: nothing is named as still being adopted. */
const landed = (historyRoot: string) =>
  vi.waitFor(() => expect(existsSync(join(homeIn(historyRoot), "adopting.json"))).toBe(false), {
    timeout: 10_000,
  });

/** Runs `__fixtures__/stepThenDie.ts`; resolves with the step's window id once the process is killed. */
function stepThenDie(dir: string, historyRoot: string, stuck: string, mode: string) {
  return new Promise<string>((done, fail) => {
    let id = "";
    const fixture = join(import.meta.dirname, "__fixtures__", "stepThenDie.ts");
    fork(fixture, [dir, historyRoot, stuck, mode], { execArgv: ["--import", "tsx"] })
      .on("message", (message) => (id = (message as { id: string }).id))
      .once("exit", (_, signal) =>
        signal === "SIGKILL" ? done(id) : fail(new Error(`stepThenDie exited: ${signal}`)),
      );
  });
}

async function step(history: ProjectHistory, writes: () => void, notes: string[]) {
  const window = await history.beginWindow(agent, "Step");
  writes();
  for (const path of notes) history.noteChange(path);
  return (await window.close())!;
}

describe("an agent step that began while a file's first copy was pending", () => {
  it("refuses its whole undo while the copy is still pending", async () => {
    const { file, read, opts } = project();
    stallRead(file("parts/p1.js"));
    const history = await open(opts);
    const entry = await step(history, () => {
      writeFileSync(file("parts/p1.js"), "// agent\n");
      writeFileSync(file("index.html"), "<html>agent</html>");
    }, [file("parts/p1.js"), file("index.html")]);
    const cursor = history.next("back", agent)?.id;
    const listed = history.list().length;
    await expect(history.undo(entry.id, { who: agent })).rejects.toThrow(STILL_SAVING);
    await expect(history.step("back", agent)).rejects.toThrow(STILL_SAVING);
    await expect(history.restore(START, agent)).rejects.toThrow(STILL_SAVING);
    await expect(history.restore(entry.id, agent)).rejects.toThrow(STILL_SAVING);
    expect(history.next("back", agent)?.id).toBe(cursor);
    expect(history.list()).toHaveLength(listed);
    expect(read("index.html")).toBe("<html>agent</html>");
    expect(read("parts/p1.js")).toBe("// agent\n");
  });

  it("stops Cmd+Z at a step whose only write was the pending file", async () => {
    const { file, read, opts } = project();
    stallRead(file("parts/p1.js"));
    const history = await open(opts);
    await step(history, () => writeFileSync(file("index.html"), "<html>first</html>"), [
      file("index.html"),
    ]);
    const entry = await step(history, () => writeFileSync(file("parts/p1.js"), "// agent\n"), [
      file("parts/p1.js"),
    ]);
    expect(history.next("back", agent)?.id).toBe(entry.id);
    await expect(history.step("back", agent)).rejects.toThrow(STILL_SAVING);
    expect(read("index.html")).toBe("<html>first</html>");
    expect(read("parts/p1.js")).toBe("// agent\n");
  });

  it("stops Cmd+Z at an open step whose only write so far is the pending file", async () => {
    const { file, read, opts } = project();
    stallRead(file("parts/p1.js"));
    const history = await open(opts);
    await step(history, () => writeFileSync(file("index.html"), "<html>first</html>"), [
      file("index.html"),
    ]);
    const window = await history.beginWindow(agent, "Step");
    closes.unshift(async () => void (await window.close()));
    writeFileSync(file("parts/p1.js"), "// agent\n");
    history.noteChange(file("parts/p1.js"));
    expect(history.next("back", agent)?.id).toBe(window.id);
    const listed = history.list();
    await expect(history.step("back", agent)).rejects.toThrow(STILL_SAVING);
    expect(history.list()).toEqual(listed);
    expect(history.next("back", agent)?.id).toBe(window.id);
    expect(read("index.html")).toBe("<html>first</html>");
    expect(read("parts/p1.js")).toBe("// agent\n");
  });

  it("refuses its whole undo once the copy lands showing the file changed", async () => {
    const { file, read, historyRoot, opts } = project();
    const release = stallRead(file("parts/p1.js"));
    const history = await open(opts);
    const entry = await step(history, () => {
      writeFileSync(file("parts/p1.js"), "// agent\n");
      writeFileSync(file("index.html"), "<html>agent</html>");
    }, [file("parts/p1.js"), file("index.html")]);
    release();
    await landed(historyRoot);
    expect(history.peek(START)!["parts/p1.js"]).not.toBe(sha256("// agent\n"));
    await expect(history.undo(entry.id, { who: agent })).rejects.toThrow(NOT_KEPT);
    await expect(history.undo(entry.id, { who: agent, mode: "back-to-before" })).rejects.toThrow(
      NOT_KEPT,
    );
    await expect(history.restore(START, agent)).rejects.toThrow(NOT_KEPT);
    expect(read("index.html")).toBe("<html>agent</html>");
    expect(read("parts/p1.js")).toBe("// agent\n");
  });

  it("undoes as usual once the copy lands and the file still holds its original bytes", async () => {
    const { file, read, historyRoot, opts } = project();
    const { release } = holdFiling(Buffer.from("// before\n"));
    const history = await open(opts);
    const entry = await step(
      history,
      () => writeFileSync(file("index.html"), "<html>agent</html>"),
      [file("index.html")],
    );
    release();
    await landed(historyRoot);
    expect(history.peek(START)!["parts/p1.js"]).toBe(sha256("// before\n"));
    await vi.waitFor(async () => {
      expect(await history.undo(entry.id, { who: agent })).toMatchObject({ ok: true });
    });
    expect(read("index.html")).toBe("<html>before</html>");
    expect(read("parts/p1.js")).toBe("// before\n");
  });

  it("refuses its undo when the step rewrote the file in the same time step, size and times unchanged", async () => {
    const { file, read, historyRoot, opts, later } = project();
    const { release } = holdFiling(Buffer.from("// before\n"));
    const listed = await realStat(file("parts/p1.js"));
    const history = await open(opts);
    const entry = await step(history, () => {
      writeFileSync(file("parts/p1.js"), "// BEFORE\n");
      writeFileSync(file("index.html"), "<html>agent</html>");
    }, [file("parts/p1.js"), file("index.html")]);
    // A drive with coarse times reports the rewrite with the stat it listed at the open.
    vi.mocked(fsp.stat).mockImplementation(async (...args: Parameters<typeof realStat>) =>
      String(args[0]) === file("parts/p1.js") ? listed : realStat(...args),
    );
    later();
    release();
    await landed(historyRoot);
    await expect(history.undo(entry.id, { who: agent })).rejects.toThrow(NOT_KEPT);
    expect(read("index.html")).toBe("<html>agent</html>");
    expect(read("parts/p1.js")).toBe("// BEFORE\n");
  });

  it("keeps an original read before the step, though filing it waited until after", async () => {
    const { file, read, historyRoot, opts } = project();
    const { release } = holdFiling(Buffer.from("// before\n"));
    const history = await open(opts);
    const entry = await step(history, () => {
      writeFileSync(file("parts/p1.js"), "// agent\n");
      writeFileSync(file("index.html"), "<html>agent</html>");
    }, [file("parts/p1.js"), file("index.html")]);
    release();
    await landed(historyRoot);
    expect(history.peek(START)!["parts/p1.js"]).toBe(sha256("// before\n"));
    await expect(history.undo(entry.id, { who: agent })).rejects.toThrow(NOT_KEPT);
    expect(read("index.html")).toBe("<html>agent</html>");
    // The original is known, so restoring the start brings every file back.
    await history.restore(START, agent);
    expect(read("parts/p1.js")).toBe("// before\n");
    expect(read("index.html")).toBe("<html>before</html>");
  });

  it("refuses its undo when the file's first reads kept changing until the step rewrote it", async () => {
    const { file, read, historyRoot, opts } = project();
    let saving = true;
    vi.mocked(fsp.open).mockImplementation(async (...args: Parameters<typeof realOpen>) => {
      const handle = await realOpen(...args);
      if (String(args[0]) !== file("parts/p1.js") || !saving) return handle;
      const readFile = handle.readFile.bind(handle);
      handle.readFile = (async (...options: Parameters<typeof readFile>) => {
        const bytes = await readFile(...options);
        if (saving) appendFileSync(file("parts/p1.js"), "// saved while read\n");
        return bytes;
      }) as typeof handle.readFile;
      return handle;
    });
    const history = await open(opts);
    const window = await history.beginWindow(agent, "Step");
    saving = false;
    writeFileSync(file("parts/p1.js"), "// agent\n");
    writeFileSync(file("index.html"), "<html>agent</html>");
    history.noteChange(file("parts/p1.js"));
    history.noteChange(file("index.html"));
    const entry = (await window.close())!;
    await landed(historyRoot);
    expect(history.peek(START)!["parts/p1.js"]).not.toBe(sha256("// agent\n"));
    await expect(history.restore(START, agent)).rejects.toThrow(NOT_KEPT);
    await expect(history.undo(entry.id, { who: agent })).rejects.toThrow(NOT_KEPT);
    expect(read("index.html")).toBe("<html>agent</html>");
  });

  it("keeps the refusal when the file changes while its copy is being filed", async () => {
    const { file, read, historyRoot, opts, later } = project();
    const release = stallRead(file("parts/p1.js"));
    const filing = holdFiling(Buffer.from("// before\n"));
    const history = await open(opts);
    const entry = await step(
      history,
      () => writeFileSync(file("index.html"), "<html>agent</html>"),
      [file("index.html")],
    );
    later();
    release();
    await filing.reached;
    writeFileSync(file("parts/p1.js"), "// while filed\n");
    filing.release();
    await landed(historyRoot);
    await expect(history.undo(entry.id, { who: agent })).rejects.toThrow(NOT_KEPT);
    expect(read("index.html")).toBe("<html>agent</html>");
    expect(read("parts/p1.js")).toBe("// while filed\n");
  });

  it("refuses the whole undo in a history read by an app that ignores the list", async () => {
    const { file, read, historyRoot, opts } = project();
    const release = stallRead(file("parts/p1.js"));
    let history = await open(opts);
    const entry = await step(history, () => {
      writeFileSync(file("parts/p1.js"), "// agent\n");
      writeFileSync(file("index.html"), "<html>agent</html>");
    }, [file("parts/p1.js"), file("index.html")]);
    release();
    await landed(historyRoot);
    await history.close();
    const logFile = join(homeIn(historyRoot), "log.jsonl");
    const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
    const older = lines.map((line) => {
      const record = JSON.parse(line);
      if (record.type === "entry") delete record.entry.wentAheadOf;
      return JSON.stringify(record);
    });
    writeFileSync(logFile, `${older.join("\n")}\n`);
    history = await open(opts);
    for (const mode of [undefined, "back-to-before"] as const) {
      const result = await history.undo(entry.id, { who: agent, mode }).catch((error) => error);
      expect(result).not.toMatchObject({ ok: true });
    }
    expect(read("index.html")).toBe("<html>agent</html>");
    expect(read("parts/p1.js")).toBe("// agent\n");
    // Accepted: "Keep later edits" there counts the pending file as changed later, so it stays as the agent left it.
    await history.undo(entry.id, { who: agent, mode: "keep-later-edits" });
    expect(read("index.html")).toBe("<html>before</html>");
    expect(read("parts/p1.js")).toBe("// agent\n");
  });

  it("names a file a step went ahead of at every earlier point, for an app that ignores the lists", async () => {
    const { dir, file, read, historyRoot, opts } = project();
    await stepThenDie(dir, historyRoot, file("parts/p1.js"), "earlier");
    const home = homeIn(historyRoot);
    const logFile = join(home, "log.jsonl");
    const lines = readFileSync(logFile, "utf8").split("\n").filter(Boolean);
    const older = lines.map((line) => {
      const record = JSON.parse(line);
      if (record.type === "entry") delete record.entry.wentAheadOf;
      return JSON.stringify(record);
    });
    writeFileSync(logFile, `${older.join("\n")}\n`);
    for (const list of ["went-ahead.json", "adopting.json"])
      rmSync(join(home, list), { force: true });
    const history = await open(opts);
    const first = history.list().find((item) => item.label === "First")!;
    const after = history.list().find((item) => item.label === "Step")!;
    const result = await history
      .undo(after.id, { who: agent, mode: "back-to-before" })
      .catch((error) => error);
    expect(result).not.toMatchObject({ ok: true });
    expect(first).toBeDefined();
    expect(read("parts/p1.js")).toBe("// agent\n");
  });

  it("keeps the refusal for a step recovered after the process died while it was open", async () => {
    const { dir, file, read, historyRoot, opts } = project();
    const id = await stepThenDie(dir, historyRoot, file("parts/p1.js"), "open");
    const closedWindow = {
      id,
      who: agent,
      label: "Step",
      startedAt: 1,
      lastWriteAt: Date.now(),
      idleMs: 60_000,
    };
    const history = await open({ ...opts, closedWindow });
    await landed(historyRoot);
    const recovered = history.list().find((item) => item.id === id)!;
    expect(recovered.files.map((change) => change.path)).toContain("index.html");
    await expect(history.undo(recovered.id, { who: agent })).rejects.toThrow(NOT_KEPT);
    expect(read("index.html")).toBe("<html>agent</html>");
    expect(read("parts/p1.js")).toBe("// agent\n");
  });

  it("refuses its whole undo when the step deleted the pending file", async () => {
    const { file, read, historyRoot, opts } = project();
    const release = stallRead(file("parts/p1.js"));
    const history = await open(opts);
    const entry = await step(history, () => {
      unlinkSync(file("parts/p1.js"));
      writeFileSync(file("index.html"), "<html>agent</html>");
    }, [file("parts/p1.js"), file("index.html")]);
    release();
    await landed(historyRoot);
    await expect(history.undo(entry.id, { who: agent })).rejects.toThrow(NOT_KEPT);
    await expect(history.restore(START, agent)).rejects.toThrow(NOT_KEPT);
    expect(read("index.html")).toBe("<html>agent</html>");
    expect(existsSync(file("parts/p1.js"))).toBe(false);
  });

  it("refuses the undo of each step that began while it was pending, not just the last", async () => {
    const { file, read, historyRoot, opts } = project();
    const release = stallRead(file("parts/p1.js"));
    const history = await open(opts);
    const first = await step(history, () => {
      writeFileSync(file("parts/p1.js"), "// agent\n");
      writeFileSync(file("index.html"), "<html>agent</html>");
    }, [file("parts/p1.js"), file("index.html")]);
    const look = await history.beginWindow(agent, "Look");
    const second = (await look.close())!;
    for (const id of [first.id, second.id])
      await expect(history.undo(id, { who: agent })).rejects.toThrow(STILL_SAVING);
    release();
    await landed(historyRoot);
    for (const id of [first.id, second.id])
      await expect(history.undo(id, { who: agent })).rejects.toThrow(NOT_KEPT);
    expect(read("index.html")).toBe("<html>agent</html>");
    expect(read("parts/p1.js")).toBe("// agent\n");
  });

  it("never gives a closed step a person's later edit of the pending file", async () => {
    const { file, read, historyRoot, opts } = project();
    const release = stallRead(file("parts/p1.js"));
    const history = await open(opts);
    const entry = await step(
      history,
      () => writeFileSync(file("index.html"), "<html>agent</html>"),
      [file("index.html")],
    );
    // Studio saves the pending file through its API, which reports the bytes it replaced.
    writeFileSync(file("parts/p1.js"), "// person\n");
    recordFileWriteReceipt(file("parts/p1.js"), {
      path: "parts/p1.js",
      version: fileContentVersion("// person\n"),
      writeToken: "studio",
      overwrote: "// before\n",
    });
    const claimed = history.claim(you, "Edit", ["parts/p1.js"]);
    release();
    expect(await claimed).toMatchObject({ id: expect.any(String) });
    await landed(historyRoot);
    await history.undo(entry.id, { who: agent }).catch(() => undefined);
    expect(read("parts/p1.js")).toBe("// person\n");
    expect(history.list().find((item) => item.id === entry.id)).toBeDefined();
    const log = readLog(join(homeIn(historyRoot), "log.jsonl"), () => {});
    const agentEntry = log!.entries.find((logged) => logged.id === entry.id)!;
    const recorded = agentEntry.files.filter((change) => change.before !== change.after);
    expect(recorded.map((change) => change.path)).toEqual(["index.html"]);
  });

  for (const readBefore of [false, true])
    it(`never takes the agent's bytes as the start from a later Studio save's receipt (read ${readBefore ? "before" : "after"} the step)`, async () => {
      const { file, read, historyRoot, opts } = project();
      const release = readBefore
        ? holdFiling(Buffer.from("// before\n")).release
        : stallRead(file("parts/p1.js"));
      const history = await open(opts);
      await step(history, () => writeFileSync(file("parts/p1.js"), "// agent\n"), [
        file("parts/p1.js"),
      ]);
      writeFileSync(file("parts/p1.js"), "// person\n");
      recordFileWriteReceipt(file("parts/p1.js"), {
        path: "parts/p1.js",
        version: fileContentVersion("// person\n"),
        writeToken: "studio",
        overwrote: "// agent\n",
      });
      const claimed = history.claim(you, "Edit", ["parts/p1.js"]);
      release();
      await claimed;
      await landed(historyRoot);
      const start = history.peek(START)!["parts/p1.js"];
      if (readBefore) expect(start).toBe(sha256("// before\n"));
      else {
        expect(start).not.toBe(sha256("// agent\n"));
        await expect(history.restore(START, agent)).rejects.toThrow(NOT_KEPT);
      }
      expect(read("parts/p1.js")).toBe("// person\n");
    });

  it("answers a Studio claim on the pending file within the deadline", async () => {
    const { file, opts } = project();
    stallRead(file("parts/p1.js"));
    const history = await open(opts);
    writeFileSync(file("parts/p1.js"), "// person\n");
    const answered = history.claim(you, "Edit", ["parts/p1.js"]);
    const waited = new Promise((late) => setTimeout(() => late("still waiting"), 3000));
    const claimed = await Promise.race([answered, waited]);
    expect(claimed).toMatchObject({ id: expect.any(String) });
    await expect(history.undo((claimed as { id: string }).id, { who: you })).rejects.toThrow(
      STILL_SAVING,
    );
    await expect(history.restore(START, agent)).rejects.toThrow(STILL_SAVING);
  });

  for (const [mode, written] of [
    ["close", "// agent\n"],
    ["open", "// agent\n"],
    ["delete", null],
  ] as const)
    it(`keeps the start out of reach for a file its step went ahead of before a restart (${mode})`, async () => {
      const { dir, file, read, historyRoot } = project();
      await stepThenDie(dir, historyRoot, file("parts/p1.js"), mode);
      const history = await open({ projectDir: dir, historyRoot });
      await landed(historyRoot);
      const start = history.peek(START)!["parts/p1.js"]!;
      expect(start).toBeDefined();
      expect(start).not.toBe(sha256("// agent\n"));
      expect(() => blobPath(historyRoot, start)).not.toThrow();
      await expect(history.restore(START, agent)).rejects.toThrow(NOT_KEPT);
      expect(written === null ? existsSync(file("parts/p1.js")) : read("parts/p1.js")).toBe(
        written ?? false,
      );
      const stepEntry = history.list().find((item) => item.label === "Step");
      if (stepEntry)
        await expect(history.undo(stepEntry.id, { who: agent })).rejects.toThrow(NOT_KEPT);
    });

  it("refuses the undo of every part a Studio claim splits from the step", async () => {
    const { file, read, historyRoot, opts } = project();
    const release = stallRead(file("parts/p1.js"));
    const history = await open(opts);
    const window = await history.beginWindow(agent, "Step");
    writeFileSync(file("parts/p1.js"), "// agent\n");
    writeFileSync(file("index.html"), "<html>agent</html>");
    history.noteChange(file("parts/p1.js"));
    history.noteChange(file("index.html"));
    writeFileSync(file("notes.txt"), "person");
    // A claim scans first, so the step's writes so far become their own part.
    await history.claim(you, "Note", ["notes.txt"]);
    writeFileSync(file("index.html"), "<html>agent 2</html>");
    history.noteChange(file("index.html"));
    await window.close();
    release();
    await landed(historyRoot);
    const parts = history.list().filter((item) => item.label === "Step");
    expect(parts).toHaveLength(2);
    for (const part of parts)
      await expect(history.undo(part.id, { who: agent })).rejects.toThrow(NOT_KEPT);
    expect(read("index.html")).toBe("<html>agent 2</html>");
  });
});
