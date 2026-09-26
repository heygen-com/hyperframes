// @vitest-environment node
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createStudioApi } from "../createStudioApi";
import { openProjectHistory, type ProjectHistory } from "../history/projectHistory";
import type { StudioApiAdapter } from "../types";

const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  for (const step of cleanup.splice(0).reverse()) await step();
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanup.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function apiFor(projectDir: string, history?: ProjectHistory) {
  const adapter = {
    listProjects: () => [],
    resolveProject: (id: string) => (id === "demo" ? { id, dir: projectDir } : null),
    ...(history && { history: () => history }),
  } as unknown as StudioApiAdapter;
  const api = createStudioApi(adapter);
  return (path: string, body?: object) =>
    api.request(
      `/projects/demo/history${path}`,
      body ? { method: "POST", body: JSON.stringify(body) } : undefined,
    );
}

describe("history routes", () => {
  it("record a Studio edit window as the person's entry, and step back undoes it", async () => {
    const projectDir = tempDir("hf-history-routes-");
    writeFileSync(join(projectDir, "index.html"), "A");
    const history = await openProjectHistory({
      projectDir,
      historyRoot: tempDir("hf-history-routes-root-"),
    });
    cleanup.push(() => history.close());
    const call = apiFor(projectDir, history);

    const { windowId } = await (await call("/window", { label: "Moved Title" })).json();
    writeFileSync(join(projectDir, "index.html"), "B");
    const { entry } = await (await call(`/window/${windowId}/close`, {})).json();
    expect(entry).toMatchObject({ label: "Moved Title", who: { kind: "person", name: "You" } });

    const step = await (await call("/step", { direction: "back" })).json();
    expect(step).toMatchObject({ ok: true, entry: { label: "Undid: Moved Title" } });
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe("A");
    expect((await (await call("")).json()).entries).toHaveLength(2);
  });

  it("answer 404 when the host keeps no history for the project", async () => {
    const call = apiFor(tempDir("hf-history-routes-none-"));
    expect((await call("")).status).toBe(404);
  });
});
