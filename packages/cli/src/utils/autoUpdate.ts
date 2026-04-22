/**
 * Silent, lazy auto-update — Claude-Code-style.
 *
 * Flow across two runs of `hyperframes`:
 *
 *   Run N     → check registry, see latest > current, spawn detached
 *               installer child, write `pendingUpdate` marker. Exit normally
 *               without waiting. User's command is unaffected.
 *   (between) → detached child runs the installer, writes the outcome to
 *               `completedUpdate`, clears `pendingUpdate`.
 *   Run N+1   → detect `completedUpdate`, print one short line, clear the
 *               marker. The user is now on the new version.
 *
 * Guardrails:
 *   - Never auto-update across major versions. The user opts in explicitly
 *     via `hyperframes upgrade`.
 *   - Skip on CI, non-TTY, dev mode, unknown installer, ephemeral exec (npx),
 *     or when `HYPERFRAMES_NO_AUTO_INSTALL` / `HYPERFRAMES_NO_UPDATE_CHECK`
 *     is set.
 *   - If a previous install is still in flight (less than 10 min old), don't
 *     re-launch.
 *   - Installer output is redirected to `~/.hyperframes/auto-update.log` for
 *     postmortem; the user's terminal stays clean.
 */

import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync, openSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { compareVersions } from "compare-versions";
import { readConfig, writeConfig } from "../telemetry/config.js";
import { isDevMode } from "./env.js";
import { detectInstaller } from "./installerDetection.js";

const CONFIG_DIR = join(homedir(), ".hyperframes");
const LOG_FILE = join(CONFIG_DIR, "auto-update.log");
/** An install that hasn't finished after this many ms is considered stuck. */
const PENDING_TIMEOUT_MS = 10 * 60 * 1000;

function isAutoInstallDisabled(): boolean {
  if (isDevMode()) return true;
  if (process.env["CI"] === "true" || process.env["CI"] === "1") return true;
  if (process.env["HYPERFRAMES_NO_UPDATE_CHECK"] === "1") return true;
  if (process.env["HYPERFRAMES_NO_AUTO_INSTALL"] === "1") return true;
  return false;
}

/** Parse a semver-ish string's major number; returns NaN for pre-releases etc. */
function majorOf(version: string): number {
  const match = /^(\d+)\./.exec(version);
  return match?.[1] ? Number.parseInt(match[1], 10) : Number.NaN;
}

/**
 * Quietly log a diagnostic line to `auto-update.log`. Never throws — a bad
 * file write must not take down the CLI.
 */
function log(line: string): void {
  try {
    mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
    appendFileSync(LOG_FILE, `${new Date().toISOString()} ${line}\n`, { mode: 0o600 });
  } catch {
    /* best-effort */
  }
}

/**
 * Spawn a detached child to run the install command. Stdout/stderr land in
 * the log file; the child is `unref()`d so the parent exits immediately
 * regardless of install duration.
 *
 * The child is responsible for writing `completedUpdate` to the config when
 * it finishes — we express that by running a small inline Node command after
 * the install that edits the config file in place. Keeps the whole thing to
 * one spawned process with no extra binary to distribute.
 */
function launchDetachedInstall(installCommand: string, version: string): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const configFile = join(CONFIG_DIR, "config.json");

  // The child script:
  //   1. Runs the install command, capturing exit code + stderr tail.
  //   2. Rewrites the config file with completedUpdate, clears pendingUpdate.
  // We shell out to `node -e` so we don't need to ship a separate file.
  const nodeScript = `
    const { exec } = require("node:child_process");
    const { readFileSync, renameSync, writeFileSync } = require("node:fs");
    const CFG = ${JSON.stringify(configFile)};
    const TMP = \`\${CFG}.tmp\`;
    const VERSION = ${JSON.stringify(version)};
    const CMD = ${JSON.stringify(installCommand)};
    exec(CMD, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, _stdout, stderr) => {
      let cfg = {};
      try { cfg = JSON.parse(readFileSync(CFG, "utf-8")); } catch (e) {}
      cfg.completedUpdate = {
        version: VERSION,
        ok: !err,
        finishedAt: new Date().toISOString(),
        ...(err ? { error: String(stderr || err.message || "install failed").slice(-400) } : {}),
      };
      delete cfg.pendingUpdate;
      try {
        writeFileSync(TMP, JSON.stringify(cfg, null, 2) + "\\n", { mode: 0o600 });
        renameSync(TMP, CFG);
      } catch (e) {}
    });
  `;

  const out = openSync(LOG_FILE, "a", 0o600);
  const child = spawn(process.execPath, ["-e", nodeScript], {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_NO_AUTO_INSTALL: "1" },
  });
  child.unref();
  log(`[launch] pid=${child.pid ?? "?"} cmd=${installCommand} version=${version}`);
}

/**
 * If a new version is available and policy allows, kick off a detached
 * installer. Returns whether an install was spawned (for tests).
 */
export function scheduleBackgroundInstall(latestVersion: string, currentVersion: string): boolean {
  if (isAutoInstallDisabled()) return false;
  if (!latestVersion || !currentVersion) return false;

  let cmp: number;
  try {
    cmp = compareVersions(latestVersion, currentVersion);
  } catch {
    return false;
  }
  if (cmp <= 0) return false;

  // Major-version jumps carry breaking-change risk. Don't silent-install;
  // the existing `printUpdateNotice` banner nudges the user to run
  // `hyperframes upgrade` explicitly.
  const latestMajor = majorOf(latestVersion);
  const currentMajor = majorOf(currentVersion);
  if (Number.isFinite(latestMajor) && Number.isFinite(currentMajor) && latestMajor > currentMajor) {
    log(`[skip] major-bump ${currentVersion} -> ${latestVersion}`);
    return false;
  }

  const installer = detectInstaller();
  if (installer.kind === "skip") {
    log(`[skip] ${installer.reason}`);
    return false;
  }
  const installCommand = installer.installCommand(latestVersion);
  if (!installCommand) return false;

  const config = readConfig();

  // Don't re-launch if a previous install is still fresh. Treat anything
  // over PENDING_TIMEOUT_MS as stuck and let the next run supersede it.
  if (config.pendingUpdate) {
    const startedAt = Date.parse(config.pendingUpdate.startedAt);
    const age = Number.isFinite(startedAt) ? Date.now() - startedAt : Number.POSITIVE_INFINITY;
    if (age < PENDING_TIMEOUT_MS && config.pendingUpdate.version === latestVersion) {
      return false;
    }
  }

  // Skip if the previous completed outcome is already for this version and
  // hasn't been surfaced yet — that run already did the work.
  if (config.completedUpdate && config.completedUpdate.version === latestVersion) {
    return false;
  }

  config.pendingUpdate = {
    version: latestVersion,
    command: installCommand,
    startedAt: new Date().toISOString(),
  };
  writeConfig(config);

  try {
    launchDetachedInstall(installCommand, latestVersion);
    return true;
  } catch (err) {
    log(`[error] spawn failed: ${String(err)}`);
    const rollback = readConfig();
    delete rollback.pendingUpdate;
    writeConfig(rollback);
    return false;
  }
}

/**
 * If a previous run finished auto-installing, surface the outcome once.
 * Successful installs are cleared immediately; failed installs stay marked so
 * the scheduler can avoid retrying the same version on every invocation.
 */
export function reportCompletedUpdate(): void {
  if (process.env["HYPERFRAMES_NO_UPDATE_CHECK"] === "1") return;

  const config = readConfig();
  const done = config.completedUpdate;
  if (!done) return;

  if (done.ok) {
    delete config.completedUpdate;
    writeConfig(config);
  } else if (!done.reported) {
    config.completedUpdate = { ...done, reported: true };
    writeConfig(config);
  } else {
    return;
  }

  if (!process.stderr.isTTY) return;

  if (done.ok) {
    process.stderr.write(`  hyperframes auto-updated to v${done.version}\n\n`);
  } else if (!done.reported) {
    // Failed installs are surfaced once too — the user should know why the
    // auto-update didn't take.
    process.stderr.write(
      `  hyperframes auto-update to v${done.version} failed. Run \`hyperframes upgrade\` to retry.\n\n`,
    );
  }
}
