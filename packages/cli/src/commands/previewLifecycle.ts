import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { scanActiveServers, type ActiveServer } from "../server/portUtils.js";
import { killProcessTree } from "../utils/orphanCleanup.js";

export interface PreviewSession {
  pid: number;
  port: number;
  projectDir: string;
  logPath: string;
}

type SpawnResult = { pid?: number; unref(): void };
type SpawnPreview = (
  command: string,
  args: string[],
  options: {
    detached: boolean;
    stdio: ["ignore", number, number];
    env: NodeJS.ProcessEnv;
  },
) => SpawnResult;

interface LifecycleDependencies {
  argv?: string[];
  execPath?: string;
  scan?: (startPort?: number) => Promise<ActiveServer[]>;
  spawn?: SpawnPreview;
  sleep?: (ms: number) => Promise<void>;
  kill?: (pid: number) => void;
  stateHome?: string;
  forceNew?: boolean;
}

function defaultStateHome(): string {
  return process.env.XDG_STATE_HOME || join(homedir(), ".local", "state");
}

function normalized(path: string): string {
  const resolved = resolve(path).replace(/\\/g, "/");
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function sessionDirectory(stateHome = defaultStateHome()): string {
  return join(stateHome, "hyperframes", "previews");
}

export function previewSessionPath(projectDir: string, stateHome = defaultStateHome()): string {
  const key = createHash("sha256").update(normalized(projectDir)).digest("hex").slice(0, 16);
  return join(sessionDirectory(stateHome), `${key}.json`);
}

function previewLogPath(projectDir: string, stateHome = defaultStateHome()): string {
  return previewSessionPath(projectDir, stateHome).replace(/\.json$/, ".log");
}

export function writePreviewSession(session: PreviewSession, stateHome = defaultStateHome()): void {
  const path = previewSessionPath(session.projectDir, stateHome);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
}

function readPreviewSession(
  projectDir: string,
  stateHome = defaultStateHome(),
): PreviewSession | null {
  const path = previewSessionPath(projectDir, stateHome);
  if (!existsSync(path)) return null;
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PreviewSession;
    if (
      !Number.isInteger(parsed.pid) ||
      parsed.pid <= 0 ||
      normalized(parsed.projectDir) !== normalized(projectDir)
    ) {
      throw new Error("invalid preview session");
    }
    return parsed;
  } catch {
    rmSync(path, { force: true });
    return null;
  }
}

function removePreviewSession(projectDir: string, stateHome = defaultStateHome()): void {
  rmSync(previewSessionPath(projectDir, stateHome), { force: true });
}

function matchingServer(servers: ActiveServer[], projectDir: string): ActiveServer | null {
  return servers.find((server) => normalized(server.projectDir) === normalized(projectDir)) ?? null;
}

function stopProcess(pid: number): void {
  killProcessTree(pid);
  if (process.platform === "win32") {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // Process already exited.
    }
  }
}

const delay = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

function spawnDetachedPreview(
  projectDir: string,
  stateHome: string,
  dependencies: LifecycleDependencies,
): { pid: number; logPath: string } {
  const logPath = previewLogPath(projectDir, stateHome);
  mkdirSync(dirname(logPath), { recursive: true });
  const logFd = openSync(logPath, "a", 0o600);
  const spawn = dependencies.spawn ?? (nodeSpawn as unknown as SpawnPreview);
  let child: SpawnResult;
  try {
    child = spawn(
      dependencies.execPath ?? process.execPath,
      buildBackgroundPreviewArgs(dependencies.argv ?? process.argv.slice(1)),
      {
        detached: true,
        stdio: ["ignore", logFd, logFd],
        env: process.env,
      },
    );
  } finally {
    closeSync(logFd);
  }
  if (!child.pid) throw new Error("background preview child did not report a PID");
  child.unref();
  return { pid: child.pid, logPath };
}

function startedServer(
  servers: ActiveServer[],
  projectDir: string,
  existing: ActiveServer | null,
  forceNew: boolean,
): ActiveServer | null {
  const candidates =
    forceNew && existing ? servers.filter((server) => server.port !== existing.port) : servers;
  return matchingServer(candidates, projectDir);
}

export function buildBackgroundPreviewArgs(argv: string[]): string[] {
  const filtered = argv.filter(
    (arg) =>
      arg !== "--background" &&
      !arg.startsWith("--background=") &&
      arg !== "--open" &&
      arg !== "--no-open",
  );
  return [...filtered, "--no-open"];
}

export async function readBackgroundPreviewStatus(
  projectDir: string,
  startPort: number,
  dependencies: LifecycleDependencies = {},
): Promise<PreviewSession | null> {
  const scan = dependencies.scan ?? scanActiveServers;
  const stateHome = dependencies.stateHome ?? defaultStateHome();
  const saved = readPreviewSession(projectDir, stateHome);
  const server = matchingServer(await scan(saved?.port ?? startPort), projectDir);
  if (server) {
    const pid = Number(server.pid ?? saved?.pid);
    if (Number.isInteger(pid) && pid > 0) {
      return {
        pid,
        port: server.port,
        projectDir: resolve(projectDir),
        logPath: saved?.logPath ?? previewLogPath(projectDir, stateHome),
      };
    }
  }

  removePreviewSession(projectDir, stateHome);
  return null;
}

export async function startBackgroundPreview(
  projectDir: string,
  startPort: number,
  dependencies: LifecycleDependencies = {},
): Promise<
  | { type: "reused"; port: number; pid: number | null; logPath: string | null }
  | { type: "started"; port: number; pid: number; logPath: string }
> {
  const scan = dependencies.scan ?? scanActiveServers;
  const existing = matchingServer(await scan(startPort), projectDir);
  if (existing && !dependencies.forceNew) {
    return {
      type: "reused",
      port: existing.port,
      pid: existing.pid ? Number(existing.pid) : null,
      logPath: null,
    };
  }

  const stateHome = dependencies.stateHome ?? defaultStateHome();
  const { pid, logPath } = spawnDetachedPreview(projectDir, stateHome, dependencies);

  const sleep = dependencies.sleep ?? delay;
  for (let attempt = 0; attempt < 50; attempt++) {
    const server = startedServer(
      await scan(startPort),
      projectDir,
      existing,
      dependencies.forceNew === true,
    );
    if (server) {
      const session = {
        pid,
        port: server.port,
        projectDir: resolve(projectDir),
        logPath,
      };
      writePreviewSession(session, stateHome);
      return { type: "started", ...session };
    }
    await sleep(200);
  }

  (dependencies.kill ?? stopProcess)(pid);
  throw new Error(`background preview did not become ready; see ${logPath}`);
}

export async function stopBackgroundPreview(
  projectDir: string,
  startPort: number,
  dependencies: LifecycleDependencies = {},
): Promise<boolean> {
  const scan = dependencies.scan ?? scanActiveServers;
  const stateHome = dependencies.stateHome ?? defaultStateHome();
  const saved = readPreviewSession(projectDir, stateHome);
  const scanStart = saved?.port ?? startPort;
  const server = matchingServer(await scan(scanStart), projectDir);
  // A saved PID can be reused after a crashed preview, so only trust it while
  // a currently reachable server proves this exact project is still running.
  const pid = Number(server ? (server.pid ?? saved?.pid) : undefined);
  if (!Number.isInteger(pid) || pid <= 0) {
    removePreviewSession(projectDir, stateHome);
    return false;
  }

  (dependencies.kill ?? stopProcess)(pid);
  const sleep = dependencies.sleep ?? delay;
  for (let attempt = 0; attempt < 25; attempt++) {
    if (!matchingServer(await scan(scanStart), projectDir)) {
      removePreviewSession(projectDir, stateHome);
      return true;
    }
    await sleep(100);
  }
  throw new Error(`background preview did not stop for ${resolve(projectDir)}`);
}
