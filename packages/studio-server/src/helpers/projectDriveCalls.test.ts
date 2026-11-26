import { afterEach, describe, expect, it, vi } from "vitest";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { stampProjectHfIdsAsync } from "./hfIdPersist.js";
import { projectHistoryId } from "../history/historyId.js";

const recorder = vi.hoisted(() => ({ dir: "", calls: [] as string[] }));

// Every blocking (`*Sync`) node:fs call is recorded while `recorder.dir` is set, when it names a path under it.
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  const wrapped: Record<string, unknown> = { ...actual };
  for (const [name, fn] of Object.entries(actual)) {
    if (!name.endsWith("Sync") || typeof fn !== "function") continue;
    wrapped[name] = (...args: unknown[]) => {
      const path = args[0];
      const { dir } = recorder;
      if (dir && typeof path === "string" && (path === dir || path.startsWith(dir + sep)))
        recorder.calls.push(`${name} ${path.slice(dir.length) || "."}`);
      return (fn as (...a: unknown[]) => unknown)(...args);
    };
  }
  return { ...wrapped, default: wrapped };
});

const PAGE = '<main data-composition-id="c"><div class="clip"><span>Hi</span></div></main>';
const dirs: string[] = [];

function folder(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  recorder.dir = "";
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

async function blockingCallsUnder(dir: string, run: () => Promise<unknown>): Promise<string[]> {
  recorder.calls = [];
  recorder.dir = dir;
  try {
    await run();
  } finally {
    recorder.dir = "";
  }
  return recorder.calls;
}

// fails without the fix: the async pass listed the project, checked its folders for links and its root with blocking
// calls, so a drive that stopped answering partway through still held the host's thread
describe("a project opened with the async stamp pass and first history id", () => {
  it("is listed, checked and written only through fs/promises", async () => {
    const dir = folder("hf-drive-calls-");
    mkdirSync(join(dir, "scenes"));
    for (const name of ["a.html", join("scenes", "b.html")]) writeFileSync(join(dir, name), PAGE);
    expect(await blockingCallsUnder(dir, () => stampProjectHfIdsAsync(dir))).toEqual([]);
    expect(readFileSync(join(dir, "scenes", "b.html"), "utf8")).toContain("data-hf-id");
    expect(existsSync(join(dir, ".hyperframes", "hf-ids-stamped.json"))).toBe(true);

    const fresh = folder("hf-drive-calls-history-");
    writeFileSync(join(fresh, "index.html"), PAGE);
    const historyRoot = folder("hf-drive-calls-root-");
    let id = "";
    const calls = await blockingCallsUnder(fresh, async () => {
      id = await projectHistoryId(fresh, historyRoot);
    });
    expect(calls).toEqual([]);
    expect(readFileSync(join(fresh, ".hyperframes", "history-id"), "utf8").trim()).toBe(id);
  });
});
