import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { CommandDef } from "citty";
import {
  ACCEPTS_EXTRA_POSITIONALS,
  JOINS_EXTRA_POSITIONALS,
} from "./utils/reject-extra-positionals.js";

const cliSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "cli.ts"), "utf8");
const helpSource = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "help.ts"), "utf8");

function commandLoaderBlock(): string {
  const match = cliSource.match(/const commandLoaders = \{([\s\S]*?)\n\};/);
  expect(match).toBeTruthy();
  return match![1]!;
}

// Vite cannot resolve a template-string import, so each listed top-level command is named here.
const LIST_COMMANDS: Record<string, () => Promise<{ default: unknown }>> = {
  catalog: () => import("./commands/catalog.js"),
  compare: () => import("./commands/compare.js"),
  figma: () => import("./commands/figma.js"),
  skills: () => import("./commands/skills.js"),
  timeline: () => import("./commands/timeline.js"),
  tts: () => import("./commands/tts.js"),
};

describe("CLI command registration", () => {
  it.each([...ACCEPTS_EXTRA_POSITIONALS, ...JOINS_EXTRA_POSITIONALS])(
    "names a real command in the extra-positional lists: %s",
    async (path) => {
      const [top, ...subs] = path.split(" ");
      expect(commandLoaderBlock()).toMatch(new RegExp(`\\b${top}:\\s*\\(\\)\\s*=>`));
      let cmd = (await LIST_COMMANDS[top!]!()).default as CommandDef;
      expect(cmd.meta).toMatchObject({ name: top });
      for (const sub of subs) {
        const entry = (cmd.subCommands as Record<string, unknown>)[sub!];
        cmd = (typeof entry === "function" ? await entry() : entry) as CommandDef;
        expect(cmd, `${path} resolves to a subcommand`).toBeTruthy();
      }
    },
  );

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

  it("shows the check command used by workflow capability preflight in root help", () => {
    const loaders = commandLoaderBlock();
    expect(loaders).toMatch(/\bcheck:\s*\(\)\s*=>\s*import\("\.\/commands\/check\.js"\)/);
    expect(helpSource).toContain(
      '["check", "Run lint, runtime validation, and layout inspection as one gate"]',
    );
  });

  it("registers media-treatment as the only treatment authoring command", () => {
    const loaders = commandLoaderBlock();
    expect(loaders).toContain('"media-treatment"');
    expect(loaders).not.toContain('"color-grading"');
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

  it("reports each command failure only at the executable boundary", () => {
    expect(cliSource).toContain("trackCommandFailures(load)");
    expect(cliSource).not.toContain("trackCommandFailures(load,");
    expect(cliSource.match(/reportCommandFailure\(command, error\)/g)).toHaveLength(1);
  });
});
