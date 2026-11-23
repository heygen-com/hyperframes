import { afterEach, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { stampProjectHfIds, stampProjectHfIdsAsync } from "./hfIdPersist.js";

const PAGE = '<main data-composition-id="c"><div class="clip"><span>Hi</span></div></main>';
const dirs: string[] = [];

function project(pages: number): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-yield-"));
  dirs.push(dir);
  for (let i = 0; i < pages; i++) writeFileSync(join(dir, `p${i}.html`), PAGE);
  return dir;
}

const stamped = (dir: string) =>
  readdirSync(dir).filter(
    (f) => f.endsWith(".html") && /data-hf-id=/.test(readFileSync(join(dir, f), "utf-8")),
  ).length;

afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

describe("stampProjectHfIdsAsync", () => {
  it("lets the event loop run between files of a project", async () => {
    const dir = project(40);
    let doneWhenTimerFired = -1;
    const pass = stampProjectHfIdsAsync(dir);
    setImmediate(() => (doneWhenTimerFired = stamped(dir)));
    await pass;

    expect(doneWhenTimerFired).toBeGreaterThan(0);
    expect(doneWhenTimerFired).toBeLessThan(40);
    expect(stamped(dir)).toBe(40);
  });

  it("stamps exactly what the synchronous pass stamps", async () => {
    const [sync, async] = [project(5), project(5)];
    stampProjectHfIds(sync);
    await stampProjectHfIdsAsync(async);

    const read = (dir: string) =>
      readdirSync(dir)
        .sort()
        .map((f) => f);
    expect(read(async)).toEqual(read(sync));
    expect(readFileSync(join(async, "p3.html"), "utf-8")).toBe(
      readFileSync(join(sync, "p3.html"), "utf-8"),
    );
  });
});
