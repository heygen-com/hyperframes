// @vitest-environment node
import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { START, type HistoryWho } from "./historyLog";
import { openProjectHistory } from "./projectHistory";

// Counts every file-system call while armed, and runs `swap` just before call number `at`.
const { race, counted } = vi.hoisted(() => {
  const race = { armed: false, calls: 0, at: 0, swap: null as null | (() => void) };
  const before = () => {
    if (!race.armed || !race.swap) return;
    race.calls += 1;
    if (race.calls !== race.at) return;
    const swap = race.swap;
    race.swap = null;
    swap();
  };
  type Fn = (...args: unknown[]) => unknown;
  const wrap = (fn: Fn): Fn => {
    const wrapped: Fn = (...args) => {
      before();
      return fn(...args);
    };
    // realpathSync.native and the like.
    for (const [key, inner] of Object.entries(fn))
      if (typeof inner === "function") Object.assign(wrapped, { [key]: wrap(inner as Fn) });
    return wrapped;
  };
  const counted = <T extends object>(module: T): T =>
    Object.fromEntries(
      Object.entries(module).map(([key, value]) => [
        key,
        typeof value === "function" && !/^[A-Z]/.test(key) ? wrap(value as Fn) : value,
      ]),
    ) as T;
  return { race, counted };
});
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  return { ...counted(original), default: counted(original) };
});
vi.mock("node:fs/promises", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs/promises")>();
  return { ...counted(original), default: counted(original) };
});

const real = await vi.importActual<typeof import("node:fs")>("node:fs");
const you: HistoryWho = { kind: "person", name: "You" };
const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  race.armed = false;
  race.swap = null;
  for (const step of cleanup.splice(0).reverse()) await step();
});

/** Every file under `dir` and its text; a link is listed as where it points. */
function contents(dir: string): Record<string, string> {
  const found: Record<string, string> = {};
  for (const entry of real.readdirSync(dir, { withFileTypes: true, recursive: true })) {
    const path = join(entry.parentPath, entry.name);
    found[path] = entry.isSymbolicLink()
      ? `link to ${real.readlinkSync(path)}`
      : entry.isFile()
        ? real.readFileSync(path, "utf-8")
        : "folder";
  }
  return found;
}

/** A project whose `sub/` folder a restore rewrites, creates in and deletes from, and a folder outside it. */
async function restorable() {
  const root = mkdtempSync(join(tmpdir(), "hf-history-contained-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const projectDir = join(root, "project");
  const sub = join(projectDir, "sub");
  const outside = join(root, "outside");
  mkdirSync(sub, { recursive: true });
  mkdirSync(outside);
  writeFileSync(join(projectDir, "index.html"), "i1");
  for (const name of ["a", "b", "c"]) writeFileSync(join(sub, `${name}.html`), `${name}1`);
  for (const name of ["a", "b", "d"])
    writeFileSync(join(outside, `${name}.html`), `outside ${name}`);
  const history = await openProjectHistory({ projectDir, historyRoot: join(root, "history") });
  cleanup.push(() => history.close());
  const window = await history.beginWindow(you, "Edit");
  writeFileSync(join(projectDir, "index.html"), "i2");
  writeFileSync(join(sub, "a.html"), "a2");
  writeFileSync(join(sub, "b.html"), "b2");
  rmSync(join(sub, "c.html"));
  writeFileSync(join(sub, "d.html"), "d2");
  await window.close();
  const swap = () => {
    real.renameSync(sub, join(projectDir, "sub-moved"));
    real.symlinkSync(outside, sub, "junction");
  };
  return { history, projectDir, outside, swap };
}

describe("a restore while a folder in the project is swapped for a link", () => {
  it("creates, replaces and deletes nothing outside the project, wherever in the restore the swap lands", async () => {
    let calls = Infinity;
    for (let at = 1; at <= calls; at += 1) {
      const { history, outside, swap } = await restorable();
      const before = contents(outside);
      Object.assign(race, { armed: true, calls: 0, at, swap });
      await history.restore(START, you).catch(() => undefined);
      race.armed = false;
      if (race.swap) calls = race.calls;
      expect({ at, files: contents(outside) }).toEqual({ at, files: before });
      for (const step of cleanup.splice(0).reverse()) await step();
    }
    expect(calls).toBeGreaterThan(20);
  }, 120_000);

  it("restores every file when nothing is swapped", async () => {
    const { history, projectDir } = await restorable();

    await history.restore(START, you);

    expect(readdirSync(join(projectDir, "sub")).sort()).toEqual(["a.html", "b.html", "c.html"]);
    expect(readFileSync(join(projectDir, "sub", "c.html"), "utf-8")).toBe("c1");
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe("i1");
  });
});

describe("a history log with a path that could leave the project", () => {
  it.each([
    "sub\\..\\..\\outside\\a.html",
    "/abs.html",
    "C:/abs.html",
    "sub/../../outside/a.html",
    "sub//a.html",
    "sub/./a.html",
    ".. /outside/a.html",
  ])("drops %s on open, and an undo of its entry writes nothing outside", async (forged) => {
    const { history, projectDir, outside } = await restorable();
    const [edit] = history.list();
    const hash = edit!.files.find((file) => file.path === "sub/a.html")!.after!;
    await history.close();
    const logFile = join(projectDir, "..", "history", history.projectId, "log.jsonl");
    const entry = {
      id: "forged",
      who: you,
      label: "Forged",
      startedAt: Date.now(),
      endedAt: Date.now(),
      files: [{ path: forged, before: hash, after: null }],
    };
    appendFileSync(logFile, `${JSON.stringify({ type: "entry", entry })}\n`);
    const before = contents(outside);

    const reopened = await openProjectHistory({
      projectDir,
      historyRoot: join(projectDir, "..", "history"),
    });
    cleanup.push(() => reopened.close());
    const listed = reopened.list().find((item) => item.id === "forged");
    expect(listed?.files ?? []).toEqual([]);
    await reopened.undo("forged", { who: you }).catch(() => undefined);

    expect(contents(outside)).toEqual(before);
    expect(readdirSync(projectDir).sort()).toEqual([".hyperframes", "index.html", "sub"]);
  });
});
