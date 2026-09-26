import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, win32 } from "node:path";
import { isValidProjectId } from "./src/utils/projectRouting";
import { createStudioApi, type ProjectHistory } from "@hyperframes/studio-server";
import type { ViteDevServer } from "vite";
import { createProjectSignatureCache, createViteAdapter } from "./vite.adapter";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "hf-project-routing-"));
  roots.push(root);
  const data = join(root, "data");
  const sessions = join(root, "sessions");
  mkdirSync(data);
  mkdirSync(sessions);
  // Project resolution does not call Vite's module loader.
  const adapter = createViteAdapter(
    data,
    {} as ViteDevServer,
    createProjectSignatureCache({ compute: () => "test" }),
    { historyRoot: join(root, "history") },
  );
  const app = createStudioApi(adapter);
  return { root, data, sessions, adapter, app };
}

describe("Studio's dev server keeps each project's history", () => {
  it("serves it, so an edit Studio claims is the next undo, and opens it once per project", async () => {
    const { data, adapter, app } = fixture();
    mkdirSync(join(data, "demo"));
    writeFileSync(join(data, "demo", "index.html"), "A");
    const project = adapter.resolveProject("demo")!;
    const history = await adapter.history!(project);
    expect(await adapter.history!(project)).toBe(history);
    try {
      writeFileSync(join(data, "demo", "index.html"), "B");
      const claim = await app.request("http://localhost/projects/demo/history/claim", {
        method: "POST",
        body: JSON.stringify({ label: "Moved Title", paths: ["index.html"] }),
      });
      expect(await claim.json()).toMatchObject({ claimed: { id: expect.any(String) } });
      const list = await app.request("http://localhost/projects/demo/history");
      expect(await list.json()).toMatchObject({ back: { label: "Moved Title" } });
    } finally {
      await history?.close();
    }
  });

  it("opens a new project's own history once it takes the folder's path", async () => {
    const { data, adapter, app } = fixture();
    mkdirSync(join(data, "demo"));
    writeFileSync(join(data, "demo", "index.html"), "A");
    const old = await adapter.history!(adapter.resolveProject("demo")!);
    renameSync(join(data, "demo"), join(data, "demo-moved"));
    mkdirSync(join(data, "demo"));
    writeFileSync(join(data, "demo", "index.html"), "new");

    const list = await app.request("http://localhost/projects/demo/history");
    expect(list.status).toBe(200);
    expect(existsSync(join(data, "demo", ".hyperframes", "history-id"))).toBe(true);
    const fresh = await adapter.history!(adapter.resolveProject("demo")!);
    expect(fresh?.projectId).not.toBe(old?.projectId);
    await fresh?.close();
  });
});

describe("Studio's dev server retries a history whose folder changed while it opened", () => {
  it("opens it again on the next request", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-project-history-retry-"));
    roots.push(root);
    mkdirSync(join(root, "demo"));
    const history = { replacedAtPath: () => false } as unknown as ProjectHistory;
    const openHistory = vi
      .fn()
      .mockRejectedValueOnce(
        Object.assign(new Error("now another project"), { name: "HistoryClosedError" }),
      )
      .mockResolvedValue(history);
    const adapter = createViteAdapter(
      root,
      {} as ViteDevServer,
      createProjectSignatureCache({ compute: () => "test" }),
      { openHistory },
    );
    expect(await adapter.history!(adapter.resolveProject("demo")!)).toBeNull();
    expect(await adapter.history!(adapter.resolveProject("demo")!)).toBe(history);
  });
});

describe("Studio's dev server closes the histories it opened when it stops", () => {
  it("closes each through the opener it was given, so an open edit keeps its label", async () => {
    const root = mkdtempSync(join(tmpdir(), "hf-project-history-close-"));
    roots.push(root);
    mkdirSync(join(root, "demo"));
    const httpServer = new EventEmitter();
    const close = vi.fn(async () => {});
    const openHistory = vi.fn(
      async () => ({ close, replacedAtPath: () => false }) as unknown as ProjectHistory,
    );
    const adapter = createViteAdapter(
      root,
      { httpServer } as unknown as ViteDevServer,
      createProjectSignatureCache({ compute: () => "test" }),
      { openHistory },
    );
    await adapter.history!(adapter.resolveProject("demo")!);
    httpServer.emit("close");
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(openHistory).toHaveBeenCalledOnce();
  });
});

describe("Vite project resolution boundary", () => {
  it.each(["C%3A", "C%3Ademo", "..%2Fsessions", "a%2Fb", "a%5Cb", "%2E%2E%2Fsessions", "a%00b"])(
    "rejects a router-decoded unsafe ID: %s",
    async (id) => {
      const { app } = fixture();
      expect((await app.request(`http://localhost/projects/${id}`)).status).toBe(404);
    },
  );

  it("preserves valid names, session aliases, and explicitly listed symlink projects", async () => {
    const { data, sessions, root, adapter, app } = fixture();
    const id = "..Mañana #1 50%";
    mkdirSync(join(data, id));
    expect((await app.request(`http://localhost/projects/${encodeURIComponent(id)}`)).status).toBe(
      200,
    );
    writeFileSync(join(sessions, "alias.json"), JSON.stringify({ projectId: id, title: "Title" }));
    expect(adapter.resolveProject("alias")?.id).toBe(id);
    const linked = join(root, "linked");
    mkdirSync(linked);
    symlinkSync(linked, join(data, "shortcut"), "junction");
    expect(adapter.resolveProject("shortcut")?.dir).toBe(realpathSync(linked));
  });

  it("rejects drive-relative IDs that Windows resolves as root or sibling aliases", () => {
    expect(win32.resolve("C:\\hf\\data", "C:")).toBe("C:\\hf\\data");
    expect(win32.resolve("C:\\hf\\data", "C:demo")).toBe("C:\\hf\\data\\demo");
    expect(isValidProjectId("C:")).toBe(false);
    expect(isValidProjectId("C:demo")).toBe(false);
  });

  it.skipIf(process.platform === "win32")(
    "does not discover POSIX directory names outside the portable ID contract",
    async () => {
      const { data, adapter } = fixture();
      for (const id of ["valid", "bad\\name", "bad\nname", "C:demo"]) {
        mkdirSync(join(data, id));
        writeFileSync(join(data, id, "index.html"), "<html></html>");
      }
      expect((await adapter.listProjects()).map((project) => project.id)).toEqual(["valid"]);
    },
  );

  it("rejects traversal in a session's project mapping", () => {
    const { sessions, adapter } = fixture();
    writeFileSync(join(sessions, "alias.json"), JSON.stringify({ projectId: "../sessions" }));
    expect(adapter.resolveProject("alias")).toBeNull();
  });
});
