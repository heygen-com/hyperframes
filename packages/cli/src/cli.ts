#!/usr/bin/env node

// ── EPIPE suppression (must run before ANY stdout/stderr write) ────────────
// When the CLI runs inside a piped agent environment (Claude Code, Codex,
// Cursor, etc.), the reader may close the pipe before we finish writing.
// Node treats EPIPE on stdout/stderr as an uncaughtException, which crashes
// the process. This is a normal lifecycle event — suppress it.
//
// commandFailed must be declared here (before the handlers) so the EPIPE
// stream-error path can set it before process.exit(0). The telemetry exit
// handler reads this flag to determine success/failure — an EPIPE exit
// should NOT score as success:true in telemetry.
let commandFailed = false;

for (const stream of [process.stdout, process.stderr]) {
  stream.on("error", (err) => {
    if ((err as NodeJS.ErrnoException).code === "EPIPE") {
      commandFailed = true;
      process.exit(0);
    }
  });
}

// ── Worker entry path bootstrap (must run before any producer/engine load) ──
// The hf#677 worker_threads pools (`pngDecodeBlitWorkerPool`,
// `shaderTransitionWorkerPool`) live in the producer package and try to
// resolve their worker entry by probing for sibling `.js` files next to
// `import.meta.url`. When this CLI is bundled by tsup, the producer code is
// inlined into `cli.js`, but `import.meta.url` resolves to the producer's
// own dist path (NOT cli.js) on some module-graph layouts — so the sibling
// probe lands in a directory that does not contain the bundled workers.
// We emit the worker entries next to cli.js (see tsup.config.ts) and tell
// the pools where to find them via the published env-var overrides. The
// pools have an explicit `workerEntryPath` factory option as the canonical
// API, but setting the env vars here covers every call site without having
// to thread the path through the renderOrchestrator → captureHdrStage →
// captureHdrHybridLoop chain.
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

// fallow-ignore-next-line complexity
(() => {
  const here = dirname(fileURLToPath(import.meta.url));
  const shader = join(here, "shaderTransitionWorker.js");
  const png = join(here, "pngDecodeBlitWorker.js");
  if (!process.env.HF_SHADER_WORKER_ENTRY && existsSync(shader)) {
    process.env.HF_SHADER_WORKER_ENTRY = shader;
  }
  if (!process.env.HF_PNG_DECODE_BLIT_WORKER_ENTRY && existsSync(png)) {
    process.env.HF_PNG_DECODE_BLIT_WORKER_ENTRY = png;
  }
})();

// ── Fast-path exits ─────────────────────────────────────────────────────────
// Check --version before importing anything heavy. This makes
// `hyperframes --version` near-instant (~10ms vs ~80ms).
import { VERSION } from "./version.js";

const argv = process.argv.slice(2);
const commandArg = argv[0];
const rootVersionRequested =
  commandArg === "--version" ||
  commandArg === "-V" ||
  (commandArg === undefined && (argv.includes("--version") || argv.includes("-V")));

if (rootVersionRequested) {
  console.log(VERSION);
  process.exit(0);
}

// ── Load .env from CWD ─────────────────────────────────────────────────────
// Agents run from the project directory where .env holds API keys (Gemini,
// HeyGen, ElevenLabs). Load it automatically so they don't need `source .env`.
try {
  const { readFileSync } = await import("node:fs");
  const { resolve } = await import("node:path");
  const envPath = resolve(process.cwd(), ".env");
  const envContent = readFileSync(envPath, "utf-8");
  for (const rawLine of envContent.split("\n")) {
    let line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    // Tolerate `export FOO=bar` (common in dotfile-style .env files).
    if (line.startsWith("export ")) line = line.slice(7).trim();
    const eqIdx = line.indexOf("=");
    if (eqIdx < 1) continue;
    const key = line.slice(0, eqIdx).trim();
    let val = line.slice(eqIdx + 1).trim();
    if (val.startsWith('"') || val.startsWith("'")) {
      // Quoted value: take until the matching closing quote; leave the rest.
      // Anything after a closing quote (including `# comment`) is dropped.
      const quote = val.charAt(0);
      const end = val.indexOf(quote, 1);
      if (end > 0) val = val.slice(1, end);
      else val = val.slice(1); // unterminated quote — best-effort, strip opener
    } else {
      // Unquoted value: strip inline `# comment` (requires whitespace before #
      // to avoid eating `pass#word` style values).
      const commentMatch = val.match(/\s+#/);
      if (commentMatch?.index !== undefined) val = val.slice(0, commentMatch.index).trim();
    }
    if (key && !(key in process.env)) process.env[key] = val;
  }
} catch {
  /* .env not present — fine, env vars may be set another way */
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
  publish: () => import("./commands/publish.js").then((m) => m.default),
  render: () => import("./commands/render.js").then((m) => m.default),
  lint: () => import("./commands/lint.js").then((m) => m.default),
  inspect: () => import("./commands/inspect.js").then((m) => m.default),
  layout: () => import("./commands/layout.js").then((m) => m.default),
  info: () => import("./commands/info.js").then((m) => m.default),
  compositions: () => import("./commands/compositions.js").then((m) => m.default),
  benchmark: () => import("./commands/benchmark.js").then((m) => m.default),
  browser: () => import("./commands/browser.js").then((m) => m.default),
  "remove-background": () => import("./commands/remove-background.js").then((m) => m.default),
  transcribe: () => import("./commands/transcribe.js").then((m) => m.default),
  tts: () => import("./commands/tts.js").then((m) => m.default),
  docs: () => import("./commands/docs.js").then((m) => m.default),
  doctor: () => import("./commands/doctor.js").then((m) => m.default),
  upgrade: () => import("./commands/upgrade.js").then((m) => m.default),
  skills: () => import("./commands/skills.js").then((m) => m.default),
  feedback: () => import("./commands/feedback.js").then((m) => m.default),
  telemetry: () => import("./commands/telemetry.js").then((m) => m.default),
  validate: () => import("./commands/validate.js").then((m) => m.default),
  snapshot: () => import("./commands/snapshot.js").then((m) => m.default),
  capture: () => import("./commands/capture.js").then((m) => m.default),
  lambda: () => import("./commands/lambda.js").then((m) => m.default),
  cloudrun: () => import("./commands/cloudrun.js").then((m) => m.default),
  cloud: () => import("./commands/cloud.js").then((m) => m.default),
  auth: () => import("./commands/auth.js").then((m) => m.default),
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

const cliCommandArg = process.argv[2];
const command = cliCommandArg && cliCommandArg in subCommands ? cliCommandArg : "unknown";
const hasJsonFlag = process.argv.includes("--json");

// Captured references — populated when the lazy imports resolve.
// Used in exit handlers where dynamic import() is unsafe (beforeExit loops,
// exit handler is synchronous-only).
let _flush: (() => Promise<void>) | undefined;
let _flushSync: (() => void) | undefined;
let _trackCliError:
  | ((props: {
      error_name: string;
      error_message: string;
      stack_trace?: string;
      command?: string;
      kind: "uncaught_exception" | "unhandled_rejection" | "command_error";
    }) => void)
  | undefined;
let _trackCommandResult:
  | ((props: { command: string; success: boolean; exitCode: number; durationMs: number }) => void)
  | undefined;
let _printUpdateNotice: (() => void) | undefined;

if (!isHelp && command !== "telemetry" && command !== "unknown") {
  import("./telemetry/index.js").then((mod) => {
    _flush = mod.flush;
    _flushSync = mod.flushSync;
    _trackCliError = mod.trackCliError;
    _trackCommandResult = mod.trackCommandResult;
    mod.showTelemetryNotice();
    mod.trackCommand(command);
    if (mod.shouldTrack()) mod.incrementCommandCount();
  });
}

if (!isHelp && !hasJsonFlag && command !== "upgrade") {
  // Report any completed auto-install from the previous run first, before
  // kicking off the next check — so the user sees "updated to vX" once and
  // we don't over-print.
  import("./utils/autoUpdate.js").then((mod) => mod.reportCompletedUpdate()).catch(() => {});

  import("./utils/updateCheck.js").then(async (mod) => {
    _printUpdateNotice = mod.printUpdateNotice;
    const result = await mod.checkForUpdate().catch(() => null);
    if (result?.updateAvailable) {
      const auto = await import("./utils/autoUpdate.js").catch(() => null);
      auto?.scheduleBackgroundInstall(result.latest, result.current);
    }
  });
}

const commandStart = Date.now();

// Async flush for normal exit. `beforeExit` re-fires every time the
// event loop drains, and the async `_flush()` itself schedules new
// work — so a plain `on` listener would print the update notice (and
// re-flush) once per drain (the user-reported double-print). `once`
// detaches after first invocation, which is what we want for both.
process.once("beforeExit", () => {
  _flush?.().catch(() => {});
  if (!hasJsonFlag) _printUpdateNotice?.();
});

// Sync-only: exit handlers cannot await promises or drain microtasks.
// _trackCommandResult / _trackCliError are captured references resolved
// at init time, so they're callable synchronously here.
process.on("exit", (code) => {
  _trackCommandResult?.({
    command,
    success: code === 0 && !commandFailed,
    exitCode: code,
    durationMs: Date.now() - commandStart,
  });
  _flushSync?.();
});

process.on("uncaughtException", (error) => {
  if ((error as NodeJS.ErrnoException).code === "EPIPE") {
    commandFailed = true;
    process.exit(0);
  }
  commandFailed = true;
  _trackCliError?.({
    error_name: error.name,
    error_message: error.message,
    stack_trace: error.stack,
    command,
    kind: "uncaught_exception",
  });
  _flushSync?.();
  process.exit(1);
});

// unhandledRejection does not call process.exit() — Node may continue
// running if the rejection is non-fatal (e.g. a fire-and-forget promise).
// The exit handler above will still fire with the real exit code.
process.on("unhandledRejection", (reason) => {
  commandFailed = true;
  const error = reason instanceof Error ? reason : new Error(String(reason));
  _trackCliError?.({
    error_name: error.name,
    error_message: error.message,
    stack_trace: error.stack,
    command,
    kind: "unhandled_rejection",
  });
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
