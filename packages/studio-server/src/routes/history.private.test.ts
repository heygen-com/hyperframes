// @vitest-environment node
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudioApi } from "../createStudioApi";
import { openProjectHistory } from "../history/projectHistory";
import type { StudioApiAdapter } from "../types";

// While `olderVersion` is set, history judges paths as it did before it skipped private files.
const rule = vi.hoisted(() => ({ olderVersion: false }));
vi.mock("@hyperframes/core/safe-path", async (importOriginal) => {
  const real = await importOriginal<typeof import("@hyperframes/core/safe-path")>();
  return {
    ...real,
    isStudioPrivatePath: (path: string) => !rule.olderVersion && real.isStudioPrivatePath(path),
  };
});

const cleanup: Array<() => unknown> = [];
afterEach(async () => {
  rule.olderVersion = false;
  for (const step of cleanup.splice(0).reverse()) await step();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

const PRIVATE_FILES = ["cert.pem", "server.key", "id_ed25519", "_netrc", "pip.conf"];
const privatePaths = PRIVATE_FILES.flatMap((name) => [name, `keys/${name}`]);
const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

function projectWithKeys() {
  const projectDir = tempDir("hf-history-private-");
  mkdirSync(join(projectDir, "keys"));
  writeFileSync(join(projectDir, "index.html"), "A");
  for (const path of privatePaths) writeFileSync(join(projectDir, path), `secret ${path}`);
  return { projectDir, historyRoot: tempDir("hf-history-private-root-") };
}

async function routesOver(projectDir: string, historyRoot: string) {
  const history = await openProjectHistory({ projectDir, historyRoot });
  cleanup.push(() => history.close());
  const api = createStudioApi({
    listProjects: () => [],
    resolveProject: (id: string) => (id === "demo" ? { id, dir: projectDir } : null),
    history: () => history,
  } as unknown as StudioApiAdapter);
  const call = (path: string, body?: object) =>
    api.request(
      `/projects/demo/history${path}`,
      body ? { method: "POST", body: JSON.stringify(body) } : undefined,
    );
  return { history, call };
}

describe("history and private files", () => {
  it("never names, copies or serves a key or credential file", async () => {
    const { projectDir, historyRoot } = projectWithKeys();
    const { call } = await routesOver(projectDir, historyRoot);

    const { windowId } = await (await call("/window", { label: "Edit" })).json();
    writeFileSync(join(projectDir, "index.html"), "B");
    for (const path of privatePaths) writeFileSync(join(projectDir, path), `rotated ${path}`);
    const { entry } = await (await call(`/window/${windowId}/close`, {})).json();

    expect(Object.keys((await (await call("/peek/start")).json()).files)).toEqual(["index.html"]);
    expect(Object.keys((await (await call(`/peek/${windowId}`)).json()).files)).toEqual([
      "index.html",
    ]);
    expect(entry.files.map((file: { path: string }) => file.path)).toEqual(["index.html"]);
    const listed = JSON.stringify(await (await call("")).json());
    for (const path of privatePaths) expect(listed).not.toContain(path);
    for (const path of privatePaths) {
      expect((await call(`/blob/${sha256(`secret ${path}`)}`)).status).toBe(404);
      expect((await call(`/blob/${sha256(`rotated ${path}`)}`)).status).toBe(404);
    }
    expect(await (await call(`/blob/${sha256("A")}`)).text()).toBe("A");

    expect((await call("/undo", { entryId: windowId })).status).toBe(200);
    expect(await (await call(`/blob/${sha256("B")}`)).text()).toBe("B");
  });

  it("drops private files an older version kept, and no longer serves their copies", async () => {
    const { projectDir, historyRoot } = projectWithKeys();
    rule.olderVersion = true;
    const older = await openProjectHistory({ projectDir, historyRoot });
    expect(Object.keys(older.peek("start") ?? {})).toContain("keys/server.key");
    expect((await older.readBlob(sha256("secret keys/server.key"))).toString()).toBe(
      "secret keys/server.key",
    );
    await older.close();

    rule.olderVersion = false;
    const { call } = await routesOver(projectDir, historyRoot);
    expect(Object.keys((await (await call("/peek/start")).json()).files)).toEqual(["index.html"]);
    for (const path of privatePaths)
      expect((await call(`/blob/${sha256(`secret ${path}`)}`)).status).toBe(404);
    expect(await (await call(`/blob/${sha256("A")}`)).text()).toBe("A");
  });
});
