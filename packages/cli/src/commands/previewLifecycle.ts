import { spawn as nodeSpawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { scanActiveServers, type ActiveServer } from "../server/portUtils.js";
import type { BrowserGpuMode } from "../browser/gpuPolicy.js";
import { isProcessDescendant, killProcessTree, processIdentity } from "../utils/orphanCleanup.js";

export interface PreviewSession {
  pid: number;
  wrapperIdentity?: string;
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
  isDescendant?: (childPid: number, ancestorPid: number) => boolean;
  identity?: (pid: number) => string | null;
  isSignalable?: (pid: number) => boolean;
  stateHome?: string;
  forceNew?: boolean;
  browserGpuMode?: BrowserGpuMode;
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
  // Written through a temp file and renamed: every reader deletes this record
  // when it fails to parse, so a concurrent reader catching a half-written file
  // would destroy a live server's only ownership proof. `rename` is atomic
  // within a directory, so a reader sees either the old record or the new one.
  const temporary = `${path}.${process.pid}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(session, null, 2)}\n`, { mode: 0o600 });
    renameSync(temporary, path);
  } finally {
    // A failed rename would otherwise orphan the temp file. The `.json` filter
    // hides it from the lister, so it accumulates silently.
    rmSync(temporary, { force: true });
  }
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

function hasValidPreviewProcess(session: PreviewSession): boolean {
  return Number.isInteger(session.pid) && session.pid > 0;
}

function hasValidPreviewEndpoint(session: PreviewSession): boolean {
  return Number.isInteger(session.port) && session.port > 0 && session.port <= 65535;
}

function matchesPreviewSessionFile(
  session: PreviewSession,
  path: string,
  stateHome: string,
): boolean {
  return (
    typeof session.projectDir === "string" &&
    typeof session.logPath === "string" &&
    previewSessionPath(session.projectDir, stateHome) === path
  );
}

function readPreviewSessionFile(path: string, stateHome: string): PreviewSession | null {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as PreviewSession;
    if (
      !hasValidPreviewProcess(parsed) ||
      !hasValidPreviewEndpoint(parsed) ||
      !matchesPreviewSessionFile(parsed, path, stateHome)
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

function matchingServer(
  servers: ActiveServer[],
  projectDir: string,
  browserGpuMode?: BrowserGpuMode,
): ActiveServer | null {
  return (
    servers.find(
      (server) =>
        normalized(server.projectDir) === normalized(projectDir) &&
        (browserGpuMode === undefined || server.browserGpuMode === browserGpuMode),
    ) ?? null
  );
}

function matchingServerAtPort(
  servers: ActiveServer[],
  projectDir: string,
  port: number,
): ActiveServer | null {
  return matchingServer(
    servers.filter((server) => server.port === port),
    projectDir,
  );
}

function sameProjectPorts(servers: ActiveServer[], projectDir: string): Set<number> {
  const project = normalized(projectDir);
  return new Set(
    servers
      .filter((server) => normalized(server.projectDir) === project)
      .map((server) => server.port),
  );
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
): { pid: number; wrapperIdentity: string | undefined; logPath: string } {
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
  return {
    pid: child.pid,
    wrapperIdentity: (dependencies.identity ?? processIdentity)(child.pid) ?? undefined,
    logPath,
  };
}

function startedServer(
  servers: ActiveServer[],
  projectDir: string,
  preLaunchPorts: Set<number>,
  browserGpuMode?: BrowserGpuMode,
): ActiveServer | null {
  const candidates = servers.filter((server) => !preLaunchPorts.has(server.port));
  return matchingServer(candidates, projectDir, browserGpuMode);
}

export function buildBackgroundPreviewArgs(argv: string[]): string[] {
  const filtered = argv.filter(
    (arg) =>
      arg !== "--background" &&
      !arg.startsWith("--background=") &&
      arg !== "--foreground" &&
      !arg.startsWith("--foreground=") &&
      arg !== "--open" &&
      arg !== "--no-open" &&
      arg !== "--json",
  );
  return [...filtered, "--foreground", "--no-open"];
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

  // A missed probe is not proof the preview is gone: a server whose event loop
  // is momentarily blocked (a Puppeteer thumbnail capture will do it) answers
  // nothing for a second or two. Deleting the record on that would destroy the
  // wrapperIdentity that is the only PID-reuse guard `--stop` has, and it never
  // comes back. Only a wrapper process that is provably gone retires a record.
  if (saved && wrapperProcessIsAlive(saved, dependencies)) return null;
  removePreviewSession(projectDir, stateHome);
  return null;
}

/**
 * Whether the recorded wrapper process is still the process we launched.
 *
 * `processIdentity` returns a birth token, so a recycled PID reads as a
 * different process and the record is correctly retired. A null token (no such
 * process, or the platform lookup failed) is only treated as "gone" when the
 * record has no token to compare against — failing closed there would pin dead
 * records forever on platforms where the lookup is unavailable.
 */
/**
 * Whether a PID exists at all. `kill(pid, 0)` sends no signal; it only asks the
 * kernel. `EPERM` means the process is there but owned by someone else — still
 * alive, which is the question being asked.
 */
function processIsSignalable(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException | undefined)?.code === "EPERM";
  }
}

function wrapperProcessIsAlive(
  saved: PreviewSession,
  dependencies: LifecycleDependencies,
): boolean {
  if (!saved.wrapperIdentity) return false;

  // Cheap and decisive first: a PID nothing can signal is gone, and no birth
  // token is needed to say so. This also keeps the identity subprocess off the
  // path for exactly the stale records that make `--list` slow.
  const signalable = dependencies.isSignalable ?? processIsSignalable;
  if (!signalable(saved.pid)) return false;

  const identity = (dependencies.identity ?? processIdentity)(saved.pid);
  // No answer is NOT the same as a different answer. `processIdentity` catches
  // every failure into `null`, and on two of three platforms that failure is a
  // subprocess timeout on a live process — `ps -o lstart=` and PowerShell's CIM
  // query both run on a 2 s budget, under the very load that made the HTTP
  // probe miss in the first place. Treating that as "recycled" would destroy
  // the only PID-reuse guard `--stop` has, which is the loss this whole path
  // exists to prevent. The PID is signalable, so keep the record.
  if (identity === null) return true;

  return identity === saved.wrapperIdentity;
}

export async function listBackgroundPreviewStatuses(
  dependencies: LifecycleDependencies = {},
): Promise<PreviewSession[]> {
  const stateHome = dependencies.stateHome ?? defaultStateHome();
  const directory = sessionDirectory(stateHome);
  let files: string[];
  try {
    files = readdirSync(directory)
      .filter((name) => name.endsWith(".json"))
      .map((name) => join(directory, name));
  } catch {
    return [];
  }

  const saved = files
    .map((path) => readPreviewSessionFile(path, stateHome))
    .filter((session): session is PreviewSession => session !== null);
  const statuses = await Promise.all(
    saved.map((session) =>
      readBackgroundPreviewStatus(session.projectDir, session.port, {
        ...dependencies,
        stateHome,
      }),
    ),
  );
  return statuses.filter((status): status is PreviewSession => status !== null);
}

function readyPreviewSession(
  server: ActiveServer,
  pid: number,
  wrapperIdentity: string | undefined,
  projectDir: string,
  logPath: string,
  dependencies: LifecycleDependencies,
): { session: PreviewSession; publicPid: number } {
  const identity = wrapperIdentity ?? (dependencies.identity ?? processIdentity)(pid) ?? undefined;
  const liveServerPid = Number(server.pid);
  return {
    session: {
      pid,
      wrapperIdentity: identity,
      port: server.port,
      projectDir: resolve(projectDir),
      logPath,
    },
    publicPid: Number.isInteger(liveServerPid) && liveServerPid > 0 ? liveServerPid : pid,
  };
}

function ownedStopTargetPid(
  saved: PreviewSession | null,
  liveServerPid: number,
  dependencies: LifecycleDependencies,
): number {
  if (!saved?.wrapperIdentity) return liveServerPid;
  const identity = dependencies.identity ?? processIdentity;
  if (identity(saved.pid) !== saved.wrapperIdentity) return liveServerPid;
  if (saved.pid === liveServerPid) return saved.pid;
  const isDescendant = dependencies.isDescendant ?? isProcessDescendant;
  return isDescendant(liveServerPid, saved.pid) ? saved.pid : liveServerPid;
}

async function stopOwnedPreviewBeforeReplacement(
  owned: ActiveServer | null,
  projectDir: string,
  dependencies: LifecycleDependencies,
): Promise<void> {
  if (!owned) return;
  // `false` means "there was nothing left to stop" — the server went away
  // between the outer scan and this one. That is the goal state for a
  // replacement, not a failure; treating it as fatal refused to start any
  // preview at all until the user deleted the session record by hand.
  // A server that is still listening throws from inside stopBackgroundPreview.
  await stopBackgroundPreview(projectDir, owned.port, dependencies);
}

function savedOwnedPreview(
  servers: ActiveServer[],
  saved: PreviewSession | null,
  projectDir: string,
): ActiveServer | null {
  if (!saved) return null;
  // Ownership comes from the saved project+port, not the replacement's GPU
  // policy. Filtering here would miss an owned hardware→software replacement
  // and overwrite the only session record while leaving the old listener live.
  const savedPortServers = servers.filter((server) => server.port === saved.port);
  return matchingServer(savedPortServers, projectDir);
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
  const stateHome = dependencies.stateHome ?? defaultStateHome();
  const saved = readPreviewSession(projectDir, stateHome);
  // Always inspect a saved custom port first. `--force-new --port <new>` must
  // replace that owned server before recording the replacement, otherwise the
  // single per-project ownership record would orphan the old listener.
  const scanStart = saved?.port ?? startPort;
  const scanned = await scan(scanStart);
  const requestedExisting = matchingServer(scanned, projectDir, dependencies.browserGpuMode);
  const ownedExisting = savedOwnedPreview(scanned, saved, projectDir);
  // A saved managed preview is the authoritative same-project instance. An
  // explicit GPU-policy change replaces it; it must not silently adopt an
  // unmanaged sibling that happens to match the new policy.
  const reusableOwned = ownedExisting
    ? matchingServer([ownedExisting], projectDir, dependencies.browserGpuMode)
    : null;
  const reusableExisting = reusableOwned ?? (ownedExisting ? null : requestedExisting);
  if (reusableExisting && !dependencies.forceNew) {
    return {
      type: "reused",
      port: reusableExisting.port,
      pid: reusableExisting.pid ? Number(reusableExisting.pid) : null,
      logPath: null,
    };
  }
  await stopOwnedPreviewBeforeReplacement(ownedExisting, projectDir, dependencies);
  // Snapshot every same-project listener in the prospective launch range only
  // after the owned listener is gone. Readiness must identify a newly appeared
  // server, never a pre-existing unmanaged sibling.
  const preLaunchPorts = sameProjectPorts(await scan(startPort), projectDir);

  const { pid, wrapperIdentity, logPath } = spawnDetachedPreview(
    projectDir,
    stateHome,
    dependencies,
  );

  const sleep = dependencies.sleep ?? delay;
  for (let attempt = 0; attempt < 50; attempt++) {
    const server = startedServer(
      await scan(startPort),
      projectDir,
      preLaunchPorts,
      dependencies.browserGpuMode,
    );
    if (server) {
      const ready = readyPreviewSession(
        server,
        pid,
        wrapperIdentity,
        projectDir,
        logPath,
        dependencies,
      );
      writePreviewSession(ready.session, stateHome);
      return {
        type: "started",
        ...ready.session,
        pid: ready.publicPid,
      };
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
  const scanned = await scan(scanStart);
  const server = saved
    ? matchingServerAtPort(scanned, projectDir, saved.port)
    : matchingServer(scanned, projectDir);
  if (!server) {
    removePreviewSession(projectDir, stateHome);
    return false;
  }
  // A saved PID can be reused after a crashed preview. The HTTP probe proves
  // the project, but only the live server's own metadata proves which process
  // owns it; never substitute the saved wrapper PID here.
  const pid = Number(server.pid);
  if (!Number.isInteger(pid) || pid <= 0) {
    throw new Error(`preview ownership could not be proven for ${resolve(projectDir)}`);
  }

  const kill = dependencies.kill ?? stopProcess;
  kill(ownedStopTargetPid(saved, pid, dependencies));

  const sleep = dependencies.sleep ?? delay;
  for (let attempt = 0; attempt < 25; attempt++) {
    if (!matchingServerAtPort(await scan(scanStart), projectDir, server.port)) {
      removePreviewSession(projectDir, stateHome);
      return true;
    }
    await sleep(100);
  }
  throw new Error(`background preview did not stop for ${resolve(projectDir)}`);
}
