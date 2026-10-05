// @vitest-environment node
// fallow-ignore-file code-duplication
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createStudioApi } from "../createStudioApi";
import { DELETED_VERSION, fileContentVersion, identifyFileWrite } from "../helpers/fileVersion";
import { openProjectHistory, type ProjectHistory } from "../history/projectHistory";
import { START } from "../history/historyLog";
import { historyCache } from "../history/historyCache";
import { createProjectSignature, resolveProjectSignature } from "../helpers/projectSignature";
import type { StudioApiAdapter } from "../types";

// Media copies wait on `held`, so a test can keep the first open's media copy running.
const mediaCopy = vi.hoisted(() => ({ held: null as Promise<void> | null }));
vi.mock("../history/blobStore", async (importOriginal) => {
  const real = await importOriginal<typeof import("../history/blobStore")>();
  return {
    ...real,
    openBlobStore: async (dir: string) => {
      const store = await real.openBlobStore(dir);
      return {
        ...store,
        put: async (path: string) => {
          if (path.endsWith(".mp4")) await mediaCopy.held;
          return store.put(path);
        },
      };
    },
  };
});

const cleanup: Array<() => unknown> = [];

afterEach(async () => {
  mediaCopy.held = null;
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

/** A project whose index.html reads "A", its history opened on first use as both hosts do. */
function lazyHistoryProject() {
  const projectDir = tempDir("hf-history-first-write-");
  const file = join(projectDir, "index.html");
  writeFileSync(file, "A");
  const historyRoot = tempDir("hf-history-first-write-root-");
  const histories = historyCache((dir) => openProjectHistory({ projectDir: dir, historyRoot }));
  cleanup.push(() => histories.closeAll());
  const api = createStudioApi({
    listProjects: () => [],
    resolveProject: (id: string) => (id === "demo" ? { id, dir: projectDir } : null),
    history: (project: { dir: string }) => histories.get(project.dir),
  } as unknown as StudioApiAdapter);
  const post = (path: string, body: object) =>
    api.request(`/projects/demo/history${path}`, { method: "POST", body: JSON.stringify(body) });
  const put = (content: string) =>
    api.request("/projects/demo/files/index.html", {
      method: "PUT",
      body: content,
      headers: { "If-Match": fileContentVersion("A") },
    });
  return { projectDir, file, histories, api, post, put };
}

async function claimFirstWrite(post: ReturnType<typeof lazyHistoryProject>["post"]) {
  const reply = await post("/claim", {
    label: "Color",
    paths: ["index.html"],
    overwrote: { "index.html": fileContentVersion("A") },
  });
  return ((await reply.json()) as { claimed: unknown }).claimed;
}

/** A project whose index.html reads "A", with its history and the routes over it. */
async function demoProject({ quietMs }: { quietMs?: number } = {}) {
  const projectDir = tempDir("hf-history-routes-");
  writeFileSync(join(projectDir, "index.html"), "A");
  const history = await openProjectHistory({
    projectDir,
    historyRoot: tempDir("hf-history-routes-root-"),
    ...(quietMs && { quietMs }),
  });
  cleanup.push(() => history.close());
  return { projectDir, history, call: apiFor(projectDir, history) };
}

describe("history routes", () => {
  it.each([
    ["outside", 0],
    ["agent turn", 0],
    ["outside", 11_000],
    ["agent turn", 11_000],
  ])(
    "keep the %s write that landed between Studio's read and its patch when Studio's edit is undone (claim %d ms later)",
    async (writer, claimDelayMs) => {
      const projectDir = tempDir("hf-history-outside-patch-");
      const file = join(projectDir, "index.html");
      writeFileSync(file, '<h1 id="title">A</h1>');
      const history = await openProjectHistory({
        projectDir,
        historyRoot: tempDir("hf-history-outside-patch-root-"),
      });
      cleanup.push(() => history.close());
      const call = apiFor(projectDir, history);
      const api = createStudioApi({
        listProjects: () => [],
        resolveProject: (id: string) => (id === "demo" ? { id, dir: projectDir } : null),
        history: () => history,
      } as unknown as StudioApiAdapter);

      const studioRead = readFileSync(file, "utf-8");
      const turn =
        writer === "agent turn"
          ? await history.beginWindow({ kind: "agent", name: "Agent" }, "Agent turn")
          : null;
      writeFileSync(file, '<h1 id="title">B</h1>');
      const patched = await api.request("/projects/demo/file-mutations/patch-element/index.html", {
        method: "POST",
        body: JSON.stringify({
          target: { id: "title" },
          operations: [{ type: "inline-style", property: "color", value: "red" }],
        }),
      });
      expect(await patched.json()).toMatchObject({ ok: true, changed: true });
      if (claimDelayMs) {
        vi.useFakeTimers({ toFake: ["Date"], now: Date.now() + claimDelayMs });
        cleanup.push(() => vi.useRealTimers());
      }
      await call("/claim", {
        label: "Color",
        paths: ["index.html"],
        overwrote: { "index.html": fileContentVersion(studioRead) },
      });

      await turn?.close();

      expect(await (await call("/step", { direction: "back" })).json()).toMatchObject({ ok: true });
      expect(readFileSync(file, "utf-8")).toBe('<h1 id="title">B</h1>');
    },
  );

  it("drop the host's cached signature before an undo answers, so the next preview is the restored build", async () => {
    const { projectDir, history } = await demoProject();
    let cached: string | null = null;
    const adapter = {
      listProjects: () => [],
      resolveProject: (id: string) => (id === "demo" ? { id, dir: projectDir } : null),
      history: () => history,
      getProjectSignature: (dir: string) => (cached ??= createProjectSignature(dir)),
      invalidateProjectSignature: () => (cached = null),
    } as unknown as StudioApiAdapter;
    const api = createStudioApi(adapter);
    const call = (path: string, body: object) =>
      api.request(`/projects/demo/history${path}`, { method: "POST", body: JSON.stringify(body) });
    const { windowId } = await (await call("/window", { label: "Retitle" })).json();
    writeFileSync(join(projectDir, "index.html"), "Bee");
    await call(`/window/${windowId}/close`, {});
    // A thumbnail request caches the edited build's signature; the watcher that clears it lags the undo.
    const edited = resolveProjectSignature(adapter, projectDir);

    expect(await (await call("/step", { direction: "back" })).json()).toMatchObject({ ok: true });
    expect(readFileSync(join(projectDir, "index.html"), "utf-8")).toBe("A");
    expect(resolveProjectSignature(adapter, projectDir)).not.toBe(edited);
  });

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
    const outsideHistory = `${"../".repeat(40)}${projectDir.slice(1)}/index.html`;
    const { windowId } = await (await call("/window", { label: "Edit" })).json();
    writeFileSync(join(projectDir, "index.html"), "B");
    const { entry } = await (await call(`/window/${windowId}/close`, {})).json();

    expect(await (await call(`/blob/${entry.files[0].before}`)).text()).toBe("A");
    expect((await call(`/blob/${"0".repeat(64)}`)).status).toBe(404);
    expect((await call(`/blob/${encodeURIComponent(outsideHistory)}`)).status).toBe(404);
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

  it("name the person's own newest change, not an agent's later write", async () => {
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
    expect((await (await call("")).json()).back).toMatchObject({ label: "Dragged Title" });
  });

  it.each([
    ["a save that landed between Studio's read and its write", ["save B", "patch"], "B"],
    ["its start, when Studio wrote the edit as two patches", ["patch", "patch"], "A"],
    ["a save before Studio's patch and its whole-file follow-up", ["save B", "patch", "put"], "B"],
    [
      "its start, when Studio's patches came back to earlier bytes",
      ["patch", "patch", "unpatch"],
      "A",
    ],
  ])("undo Studio's element edit back to %s", async (_, steps, undoneTo) => {
    const { projectDir, history } = await demoProject();
    const index = join(projectDir, "index.html");
    const saved = (text: string) => `<h1 id="title">${text}</h1>`;
    writeFileSync(index, saved("A"));
    await history.flush();
    const api = createStudioApi({
      listProjects: () => [],
      resolveProject: (id: string) => (id === "demo" ? { id, dir: projectDir } : null),
      history: () => history,
    } as unknown as StudioApiAdapter);
    const post = (path: string, body: object) =>
      api.request(`/projects/demo${path}`, { method: "POST", body: JSON.stringify(body) });

    let zIndex = 1;
    for (const step of steps) {
      if (step === "save B") writeFileSync(index, saved("B"));
      const current = readFileSync(index, "utf-8");
      const written =
        step === "patch" || step === "unpatch"
          ? await post("/file-mutations/patch-element/index.html", {
              target: { id: "title" },
              operations: [
                {
                  type: "inline-style",
                  property: "z-index",
                  value: String(step === "patch" ? ++zIndex : --zIndex),
                },
              ],
            })
          : step === "put"
            ? await api.request("/projects/demo/files/index.html", {
                method: "PUT",
                headers: { "If-Match": fileContentVersion(current) },
                body: `${current}<style>@font-face{}</style>`,
              })
            : null;
      expect(written?.status ?? 200).toBe(200);
    }
    await post("/history/claim", {
      label: "Moved Title",
      paths: ["index.html"],
      overwrote: { "index.html": fileContentVersion(saved("A")) },
    });
    expect(await (await post("/history/step", { direction: "back" })).json()).toMatchObject({
      ok: true,
      entry: { label: "Undid: Moved Title" },
    });
    expect(readFileSync(index, "utf-8")).toBe(saved(undoneTo));
  });

  it("hold a gesture claimed without idleMs until another key, however long it pauses", async () => {
    const { projectDir, history, call } = await demoProject({ quietMs: 30 });
    const drag = (text: string) => {
      writeFileSync(join(projectDir, "index.html"), text);
      return call("/claim", {
        label: "Dragged Title",
        paths: ["index.html"],
        coalesceKey: "drag",
        idleMs: null,
      });
    };
    await drag("B");
    await new Promise((resolve) => setTimeout(resolve, 150));
    await drag("C");
    await history.flush();
    expect(history.list().map((entry) => entry.label)).toEqual(["Dragged Title"]);
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

  it("undo Studio's first write when that write is what opens the project's history", async () => {
    const { file, put, post } = lazyHistoryProject();

    expect((await put("B")).status).toBe(200);
    expect(await claimFirstWrite(post)).not.toBeNull();
    expect(await (await post("/step", { direction: "back" })).json()).toMatchObject({ ok: true });
    expect(readFileSync(file, "utf-8")).toBe("A");
  });

  it("save and undo the first edit while the project's media is still being copied in", async () => {
    let finishCopy = () => {};
    mediaCopy.held = new Promise<void>((resolve) => (finishCopy = resolve));
    const { projectDir, file, put, post, histories } = lazyHistoryProject();
    writeFileSync(join(projectDir, "clip.mp4"), Buffer.alloc(4 * 1024 ** 2, 7));

    // The copy stays held until finishCopy, so a save or claim that waited on it never returns.
    expect((await put("B")).status).toBe(200);
    expect(await claimFirstWrite(post)).not.toBeNull();
    await post("/step", { direction: "back" });
    expect(readFileSync(file, "utf-8")).toBe("A");

    finishCopy();
    const history = (await histories.get(projectDir))!;
    await vi.waitFor(() => expect(history.peek(START)).toHaveProperty(["clip.mp4"]));
    await history.flush();
    expect(history.list().map((entry) => entry.label)).toEqual(["Color", "Undid: Color"]);
  });

  it("undo Studio's overwrite of media whose first copy was still running", async () => {
    let finishCopy = () => {};
    mediaCopy.held = new Promise<void>((resolve) => (finishCopy = resolve));
    const { projectDir, api, post } = lazyHistoryProject();
    const clip = join(projectDir, "clip.mp4");
    const original = Buffer.alloc(4 * 1024 ** 2, 7);
    writeFileSync(clip, original);
    await post("/claim", { label: "Nothing", paths: [] });

    const written = await api.request("/projects/demo/files/clip.mp4", {
      method: "PUT",
      body: Buffer.alloc(4 * 1024 ** 2, 9),
      headers: { "If-Match": fileContentVersion(original) },
    });
    expect(written.status).toBe(200);
    finishCopy();
    const claimed = await post("/claim", {
      label: "Replace clip",
      paths: ["clip.mp4"],
      overwrote: { "clip.mp4": fileContentVersion(original) },
    });
    expect(((await claimed.json()) as { claimed: unknown }).claimed).not.toBeNull();

    await post("/step", { direction: "back" });
    expect(readFileSync(clip).equals(original)).toBe(true);
  });

  it("adopt media whose copy a restart cut short, rather than log it as added", async () => {
    mediaCopy.held = new Promise<void>(() => {});
    const { projectDir, post, histories } = lazyHistoryProject();
    writeFileSync(join(projectDir, "clip.mp4"), Buffer.alloc(4 * 1024 ** 2, 7));
    await post("/claim", { label: "Nothing", paths: [] });
    await histories.closeAll();
    histories.forget(projectDir);

    mediaCopy.held = null;
    const history = (await histories.get(projectDir))!;
    await vi.waitFor(() => expect(history.peek(START)).toHaveProperty(["clip.mp4"]));
    await history.flush();
    expect(history.list()).toEqual([]);
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
