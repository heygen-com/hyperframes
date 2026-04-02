import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { execSync } from "node:child_process";

export const examples: Example[] = [["Check system dependencies", "hyperframes doctor"]];
import { freemem, platform } from "node:os";
import { c } from "../ui/colors.js";
import { findBrowser } from "../browser/manager.js";
import { findFFmpeg } from "../browser/ffmpeg.js";
import { VERSION } from "../version.js";
import { getUpdateMeta } from "../utils/updateCheck.js";
import { getSystemMeta, getShmSizeMb, getFreeDiskMb, bytesToMb } from "../telemetry/system.js";

interface Check {
  name: string;
  run: () => CheckResult | Promise<CheckResult>;
}

interface CheckResult {
  ok: boolean;
  detail: string;
  hint?: string;
}

function checkFFmpeg(): CheckResult {
  const path = findFFmpeg();
  if (path) {
    try {
      const version =
        execSync("ffmpeg -version", { encoding: "utf-8", timeout: 5000 }).split("\n")[0] ?? "";
      return { ok: true, detail: version.trim() };
    } catch {
      return { ok: true, detail: path };
    }
  }
  return {
    ok: false,
    detail: "Not found",
    hint: process.platform === "darwin" ? "brew install ffmpeg" : "sudo apt install ffmpeg",
  };
}

function checkFFprobe(): CheckResult {
  try {
    const result = execSync("which ffprobe", { encoding: "utf-8", timeout: 5000 }).trim();
    return { ok: true, detail: result };
  } catch {
    return {
      ok: false,
      detail: "Not found",
      hint: "Installed with ffmpeg",
    };
  }
}

async function checkChrome(): Promise<CheckResult> {
  const info = await findBrowser();
  if (info) {
    return { ok: true, detail: `${info.source}: ${info.executablePath}` };
  }
  return {
    ok: false,
    detail: "Not found",
    hint: "Run: npx hyperframes browser ensure",
  };
}

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
  const freeMb = bytesToMb(freemem()); // fresh reading, not cached
  const totalGb = (sys.memory_total_mb / 1024).toFixed(1);
  const freeGb = (freeMb / 1024).toFixed(1);

  if (freeMb < 2048) {
    return {
      ok: false,
      detail: `${totalGb} GB total \u00B7 ${freeGb} GB free`,
      hint: "Low memory — renders may fail. Close other apps or increase RAM.",
    };
  }
  return { ok: true, detail: `${totalGb} GB total \u00B7 ${freeGb} GB free` };
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

export default defineCommand({
  meta: { name: "doctor", description: "Check system dependencies and environment" },
  args: {},
  async run() {
    console.log();
    console.log(c.bold("hyperframes doctor"));
    console.log();

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

    checks.push(
      { name: "Environment", run: checkEnvironment },
      { name: "FFmpeg", run: checkFFmpeg },
      { name: "FFprobe", run: checkFFprobe },
      { name: "Chrome", run: checkChrome },
      { name: "Docker", run: checkDocker },
      { name: "Docker running", run: checkDockerRunning },
    );

    let allOk = true;

    for (const check of checks) {
      const result = await check.run();
      const icon = result.ok ? c.success("\u2713") : c.error("\u2717");
      const name = check.name.padEnd(16);
      console.log(
        `  ${icon} ${c.bold(name)} ${result.ok ? c.dim(result.detail) : c.error(result.detail)}`,
      );
      if (!result.ok && result.hint) {
        console.log(`  ${" ".repeat(19)}${c.accent(result.hint)}`);
      }
      if (!result.ok) allOk = false;
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
