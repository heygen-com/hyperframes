// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { resolveFoundSelection } from "../components/editor/previewSelection";
import { sealedPreviewFrame } from "../player/lib/sealedPreviewFrame.test-helpers";
import { agentPreview } from "./agentPreview";
import { studioSetStyle, studioSetText } from "./tools/contentTools";
import { studioInspect } from "./tools/inspectTools";
import { buildStudioLook, collectStudioLookScene, type StudioLook } from "./tools/lookTools";
import { studioSelect } from "./tools/selectionTools";
import { studioTransform, type StudioTransformResult } from "./tools/transformTools";
import type { StudioSelectResult } from "./tools/selectionTools";
import {
  expectOk,
  lookSnapshot,
  selectionFor,
  sourceHandle,
  studioAgentToolsDeps,
} from "./webmcpTestUtils";

const FIXTURE = `
  <div data-composition-id="main" data-width="1920" data-height="1080">
    <div id="card" class="clip"><h1 id="target">Ship it</h1></div>
  </div>`;
const CONTEXT = { activeCompositionPath: "index.html", isMasterView: false };
const selfTextField = selectionFor(document.createElement("h1")).textFields[0]!;

afterEach(() => {
  document.body.innerHTML = "";
});

/** Studio's agent tools on a sealed preview of FIXTURE, whose #target paints at `box`. */
function sealedStudio() {
  document.body.innerHTML = FIXTURE;
  const target = document.getElementById("target")!;
  const box = { x: 10, y: 20, width: 300, height: 60 };
  target.getBoundingClientRect = () =>
    ({
      ...box,
      top: box.y,
      left: box.x,
      right: box.x + box.width,
      bottom: box.y + box.height,
    }) as DOMRect;
  const { iframe } = sealedPreviewFrame();
  const preview = agentPreview(() => iframe, "index.html");
  const applySelection = vi.fn<(selection: DomEditSelection) => void>();
  const deps = studioAgentToolsDeps({
    preview,
    readNow: preview.readNow,
    getProjectId: () => "project-a",
    buildSelection: (found) => resolveFoundSelection(iframe, found, CONTEXT),
    applySelection,
  });
  return { preview, deps, target, box, applySelection, handle: sourceHandle("target") };
}

describe("agent tools on a sealed preview", () => {
  it("looks at the same scene, with the same handles, as on a live preview", async () => {
    const { preview } = sealedStudio();
    const look = (scene: Awaited<ReturnType<typeof preview.scene>>) =>
      expectOk<StudioLook>(buildStudioLook(lookSnapshot({ projectId: "project-a", scene })));

    const sealed = look(await preview.scene(null));
    const live = look(collectStudioLookScene(document, "index.html", null));

    expect(sealed.sceneStatus).toBe("ready");
    expect(sealed.elements.map((element) => element.handle)).toContain(sourceHandle("target"));
    expect(sealed.elements).toEqual(live.elements);
  });

  it("selects an element by its handle", async () => {
    const { deps, handle, applySelection } = sealedStudio();

    const selected = expectOk<StudioSelectResult>(await studioSelect(deps, handle));

    expect(selected.tagName).toBe("h1");
    expect(selected.box).toEqual({ x: 10, y: 20, width: 300, height: 60 });
    expect(applySelection.mock.calls[0]?.[0].handle).toBeDefined();
  });

  it("inspects an element by its handle", async () => {
    const { deps, handle } = sealedStudio();

    const inspected = expectOk(await studioInspect(deps, { handle }));

    expect(inspected).toMatchObject({ tagName: "h1", text: "Ship it" });
  });

  it("writes a style to an element by its handle", async () => {
    const { deps, handle, target } = sealedStudio();
    const setStyle = vi.fn(
      async (_selection: DomEditSelection, property: string, value: string) => {
        target.style.setProperty(property, value);
        return { ok: true as const };
      },
    );

    const result = await studioSetStyle(
      { ...deps, setStyle },
      { handle, styles: { opacity: "0.5" } },
    );

    expect(result).toMatchObject({ ok: true });
    expect(setStyle.mock.calls[0]?.[0].handle).toBeDefined();
  });

  it("reads a move it made off the frame's element", async () => {
    const { deps, handle, box } = sealedStudio();
    const moveTo = vi.fn(async (_selection: DomEditSelection, next: { x: number; y: number }) => {
      Object.assign(box, next);
    });

    const moved = expectOk<StudioTransformResult>(
      await studioTransform({ ...deps, moveTo }, { handle, x: 40, y: 50 }),
    );

    expect(moved.applied).toEqual(["move"]);
    expect(moved.box).toEqual({ x: 40, y: 50, width: 300, height: 60 });
  });

  it("reads new text it wrote off the frame's element", async () => {
    const { deps, handle, target } = sealedStudio();
    // A sealed selection lists no text fields yet; one is given here so the write reaches its read-back.
    const buildSelection = async (found: Parameters<typeof deps.buildSelection>[0]) => {
      const selection = await deps.buildSelection(found);
      return selection && { ...selection, textFields: [selfTextField] };
    };
    const setText = vi.fn(async (_selection: DomEditSelection, value: string) => {
      target.textContent = value;
      return { ok: true as const };
    });

    const result = await studioSetText(
      { ...deps, buildSelection, setText },
      { handle, text: "Shipped" },
    );

    expect(result).toMatchObject({ ok: true, text: "Shipped", changed: true });
  });
});

describe("studio_look before the timeline is known", () => {
  it("says the scene is still loading, and lists nothing", () => {
    const look = expectOk<StudioLook>(
      buildStudioLook(
        lookSnapshot({
          duration: 0,
          scene: { status: "ready", items: [], drillInItem: null },
        }),
      ),
    );

    expect(look.sceneStatus).toBe("loading");
    expect(look.elements).toEqual([]);
  });
});
