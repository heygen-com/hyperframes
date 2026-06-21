import { describe, it, expect, afterEach } from "vitest";
import { createClipTree, stableClipId } from "./clipTree";

describe("stableClipId", () => {
  it("prefers id, falls back to data-hf-id, else null", () => {
    const withId = document.createElement("div");
    withId.id = "real";
    withId.setAttribute("data-hf-id", "hf-1");
    expect(stableClipId(withId)).toBe("real");

    const hfOnly = document.createElement("div");
    hfOnly.setAttribute("data-hf-id", "hf-2");
    expect(stableClipId(hfOnly)).toBe("hf-2");

    expect(stableClipId(document.createElement("div"))).toBeNull();
  });
});

describe("createClipTree", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  const params = {
    startResolver: { resolveStartForElement: () => 0 },
    timelineRegistry: {},
    rootDuration: 10,
  };

  // Regression: id-less children (root index.html uses data-hf-id, not id) must
  // get their data-hf-id as the node id — not a synthetic `__clip-N` — so the
  // tree aligns with __clipManifest (which also keys on data-hf-id) and inline
  // expansion can join parent↔child.
  it("ids id-less timed elements by data-hf-id and links them to their parent", () => {
    document.body.innerHTML = `
      <div data-composition-id="root" data-duration="10" data-start="0" id="root">
        <div data-start="0" data-duration="5" id="scene">
          <h1 data-start="0" data-hf-id="hf-headline" class="headline">Hi</h1>
        </div>
      </div>`;

    const tree = createClipTree(params);
    const scene = tree.roots.find((n) => n.id === "scene");
    expect(scene).toBeDefined();
    const child = scene!.children.find((n) => n.id === "hf-headline");
    expect(child).toBeDefined();
    expect(child!.id).not.toMatch(/^__clip-/);
    expect(child!.parentId).toBe("scene");
  });
});
