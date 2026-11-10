// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { openProjectHistory } from "./projectHistory";

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

/** The longest stretch the event loop went without turning while `work` ran, and how long `work` took. */
async function longestHold(work: () => Promise<unknown>) {
  let last = performance.now();
  let longest = 0;
  let running = true;
  const turn = () => {
    const now = performance.now();
    longest = Math.max(longest, now - last);
    last = now;
    if (running) setImmediate(turn);
  };
  const began = performance.now();
  setImmediate(turn);
  await work();
  running = false;
  return { longest, took: performance.now() - began };
}

// fails without the fix: the sweep listed the project with readdirSync and lstatSync, holding the loop for the walk.
it("a sweep of a large project lets the host keep answering while it lists the files", async () => {
  const projectDir = tempDir("hf-history-walk-");
  for (let folder = 0; folder < 40; folder++) {
    mkdirSync(join(projectDir, `scenes-${folder}`));
    for (let file = 0; file < 100; file++)
      writeFileSync(join(projectDir, `scenes-${folder}`, `clip-${file}.html`), `<p>${file}</p>`);
  }
  const history = await openProjectHistory({ projectDir, historyRoot: tempDir("hf-history-root-") });
  cleanup.push(() => history.close());

  const { longest, took } = await longestHold(() => history.flush());

  expect(longest).toBeLessThan(took / 2);
});
