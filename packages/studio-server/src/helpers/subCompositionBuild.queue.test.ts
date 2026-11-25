import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { runOffThread, SubCompositionDeadlineError } from "./subCompositionBuild.js";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** A project whose one page takes the worker about a second to parse; `word` keeps two projects' pages apart. */
function slowProject(word: string): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-queue-test-"));
  dirs.push(dir);
  const page = `${`<p>${word}</p>`.repeat(1_500_000)}<div data-composition-id="main"></div>`;
  writeFileSync(join(dir, "page.html"), page);
  return dir;
}

const scan = (projectDir: string, timeMs: number) =>
  runOffThread(
    { kind: "compositions", projectDir, files: ["page.html"], keptBackForPageInProgressMs: 0 },
    performance.now() + timeMs,
    projectDir,
  );

// fails without the fix: every job was posted to the worker at once, so one dropped while it waited still ran there,
// and the job behind it waited for that.
it("never hands the worker a scan that ran out of time while it waited, so the job behind it is not held up", async () => {
  const [first, late] = [slowProject("first"), slowProject("late")];

  const running = scan(first, 60_000);
  const expired = scan(late, 50);
  const behind = runOffThread(
    { kind: "parts", html: "<div></div>", ignore: [] },
    performance.now() + 60_000,
    "behind",
  ).then(() => performance.now());

  await expect(expired).rejects.toBeInstanceOf(SubCompositionDeadlineError);
  expect(await running).toEqual({ compositions: ["page.html"], unchecked: 0 });
  const firstEnded = performance.now();
  expect((await behind) - firstEnded).toBeLessThan(500);

  // The late page was never parsed: scanning it now is a first parse, not an answer the worker kept.
  const started = performance.now();
  await scan(late, 60_000);
  expect(performance.now() - started).toBeGreaterThan(400);
}, 60_000);

it("gives a scan only the time it has left when the worker takes it", async () => {
  const [first, second] = [slowProject("one"), slowProject("two")];

  const running = scan(first, 60_000);
  const queued = runOffThread(
    {
      kind: "compositions",
      projectDir: second,
      files: ["page.html"],
      keptBackForPageInProgressMs: 59_990,
    },
    performance.now() + 60_000,
    second,
  );

  await running;
  expect(await queued).toEqual({ compositions: [], unchecked: 1 });
}, 60_000);
