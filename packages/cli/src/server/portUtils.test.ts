import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:net";
import { resolve } from "node:path";
import { createServer as createHttpServer, type Server as HttpServer } from "node:http";
import {
  PORT_PROBE_HOSTS,
  detectHyperframesServer,
  findPortAndServe,
  testPortOnAllHosts,
} from "./portUtils.js";
import type { ServerType } from "@hono/node-server";

const openServers: Server[] = [];
const openHttpServers: HttpServer[] = [];
const openAdaptorServers: ServerType[] = [];

async function allocFreePort(): Promise<number> {
  const srv = createServer();
  await new Promise<void>((resolve, reject) => {
    srv.once("error", reject);
    srv.listen(0, "127.0.0.1", () => resolve());
  });
  const port = (srv.address() as import("node:net").AddressInfo).port;
  await new Promise<void>((resolve) => srv.close(() => resolve()));
  return port;
}

async function closeAll(servers: Array<{ close(cb: () => void): void }>): Promise<void> {
  await Promise.all(
    servers.splice(0).map((s) => new Promise<void>((resolve) => s.close(() => resolve()))),
  );
}

afterEach(async () => {
  await closeAll(openServers);
  await closeAll(openHttpServers);
  await closeAll(openAdaptorServers);
  vi.restoreAllMocks();
});

function boundAddress(server: ServerType): string {
  const addr = server.address();
  if (addr === null || typeof addr === "string") {
    throw new Error(`expected an AddressInfo, got ${JSON.stringify(addr)}`);
  }
  return addr.address;
}

async function startConfigProbeServer(payload: Record<string, unknown>): Promise<number> {
  const server = createHttpServer((_req, res) => {
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(payload));
  });
  openHttpServers.push(server);
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });
  return (server.address() as import("node:net").AddressInfo).port;
}

describe("testPortOnAllHosts — real-socket behaviour (OS-dependent)", () => {
  // These exercise the real network stack. On Linux the buggy parallel
  // implementation reliably fails the first test (issue #309 repro); on
  // macOS the race is not deterministic so both old and new code pass
  // here. The sequential-contract test below is the platform-agnostic
  // regression gate.

  it("returns true for a genuinely free port (regression: #309)", async () => {
    const port = await allocFreePort();
    const result = await testPortOnAllHosts(port);
    expect(result).toBe(true);
  });

  it("returns false when the port is occupied on 0.0.0.0", async () => {
    const port = await allocFreePort();
    const blocker = createServer();
    openServers.push(blocker);
    await new Promise<void>((resolve, reject) => {
      blocker.once("error", reject);
      blocker.listen({ port, host: "0.0.0.0" }, () => resolve());
    });
    const result = await testPortOnAllHosts(port);
    expect(result).toBe(false);
  });
});

describe("testPortOnAllHosts — sequential contract (platform-agnostic)", () => {
  /**
   * Load-bearing regression test. Injects a recording fake probe that
   * holds each call open for a few ms and tracks how many are in flight.
   * The parallel (buggy) implementation would drive overlap to 4; the
   * sequential fix keeps it at 1. Deterministic on every OS.
   */
  it("runs host probes sequentially — never more than one concurrent", async () => {
    let inFlight = 0;
    let peakConcurrency = 0;
    const hostsProbed: string[] = [];

    const fakeProbe = async (_port: number, host: string): Promise<boolean> => {
      inFlight++;
      if (inFlight > peakConcurrency) peakConcurrency = inFlight;
      hostsProbed.push(host);
      // Hold so any parallel overlap from a regression would be visible
      // here regardless of OS scheduling.
      await new Promise((r) => setTimeout(r, 20));
      inFlight--;
      return true;
    };

    const result = await testPortOnAllHosts(7777, fakeProbe);

    expect(result).toBe(true);
    expect(peakConcurrency).toBe(1);
    expect(hostsProbed).toEqual([...PORT_PROBE_HOSTS]);
  });

  it("short-circuits on the first unavailable host", async () => {
    const hostsProbed: string[] = [];
    const fakeProbe = async (_port: number, host: string): Promise<boolean> => {
      hostsProbed.push(host);
      // Second host reports in-use; verify we never probe hosts three and four.
      return host === "127.0.0.1";
    };

    const result = await testPortOnAllHosts(7777, fakeProbe);

    expect(result).toBe(false);
    expect(hostsProbed).toEqual(["127.0.0.1", "0.0.0.0"]);
  });
});

describe("findPortAndServe — bind host (security: F-001)", () => {
  const okFetch = (): Response => new Response("ok");

  it("binds to loopback (127.0.0.1) by default — not all interfaces", async () => {
    const port = await allocFreePort();
    const result = await findPortAndServe(okFetch, port, "/tmp/demo-project", true);
    expect(result.type).toBe("started");
    if (result.type !== "started") return;
    openAdaptorServers.push(result.server);
    // A no-host listen() binds the unspecified address (`::`/`0.0.0.0`),
    // exposing the studio API to the LAN. The fix must default to loopback.
    expect(boundAddress(result.server)).toBe("127.0.0.1");
  });

  it("honours an explicit bindHost when the operator opts in to LAN exposure", async () => {
    const port = await allocFreePort();
    const result = await findPortAndServe(
      okFetch,
      port,
      "/tmp/demo-project",
      true,
      null,
      "0.0.0.0",
    );
    expect(result.type).toBe("started");
    if (result.type !== "started") return;
    openAdaptorServers.push(result.server);
    expect(boundAddress(result.server)).toBe("0.0.0.0");
  });
});

describe("detectHyperframesServer", () => {
  it("treats same-project servers with a different server build signature as mismatch", async () => {
    const projectDir = "/tmp/demo-project";
    const port = await startConfigProbeServer({
      isHyperframes: true,
      projectName: "demo-project",
      projectDir,
      serverBuildSignature: "old-build",
      version: "0.6.42",
    });

    const normalizedProjectDir = resolve(projectDir).replace(/\\/g, "/").toLowerCase();
    const result = await detectHyperframesServer(port, normalizedProjectDir, "new-build");

    expect(result).toEqual({ type: "mismatch", projectName: "demo-project" });
  });

  it("treats same-project servers with the same server build signature as match", async () => {
    const projectDir = "/tmp/demo-project";
    const port = await startConfigProbeServer({
      isHyperframes: true,
      projectName: "demo-project",
      projectDir,
      serverBuildSignature: "same-build",
      version: "0.6.42",
    });

    const normalizedProjectDir = resolve(projectDir).replace(/\\/g, "/").toLowerCase();
    const result = await detectHyperframesServer(port, normalizedProjectDir, "same-build");

    expect(result).toEqual({ type: "match" });
  });
});
