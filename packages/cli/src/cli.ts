#!/usr/bin/env node

import { defineCommand, runMain } from "citty";
import { VERSION } from "./version.js";
import {
  showTelemetryNotice,
  flush,
  flushSync,
  shouldTrack,
  trackCommand,
  incrementCommandCount,
} from "./telemetry/index.js";
import { checkForUpdate, printUpdateNotice } from "./utils/updateCheck.js";

// ---------------------------------------------------------------------------
// CLI definition
// ---------------------------------------------------------------------------

const subCommands = {
  init: () => import("./commands/init.js").then((m) => m.default),
  dev: () => import("./commands/dev.js").then((m) => m.default),
  render: () => import("./commands/render.js").then((m) => m.default),
  lint: () => import("./commands/lint.js").then((m) => m.default),
  info: () => import("./commands/info.js").then((m) => m.default),
  compositions: () => import("./commands/compositions.js").then((m) => m.default),
  benchmark: () => import("./commands/benchmark.js").then((m) => m.default),
  browser: () => import("./commands/browser.js").then((m) => m.default),
  skills: () => import("./commands/install-skills.js").then((m) => m.default),
  transcribe: () => import("./commands/transcribe.js").then((m) => m.default),
  docs: () => import("./commands/docs.js").then((m) => m.default),
  doctor: () => import("./commands/doctor.js").then((m) => m.default),
  upgrade: () => import("./commands/upgrade.js").then((m) => m.default),
  telemetry: () => import("./commands/telemetry.js").then((m) => m.default),
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
// Telemetry — detect command from argv, track it, flush on exit
// ---------------------------------------------------------------------------

const commandArg = process.argv[2];
const isHelpOrVersion =
  process.argv.includes("--help") ||
  process.argv.includes("--version") ||
  process.argv.includes("-h");
const command = commandArg && commandArg in subCommands ? commandArg : "unknown";

if (command !== "telemetry" && command !== "unknown" && !isHelpOrVersion) {
  showTelemetryNotice();
  trackCommand(command);
  if (shouldTrack()) {
    incrementCommandCount();
  }
}

// Fire background update check (non-blocking, populates cache for printUpdateNotice)
const hasJsonFlag = process.argv.includes("--json");
if (!isHelpOrVersion && !hasJsonFlag && command !== "upgrade") {
  checkForUpdate().catch(() => {});
}

// Async flush for normal exit (beforeExit fires when the event loop drains)
process.on("beforeExit", () => {
  flush().catch(() => {});
  // Print update notice after command output (stderr, skipped in CI/non-TTY)
  if (!hasJsonFlag) {
    printUpdateNotice();
  }
});

// Sync flush for process.exit() calls (exit event only allows synchronous code)
process.on("exit", () => {
  flushSync();
});

runMain(main);
