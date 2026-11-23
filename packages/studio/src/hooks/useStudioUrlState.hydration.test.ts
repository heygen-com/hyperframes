// @vitest-environment happy-dom
import { describe, expect, it, vi } from "vitest";
import { resolveUrlSelections } from "./useStudioUrlState";

describe("restoring a selection from the URL", () => {
  it("probes the source for the primary only, never for the group", async () => {
    // Each probe is its own request and they are awaited one after another,
    // while the URL carries the whole selection — so a marquee over a captured
    // page turned every later reload into hundreds of serial round trips before
    // the canvas answered anything.
    const doc = document.implementation.createHTMLDocument();
    const ids = ["a", "b", "c", "d"];
    for (const id of ids) {
      const el = doc.createElement("div");
      el.id = id;
      doc.body.append(el);
    }
    const probed: (boolean | undefined)[] = [];
    const buildDomSelection = vi.fn(
      async (element: HTMLElement, options?: { skipSourceProbe?: boolean }) => {
        probed.push(options?.skipSourceProbe);
        return { element, id: element.id } as never;
      },
    );

    await resolveUrlSelections({
      find: async (target) => (target.id ? doc.getElementById(target.id) : doc.getElementById("a")),
      selection: { sourceFile: "index.html" } as never,
      group: ids.slice(1).map((id) => ({ id, sourceFile: "index.html" })) as never,
      isCurrent: () => true,
      buildDomSelection,
    });

    expect(probed[0]).toBeUndefined();
    expect(probed.slice(1)).toEqual([true, true, true]);
  });

  it("restores a sealed preview's selection from the frame's description of it", async () => {
    const described = { handle: "0123456789abcdef:1", id: "a" } as never;
    const buildDomSelection = vi.fn(async (target: unknown) => ({ target }) as never);
    const members = await resolveUrlSelections({
      find: async () => described,
      selection: { id: "a", sourceFile: "index.html" } as never,
      group: [],
      isCurrent: () => true,
      buildDomSelection,
    });
    expect(buildDomSelection).toHaveBeenCalledWith(described, { preferClipAncestor: false });
    expect(members).toEqual([{ target: described }]);
  });

  it("answers undefined while the frame cannot answer, so the caller retries", async () => {
    const buildDomSelection = vi.fn();
    const members = await resolveUrlSelections({
      find: async () => undefined,
      selection: { id: "a", sourceFile: "index.html" } as never,
      group: [],
      isCurrent: () => true,
      buildDomSelection,
    });
    expect(members).toBeUndefined();
    expect(buildDomSelection).not.toHaveBeenCalled();
  });

  it("waits for a group member the frame cannot answer for yet, rather than dropping it", async () => {
    const a = document.createElement("div");
    const built = { id: "a" } as never;
    const members = await resolveUrlSelections({
      find: async (target) => (target.id === "a" ? a : undefined),
      selection: { id: "a", sourceFile: "index.html" } as never,
      group: [{ id: "b" }],
      isCurrent: () => true,
      buildDomSelection: async () => built,
    });
    expect(members).toBeUndefined();
  });

  it("omits a group member the frame confirms is gone", async () => {
    const a = document.createElement("div");
    const built = { id: "a" } as never;
    const members = await resolveUrlSelections({
      find: async (target) => (target.id === "a" ? a : null),
      selection: { id: "a", sourceFile: "index.html" } as never,
      group: [{ id: "b" }],
      isCurrent: () => true,
      buildDomSelection: async () => built,
    });
    expect(members).toEqual([built]);
  });
});
