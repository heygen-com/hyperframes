// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";
import { ensureHfIds } from "@hyperframes/parsers/hf-ids";
import { encodeElementClipboard } from "@hyperframes/core/element-clipboard";
import { useClipboard } from "./useClipboard";
import { useStableHandlers } from "./useStableHandlers";
import { usePlayerStore } from "../player";

const SOURCE = ensureHfIds(
  '<html><head><style>#card{border:5px solid red}</style></head><body><div data-composition-id="main" data-duration="10"><div id="card" class="clip" data-start="0" data-duration="5" data-track-index="0">Card</div></div></body></html>',
);
let root: Root | null = null;
afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

function mount() {
  let project = "A";
  const files: Record<string, string> = { A: SOURCE, B: SOURCE };
  const reads: string[] = [];
  const writes: Array<{ project: string; content: string }> = [];
  const history: string[] = [];
  const reloads: string[] = [];
  const toasts: string[] = [];
  const gates: { file: Promise<void> | null; dom: Promise<void> | null; waits: number } = {
    file: null,
    dom: null,
    waits: 0,
  };
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const reload = () => {
    iframe.contentDocument!.open();
    iframe.contentDocument!.write(files[project]!);
    iframe.contentDocument!.close();
  };
  vi.stubGlobal("fetch", async (url: string) => {
    const pid = String(url).match(/\/projects\/([^/]+)\/files\//)?.[1];
    if (!pid || !(pid in files)) throw new Error(`Unexpected file request ${url}`);
    reads.push(pid);
    if (gates.file) await gates.file;
    return new Response(JSON.stringify({ content: files[pid] }));
  });
  let api: ReturnType<typeof useClipboard> | null = null;
  function Harness() {
    const pid = project;
    const handlers = useStableHandlers(
      {
        writeProjectFile: async (_path: string, content: string, expected?: string) => {
          if (expected !== undefined && expected !== files[pid])
            throw new Error("Content conflict");
          files[pid] = content;
          writes.push({ project: pid, content });
        },
        recordEdit: async () => {
          history.push(pid);
        },
        reloadPreview: () => {
          reloads.push(pid);
        },
      },
      pid,
    );
    api = useClipboard({
      projectId: pid,
      activeCompPath: "index.html",
      ...handlers,
      domEditSelectionRef: { current: null },
      previewIframeRef: { current: iframe },
      showToast: (message) => {
        toasts.push(message);
      },
      waitForPendingDomEditSaves: async () => {
        gates.waits++;
        if (gates.dom) await gates.dom;
      },
      handleTimelineElementsDelete: async () => {},
      handleDomEditElementDelete: async () => {},
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  const render = () => act(() => root?.render(<Harness />));
  render();
  reload();
  const card = iframe.contentDocument!.getElementById("card")!;
  usePlayerStore.setState({
    currentTime: 0,
    elements: [
      {
        id: "card",
        domId: "card",
        hfId: card.getAttribute("data-hf-id")!,
        tag: "div",
        start: 0,
        duration: 5,
        track: 0,
        sourceFile: "index.html",
      },
    ],
    selectedElementId: "card",
    selectedElementIds: new Set(["card"]),
  });
  return {
    api: () => api!,
    files,
    reads,
    writes,
    history,
    reloads,
    toasts,
    gates,
    navigate: (pid: string) => {
      project = pid;
      render();
      reload();
    },
  };
}

it.each([
  { projects: ["B"], external: false },
  { projects: ["B", "A"], external: false },
  { projects: ["B"], external: true },
  { projects: ["A"], external: false },
])(
  "keeps one paste project epoch through native read: $projects external=$external",
  async ({ projects, external }) => {
    const view = mount();
    let finishRead: (text: string) => void = () => {};
    const pending = new Promise<string>((resolve) => {
      finishRead = resolve;
    });
    const readText = vi
      .fn()
      .mockResolvedValueOnce("ordinary text")
      .mockImplementationOnce(() => pending);
    vi.stubGlobal("navigator", { clipboard: { readText } });
    expect(view.api().handleCopy()).toBe(true);
    await vi.waitFor(() => expect(view.toasts).toContain("Copied clip"));
    view.reads.length = 0;
    const paste = view.api().handlePaste();
    for (const project of projects) view.navigate(project);
    finishRead(
      external
        ? encodeElementClipboard({
            html: "<div>External</div>",
            css: "",
            width: 100,
            height: 50,
            warnings: [],
          })
        : "ordinary text",
    );
    await paste;
    console.log(
      JSON.stringify({
        projects,
        external,
        reads: view.reads,
        writes: view.writes.map((write) => ({
          project: write.project,
          carriedRule: write.content.includes("#card-2"),
        })),
        history: view.history,
      }),
    );
    if (projects.includes("B")) {
      expect(view.files).toEqual({ A: SOURCE, B: SOURCE });
      expect(view.writes).toEqual([]);
      expect(view.history).toEqual([]);
      expect(view.reloads).toEqual([]);
      expect(usePlayerStore.getState().selectedElementId).toBe("card");
    } else {
      expect(view.writes).toHaveLength(1);
      expect(view.writes[0]!.project).toBe("A");
      expect(view.writes[0]!.content).toContain("#card-2");
      expect(view.history).toEqual(["A"]);
      expect(view.files.B).toBe(SOURCE);
    }
  },
);

it.each([
  { external: false, phase: "file" },
  { external: true, phase: "file" },
  { external: true, phase: "dom" },
] as const)(
  "cancels stale paste before saving across $phase await, external=$external",
  async ({ external, phase }) => {
    const view = mount();
    const readText = vi.fn().mockResolvedValue("ordinary text");
    vi.stubGlobal("navigator", { clipboard: { readText } });
    expect(view.api().handleCopy()).toBe(true);
    await vi.waitFor(() => expect(view.toasts).toContain("Copied clip"));
    if (external)
      readText.mockResolvedValue(
        encodeElementClipboard({
          html: "<div>External</div>",
          css: "",
          width: 100,
          height: 50,
          warnings: [],
        }),
      );
    let release: () => void = () => {};
    view.gates[phase] = new Promise<void>((resolve) => {
      release = resolve;
    });
    view.gates.waits = 0;
    view.reads.length = 0;
    const paste = view.api().handlePaste();
    await vi.waitFor(() => expect(phase === "file" ? view.reads.length : view.gates.waits).toBe(1));
    view.navigate("B");
    release();
    await paste;
    expect(view.files).toEqual({ A: SOURCE, B: SOURCE });
    expect(view.writes).toEqual([]);
    expect(view.history).toEqual([]);
    expect(view.reloads).toEqual([]);
    expect(usePlayerStore.getState().selectedElementId).toBe("card");
  },
);
