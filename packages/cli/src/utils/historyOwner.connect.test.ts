import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAdaptorServer } from "@hono/node-server";
import {
  createStudioApi,
  openProjectHistory,
  type StudioApiAdapter,
} from "@hyperframes/studio-server";
import { Hono } from "hono";
import { afterEach, describe, expect, it } from "vitest";
import { historyDeps, Refusal, withOwner } from "./historyOwner.js";

const originalRoot = historyDeps.historyRoot;
const originalFindServer = historyDeps.findServer;
const originalWait = historyDeps.ownerWaitMs;
const cleanups: (() => Promise<void> | void)[] = [];

afterEach(async () => {
  historyDeps.historyRoot = originalRoot;
  historyDeps.findServer = originalFindServer;
  historyDeps.ownerWaitMs = originalWait;
  for (const cleanup of cleanups.splice(0)) await cleanup();
});

function project() {
  const dir = mkdtempSync(join(tmpdir(), "hf-owner-version-"));
  historyDeps.historyRoot = mkdtempSync(join(tmpdir(), "hf-owner-version-history-"));
  historyDeps.ownerWaitMs = 50;
  writeFileSync(join(dir, "index.html"), "<html>a</html>");
  cleanups.push(() => {
    rmSync(dir, { recursive: true, force: true });
    rmSync(historyDeps.historyRoot, { recursive: true, force: true });
  });
  return dir;
}

async function serve(
  fetch: (request: Request) => Response | Promise<Response>,
  dir: string,
  version: string,
) {
  const server = createAdaptorServer({ fetch });
  await new Promise<void>((ready) => server.listen(0, "127.0.0.1", ready));
  cleanups.push(() => void server.close());
  const { port } = server.address() as AddressInfo;
  historyDeps.findServer = async () =>
    ({
      port,
      host: "127.0.0.1",
      projectName: "demo",
      projectDir: dir,
      version,
      pid: null,
    }) as never;
  return port;
}

/** A preview holding the project's history; `routeless` drops POST /history/checkpoint, as before 0.8.152. */
async function heldPreview(dir: string, version: string, routeless: boolean) {
  const history = await openProjectHistory({
    projectDir: dir,
    historyRoot: historyDeps.historyRoot,
  });
  cleanups.push(() => history.close());
  const adapter = {
    listProjects: () => [],
    resolveProject: (id: string) => (id === "demo" ? { id, dir } : null),
    history: () => history,
  } as unknown as StudioApiAdapter;
  const api = new Hono().route("/api", createStudioApi(adapter));
  const posted: string[] = [];
  await serve(
    (request) => {
      const { pathname } = new URL(request.url);
      if (request.method === "POST") posted.push(pathname);
      if (routeless && pathname.endsWith("/history/checkpoint"))
        return new Response("Not Found", { status: 404 });
      return api.fetch(request);
    },
    dir,
    version,
  );
  return posted;
}

describe("a preview older than the history routes this CLI calls", () => {
  it("is not adopted: the CLI says which preview is too old and how to restart it", async () => {
    const dir = project();
    const posted = await heldPreview(dir, "0.8.151", true);

    const run = withOwner(dir, async (owner) => owner.checkpoint());

    await expect(run).rejects.toBeInstanceOf(Refusal);
    await expect(run).rejects.toThrow(/v0\.8\.151.*older than this CLI.*hyperframes preview/s);
    expect(posted).toEqual([]);
  });

  it("is passed over for the CLI's own history when it does not hold the project", async () => {
    const dir = project();
    await serve(
      (request) =>
        new URL(request.url).pathname.endsWith("/history")
          ? Response.json({ entries: [] })
          : new Response("Not Found", { status: 404 }),
      dir,
      "0.8.151",
    );

    await withOwner(dir, async (owner) => {
      expect(owner.via).toBe("direct");
      await owner.checkpoint();
    });
  });

  it("is adopted once it serves the checkpoint route", async () => {
    const dir = project();
    const posted = await heldPreview(dir, "0.8.152", false);

    await withOwner(dir, async (owner) => {
      expect(owner.via).toBe("preview");
      await owner.checkpoint();
    });

    expect(posted.some((path) => path.endsWith("/history/checkpoint"))).toBe(true);
  });
});
