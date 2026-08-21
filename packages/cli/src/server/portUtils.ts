/**
 * Port utilities for the HyperFrames preview server.
 *
 * The multi-host availability probe and instance-reuse port selection are
 * inspired by Remotion's approach to dev-server port management.
 *
 * - Multi-host availability testing (catches port-forwarding ghosts)
 * - HTTP probe for detecting existing HyperFrames instances
 * - PID detection for actionable conflict logging
 * - Smart port selection with instance reuse
 */

import net from "node:net";
import http from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { resolve } from "node:path";
import type { BrowserGpuMode } from "../browser/gpuPolicy.js";

const execFileAsync = promisify(execFile);

/** Max ports to scan before giving up. */
const MAX_PORT_SCAN = 100;

/** Localhost HTTP probe timeout — HyperFrames responds in <1ms, so 300ms is generous. */
const PROBE_TIMEOUT_MS = 300;

/** Max bytes to read from HTTP probe response (guards against malicious servers). */
const PROBE_MAX_BYTES = 4096;

// ── Port availability ──────────────────────────────────────────────────────

/**
 * Test whether a port is free on a specific host.
 *
 * Attempts an ephemeral bind-and-release with `net.createServer()`. Only
 * `EADDRINUSE` means "genuinely occupied" — other errnos (EADDRNOTAVAIL when
 * IPv6 is disabled, EACCES for privileged ports, EAFNOSUPPORT for missing
 * address families) mean "this host doesn't apply to our probe", and we treat
 * the port as free for this host rather than poisoning the whole scan.
 */
async function isPortAvailableOnHost(port: number, host: string): Promise<boolean> {
  const probe = net.createServer();
  probe.unref();

  const bindError = await new Promise<NodeJS.ErrnoException | null>((settle) => {
    const handleError = (err: NodeJS.ErrnoException): void => settle(err);
    probe.once("error", handleError);
    probe.listen({ port, host }, () => {
      probe.removeListener("error", handleError);
      settle(null);
    });
  });

  if (bindError !== null) {
    return bindError.code !== "EADDRINUSE";
  }

  await new Promise<void>((done) => probe.close(() => done()));
  return true;
}

export const PORT_PROBE_HOSTS = ["127.0.0.1", "0.0.0.0", "::1", "::"] as const;

/**
 * Test a port across IPv4 and IPv6 interfaces. A port is only available if
 * EVERY host binds and releases cleanly — that catches the devbox class of
 * bug where a port is free on `127.0.0.1` but held on `0.0.0.0` via SSH
 * forwarding.
 *
 * **Must be sequential, not Promise.all.** Binding `127.0.0.1` holds the
 * socket open until `server.close()` resolves on the next event-loop tick.
 * In parallel, the wildcard `0.0.0.0` / `::` tests race that still-open
 * socket and return spurious `EADDRINUSE` — which makes every port in the
 * scan range look occupied and the preview server refuse to start. Repro
 * on Linux (Crostini on ChromeOS in the reporting environment, issue #309)
 * is deterministic; on macOS/Windows the behaviour is less consistent but
 * the race is there all the same. Serializing each bind past its close
 * callback eliminates the window entirely.
 *
 * `probe` is injectable for deterministic testing of the sequential
 * contract — callers in production pass nothing and get the real socket
 * probe. Tests can pass a recording fake that tracks in-flight probes.
 */
export async function testPortOnAllHosts(
  port: number,
  probe: (port: number, host: string) => Promise<boolean> = isPortAvailableOnHost,
): Promise<boolean> {
  for (const host of PORT_PROBE_HOSTS) {
    const available = await probe(port, host);
    if (!available) return false;
  }
  return true;
}

// ── Existing instance detection ────────────────────────────────────────────

interface HyperframesConfigResponse {
  isHyperframes: boolean;
  pid?: number;
  projectName: string;
  projectDir: string;
  serverBuildSignature?: string | null;
  browserGpuMode?: BrowserGpuMode;
  version: string;
}

export type DetectionResult =
  | { type: "match" }
  | { type: "mismatch"; projectName: string }
  | { type: "not-hyperframes" };

/**
 * Probe an occupied port to check if it's running a HyperFrames preview server.
 * HTTP GET to /__hyperframes_config with a short timeout.
 */
export function detectHyperframesServer(
  port: number,
  normalizedProjectDir: string,
  expectedServerBuildSignature: string | null = null,
  expectedBrowserGpuMode?: BrowserGpuMode,
): Promise<DetectionResult> {
  return new Promise<DetectionResult>((resolveResult) => {
    const req = http.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/__hyperframes_config",
        timeout: PROBE_TIMEOUT_MS,
      },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolveResult({ type: "not-hyperframes" });
        }

        let data = "";
        let bytes = 0;
        res.on("data", (chunk: Buffer | string) => {
          bytes += typeof chunk === "string" ? chunk.length : chunk.byteLength;
          if (bytes > PROBE_MAX_BYTES) {
            req.destroy();
            return resolveResult({ type: "not-hyperframes" });
          }
          data += chunk;
        });
        res.on("error", () => {
          resolveResult({ type: "not-hyperframes" });
        });
        res.on("end", () => {
          try {
            const json = JSON.parse(data) as HyperframesConfigResponse;
            if (json.isHyperframes !== true) {
              return resolveResult({ type: "not-hyperframes" });
            }

            const normalize = (p: string) => resolve(p).replace(/\\/g, "/").toLowerCase();

            if (normalize(json.projectDir) === normalizedProjectDir) {
              if (
                expectedServerBuildSignature !== null &&
                json.serverBuildSignature !== expectedServerBuildSignature
              ) {
                return resolveResult({ type: "mismatch", projectName: json.projectName });
              }
              if (
                expectedBrowserGpuMode !== undefined &&
                json.browserGpuMode !== expectedBrowserGpuMode
              ) {
                return resolveResult({ type: "mismatch", projectName: json.projectName });
              }
              return resolveResult({ type: "match" });
            }

            return resolveResult({ type: "mismatch", projectName: json.projectName });
          } catch {
            resolveResult({ type: "not-hyperframes" });
          }
        });
      },
    );

    req.on("error", () => {
      resolveResult({ type: "not-hyperframes" });
    });

    req.on("timeout", () => {
      req.destroy();
      resolveResult({ type: "not-hyperframes" });
    });
  });
}

// ── PID detection ──────────────────────────────────────────────────────────

/**
 * Get the PID of the process listening on a port (macOS/Linux only).
 * Returns null on Windows or if detection fails.
 */
/**
 * The PID the OS says is listening on `port`, or null when it cannot be
 * determined. This is the only trustworthy answer: a config response is
 * whatever the process on the other end chose to say.
 */
async function getProcessOnPort(port: number): Promise<string | null> {
  if (process.platform === "win32") return windowsListenerPid(port);
  try {
    const { stdout } = await execFileAsync("lsof", [`-ti:${port}`, "-sTCP:LISTEN"], {
      timeout: 2000,
    });
    const pid = stdout.trim().split("\n")[0]?.trim();
    return pid || null;
  } catch {
    return null;
  }
}

async function windowsListenerPid(port: number): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("netstat", ["-ano", "-p", "tcp"], { timeout: 4000 });
    for (const line of stdout.split(/\r?\n/)) {
      const columns = line.trim().split(/\s+/);
      if (columns.length < 5 || columns[3] !== "LISTENING") continue;
      const local = columns[1] ?? "";
      if (local.slice(local.lastIndexOf(":") + 1) !== String(port)) continue;
      const pid = columns[4] ?? "";
      return /^\d+$/.test(pid) && pid !== "0" ? pid : null;
    }
    return null;
  } catch {
    return null;
  }
}

// ── Server discovery ───────────────────────────────────────────────────────

export interface ActiveServer {
  port: number;
  /**
   * Loopback host the server is reachable on, URL-ready (`127.0.0.1` or
   * `[::1]`). Vite dev servers bind IPv6 (`::1`) while embedded servers bind
   * IPv4; consumers must use this rather than assuming `127.0.0.1`. Defaults to
   * `127.0.0.1` when unset (embedded scan path).
   */
  host?: string;
  projectName: string;
  projectDir: string;
  version: string;
  pid: string | null;
  /**
   * Where `pid` came from. `"os"` is the kernel's answer for who holds the
   * listening socket; `"self-reported"` is whatever the process on the other
   * end chose to put in its config response. Callers that SIGNAL the pid must
   * require `"os"` — see `killActiveServers`.
   */
  pidSource?: "os" | "self-reported";
  browserGpuMode?: BrowserGpuMode;
}

/**
 * Probe a single port for a HyperFrames config response.
 * Returns the full config or null if not a HyperFrames server.
 */
function probePort(port: number): Promise<HyperframesConfigResponse | null> {
  return new Promise<HyperframesConfigResponse | null>((resolveResult) => {
    const req = http.get(
      { hostname: "127.0.0.1", port, path: "/__hyperframes_config", timeout: PROBE_TIMEOUT_MS },
      (res) => {
        if (res.statusCode !== 200) {
          res.resume();
          return resolveResult(null);
        }
        let data = "";
        let bytes = 0;
        res.on("data", (chunk: Buffer | string) => {
          bytes += typeof chunk === "string" ? chunk.length : chunk.byteLength;
          if (bytes > PROBE_MAX_BYTES) {
            req.destroy();
            return resolveResult(null);
          }
          data += chunk;
        });
        res.on("error", () => resolveResult(null));
        res.on("end", () => {
          try {
            const json = JSON.parse(data) as HyperframesConfigResponse;
            resolveResult(json.isHyperframes === true ? json : null);
          } catch {
            resolveResult(null);
          }
        });
      },
    );
    req.on("error", () => resolveResult(null));
    req.on("timeout", () => {
      req.destroy();
      resolveResult(null);
    });
  });
}

/**
 * Scan the default port range for active HyperFrames preview servers.
 * Probes ports in parallel batches for speed.
 */
export async function scanActiveServers(startPort = 3002): Promise<ActiveServer[]> {
  const endPort = startPort + MAX_PORT_SCAN - 1;
  const servers: ActiveServer[] = [];

  // Probe in batches of 20 to avoid too many concurrent connections
  const batchSize = 20;
  for (let batchStart = startPort; batchStart <= endPort; batchStart += batchSize) {
    const batchEnd = Math.min(batchStart + batchSize - 1, endPort);
    const ports = Array.from({ length: batchEnd - batchStart + 1 }, (_, i) => batchStart + i);

    const results = await Promise.all(ports.map((port) => activeServerOnPort(port)));

    for (const r of results) {
      if (r) servers.push(r);
    }
  }

  return servers;
}

/**
 * Probe exactly one port and return its HyperFrames identity.
 *
 * `pid` is the OS's answer for who holds the listening socket, NOT the pid the
 * response claims. That field is load-bearing — `--stop` and `--kill-all` send
 * signals to it — and `/__hyperframes_config` is unauthenticated, so any local
 * process that answers on a scanned port could otherwise name an arbitrary PID
 * and have the CLI kill it. The self-reported value is used only where the OS
 * lookup is unavailable, which is also the only case where it is unfalsifiable.
 */
export async function activeServerOnPort(
  port: number,
  listenerLookup: (port: number) => Promise<string | null> = getProcessOnPort,
): Promise<ActiveServer | null> {
  const config = await probePort(port);
  if (!config) return null;
  const listenerPid = await listenerLookup(port);
  if (listenerPid) return { ...identityFrom(config, port), pid: listenerPid, pidSource: "os" };

  // The OS lookup came back empty. That is NOT only "unsupported platform":
  // `lsof` may be absent (common on slim images), may time out, or may not see
  // a socket owned by another user. The value is still reported, because
  // `--list` and the ownership record both have honest uses for it, but it is
  // tagged so the paths that send signals can refuse it.
  const selfReported =
    Number.isInteger(config.pid) && Number(config.pid) > 0 ? String(config.pid) : null;
  return {
    ...identityFrom(config, port),
    pid: selfReported,
    ...(selfReported ? { pidSource: "self-reported" as const } : {}),
  };
}

function identityFrom(
  config: HyperframesConfigResponse,
  port: number,
): Omit<ActiveServer, "pid" | "pidSource"> {
  return {
    port,
    projectName: config.projectName,
    projectDir: config.projectDir,
    version: config.version,
    browserGpuMode: config.browserGpuMode,
  };
}

/**
 * SIGTERM every active HyperFrames preview server whose PID the OS confirmed.
 *
 * This is a blind sweep of a port range: the only evidence that a given process
 * should be killed is that it answered `/__hyperframes_config`, which is
 * unauthenticated. So the decision here is deliberately FAIL CLOSED — a PID the
 * OS could not confirm is skipped rather than signalled, because the alternative
 * is letting any local process nominate a victim.
 *
 * The cost is real and bounded: where `lsof` is missing, `--kill-all` stops
 * reaping unmanaged servers. Managed previews are unaffected — they stop through
 * their session record, which proves ownership by process birth identity rather
 * than by asking the port who it is.
 *
 * Skipped ports are returned so the caller can say so; a security control that
 * degrades silently is one nobody knows to fix.
 */
export async function killActiveServers(
  startPort = 3002,
): Promise<{ killed: number; unverified: number[] }> {
  const servers = await scanActiveServers(startPort);
  let killed = 0;
  const unverified: number[] = [];

  for (const server of servers) {
    if (!server.pid) continue;
    if (server.pidSource !== "os") {
      unverified.push(server.port);
      continue;
    }
    try {
      process.kill(parseInt(server.pid, 10), "SIGTERM");
      killed++;
    } catch {
      // Process may have already exited
    }
  }

  return { killed, unverified };
}

// ── Smart port selection ───────────────────────────────────────────────────

export type FindPortResult =
  | { type: "started"; server: import("@hono/node-server").ServerType; port: number }
  | { type: "already-running"; port: number };

/**
 * Smart port selection with instance reuse (inspired by Remotion's dev-server
 * port handling).
 *
 * For each port in the scan range:
 *   1. Test availability on multiple hosts (catches port-forwarding ghosts)
 *   2. If available → bind the server and return
 *   3. If occupied and !forceNew → HTTP-probe for an existing HyperFrames server
 *      - Same project → return "already-running" (caller reopens browser)
 *      - Different project or non-HyperFrames → log and skip to next port
 *   4. If bind still fails with EADDRINUSE (race) → retry next port
 */
export async function findPortAndServe(
  fetch: Parameters<typeof import("@hono/node-server").serve>[0]["fetch"],
  startPort: number,
  projectDir: string,
  forceNew: boolean,
  expectedServerBuildSignature: string | null = null,
  bindHost?: string,
  expectedBrowserGpuMode?: BrowserGpuMode,
): Promise<FindPortResult> {
  const { createAdaptorServer } = await import("@hono/node-server");
  // SECURITY (F-001): bind to loopback by default. The studio API exposes
  // unauthenticated project file read/write/delete + render-spawn endpoints;
  // a bare `listen(port)` binds the unspecified address (`::`/`0.0.0.0`),
  // handing those endpoints to anyone on the LAN. Operators who genuinely
  // need LAN exposure opt in explicitly via the HYPERFRAMES_PREVIEW_HOST
  // env var (e.g. HYPERFRAMES_PREVIEW_HOST=0.0.0.0).
  const host = bindHost ?? (process.env.HYPERFRAMES_PREVIEW_HOST?.trim() || "127.0.0.1");
  const normalizedDir = resolve(projectDir).replace(/\\/g, "/").toLowerCase();
  const endPort = startPort + MAX_PORT_SCAN - 1;

  let server: import("@hono/node-server").ServerType | null = null;

  for (let port = startPort; port <= endPort; port++) {
    const available = await testPortOnAllHosts(port);

    if (available) {
      // Lazily create server on first available port
      if (!server) server = createAdaptorServer({ fetch });

      try {
        await new Promise<void>((resolveListener, rejectListener) => {
          const onError = (err: NodeJS.ErrnoException): void => {
            server!.removeListener("listening", onListening);
            rejectListener(err);
          };
          const onListening = (): void => {
            server!.removeListener("error", onError);
            resolveListener();
          };
          server!.once("error", onError);
          server!.once("listening", onListening);
          server!.listen(port, host);
        });
        return { type: "started", server, port };
      } catch (err: unknown) {
        if ((err as NodeJS.ErrnoException).code === "EADDRINUSE") {
          continue;
        }
        throw err;
      }
    }

    // Port is occupied — probe for existing HyperFrames instance
    if (!forceNew) {
      const detection = await detectHyperframesServer(
        port,
        normalizedDir,
        expectedServerBuildSignature,
        expectedBrowserGpuMode,
      );
      if (detection.type === "match") {
        return { type: "already-running", port };
      }
      if (detection.type === "mismatch") {
        continue;
      }
    }
  }

  throw new Error(
    `Ports ${startPort}–${endPort} are all in use. Use --port to specify a different starting port.`,
  );
}
