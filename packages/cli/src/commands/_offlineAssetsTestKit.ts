/**
 * Shared fixtures/helpers for the ledger + vendor command tests. Underscore
 * prefix (like _examples.ts) keeps it out of vitest's *.test.ts glob.
 */
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { vi } from "vitest";
import type { CommandDef } from "citty";

export const GSAP_URL = "https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js";

/** Invoke a citty command's run() with a context whose `args` we control. */
export function makeRunner(
  command: CommandDef,
): (args: Record<string, unknown>) => Promise<unknown> {
  return (args) =>
    (command.run as (ctx: { args: Record<string, unknown> }) => Promise<unknown>)({ args });
}

/** Last console.log payload parsed as JSON (the --json output). */
export function lastJsonOutput(): Record<string, unknown> {
  const calls = vi.mocked(console.log).mock.calls;
  const last = calls[calls.length - 1]?.[0];
  return JSON.parse(String(last));
}

/**
 * A minimal project: one jsDelivr CDN script (remote) + one local image.
 * Returns the temp project dir; callers rmSync it in afterEach.
 */
export function makeFixtureProject(prefix: string, extraBody = ""): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  mkdirSync(join(dir, "assets", "img"), { recursive: true });
  writeFileSync(join(dir, "assets", "img", "logo.png"), "png");
  writeFileSync(
    join(dir, "index.html"),
    `<!DOCTYPE html>
<html><head>
  <script src="${GSAP_URL}"></script>
</head><body>
  <img src="assets/img/logo.png">
${extraBody}
</body></html>`,
  );
  return dir;
}

/** Silence console and reset spies for one test. */
export function spyOnConsole(): void {
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
}
