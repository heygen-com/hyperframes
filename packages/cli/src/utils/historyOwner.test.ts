import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer as createHttpServer } from "node:http";
import type { AddressInfo } from "node:net";
import { createServer, type Server } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, onTestFinished, vi } from "vitest";
import { MAX_PORT_SCAN } from "../server/portUtils.js";
import { endTurn, historyDeps, withOwner, type Turn } from "./historyOwner.js";

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

async function recordingPreview(): Promise<{ port: number; paths: string[] }> {
  const paths: string[] = [];
  const server = createHttpServer((request, response) => {
    paths.push(request.url ?? "");
    response.setHeader("content-type", "application/json");
    response.end(JSON.stringify({ entries: [], entry: null }));
  });
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", () => listening()));
  onTestFinished(() => new Promise<void>((done) => server.close(() => done())));
  return { port: (server.address() as AddressInfo).port, paths };
}

function projectWithMarker(id: string): string {
  const dir = tempDir("hf-history-marker-");
  writeFileSync(join(dir, "index.html"), "A");
  mkdirSync(join(dir, ".hyperframes"), { recursive: true });
  const marker = { via: "preview", id, who: { kind: "agent", name: "Agent" }, label: "Edit" };
  writeFileSync(
    join(dir, ".hyperframes", "history-turn.json"),
    JSON.stringify({ ...marker, startedAt: 1, lastWriteAt: 2, parts: [] }),
  );
  return dir;
}

describe("history turn markers from the project folder", () => {
  const original = historyDeps.findServer;
  afterEach(() => {
    historyDeps.findServer = original;
  });

  it.each(["../../files/index.html", "%2e%2e/%2e%2e/files", "x?y", "x#y"])(
    "refuses a marker whose id is %s",
    async (id) => {
      const preview = await recordingPreview();
      historyDeps.findServer = async () => ({ port: preview.port, projectName: "p" }) as never;

      expect(await withOwner(projectWithMarker(id), async (_owner, turn) => turn)).toBeNull();
    },
  );

  it("sends a turn id only as one encoded path segment of its own close route", async () => {
    const preview = await recordingPreview();
    historyDeps.findServer = async () => ({ port: preview.port, projectName: "p" }) as never;
    const dir = projectWithMarker("not-read");
    const turn: Turn = {
      via: "preview",
      id: "../../files/x?y#z",
      who: { kind: "agent", name: "Agent" },
      label: "Edit",
      startedAt: 1,
      lastWriteAt: 2,
      parts: [],
    };

    await withOwner(dir, (owner) => endTurn(owner, turn, dir));

    expect(preview.paths).toContain(
      "/api/projects/p/history/window/..%2F..%2Ffiles%2Fx%3Fy%23z/close",
    );
    expect(preview.paths.every((path) => path.startsWith("/api/projects/p/history"))).toBe(true);
  });
});
