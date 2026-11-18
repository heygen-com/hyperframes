import { createStudioApi } from "@hyperframes/studio-server";
import { IDBFactory } from "fake-indexeddb";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createMemoryExternalConflictStorage,
  deleteExternalConflictSnapshot,
  loadExternalConflictSnapshot,
  persistExternalConflictSnapshot,
  type ExternalConflictSnapshot,
} from "./externalConflictStorage";
import { StudioFileConflictError } from "./studioSaveDiagnostics";

const made: string[] = [];

/** Studio's real API for one project, "demo", answering the store's fetches. */
function serveProject(): string {
  const dir = mkdtempSync(join(tmpdir(), "hf-drafts-"));
  made.push(dir);
  const api = createStudioApi({
    listProjects: () => [],
    resolveProject: async (id: string) => (id === "demo" ? { id, dir, title: "Demo" } : null),
    bundle: async () => null,
    lint: async () => ({ findings: [] }),
    runtimeUrl: "/api/runtime.js",
    rendersDir: () => join(dir, "renders"),
    startRender: () => ({ id: "job", status: "rendering", progress: 0, outputPath: "" }),
  });
  vi.stubGlobal("fetch", (input: string, init?: RequestInit) =>
    api.fetch(new Request(`http://localhost${input.replace(/^\/api/, "")}`, init)),
  );
  return dir;
}

describe("external conflict snapshots", () => {
  beforeEach(() => {
    vi.stubGlobal("indexedDB", new IDBFactory());
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    for (const dir of made.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it("durably records both complete file versions before resolution", async () => {
    const storage = createMemoryExternalConflictStorage();
    const snapshot: ExternalConflictSnapshot = {
      kind: "conflict",
      projectId: "project-a",
      filePath: "index.html",
      externalVersion: "v2",
      externalContent: "external full file",
      studioContent: "studio full file",
      createdAt: 100,
    };

    await storage.set(snapshot);
    expect(await storage.get("project-a", "index.html")).toEqual(snapshot);
    await storage.delete("project-a", "index.html");
    expect(await storage.get("project-a", "index.html")).toBeNull();
  });

  it("records a failed final Studio candidate for remount recovery", async () => {
    const storage = createMemoryExternalConflictStorage();
    const snapshot: ExternalConflictSnapshot = {
      kind: "failed",
      projectId: "project-a",
      filePath: "index.html",
      externalVersion: null,
      externalContent: null,
      studioContent: "recover me",
      failureMessage: "network unavailable",
      createdAt: 101,
    };

    await storage.set(snapshot);
    expect(await storage.get("project-a", "index.html")).toEqual(snapshot);
  });

  it("persists, loads, and deletes a draft through the project's own server", async () => {
    const project = serveProject();
    const conflict = new StudioFileConflictError({
      filePath: "index.html",
      currentVersion: "v2",
      currentContent: "external full file",
      attemptedContent: "studio full file",
    });

    await persistExternalConflictSnapshot("demo", conflict);
    expect(readdirSync(join(project, ".hyperframes", "recovery"))).toHaveLength(1);
    await expect(loadExternalConflictSnapshot("demo", "index.html")).resolves.toMatchObject({
      kind: "conflict",
      projectId: "demo",
      filePath: "index.html",
      externalVersion: "v2",
      externalContent: "external full file",
      studioContent: "studio full file",
    });
    await deleteExternalConflictSnapshot("demo", "index.html");
    await expect(loadExternalConflictSnapshot("demo", "index.html")).resolves.toBeNull();
  });

  // Every project previewed on a port shares the origin's IndexedDB, and so does each one's composition code.
  it("never offers a draft another project's code planted in the browser's shared IndexedDB", async () => {
    serveProject();
    const open = indexedDB.open("hyperframes-studio-external-conflicts", 1);
    open.onupgradeneeded = () => open.result.createObjectStore("file-conflicts");
    const db = await new Promise<IDBDatabase>(
      (resolve) => (open.onsuccess = () => resolve(open.result)),
    );
    const planted = db.transaction("file-conflicts", "readwrite");
    planted.objectStore("file-conflicts").put(
      {
        kind: "failed",
        projectId: "demo",
        filePath: "index.html",
        externalVersion: null,
        externalContent: null,
        studioContent: "<script>planted</script>",
        failureMessage: "Recovered draft",
        createdAt: Date.now(),
      },
      "demo\0index.html",
    );
    await new Promise((resolve) => (planted.oncomplete = resolve));
    db.close();

    await expect(loadExternalConflictSnapshot("demo", "index.html")).resolves.toBeNull();
  });

  it("rejects persistence when the server cannot keep the draft", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 500 }));
    const conflict = new StudioFileConflictError({
      filePath: "index.html",
      currentVersion: "v2",
      currentContent: "external",
      attemptedContent: "studio",
    });

    await expect(persistExternalConflictSnapshot("demo", conflict)).rejects.toThrow(
      "Recovery draft storage failed (500)",
    );
  });
});
