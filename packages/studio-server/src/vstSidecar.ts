/**
 * Lifecycle for the VST host sidecar (`packages/vst-host`), shared by both
 * `hyperframes preview` (CLI, via `packages/cli/src/vst/sidecar.ts`'s
 * re-export of this module) and the Studio Vite dev server. Spawns the
 * sidecar's `serve` subcommand, waits for its ready handshake on stdout, and
 * tracks the single running instance for the lifetime of this process.
 * `hyperframes preview` registers the running child with the same
 * signal-driven shutdown paths it uses for its own studio child processes so
 * Ctrl-C during a preview session also tears the sidecar down.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join, resolve } from "node:path";

// Captures the shared-secret token the sidecar prints alongside its port
// (see server.py's `_authenticate`/`start`) — required by every WS command,
// so it must be relayed to the browser (via `/vst/start`'s response) rather
// than just the port.
const READY_RE = /VST-HOST-LISTENING port=(\d+) token=(\S+)/;
const READY_TIMEOUT_MS = 30_000;
const INSTALL_HINT = "Install the VST host: uv tool install hyperframes-vst-host (requires uv)";

interface RunningSidecar {
  port: number;
  token: string;
  child: ChildProcess;
}

let running: RunningSidecar | null = null;
let pending: Promise<{ port: number; token: string; stop: () => void }> | null = null;
/**
 * The child process of an in-flight `startVstSidecar()` attempt, tracked from
 * the moment `spawn()` returns until either the ready handshake arrives (at
 * which point `running` takes over tracking) or the attempt fails/times out.
 * Lets `stopVstSidecar()` kill a sidecar that's still booting — without this,
 * a shutdown that races the ready handshake (e.g. Ctrl-C during a slow boot)
 * would see `running === null` and leave the child orphaned.
 */
let spawningChild: ChildProcess | null = null;

/**
 * Resolves the command used to invoke the VST host sidecar.
 *
 * Precedence:
 * 1. `HF_VST_HOST_CMD` env var (space-split) — lets CI/dev machines point at
 *    an arbitrary executable (or, in tests, a fake shell script).
 * 2. `uv run --project <packages/vst-host> hyperframes-vst` when the
 *    monorepo's `packages/vst-host` directory is present relative to this
 *    package (the common case: a source checkout of hyperframes).
 * 3. Bare `hyperframes-vst` on PATH (an installed/published sidecar).
 *
 * Duplicated from `@hyperframes/engine`'s `resolveVstHostCommand`
 * (packages/engine/src/services/vstBounce.ts) — that package doesn't export
 * it from its public entry point or a subpath, so this module carries its own
 * copy with a package-relative monorepo path. Exported for reuse by
 * `vstCarve.ts`, which spawns the same sidecar's `carve` verb; `HF_VST_HOST_CMD`
 * is the test seam (see vstSidecar.test.ts) for both call sites.
 */
export function resolveVstHostCommand(): string[] {
  const override = process.env.HF_VST_HOST_CMD;
  if (override && override.trim().length > 0) {
    return override.trim().split(/\s+/);
  }

  const thisDir = fileURLToPath(new URL(".", import.meta.url));
  const monorepoVstHostDir = resolve(thisDir, "../../vst-host");
  if (existsSync(join(monorepoVstHostDir, "pyproject.toml"))) {
    return ["uv", "run", "--project", monorepoVstHostDir, "hyperframes-vst"];
  }

  return ["hyperframes-vst"];
}

/** Returns the running sidecar's port, or `null` if none is running. */
export function getVstSidecar(): { port: number } | null {
  return running ? { port: running.port } : null;
}

/**
 * Kills the running sidecar, if any. Safe to call whether or not a sidecar
 * is currently running — used by `hyperframes preview`'s shutdown paths so
 * every launch mode tears the sidecar down without needing to know whether
 * one was ever started.
 *
 * Also handles a sidecar that's still mid-spawn (a `startVstSidecar()` call
 * in flight whose child hasn't announced its ready port yet): `running` is
 * null in that window, so falls back to killing `spawningChild`.
 */
export function stopVstSidecar(): void {
  if (running) {
    stopSidecar(running.child);
  } else if (spawningChild) {
    stopSidecar(spawningChild);
  }
}

/** Test-only: force-resets singleton state between test cases. */
export function __resetForTests(): void {
  if (running) {
    running.child.kill();
  }
  if (spawningChild) {
    spawningChild.kill();
  }
  running = null;
  pending = null;
  spawningChild = null;
}

/**
 * Starts the VST host sidecar (`<resolved cmd> serve --port 0`) and resolves
 * once it announces its bound port on stdout. Only one sidecar runs per host
 * process — a second call while one is already running returns the same
 * instance.
 *
 * Concurrent calls made before the FIRST call's child becomes ready share
 * that same in-flight attempt via the module-level `pending` promise, rather
 * than each spawning their own child: `running` is only assigned once the
 * ready handshake arrives (inside `child.stdout`'s `data` handler), so
 * without `pending` a second call arriving before that point would see
 * `running === null` and spawn a second, orphaned child (TOCTOU race).
 * `pending` is set synchronously — before any `await` or callback-based work
 * — so every concurrent caller observes either `running` (already ready) or
 * `pending` (in flight) and never falls through to a fresh `spawn()` call.
 */
export function startVstSidecar(): Promise<{ port: number; token: string; stop: () => void }> {
  if (running) {
    const current = running;
    return Promise.resolve({
      port: current.port,
      token: current.token,
      stop: () => stopSidecar(current.child),
    });
  }
  if (pending) {
    return pending;
  }

  const [cmd, ...baseArgs] = resolveVstHostCommand();
  if (!cmd) {
    return Promise.reject(new Error(`VST sidecar could not be started. ${INSTALL_HINT}`));
  }

  pending = new Promise<{ port: number; token: string; stop: () => void }>(
    (resolvePromise, reject) => {
      const child = spawn(cmd, [...baseArgs, "serve", "--port", "0"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      spawningChild = child;
      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        if (spawningChild === child) spawningChild = null;
        child.kill();
        reject(new Error(`VST sidecar did not become ready in 30s. ${INSTALL_HINT}`));
      }, READY_TIMEOUT_MS);

      child.stdout?.on("data", (buf: Buffer) => {
        if (settled) return;
        const match = buf.toString().match(READY_RE);
        const portGroup = match?.[1];
        const tokenGroup = match?.[2];
        if (!portGroup || !tokenGroup) return;
        settled = true;
        clearTimeout(timer);
        const port = Number(portGroup);
        running = { port, token: tokenGroup, child };
        if (spawningChild === child) spawningChild = null;
        resolvePromise({ port, token: tokenGroup, stop: () => stopSidecar(child) });
      });

      child.on("error", () => {
        if (settled) return;
        settled = true;
        if (spawningChild === child) spawningChild = null;
        clearTimeout(timer);
        reject(new Error(`VST sidecar could not be started. ${INSTALL_HINT}`));
      });

      child.on("exit", () => {
        if (running && running.child === child) {
          running = null;
        }
        if (spawningChild === child) spawningChild = null;
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        reject(new Error(`VST sidecar exited before becoming ready. ${INSTALL_HINT}`));
      });
    },
  ).finally(() => {
    pending = null;
  });

  return pending;
}

function stopSidecar(child: ChildProcess): void {
  child.kill();
  if (running && running.child === child) {
    running = null;
  }
  if (spawningChild === child) {
    spawningChild = null;
  }
}
