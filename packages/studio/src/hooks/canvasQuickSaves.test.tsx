// @vitest-environment happy-dom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection, DomEditTextField } from "../components/editor/domEditing";
import type { TimelineElement } from "../player/store/playerStore";
import { buildTimelineMoveTimingPatch, persistTimelineEdit } from "./timelineEditingHelpers";
import { useDomEditCommits } from "./useDomEditCommits";

Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
vi.mock("../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

const SOURCE =
  '<!doctype html><html><head></head><body><div data-hf-id="hf-card" style="color: red">Card</div>' +
  '<div id="clip" class="clip" data-start="1" data-duration="5" data-track-index="0"></div></body></html>';

// The server patches whatever is on disk; the writer refuses a stale base like If-Match does.
// The first write can be held mid-flight.
function fakeProject() {
  let disk = SOURCE;
  const refused: string[] = [];
  let writes = 0;
  let release = () => {};
  const firstWrite = new Promise<void>((resolve) => (release = resolve));
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string, init?: RequestInit) => {
      if (input.includes("/file-mutations/patch-element/")) {
        const { operations } = JSON.parse(String(init?.body)) as {
          operations: Array<{ property?: string; value?: string }>;
        };
        for (const op of operations) {
          if (op.property === "color") disk = disk.replace(/color: \w+/, `color: ${op.value}`);
        }
        return Response.json({ ok: true, changed: true, matched: true, content: disk });
      }
      return Response.json({ content: disk });
    }),
  );
  const writeProjectFile = async (path: string, content: string, expected?: string) => {
    if (++writes === 1) await firstWrite;
    if (expected !== undefined && expected !== disk && content !== disk) {
      refused.push(path);
      throw new Error(`409 conflict on ${path}`);
    }
    disk = content;
  };
  return { writeProjectFile, refused, release: () => release(), read: () => disk };
}

type Project = ReturnType<typeof fakeProject>;

function mountCanvasCommits(project: Project) {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  iframe.contentDocument!.body.innerHTML =
    '<div data-hf-id="hf-card" style="color: red">Card</div>';
  const element = iframe.contentDocument!.querySelector<HTMLElement>('[data-hf-id="hf-card"]')!;
  const selection = {
    element,
    label: "Card",
    tagName: "div",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 0, y: 0, width: 120, height: 40 },
    textContent: "Card",
    dataAttributes: {},
    inlineStyles: { color: "red" },
    computedStyles: {},
    textFields: [],
    capabilities: { canSelect: true, canEditStyles: true, canMove: true, canResize: true },
    hfId: "hf-card",
    selector: '[data-hf-id="hf-card"]',
    selectorIndex: 0,
  } as unknown as DomEditSelection;
  const captured: { current: ReturnType<typeof useDomEditCommits> | null } = { current: null };
  const toasts: string[] = [];
  function Probe() {
    captured.current = useDomEditCommits({
      activeCompPath: "index.html",
      previewIframeRef: { current: iframe },
      showToast: (message) => toasts.push(message),
      queueDomEditSave: (save) => save(),
      writeProjectFile: project.writeProjectFile,
      editHistory: { recordEdit: async () => {} },
      fileTree: [],
      importedFontAssetsRef: { current: [] },
      projectId: "p1",
      projectIdRef: { current: "p1" },
      reloadPreview: () => {},
      domEditSelection: selection,
      applyDomSelection: () => {},
      clearDomSelection: () => {},
      refreshDomEditSelectionFromPreview: () => {},
      buildDomSelectionFromTarget: async () => null,
      readOnlyPreview: false,
    });
    return null;
  }
  const root = createRoot(document.createElement("div"));
  act(() => root.render(createElement(Probe)));
  return { hook: captured.current!, selection, toasts };
}

const selfText: DomEditTextField = {
  key: "self",
  label: "self",
  value: "Card",
  tagName: "div",
  attributes: [],
  inlineStyles: {},
  computedStyles: {},
  source: "self",
};

const moveClip = (project: Project) =>
  persistTimelineEdit({
    projectId: "p1",
    activeCompPath: "index.html",
    element: {
      id: "clip",
      key: "clip",
      domId: "clip",
      tag: "div",
      start: 1,
      duration: 5,
      track: 0,
    } as TimelineElement,
    label: "Move clip",
    buildPatches: (original, target) => buildTimelineMoveTimingPatch(original, target, 3, 5),
    writeProjectFile: project.writeProjectFile,
    recordEdit: async () => {},
    pendingTimelineEditPathRef: { current: new Set<string>() },
  });

// Starts the second save while the first one's write is in flight; both must land unrefused.
async function expectBothLand(
  project: Project,
  first: () => Promise<unknown>,
  second: () => Promise<unknown>,
) {
  await act(async () => {
    const saves = [first()];
    await new Promise((resolve) => setTimeout(resolve, 0));
    saves.push(second());
    await new Promise((resolve) => setTimeout(resolve, 0));
    project.release();
    await Promise.allSettled(saves);
  });
  expect(project.refused).toEqual([]);
}

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("canvas edit commits share the file queue", () => {
  it("lands a second canvas commit started while the first one's font write is held", async () => {
    const project = fakeProject();
    const { hook, selection, toasts } = mountCanvasCommits(project);
    const font = {
      family: "Imported",
      path: "fonts/Imported.woff2",
      url: "/api/projects/p1/preview/fonts/Imported.woff2",
    };

    await expectBothLand(
      project,
      () => hook.commitDomTextFields(selection, [selfText], { importedFont: font }),
      () => hook.handleDomStyleCommit("color", "green"),
    );

    expect(toasts).toEqual([]);
    expect(project.read()).toContain("@font-face");
    expect(project.read()).toContain("color: green");
  });

  it("lands a canvas commit started while a timeline save is writing", async () => {
    const project = fakeProject();
    const { hook, toasts } = mountCanvasCommits(project);

    await expectBothLand(
      project,
      () => moveClip(project),
      () => hook.handleDomStyleCommit("color", "green"),
    );

    expect(toasts).toEqual([]);
    expect(project.read()).toContain('id="clip" class="clip" data-start="3"');
    expect(project.read()).toContain("color: green");
  });
});
