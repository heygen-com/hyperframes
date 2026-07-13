import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const cliSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cli.ts"), "utf8");
const helpSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "help.ts"), "utf8");

function commandLoaderBlock(): string {
  const match = cliSource.match(/const commandLoaders = \{([\s\S]*?)\n\};/);
  expect(match).toBeTruthy();
  return match![1]!;
}

describe("CLI command registration", () => {
  it("registers keyframes as the only keyframe inspection command", () => {
    const loaders = commandLoaderBlock();

    expect(loaders).toMatch(/\bkeyframes:\s*\(\)\s*=>\s*import\("\.\/commands\/keyframes\.js"\)/);
    expect(loaders).not.toMatch(/\bmotion:\s*\(\)\s*=>/);
    expect(loaders).not.toContain("./commands/motion.js");
  });

  it("shows keyframes in root help", () => {
    expect(helpSource).toContain(
      '["keyframes", "Inspect keyframes and render onion-shot diagnostics"]',
    );
  });

  // A command actively reconciling skills (`skills check`/`skills update`)
  // must not also nudge the user to go reconcile skills — that nudge is
  // either redundant (it just ran) or misleading (a stale cached count from
  // the 24h background check, contradicting whatever it just reported).
  it("excludes 'skills' from the background skills-nudge gate, alongside 'upgrade' and 'events'", () => {
    const match = cliSource.match(/if \(([\s\S]*?)\) \{\s*\/\/ Report any completed auto-install/);
    expect(match, "expected to find the background nudge gate's if-condition").toBeTruthy();
    const condition = match![1]!;
    expect(condition).toContain('command !== "upgrade"');
    expect(condition).toContain('command !== "events"');
    expect(condition).toContain('command !== "skills"');
  });
});
