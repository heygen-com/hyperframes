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
 *   - Skip on CI, dev mode, unknown installer, ephemeral exec (npx),
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
import { withFileLock } from "../media-use/lib/config-lock.mjs";
import { readConfig, writeConfig } from "../telemetry/config.js";
import { updateCheckDisabled } from "./updateCheck.js";
import { RUNNING_DIR, RUNNING_STALE_MS } from "./runningCli.js";
import {
  detectInstaller,
  installInvocation,
  type InstallInvocation,
} from "./installerDetection.js";

const CONFIG_DIR = join(homedir(), ".hyperframes");
const LOG_FILE = join(CONFIG_DIR, "auto-update.log");
/** An install that hasn't finished after this many ms is considered stuck. */
const PENDING_TIMEOUT_MS = 10 * 60 * 1000;
/** A waiting installer gives up after this long; the next run schedules it again. */
const INSTALL_MAX_WAIT_MS = 60 * 60 * 1000;
const INSTALL_POLL_MS = 2_000;

function isAutoInstallDisabled(): boolean {
  return updateCheckDisabled() || process.env["HYPERFRAMES_NO_AUTO_INSTALL"] === "1";
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

export interface InstallerScriptOptions {
  configFile: string;
  version: string;
  bin: string;
  args: readonly string[];
  runningDir: string;
  pollMs: number;
  maxWaitMs: number;
  /** A pid or install-lock file not touched for this long belongs to a dead process. */
  staleMs: number;
}

/**
 * Source of the detached installer, run through `node -e` so no separate file ships. It:
 *   1. Exits if another waiting installer is alive (install lock), then waits until no pid in
 *      `runningDir` is alive and heartbeating, so no running CLI has package files replaced under it.
 *   2. Runs the install via execFile (bin + argv, NO shell); values are embedded as JSON literals.
 *   3. Under the shared settings lock, records completedUpdate and clears pendingUpdate.
 */
export function installerScript(o: InstallerScriptOptions): string {
  return `
    const { execFile } = require("node:child_process");
    const fs = require("node:fs");
    const { join } = require("node:path");
    const { readFileSync, renameSync, writeFileSync } = fs;
    const CFG = ${JSON.stringify(o.configFile)};
    const TMP = \`\${CFG}.tmp\`;
    const INSTALL_LOCK = \`\${CFG}.install-lock\`;
    const RUNNING = ${JSON.stringify(o.runningDir)};
    const VERSION = ${JSON.stringify(o.version)};
    const BIN = ${JSON.stringify(o.bin)};
    const ARGS = ${JSON.stringify(o.args)};
    const withFileLock = ${withFileLock.toString()};
    const withLock = (task) => { try { withFileLock(\`\${CFG}.lock\`, fs, task); } catch (e) {} };
    const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
    // Stale = no heartbeat for staleMs on this process's own clock, which stops while the machine sleeps.
    const seen = new Map();
    const mono = () => Number(process.hrtime.bigint() / 1000000n);
    const observe = (file) => {
      let mtime;
      try { mtime = fs.statSync(file).mtimeMs; } catch (e) { return "stale"; }
      const prev = seen.get(file);
      if (prev && prev.mtime === mtime) return mono() - prev.at >= ${o.staleMs} ? "stale" : "quiet";
      seen.set(file, { mtime, at: mono() });
      return prev ? "beating" : "quiet";
    };
    const touch = (file) => { try { const now = new Date(); fs.utimesSync(file, now, now); } catch (e) {} };
    const running = () => {
      let names = [];
      try { names = fs.readdirSync(RUNNING); } catch (e) {}
      return names.filter((name) => {
        const pid = Number(name);
        const file = join(RUNNING, name);
        if (Number.isInteger(pid) && pid > 0 && alive(pid) && observe(file) !== "stale") return true;
        try { fs.unlinkSync(file); } catch (e) {}
        return false;
      });
    };
    let lockBeat;
    const ownsLock = () => { try { return Number(readFileSync(INSTALL_LOCK, "utf-8")) === process.pid; } catch (e) { return false; } };
    // Under the settings lock, so two installers launched together cannot both take it over.
    const tryLock = () => {
      let result = "stuck";
      withLock(() => {
        let owner = NaN;
        try { owner = Number(readFileSync(INSTALL_LOCK, "utf-8")); } catch (e) {}
        const state = Number.isInteger(owner) && owner > 0 && alive(owner) ? observe(INSTALL_LOCK) : "stale";
        if (state !== "stale") { result = state; return; }
        writeFileSync(INSTALL_LOCK, String(process.pid));
        result = "taken";
      });
      return result;
    };
    const releaseInstallLock = () => {
      clearInterval(lockBeat);
      if (ownsLock()) { try { fs.unlinkSync(INSTALL_LOCK); } catch (e) {} }
    };
    const install = () => execFile(BIN, ARGS, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 }, (err, _stdout, stderr) => {
      withLock(() => {
        let cfg = {};
        try { cfg = JSON.parse(readFileSync(CFG, "utf-8")); } catch (e) { if (e.code !== "ENOENT") return; }
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
      releaseInstallLock();
    });
    const started = Date.now();
    let lastPoll = Date.now();
    const waitThenInstall = () => {
      if (!ownsLock()) return releaseInstallLock();
      // A long gap between polls means the machine slept: watch every file afresh.
      if (Date.now() - lastPoll > ${o.pollMs} * 5) seen.clear();
      lastPoll = Date.now();
      if (running().length === 0) return install();
      if (Date.now() - started > ${o.maxWaitMs}) {
        console.log(\`[wait] gave up on \${VERSION}: a hyperframes process is still running\`);
        return releaseInstallLock();
      }
      setTimeout(waitThenInstall, ${o.pollMs});
    };
    const acquire = () => {
      const result = tryLock();
      if (result === "taken") {
        lockBeat = setInterval(() => ownsLock() && touch(INSTALL_LOCK), ${o.pollMs});
        return waitThenInstall();
      }
      if (result === "quiet") return setTimeout(acquire, ${o.pollMs});
      console.log(result === "beating"
        ? \`[wait] another installer is already waiting; leaving \${VERSION} to it\`
        : \`[wait] settings lock busy; \${VERSION} left for the next run\`);
    };
    acquire();
  `;
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
function launchDetachedInstall(
  invocation: InstallInvocation,
  displayCommand: string,
  version: string,
): void {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  const configFile = join(CONFIG_DIR, "config.json");

  const nodeScript = installerScript({
    configFile,
    version,
    bin: invocation.bin,
    args: invocation.args,
    runningDir: RUNNING_DIR,
    pollMs: INSTALL_POLL_MS,
    maxWaitMs: INSTALL_MAX_WAIT_MS,
    staleMs: RUNNING_STALE_MS,
  });

  const out = openSync(LOG_FILE, "a", 0o600);
  const child = spawn(process.execPath, ["-e", nodeScript], {
    detached: true,
    stdio: ["ignore", out, out],
    windowsHide: true,
    env: { ...process.env, HYPERFRAMES_NO_UPDATE_CHECK: "1", HYPERFRAMES_NO_AUTO_INSTALL: "1" },
  });
  child.unref();
  log(`[launch] pid=${child.pid ?? "?"} cmd=${displayCommand} version=${version}`);
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
  const invocation = installInvocation(installer.kind, latestVersion);
  if (!installCommand || !invocation) return false;

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
  if (!writeConfig(config)) return false;

  try {
    launchDetachedInstall(invocation, installCommand, latestVersion);
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
