import { afterEach, describe, expect, it } from "vitest";
import fs, { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { stampProjectHfIdsAsync } from "./hfIdPersist.js";
import { projectHistoryId } from "../history/historyId.js";

const PAGE = '<main data-composition-id="c"><div class="clip"><span>Hi</span></div></main>';
/** How long a blocking write to the stand-in drive holds its thread; long enough that a late timer can't be noise. */
const HOLD_MS = 1500;
const dirs: string[] = [];

function folder(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

type Patched = [object, string, unknown];

/**
 * The drive under `dir` answers reads but never a write, as a network or cloud drive can: a blocking write call holds
 * the calling thread, an fs/promises one never settles. Patched on node:fs itself, so every module's import sees it.
 */
function writesNeverAnswer(dir: string): () => void {
  const inside = (path: unknown) =>
    typeof path === "string" && (path === dir || path.startsWith(dir + sep));
  const { O_WRONLY, O_RDWR, O_CREAT, W_OK } = fs.constants;
  const opensToWrite = (flags: unknown) =>
    typeof flags === "number"
      ? (flags & (O_WRONLY | O_RDWR | O_CREAT)) !== 0
      : /[wa+]/.test(String(flags ?? ""));
  const asksWrite = (mode: unknown) => ((Number(mode) || 0) & W_OK) !== 0;
  const hold = () => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, HOLD_MS);
  const saved: Patched[] = [];
  const patch = (
    target: object,
    name: string,
    writes: (args: unknown[]) => boolean,
    never: boolean,
  ) => {
    const real = (target as Record<string, (...args: unknown[]) => unknown>)[name]!;
    saved.push([target, name, real]);
    (target as Record<string, unknown>)[name] = function (this: unknown, ...args: unknown[]) {
      if (!inside(args[0]) || !writes(args)) return real.apply(this, args);
      if (never) return new Promise(() => {});
      hold();
      return real.apply(this, args);
    };
  };
  const always = () => true;
  for (const [target, never] of [
    [fs, false],
    [fs.promises, true],
  ] as const) {
    const suffix = never ? "" : "Sync";
    patch(target, `access${suffix}`, (args) => asksWrite(args[1]), never);
    patch(target, `open${suffix}`, (args) => opensToWrite(args[1]), never);
    for (const name of ["writeFile", "rename", "link", "mkdir", "chmod"])
      patch(target, `${name}${suffix}`, always, never);
  }
  syncBuiltinESMExports();
  return () => {
    for (const [target, name, real] of saved.reverse())
      (target as Record<string, unknown>)[name] = real;
    syncBuiltinESMExports();
  };
}

/** How late a 20 ms timer set before `start` fires, and whether `start`'s promise settled by then. */
async function lateness(
  start: () => Promise<unknown>,
): Promise<{ lateMs: number; settled: boolean }> {
  const asked = performance.now();
  const fired = new Promise<number>((resolve) =>
    setTimeout(() => resolve(performance.now() - asked - 20), 20),
  );
  let settled = false;
  void start().then(
    () => (settled = true),
    () => (settled = true),
  );
  return { lateMs: await fired, settled };
}

// fails without the fix: the stamp pass and the first history id wrote the project with blocking calls on the
// host's own thread, so a drive that answered the reads but not the write froze the host (Desktop's main) on open.
describe("a project drive that answers reads but never a write", () => {
  it("holds no thread of the host's while the stamp pass waits on it", async () => {
    const dir = folder("hf-drive-stamp-");
    for (const name of ["a", "b"]) writeFileSync(join(dir, `${name}.html`), PAGE);
    const restore = writesNeverAnswer(dir);
    try {
      const { lateMs, settled } = await lateness(() => stampProjectHfIdsAsync(dir));
      expect(lateMs).toBeLessThan(HOLD_MS / 3);
      expect(settled).toBe(false);
    } finally {
      restore();
    }
  });

  it("holds no thread of the host's while a project's first history id waits on it", async () => {
    const dir = folder("hf-drive-history-");
    const historyRoot = folder("hf-drive-history-root-");
    writeFileSync(join(dir, "index.html"), PAGE);
    const restore = writesNeverAnswer(dir);
    try {
      const { lateMs, settled } = await lateness(() => projectHistoryId(dir, historyRoot));
      expect(lateMs).toBeLessThan(HOLD_MS / 3);
      expect(settled).toBe(false);
    } finally {
      restore();
    }
  });
});
