// fallow-ignore-file complexity
import { defineCommand } from "citty";
import { execSync } from "node:child_process";
import { platform } from "node:os";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { parseToolVersion, runEnvironmentChecks } from "../browser/preflight.js";
import { VERSION } from "../version.js";
import { getUpdateMeta, withMeta } from "../utils/updateCheck.js";
import {
  getSystemMeta,
  getShmSizeMb,
  getFreeDiskMb,
  getAvailableMemoryMb,
} from "../telemetry/system.js";

export const examples: Example[] = [
  ["Check system dependencies", "hyperframes doctor"],
  ["Output as JSON for CI / agents", "hyperframes doctor --json"],
];

interface Check {
  name: string;
  run: () => CheckResult | Promise<CheckResult>;
}

interface CheckResult {
  ok: boolean;
  detail: string;
  hint?: string;
}

export { parseToolVersion };

function checkDocker(): CheckResult {
  try {
    const version = execSync("docker --version", { encoding: "utf-8", timeout: 5000 }).trim();
    return { ok: true, detail: version };
  } catch {
    return {
      ok: false,
      detail: "Not found",
      hint: "https://docs.docker.com/get-docker/",
    };
  }
}

function checkDockerRunning(): CheckResult {
  try {
    execSync("docker info", { stdio: "pipe", timeout: 5000 });
    return { ok: true, detail: "Running" };
  } catch {
    return {
      ok: false,
      detail: "Not running",
      hint: "Start Docker Desktop or run: sudo systemctl start docker",
    };
  }
}

function checkVersion(): CheckResult {
  const meta = getUpdateMeta();
  if (meta.updateAvailable && meta.latestVersion) {
    return {
      ok: false,
      detail: `${VERSION} \u2192 ${meta.latestVersion} available`,
      hint: "Run: hyperframes upgrade",
    };
  }
  return { ok: true, detail: `${VERSION} (latest)` };
}

function checkNode(): CheckResult {
  return { ok: true, detail: `${process.version} (${process.platform} ${process.arch})` };
}

// ── Hardware & Environment Checks ──────────────────────────────────────────

function checkCPU(): CheckResult {
  const sys = getSystemMeta();
  const model = sys.cpu_model ?? "Unknown";
  const speedStr = sys.cpu_speed ? ` @ ${sys.cpu_speed}MHz` : "";
  return { ok: true, detail: `${sys.cpu_count} cores \u00B7 ${model}${speedStr}` };
}

function checkMemory(): CheckResult {
  const sys = getSystemMeta();
  const availMb = getAvailableMemoryMb();
  const totalGb = (sys.memory_total_mb / 1024).toFixed(1);
  const availGb = (availMb / 1024).toFixed(1);

  if (availMb < 2048) {
    return {
      ok: false,
      detail: `${totalGb} GB total \u00B7 ${availGb} GB available`,
      hint: "Low memory — renders may fail. Close other apps or increase RAM.",
    };
  }
  return { ok: true, detail: `${totalGb} GB total \u00B7 ${availGb} GB available` };
}

function checkShm(): CheckResult {
  const shmMb = getShmSizeMb();
  if (shmMb === null) {
    return { ok: true, detail: "N/A (non-Linux)" };
  }
  // Docker default is 64MB which causes Chrome crashes
  if (shmMb < 256) {
    return {
      ok: false,
      detail: `${shmMb} MB`,
      hint: "Chrome needs \u2265256 MB. Use: docker run --shm-size=512m",
    };
  }
  return { ok: true, detail: `${shmMb} MB` };
}

function checkDisk(): CheckResult {
  const freeMb = getFreeDiskMb(".");
  if (freeMb === null) {
    return { ok: true, detail: "Unable to check" };
  }
  const freeGb = (freeMb / 1024).toFixed(1);
  if (freeMb < 1024) {
    return {
      ok: false,
      detail: `${freeGb} GB free`,
      hint: "Low disk space — renders produce large temp files.",
    };
  }
  return { ok: true, detail: `${freeGb} GB free` };
}

function checkEnvironment(): CheckResult {
  const sys = getSystemMeta();
  const parts: string[] = [];
  if (sys.is_docker) parts.push("Docker");
  if (sys.is_wsl) parts.push("WSL");
  if (sys.is_ci) parts.push(`CI (${sys.ci_name ?? "detected"})`);
  if (!sys.is_tty) parts.push("non-TTY");

  if (parts.length === 0) {
    return { ok: true, detail: "Native terminal" };
  }
  return { ok: true, detail: parts.join(" \u00B7 ") };
}

export interface CheckOutcome {
  name: string;
  ok: boolean;
  detail: string;
  hint?: string;
}

/**
 * Replace the user's home directory path with the literal string `$HOME` so
 * JSON output pasted into bug reports or agent contexts doesn't leak usernames.
 * Safe no-op when HOME/USERPROFILE is unset.
 */
export function redactHome(s: string): string {
  const home = process.env["HOME"] || process.env["USERPROFILE"];
  if (!home) return s;
  return s.split(home).join("$HOME");
}

function redactOutcome(o: CheckOutcome): CheckOutcome {
  return {
    name: o.name,
    ok: o.ok,
    detail: redactHome(o.detail),
    ...(o.hint ? { hint: redactHome(o.hint) } : {}),
  };
}

/**
 * Build the JSON report payload from raw check outcomes. Pure function so the
 * output schema can be locked down with a snapshot test — any future refactor
 * that renames fields, drops `hint`, or reorders `checks[]` will fail that
 * test before it reaches users or agents parsing the output.
 *
 * @param options.redact - when true, replaces HOME paths in `detail`/`hint`
 *   with the literal `$HOME`. Default off so tests can assert on raw values;
 *   the CLI turns it on for `--json` output.
 */
export function buildDoctorReport(outcomes: CheckOutcome[], options: { redact?: boolean } = {}) {
  const checks = options.redact ? outcomes.map(redactOutcome) : outcomes;
  return withMeta({
    ok: checks.every((o) => o.ok),
    platform: process.platform,
    arch: process.arch,
    checks,
  });
}

export default defineCommand({
  meta: { name: "doctor", description: "Check system dependencies and environment" },
  args: {
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const environment = await runEnvironmentChecks({ includeBrowser: true });
    const checks: Check[] = [
      { name: "Version", run: checkVersion },
      { name: "Node.js", run: checkNode },
      { name: "CPU", run: checkCPU },
      { name: "Memory", run: checkMemory },
      { name: "Disk", run: checkDisk },
    ];

    // /dev/shm is only relevant on Linux (especially Docker)
    if (platform() === "linux") {
      checks.push({ name: "/dev/shm", run: checkShm });
    }

    checks.push({ name: "Environment", run: checkEnvironment });

    const outcomes: CheckOutcome[] = [];
    for (const check of checks) {
      const result = await check.run();
      outcomes.push({
        name: check.name,
        ok: result.ok,
        detail: result.detail,
        ...(result.hint ? { hint: result.hint } : {}),
      });
    }
    for (const result of environment.outcomes) {
      outcomes.push({
        name: result.name,
        ok: result.ok,
        detail: result.detail,
        ...(result.hint ? { hint: result.hint } : {}),
      });
    }
    for (const check of [
      { name: "Docker", run: checkDocker },
      { name: "Docker running", run: checkDockerRunning },
    ]) {
      const result = await check.run();
      outcomes.push({
        name: check.name,
        ok: result.ok,
        detail: result.detail,
        ...(result.hint ? { hint: result.hint } : {}),
      });
    }
    const allOk = outcomes.every((o) => o.ok);

    if (args.json) {
      // Exit code intentionally reflects command success, not environment
      // health — `checkVersion` returns ok:false when an npm update is
      // available, which would poison any CI pipeline doing
      // `hyperframes doctor --json || fail` the next time a new version is
      // published. Consumers who want a gate can do:
      //   hyperframes doctor --json | jq -e '.ok' > /dev/null || handle_failure
      console.log(JSON.stringify(buildDoctorReport(outcomes, { redact: true }), null, 2));
      return;
    }

    console.log();
    console.log(c.bold("hyperframes doctor"));
    console.log();

    for (const outcome of outcomes) {
      const icon = outcome.ok ? c.success("\u2713") : c.error("\u2717");
      const name = outcome.name.padEnd(16);
      console.log(
        `  ${icon} ${c.bold(name)} ${outcome.ok ? c.dim(outcome.detail) : c.error(outcome.detail)}`,
      );
      if (!outcome.ok && outcome.hint) {
        console.log(`  ${" ".repeat(19)}${c.accent(outcome.hint)}`);
      }
    }

    console.log();
    if (allOk) {
      console.log(`  ${c.success("\u25C7")}  ${c.success("All checks passed")}`);
    } else {
      console.log(`  ${c.warn("\u25C7")}  ${c.warn("Some checks failed \u2014 see hints above")}`);
    }
    console.log();
  },
});
