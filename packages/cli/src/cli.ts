#!/usr/bin/env node

// ── Fast-path exits ─────────────────────────────────────────────────────────
// Check --version before importing anything heavy. This makes
// `hyperframes --version` near-instant (~10ms vs ~80ms).
import { VERSION } from "./version.js";

if (process.argv.includes("--version") || process.argv.includes("-V")) {
  console.log(VERSION);
  process.exit(0);
}

// ── Lazy imports ────────────────────────────────────────────────────────────
// Telemetry, update checks, and heavy modules are imported only when needed.
// For --help we skip telemetry entirely.

import { defineCommand, runMain } from "citty";
import type { ArgsDef, CommandDef } from "citty";

const isHelp = process.argv.includes("--help") || process.argv.includes("-h");

// ---------------------------------------------------------------------------
// CLI definition — all commands are lazy-loaded via dynamic import()
// ---------------------------------------------------------------------------

const subCommands = {
  init: () => import("./commands/init.js").then((m) => m.default),
  add: () => import("./commands/add.js").then((m) => m.default),
  catalog: () => import("./commands/catalog.js").then((m) => m.default),
  play: () => import("./commands/play.js").then((m) => m.default),
  preview: () => import("./commands/preview.js").then((m) => m.default),
  render: () => import("./commands/render.js").then((m) => m.default),
  lint: () => import("./commands/lint.js").then((m) => m.default),
  info: () => import("./commands/info.js").then((m) => m.default),
  compositions: () => import("./commands/compositions.js").then((m) => m.default),
  benchmark: () => import("./commands/benchmark.js").then((m) => m.default),
  browser: () => import("./commands/browser.js").then((m) => m.default),
  transcribe: () => import("./commands/transcribe.js").then((m) => m.default),
  tts: () => import("./commands/tts.js").then((m) => m.default),
  docs: () => import("./commands/docs.js").then((m) => m.default),
  doctor: () => import("./commands/doctor.js").then((m) => m.default),
  upgrade: () => import("./commands/upgrade.js").then((m) => m.default),
  skills: () => import("./commands/skills.js").then((m) => m.default),
  telemetry: () => import("./commands/telemetry.js").then((m) => m.default),
  validate: () => import("./commands/validate.js").then((m) => m.default),
};

const main = defineCommand({
  meta: {
    name: "hyperframes",
    version: VERSION,
    description: "Create and render HTML video compositions",
  },
  subCommands,
});

// ---------------------------------------------------------------------------
// Telemetry — lazy-loaded, captured references for exit handlers
// ---------------------------------------------------------------------------

const commandArg = process.argv[2];
const command = commandArg && commandArg in subCommands ? commandArg : "unknown";
const hasJsonFlag = process.argv.includes("--json");

// Captured references — populated when the lazy imports resolve.
// Used in exit handlers where dynamic import() is unsafe (beforeExit loops,
// exit handler is synchronous-only).
let _flush: (() => Promise<void>) | undefined;
let _flushSync: (() => void) | undefined;
let _printUpdateNotice: (() => void) | undefined;

if (!isHelp && command !== "telemetry" && command !== "unknown") {
  import("./telemetry/index.js").then((mod) => {
    _flush = mod.flush;
    _flushSync = mod.flushSync;
    mod.showTelemetryNotice();
    mod.trackCommand(command);
    if (mod.shouldTrack()) mod.incrementCommandCount();
  });
}

if (!isHelp && !hasJsonFlag && command !== "upgrade") {
  import("./utils/updateCheck.js").then((mod) => {
    _printUpdateNotice = mod.printUpdateNotice;
    mod.checkForUpdate().catch(() => {});
  });
}

// Async flush for normal exit (beforeExit fires when the event loop drains)
process.on("beforeExit", () => {
  _flush?.().catch(() => {});
  if (!hasJsonFlag) _printUpdateNotice?.();
});

// Sync flush for process.exit() calls (exit event only allows synchronous code)
process.on("exit", () => {
  _flushSync?.();
});

// Lazy-load help renderer — avoids allocating help data on non-help invocations
async function showUsage<T extends ArgsDef>(
  cmd: CommandDef<T>,
  parent?: CommandDef<T>,
): Promise<void> {
  const { showUsage: impl } = await import("./help.js");
  return impl(cmd as CommandDef, parent as CommandDef | undefined);
}

runMain(main, { showUsage });
