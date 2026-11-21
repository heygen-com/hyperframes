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
  return { ...actual, writeFile: vi.fn(actual.writeFile), open: vi.fn(actual.open) };
});

import * as fsp from "node:fs/promises";
import { fileContentVersion, recordFileWriteReceipt } from "../helpers/fileVersion.js";
import { readLog, START, type HistoryWho } from "./historyLog.js";
import { blobPath } from "./blobStore.js";
import { openProjectHistory, type ProjectHistory } from "./projectHistory.js";

const { writeFile: realWriteFile, open: realOpen } =
  await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
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
  // Read a minute later, so the open trusts the stats it listed.
  const opts = {
    projectDir: dir,
    historyRoot,
    firstCopyFileMs: 100,
    now: () => Date.now() + 60_000,
  };
  return { dir, historyRoot, file, read, opts };
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
function holdFiling(bytes: Buffer): () => void {
  const releases: (() => void)[] = [];
  vi.mocked(fsp.writeFile).mockImplementation(async (...args: Parameters<typeof realWriteFile>) => {
    const [to, written] = args;
    if (!releases.length && String(to).includes("incoming-") && bytes.equals(written as Buffer))
      await new Promise<void>((answer) => releases.push(answer));
    return realWriteFile(...args);
  });
  const release = () => releases.forEach((answer) => answer());
  closes.push(async () => release());
  return release;
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
    await expect(history.undo(entry.id, { who: agent })).rejects.toThrow(STILL_SAVING);
    await expect(history.restore(START, agent)).rejects.toThrow(STILL_SAVING);
    await expect(history.restore(entry.id, agent)).rejects.toThrow(STILL_SAVING);
    expect(read("index.html")).toBe("<html>agent</html>");
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

  it("undoes as usual once the copy lands showing the file unchanged", async () => {
    const { file, read, historyRoot, opts } = project();
    const release = stallRead(file("parts/p1.js"));
    const history = await open(opts);
    const entry = await step(
      history,
      () => writeFileSync(file("index.html"), "<html>agent</html>"),
      [file("index.html")],
    );
    release();
    await landed(historyRoot);
    expect(history.peek(START)!["parts/p1.js"]).toBe(sha256("// before\n"));
    expect(await history.undo(entry.id, { who: agent })).toMatchObject({ ok: true });
    expect(read("index.html")).toBe("<html>before</html>");
    expect(read("parts/p1.js")).toBe("// before\n");
  });

  it("keeps an original read before the step, though filing it waited until after", async () => {
    const { file, read, historyRoot, opts } = project();
    const release = holdFiling(Buffer.from("// before\n"));
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
    const second = await history.beginWindow(agent, "Look");
    await second.close();
    release();
    await landed(historyRoot);
    await expect(history.undo(first.id, { who: agent })).rejects.toThrow(NOT_KEPT);
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
    await claimed;
    await landed(historyRoot);
    await history.undo(entry.id, { who: agent }).catch(() => undefined);
    expect(read("parts/p1.js")).toBe("// person\n");
    expect(history.list().find((item) => item.id === entry.id)).toBeDefined();
    const log = readLog(join(homeIn(historyRoot), "log.jsonl"), () => {});
    const agentEntry = log!.entries.find((logged) => logged.id === entry.id)!;
    expect(agentEntry.files.map((change) => change.path)).toEqual(["index.html"]);
  });

  it("answers a Studio claim on the pending file within the deadline", async () => {
    const { file, opts } = project();
    stallRead(file("parts/p1.js"));
    const history = await open(opts);
    writeFileSync(file("parts/p1.js"), "// person\n");
    const answered = history.claim(you, "Edit", ["parts/p1.js"]).then(() => "answered");
    const waited = new Promise((late) => setTimeout(() => late("still waiting"), 3000));
    expect(await Promise.race([answered, waited])).toBe("answered");
    await expect(history.restore(START, agent)).rejects.toThrow(STILL_SAVING);
  });

  it("keeps the start out of reach for a file whose copy lands after a restart", async () => {
    const { dir, file, historyRoot } = project();
    const died = await new Promise<NodeJS.Signals | number | null>((done) => {
      const fixture = join(import.meta.dirname, "__fixtures__", "stepThenDie.ts");
      fork(fixture, [dir, historyRoot, file("parts/p1.js")], {
        execArgv: ["--import", "tsx"],
      }).once("exit", (code, signal) => done(signal ?? code));
    });
    expect(died).toBe("SIGKILL");
    const history = await open({ projectDir: dir, historyRoot });
    await landed(historyRoot);
    const start = history.peek(START)!["parts/p1.js"]!;
    expect(start).not.toBe(sha256("// agent\n"));
    expect(() => blobPath(historyRoot, start)).not.toThrow();
    await expect(history.restore(START, agent)).rejects.toThrow(NOT_KEPT);
    const [stepEntry] = history.list().filter((item) => item.label === "Step");
    await expect(history.undo(stepEntry!.id, { who: agent })).rejects.toThrow(NOT_KEPT);
  });
});
