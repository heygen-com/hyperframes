// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import { ID_PATH } from "./historyId";
import { openProjectHistory } from "./projectHistory";

// Records each synchronous look at the watched project folder or its history id (either case), by call name.
const watch = vi.hoisted(() => ({ dir: "", calls: [] as string[] }));
vi.mock("node:fs", async (importOriginal) => {
  const original = await importOriginal<typeof import("node:fs")>();
  const spied = { ...original };
  for (const name of ["statSync", "lstatSync", "existsSync", "readFileSync"] as const) {
    const real = original[name] as (...args: unknown[]) => unknown;
    (spied as Record<string, unknown>)[name] = (path: unknown, ...rest: unknown[]) => {
      const at = typeof path === "string" ? resolve(path) : "";
      if (
        watch.dir &&
        (at === watch.dir || at.toLowerCase() === join(watch.dir, ID_PATH).toLowerCase())
      )
        watch.calls.push(name);
      return real(path, ...rest);
    };
  }
  return spied;
});

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  watch.dir = "";
  watch.calls = [];
  for (const step of cleanup.splice(0).reverse()) await step();
});

// fails without the fix: the engine checked the folder and read its history id and case answer with statSync and
// readFileSync on the calling thread, so an open on a drive that stopped answering held the host's main thread.
it("an open and its first operation look at the project folder and its history id off the main thread", async () => {
  const root = mkdtempSync(join(tmpdir(), "hf-open-offthread-"));
  cleanup.push(() => rmSync(root, { recursive: true, force: true }));
  const projectDir = join(root, "film");
  mkdirSync(projectDir);
  writeFileSync(join(projectDir, "index.html"), "<h1>A</h1>");
  const historyRoot = join(root, "history");
  const first = await openProjectHistory({ projectDir, historyRoot });
  await first.close();

  watch.dir = resolve(projectDir);
  const history = await openProjectHistory({ projectDir, historyRoot });
  await history.checkpoint();
  expect(await history.replacedNow()).toBe(false);
  watch.dir = "";
  await history.close();

  expect(watch.calls).toEqual([]);
});
