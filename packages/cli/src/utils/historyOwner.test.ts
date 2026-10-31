import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { MAX_PORT_SCAN } from "../server/portUtils.js";
import { historyDeps, withOwner } from "./historyOwner.js";

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  onTestFinished(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function listenOn(port: number): Promise<Server | null> {
  return new Promise((resolveListen) => {
    const server = createServer((socket) => socket.destroy());
    server.once("error", () => resolveListen(null));
    server.listen(port, "127.0.0.1", () => resolveListen(server));
  });
}

async function listenerInScanRange(): Promise<{ connections: () => number }> {
  for (let port = 3002; port < 3002 + MAX_PORT_SCAN; port++) {
    const server = await listenOn(port);
    if (!server) continue;
    let count = 0;
    server.on("connection", () => count++);
    onTestFinished(() => new Promise<void>((done) => server.close(() => done())));
    return { connections: () => count };
  }
  throw new Error("no free port in the preview scan range");
}

async function openHistory(): Promise<string> {
  const dir = tempDir("hf-history-owner-");
  writeFileSync(join(dir, "index.html"), "A");
  historyDeps.historyRoot = tempDir("hf-history-owner-root-");
  return withOwner(dir, async (owner) => owner.via);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("preview discovery for history", () => {
  it("HYPERFRAMES_NO_PREVIEW_DISCOVERY=1 opens history directly without probing a port", async () => {
    const listener = await listenerInScanRange();
    vi.stubEnv("HYPERFRAMES_NO_PREVIEW_DISCOVERY", "1");

    expect(await openHistory()).toBe("direct");
    expect(listener.connections()).toBe(0);
  });

  it("without it, opening history probes the preview ports", async () => {
    const listener = await listenerInScanRange();
    vi.stubEnv("HYPERFRAMES_NO_PREVIEW_DISCOVERY", undefined);

    expect(await openHistory()).toBe("direct");
    expect(listener.connections()).toBeGreaterThan(0);
  });
});
