import { defineCommand } from "citty";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { finishCommand } from "../utils/commandResult.js";

const MEDIA_USE_ARGS = {
  type: { type: "string" },
  intent: { type: "string" },
  entity: { type: "string" },
  project: { type: "string", alias: "p" },
  adopt: { type: "boolean" },
  candidates: { type: "boolean" },
  doctor: { type: "boolean" },
  stats: { type: "boolean" },
  days: { type: "string" },
  "dry-run": { type: "boolean" },
  reuse: { type: "string" },
  from: { type: "string" },
  params: { type: "string" },
  for: { type: "string" },
  analyze: { type: "boolean" },
  "local-only": { type: "boolean" },
  provider: { type: "string" },
  "avatar-id": { type: "string" },
  "voice-id": { type: "string" },
  json: { type: "boolean" },
  help: { type: "boolean", alias: "h" },
} as const;

export function resolveMediaUseEnginePath(
  here: string,
  fileExists: (path: string) => boolean = existsSync,
): string {
  const candidates = [
    join(here, "..", "media-use", "resolve.mjs"),
    join(here, "skills", "media-use", "scripts", "resolve.mjs"),
  ];
  const engine = candidates.find((candidate) => fileExists(candidate));
  if (!engine) {
    throw new Error(
      "media-use engine is missing from this CLI build; reinstall the CLI or run from a source checkout",
    );
  }
  return engine;
}

export function mediaUsePassthroughArgs(argv: readonly string[]): string[] {
  const commandIndex = argv.indexOf("media-use");
  return argv.slice(commandIndex + 2);
}

function invokeEngine(verb: string): never {
  const here = dirname(fileURLToPath(import.meta.url));
  const passed = mediaUsePassthroughArgs(process.argv);
  const flag = verb === "resolve" ? [] : [`--${verb}`];
  const result = spawnSync(
    process.execPath,
    [resolveMediaUseEnginePath(here), ...flag, ...passed],
    {
      stdio: "inherit",
    },
  );
  if (result.error) throw result.error;
  finishCommand(result.status ?? 1);
}

function subcommand(name: string) {
  return defineCommand({
    meta: { name, description: `media-use ${name}` },
    args: MEDIA_USE_ARGS,
    run: () => invokeEngine(name),
  });
}

export default defineCommand({
  meta: { name: "media-use", description: "Resolve and operate on project media" },
  subCommands: {
    resolve: () => subcommand("resolve"),
    doctor: () => subcommand("doctor"),
    stats: () => subcommand("stats"),
    adopt: () => subcommand("adopt"),
    candidates: () => subcommand("candidates"),
    reuse: () => subcommand("reuse"),
    from: () => subcommand("from"),
    params: () => subcommand("params"),
    analyze: () => subcommand("analyze"),
  },
  run: () => console.log("Run `hyperframes media-use <resolve|doctor|stats|...> --help`"),
});
