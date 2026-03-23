import { defineCommand } from "citty";
import { execSync } from "node:child_process";
import { c } from "../ui/colors.js";
import { findBrowser } from "../browser/manager.js";
import { findFFmpeg } from "../browser/ffmpeg.js";

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
      const version = execSync("ffmpeg -version", { encoding: "utf-8", timeout: 5000 })
        .split("\n")[0] ?? "";
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

function checkNode(): CheckResult {
  return { ok: true, detail: `${process.version} (${process.platform} ${process.arch})` };
}


export default defineCommand({
  meta: { name: "doctor", description: "Check system dependencies and environment" },
  args: {},
  async run() {
    console.log();
    console.log(c.bold("hyperframes doctor"));
    console.log();

    const checks: Check[] = [
      { name: "Node.js", run: checkNode },
      { name: "FFmpeg", run: checkFFmpeg },
      { name: "FFprobe", run: checkFFprobe },
      { name: "Chrome", run: checkChrome },
      { name: "Docker", run: checkDocker },
      { name: "Docker running", run: checkDockerRunning },
    ];

    let allOk = true;

    for (const check of checks) {
      const result = await check.run();
      const icon = result.ok ? c.success("\u2713") : c.error("\u2717");
      const name = check.name.padEnd(16);
      console.log(`  ${icon} ${c.bold(name)} ${result.ok ? c.dim(result.detail) : c.error(result.detail)}`);
      if (!result.ok && result.hint) {
        console.log(`  ${" ".repeat(19)}${c.accent(result.hint)}`);
      }
      if (!result.ok) allOk = false;
    }

    console.log();
    if (allOk) {
      console.log(`  ${c.success("\u25C7")}  ${c.success("All checks passed")}`);
    } else {
      console.log(`  ${c.warn("\u25C7")}  ${c.warn("Some checks failed — see hints above")}`);
    }
    console.log();
  },
});
