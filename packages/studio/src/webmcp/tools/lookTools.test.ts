// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { DomEditSelection } from "../../components/editor/domEditingTypes";
import type { TimelineElement } from "../../player/store/timelineElement";
import { buildStudioLook, STUDIO_LOOK_INPUT_SCHEMA, type StudioLookSnapshot } from "./lookTools";

function element(overrides: Partial<TimelineElement>): TimelineElement {
  return { id: "synthetic", tag: "div", start: 0, duration: 1, track: 0, ...overrides };
}

function snapshot(overrides: Partial<StudioLookSnapshot> = {}): StudioLookSnapshot {
  return {
    projectId: "demo",
    compositionPath: "index.html",
    currentTime: 1.5,
    duration: 10,
    isPlaying: false,
    elements: [],
    selection: null,
    selectionAnimationCount: 0,
    history: { canUndo: true, canRedo: false, undoLabel: "Move layer", redoLabel: null },
    ...overrides,
  };
}

function selection(overrides: Partial<DomEditSelection> = {}): DomEditSelection {
  return {
    id: "headline",
    hfId: "abc123",
    element: document.createElement("div"),
    label: "Headline",
    tagName: "h1",
    sourceFile: "index.html",
    compositionPath: "index.html",
    isCompositionHost: false,
    isInsideLockedComposition: false,
    boundingBox: { x: 40, y: 12, width: 880, height: 96 },
    textContent: "Ship it",
    dataAttributes: {},
    inlineStyles: {},
    computedStyles: {},
    textFields: [],
    capabilities: {
      canSelect: true,
      canEditStyles: true,
      canCrop: true,
      canMove: true,
      canResize: true,
      canApplyManualOffset: true,
      canApplyManualSize: true,
      canApplyManualRotation: true,
    },
    ...overrides,
  };
}

function expectOk<T>(result: { ok: boolean } & Record<string, unknown>): T {
  if (!result.ok) throw new Error(`expected ok, got ${JSON.stringify(result)}`);
  return result as unknown as T;
}

describe("buildStudioLook", () => {
  it("reports the playhead, duration and undo label an agent needs to checkpoint", () => {
    const look = expectOk<{
      playhead: number;
      duration: number;
      history: { undoLabel: string | null };
    }>(
      buildStudioLook(
        snapshot({
          currentTime: 2.4,
          duration: 30,
          history: { canUndo: true, canRedo: false, undoLabel: "Edit text", redoLabel: null },
        }),
      ),
    );

    expect(look.playhead).toBe(2.4);
    expect(look.duration).toBe(30);
    expect(look.history.undoLabel).toBe("Edit text");
  });

  it("gives every addressable element a handle a write tool can consume", () => {
    const look = expectOk<{ elements: { handle: string | null; label: string | null }[] }>(
      buildStudioLook(
        snapshot({
          elements: [
            element({ hfId: "abc", label: "Headline" }),
            element({ domId: "cta", label: "Button" }),
            element({ selector: ".card", selectorIndex: 2, label: "Card" }),
          ],
        }),
      ),
    );

    expect(look.elements.map((e) => e.handle)).toEqual(["hf:abc", "dom:cta", "sel:.card#2"]);
  });

  it("reports an unaddressable element with a null handle rather than hiding it", () => {
    const look = expectOk<{ elements: { handle: string | null }[]; elementCount: number }>(
      buildStudioLook(snapshot({ elements: [element({ label: "Anonymous" })] })),
    );

    expect(look.elementCount).toBe(1);
    expect(look.elements[0]?.handle).toBeNull();
  });

  it("returns an empty list for an empty timeline, not a failure", () => {
    const look = expectOk<{ elements: unknown[]; elementCount: number }>(
      buildStudioLook(snapshot()),
    );

    expect(look.elements).toEqual([]);
    expect(look.elementCount).toBe(0);
  });

  it("filters on label, tag and handle, case-insensitively", () => {
    const elements = [
      element({ hfId: "abc", label: "Headline", tag: "h1" }),
      element({ domId: "cta", label: "Button", tag: "button" }),
    ];

    const byLabel = expectOk<{ elements: { handle: string | null }[] }>(
      buildStudioLook(snapshot({ elements }), { filter: "HEADLINE" }),
    );
    const byTag = expectOk<{ elements: { handle: string | null }[] }>(
      buildStudioLook(snapshot({ elements }), { filter: "button" }),
    );
    const byHandle = expectOk<{ elements: { handle: string | null }[] }>(
      buildStudioLook(snapshot({ elements }), { filter: "hf:abc" }),
    );

    expect(byLabel.elements.map((e) => e.handle)).toEqual(["hf:abc"]);
    expect(byTag.elements.map((e) => e.handle)).toEqual(["dom:cta"]);
    expect(byHandle.elements.map((e) => e.handle)).toEqual(["hf:abc"]);
  });

  it("bounds a filter before normalizing it", () => {
    const boundedFilter = "x".repeat(128);
    const look = expectOk<{ elements: { handle: string | null }[] }>(
      buildStudioLook(
        snapshot({ elements: [element({ domId: "bounded", label: boundedFilter })] }),
        { filter: `${boundedFilter}${"y".repeat(10_000)}` },
      ),
    );

    expect(look.elements.map((entry) => entry.handle)).toEqual(["dom:bounded"]);
    expect(STUDIO_LOOK_INPUT_SCHEMA.properties.filter.maxLength).toBe(128);
  });

  it("keeps the true match count when the list is truncated", () => {
    const elements = Array.from({ length: 5 }, (_, index) =>
      element({ domId: `el-${index}`, label: "Card" }),
    );

    const look = expectOk<{ elements: unknown[]; elementCount: number }>(
      buildStudioLook(snapshot({ elements }), { limit: 2 }),
    );

    // A truncated list must not read as "that is all there is".
    expect(look.elements).toHaveLength(2);
    expect(look.elementCount).toBe(5);
  });

  it("clamps a nonsense limit instead of failing the call", () => {
    const elements = [element({ domId: "a" }), element({ domId: "b" })];

    for (const limit of [0, -3, 1.5, Number.NaN]) {
      const look = expectOk<{ elements: unknown[] }>(
        buildStudioLook(snapshot({ elements }), { limit }),
      );
      expect(look.elements).toHaveLength(2);
    }
  });

  it("surfaces the selection with its capabilities and a usable handle", () => {
    const look = expectOk<{
      selection: { handle: string | null; box: { width: number }; can: { editStyles: boolean } };
    }>(buildStudioLook(snapshot({ selection: selection() })));

    expect(look.selection?.handle).toBe("hf:abc123");
    expect(look.selection?.box.width).toBe(880);
    expect(look.selection?.can.editStyles).toBe(true);
  });

  it("reports the live animation count supplied outside the DOM selection", () => {
    const look = expectOk<{ selection: { animationCount: number } | null }>(
      buildStudioLook(snapshot({ selection: selection(), selectionAnimationCount: 3 })),
    );

    expect(look.selection?.animationCount).toBe(3);
  });

  it("passes the disabled reason through so the agent learns it from a read", () => {
    const locked = selection({
      capabilities: {
        ...selection().capabilities,
        canEditStyles: false,
        canMove: false,
        canApplyManualOffset: false,
        reasonIfDisabled: "Element is inside a locked composition",
      },
    });

    const look = expectOk<{
      selection: { can: { editStyles: boolean; move: boolean; reasonIfDisabled: string | null } };
    }>(buildStudioLook(snapshot({ selection: locked })));

    expect(look.selection?.can.editStyles).toBe(false);
    expect(look.selection?.can.move).toBe(false);
    expect(look.selection?.can.reasonIfDisabled).toBe("Element is inside a locked composition");
  });

  it("reports null selection rather than an empty one when nothing is selected", () => {
    const look = expectOk<{ selection: unknown }>(buildStudioLook(snapshot({ selection: null })));
    expect(look.selection).toBeNull();
  });

  it("does not advertise write readiness before the real write gate exists", () => {
    const look = expectOk<Record<string, unknown>>(buildStudioLook(snapshot()));

    expect(look).not.toHaveProperty("canWrite");
    expect(look).not.toHaveProperty("writeBlockedReason");
  });
});
