// @vitest-environment node
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudioApi } from "../createStudioApi";
import { DELETED_VERSION, fileContentVersion, identifyFileWrite } from "../helpers/fileVersion";
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
  return (path: string, body?: object, headers?: Record<string, string>) =>
    api.request(
      `/projects/demo/history${path}`,
      body ? { method: "POST", body: JSON.stringify(body), headers } : undefined,
    );
}

/** A project whose index.html reads "A", with its history and the routes over it. */
async function demoProject() {
  const projectDir = tempDir("hf-history-routes-");
  writeFileSync(join(projectDir, "index.html"), "A");
  const history = await openProjectHistory({
    projectDir,
    historyRoot: tempDir("hf-history-routes-root-"),
  });
  cleanup.push(() => history.close());
  return { projectDir, history, call: apiFor(projectDir, history) };
}

describe("history routes", () => {
  it("record a Studio edit window as the person's entry, and step back undoes it", async () => {
    const { projectDir, call } = await demoProject();

    const { windowId } = await (await call("/window", { label: "Moved Title" })).json();
    writeFileSync(join(projectDir, "index.html"), "B");
    const { entry } = await (await call(`/window/${windowId}/close`, {})).json();
    expect(entry).toMatchObject({ label: "Moved Title", who: { kind: "person", name: "You" } });

    const step = await (await call("/step", { direction: "back" })).json();
    expect(step).toMatchObject({ ok: true, entry: { label: "Undid: Moved Title" } });
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe("A");
    expect((await (await call("")).json()).entries).toHaveLength(2);
  });

  it("record an agent that names itself as the writer of its window and of its undo", async () => {
    const { projectDir, call } = await demoProject();
    const agent = { kind: "agent", name: "Claude" };

    const { windowId } = await (
      await call("/window", { label: "Bigger title", who: agent })
    ).json();
    writeFileSync(join(projectDir, "index.html"), "B");
    const { entry } = await (await call(`/window/${windowId}/close`, {})).json();
    expect(entry.who).toEqual(agent);

    const undo = await (await call("/undo", { entryId: windowId, who: agent })).json();
    expect(undo.entry).toMatchObject({ who: agent, label: "Undid: Bigger title" });
    const restore = await (await call("/restore", { point: windowId, who: { name: "x" } })).json();
    expect(restore.who, "only an agent names itself").toEqual({ kind: "person", name: "You" });
  });

  it("serve a kept file's bytes by hash, and nothing for a hash that is not one", async () => {
    const { projectDir, call } = await demoProject();
    const { windowId } = await (await call("/window", { label: "Edit" })).json();
    writeFileSync(join(projectDir, "index.html"), "B");
    const { entry } = await (await call(`/window/${windowId}/close`, {})).json();

    expect(await (await call(`/blob/${entry.files[0].before}`)).text()).toBe("A");
    expect((await call(`/blob/${"0".repeat(64)}`)).status).toBe(404);
    expect((await call("/blob/..%2F..%2Fetc")).status).toBe(404);
  });

  it("name what Cmd+Z and Cmd+Shift+Z would revert next", async () => {
    const { projectDir, call } = await demoProject();
    expect(await (await call("")).json()).toMatchObject({ back: null, forward: null });

    const { windowId } = await (await call("/window", { label: "Moved Title" })).json();
    writeFileSync(join(projectDir, "index.html"), "B");
    await call(`/window/${windowId}/close`, {});
    expect(await (await call("")).json()).toMatchObject({
      back: { id: windowId, label: "Moved Title", paths: ["index.html"] },
      forward: null,
    });

    await call("/step", { direction: "back" });
    expect(await (await call("")).json()).toMatchObject({
      back: null,
      forward: { label: "Undid: Moved Title" },
    });
  });

  it("name the step the engine takes when it steps past an entry whose file moved on", async () => {
    const { projectDir, history, call } = await demoProject();
    const write = (text: string) => writeFileSync(join(projectDir, "index.html"), text);
    const agent = { kind: "agent" as const, name: "Agent" };
    const you = { kind: "person" as const, name: "You" };
    const window = await history.beginWindow(agent, "Agent turn");
    write("B");
    await history.claim(you, "sweep", []);
    write("C");
    await history.claim(you, "Dragged Title", ["index.html"], {
      coalesceKey: "drag",
      idleMs: 60_000,
      overwrote: { "index.html": fileContentVersion("B") },
    });
    write("D");
    await window.close();
    await history.flush();
    expect((await (await call("")).json()).back).toMatchObject({ label: "Agent turn" });
  });

  it("label an undo's writes with Studio's write token, so their echo reads as Studio's own", async () => {
    const { projectDir, call } = await demoProject();
    writeFileSync(join(projectDir, "index.html"), "B");
    await call("/claim", { label: "Moved Title", paths: ["index.html"] });
    await call("/step", { direction: "back" }, { "X-Hyperframes-Write-Token": "studio-1" });
    expect(readFileSync(join(projectDir, "index.html"), "utf8")).toBe("A");
    expect(
      identifyFileWrite(join(projectDir, "index.html"), fileContentVersion("A")),
    ).toMatchObject({
      path: "index.html",
      writeToken: "studio-1",
    });
  });

  it("label a deletion an undo makes with Studio's write token too", async () => {
    const { projectDir, call } = await demoProject();
    writeFileSync(join(projectDir, "extra.html"), "added");
    await call("/claim", { label: "Added a section", paths: ["extra.html"] });
    await call("/step", { direction: "back" }, { "X-Hyperframes-Write-Token": "studio-2" });
    expect(existsSync(join(projectDir, "extra.html"))).toBe(false);
    expect(identifyFileWrite(join(projectDir, "extra.html"), DELETED_VERSION)).toMatchObject({
      writeToken: "studio-2",
    });
  });

  it("cap a window's idle time at ten minutes, and pass the version Studio overwrote to its claim", async () => {
    const { history, call } = await demoProject();
    const beginWindow = vi.spyOn(history, "beginWindow");
    const claim = vi.spyOn(history, "claim");
    await call("/window", { label: "Dragged", idleMs: 1e12 });
    expect(beginWindow).toHaveBeenCalledWith(expect.anything(), "Dragged", { idleMs: 600_000 });
    await call("/claim", {
      label: "Moved",
      paths: ["index.html"],
      overwrote: { "index.html": "v", x: 1 },
    });
    expect(claim).toHaveBeenCalledWith(expect.anything(), "Moved", ["index.html"], {
      overwrote: { "index.html": "v" },
    });
  });

  it("claim what Studio just wrote as the person's entry, under the edit's label", async () => {
    const { projectDir, call } = await demoProject();
    writeFileSync(join(projectDir, "index.html"), "B");
    const { claimed } = await (
      await call("/claim", { label: "Moved Title", paths: ["index.html", 7] })
    ).json();
    const { entries, back } = await (await call("")).json();
    expect(entries).toMatchObject([{ id: claimed.id, label: "Moved Title", who: { name: "You" } }]);
    expect(back).toMatchObject({ id: claimed.id, label: "Moved Title" });
  });

  it("end a window given idleMs by itself once its writes stop", async () => {
    const { projectDir, call } = await demoProject();

    const { windowId } = await (
      await call("/window", { label: "Dragged Title", idleMs: 50 })
    ).json();
    writeFileSync(join(projectDir, "index.html"), "B");
    await vi.waitFor(
      async () =>
        expect((await (await call("")).json()).entries).toMatchObject([{ label: "Dragged Title" }]),
      { timeout: 2_000, interval: 50 },
    );
    const { entry } = await (await call(`/window/${windowId}/close`, {})).json();
    expect(entry).toMatchObject({ id: windowId, label: "Dragged Title" });
  });

  it("refuse to close a window through another project's route", async () => {
    const projects = new Map<string, { dir: string; history: ProjectHistory }>();
    for (const id of ["demo", "other"]) {
      const dir = tempDir("hf-history-routes-");
      writeFileSync(join(dir, "index.html"), "A");
      const history = await openProjectHistory({
        projectDir: dir,
        historyRoot: tempDir("hf-history-routes-root-"),
      });
      cleanup.push(() => history.close());
      projects.set(id, { dir, history });
    }
    const api = createStudioApi({
      listProjects: () => [],
      resolveProject: (id: string) =>
        projects.has(id) ? { id, dir: projects.get(id)!.dir } : null,
      history: (project: { id: string }) => projects.get(project.id)!.history,
    } as unknown as StudioApiAdapter);
    const post = (id: string, path: string, body: object) =>
      api.request(`/projects/${id}/history${path}`, { method: "POST", body: JSON.stringify(body) });

    const { windowId } = await (await post("demo", "/window", { label: "Moved Title" })).json();
    expect((await post("other", `/window/${windowId}/close`, {})).status).toBe(409);
    expect((await post("demo", `/window/${windowId}/close`, {})).status).toBe(200);
  });

  it("answer 404 when the host keeps no history for the project", async () => {
    const call = apiFor(tempDir("hf-history-routes-none-"));
    expect((await call("")).status).toBe(404);
  });
});
