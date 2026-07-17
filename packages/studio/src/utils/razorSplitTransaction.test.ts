import { afterEach, describe, expect, it, vi } from "vitest";
import type { TimelineElement } from "../player";
import { buildAtomicCutIntents, runAtomicCutTransaction } from "./razorSplitTransaction";

const element = (over: Partial<TimelineElement> = {}): TimelineElement => ({
  id: "clip",
  domId: "clip",
  tag: "div",
  start: 0,
  duration: 4,
  track: 0,
  timingSource: "authored",
  sourceFile: "index.html",
  ...over,
});

afterEach(() => vi.unstubAllGlobals());

describe("buildAtomicCutIntents", () => {
  it("deduplicates runtime aliases but keeps repeated authored hosts distinct", () => {
    const intents = buildAtomicCutIntents(
      [
        element({ id: "runtime-a", domId: "host-a", hfId: "stable-a" }),
        element({ id: "alias-a", domId: "host-a", hfId: "stable-a" }),
        element({ id: "runtime-b", domId: "host-b", hfId: "stable-b" }),
      ],
      2,
      "index.html",
    );

    expect(intents).toHaveLength(1);
    expect(intents[0].targets).toHaveLength(2);
    expect(intents[0].targets.map((target) => target.originalId)).toEqual(["host-a", "host-b"]);
  });

  it("rebases each nested target into its own source-file coordinates", () => {
    const intents = buildAtomicCutIntents(
      [element({ start: 8, duration: 4, expandedParentStart: 6, sourceFile: "scene.html" })],
      10,
      "index.html",
    );

    expect(intents[0].targets[0]).toMatchObject({ splitTime: 4, elementStart: 2 });
  });
});

function installCutServer(options: { status?: number } = {}) {
  const requests: Array<{ url: string; body?: unknown }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input);
      requests.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
      if (url.includes("/files/")) {
        return new Response(JSON.stringify({ content: "before", version: '"v0"' }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (options.status) {
        return new Response(JSON.stringify({ error: "stale base" }), {
          status: options.status,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(
        JSON.stringify({
          ok: true,
          outcome: "committed",
          files: [
            {
              path: "index.html",
              before: "before",
              after: "after",
              version: '"v1"',
              writeToken: "cut-1",
              splitCount: 1,
              skippedSelectors: [],
            },
          ],
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }),
  );
  return requests;
}

describe("runAtomicCutTransaction", () => {
  it("records canonical snapshots once and performs no client forward write", async () => {
    const requests = installCutServer();
    const writeProjectFile = vi.fn();
    const recordEdit = vi.fn().mockResolvedValue(undefined);
    const observe = vi.fn();
    const synchronize = vi.fn();

    const result = await runAtomicCutTransaction({
      projectId: "launch/demo",
      intents: buildAtomicCutIntents([element()], 2, "index.html"),
      label: "Split timeline clip",
      writeProjectFile,
      recordEdit,
      observeProjectFileVersion: observe,
      synchronize,
    });

    expect(requests.filter((request) => request.url.includes("split-batch"))).toHaveLength(1);
    expect(requests.map((request) => request.url)).toEqual([
      "/api/projects/launch%2Fdemo/files/index.html",
      "/api/projects/launch%2Fdemo/file-mutations/split-batch",
    ]);
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(recordEdit).toHaveBeenCalledWith({
      label: "Split timeline clip",
      kind: "timeline",
      files: { "index.html": { before: "before", after: "after" } },
    });
    expect(observe).toHaveBeenCalledWith("index.html", '"v1"');
    expect(synchronize).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ splitCount: 1, syncFailed: false });
  });

  it("CAS-restores durable bytes when history registration fails", async () => {
    installCutServer();
    const writeProjectFile = vi.fn().mockResolvedValue(undefined);

    await expect(
      runAtomicCutTransaction({
        projectId: "p1",
        intents: buildAtomicCutIntents([element()], 2, "index.html"),
        label: "Split timeline clip",
        writeProjectFile,
        recordEdit: vi.fn().mockRejectedValue(new Error("history unavailable")),
        synchronize: vi.fn(),
      }),
    ).rejects.toThrow("history unavailable");
    expect(writeProjectFile).toHaveBeenCalledTimes(1);
    expect(writeProjectFile).toHaveBeenCalledWith("index.html", "before", "after");
  });

  it("reports an initial version conflict with no history or client write", async () => {
    installCutServer({ status: 409 });
    const writeProjectFile = vi.fn();
    const recordEdit = vi.fn();

    await expect(
      runAtomicCutTransaction({
        projectId: "p1",
        intents: buildAtomicCutIntents([element()], 2, "index.html"),
        label: "Split timeline clip",
        writeProjectFile,
        recordEdit,
        synchronize: vi.fn(),
      }),
    ).rejects.toThrow("Cut conflict");
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(recordEdit).not.toHaveBeenCalled();
  });

  it("keeps a durable recorded cut when synchronization fails", async () => {
    installCutServer();
    const result = await runAtomicCutTransaction({
      projectId: "p1",
      intents: buildAtomicCutIntents([element()], 2, "index.html"),
      label: "Split timeline clip",
      writeProjectFile: vi.fn(),
      recordEdit: vi.fn().mockResolvedValue(undefined),
      synchronize: () => {
        throw new Error("preview unavailable");
      },
    });

    expect(result.syncFailed).toBe(true);
  });
});
