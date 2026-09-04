/**
 * @vitest-environment jsdom
 * AUDIT: clipTree deterministic hierarchy & identity.
 * Tests the runtime contract the renderer depends on.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createClipTree, stableClipId } from "@hyperframes/core/runtime/clipTree";

const mockResolver = { resolveStartForElement: () => 0 };

describe("stableClipId", () => {
  beforeEach(() => {
    document.body.innerHTML = "";
  });

  it("prefers id over data-hf-id", () => {
    const el = document.createElement("div");
    el.id = "real";
    el.setAttribute("data-hf-id", "generated");
    expect(stableClipId(el)).toBe("real");
  });

  it("falls back to data-hf-id when id absent", () => {
    const el = document.createElement("div");
    el.setAttribute("data-hf-id", "hf-42");
    expect(stableClipId(el)).toBe("hf-42");
  });

  it("returns null for anonymous elements", () => {
    const el = document.createElement("span");
    expect(stableClipId(el)).toBeNull();
  });
});

describe("createClipTree", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("skips root composition element so its timed children become roots", () => {
    document.body.innerHTML = `
      <div id="root" data-composition-id="main" data-start="0">
        <h1 id="title" class="clip" data-start="1" data-duration="3">Title</h1>
      </div>
    `;
    const tree = createClipTree({
      startResolver: mockResolver,
      timelineRegistry: {},
      rootDuration: 10,
    });

    const root = tree.roots.find((n) => n.id === "root");
    expect(root).toBeUndefined();

    const child = tree.roots.find((n) => n.id === "title");
    expect(child).toBeDefined();
    // Parent is skipped, so child.parentId is null
    expect(child!.parentId).toBeNull();
  });

  it("links nested non-root parent/child relationships", () => {
    document.body.innerHTML = `
      <div id="stage" data-composition-id="stage" data-start="0">
        <div id="group" class="clip" data-start="1" data-duration="8">
          <p id="cap" class="clip" data-start="2" data-duration="4">Hello</p>
        </div>
      </div>
    `;
    const tree = createClipTree({
      startResolver: mockResolver,
      timelineRegistry: {},
      rootDuration: 10,
    });

    const group = tree.roots.find((n) => n.id === "group");
    expect(group).toBeDefined();

    const cap = group!.children.find((n) => n.id === "cap");
    expect(cap).toBeDefined();
    expect(cap!.parentId).toBe("group");
  });

  it("uses data-hf-id as id for id-less elements", () => {
    document.body.innerHTML = `
      <div data-composition-id="s" data-start="0">
        <p class="clip" data-start="1" data-duration="2" data-hf-id="caption-01">Hi</p>
      </div>
    `;
    const tree = createClipTree({
      startResolver: mockResolver,
      timelineRegistry: {},
      rootDuration: 5,
    });

    const cap = tree.roots.find((n) => n.id === "caption-01");
    expect(cap).toBeDefined();
    expect(cap!.id).not.toMatch(/^__clip-/);
  });

  it("falls back to synthetic __clip-N only when both id & data-hf-id missing", () => {
    document.body.innerHTML = `
      <div data-composition-id="s" data-start="0">
        <span class="clip" data-start="0.5" data-duration="1">anon</span>
      </div>
    `;
    const tree = createClipTree({
      startResolver: mockResolver,
      timelineRegistry: {},
      rootDuration: 5,
    });

    expect(tree.roots).toHaveLength(1);
    expect(tree.roots[0]!.id).toMatch(/^__clip-\d+$/);
  });

  it("skips decorative tags even when they carry data-start", () => {
    document.body.innerHTML = `
      <div data-composition-id="demo" data-start="0">
        <style class="clip" data-start="1" data-duration="1">.x{color:red}</style>
        <script class="clip" data-start="1" data-duration="1">const x=1;</script>
        <meta class="clip" data-start="1" data-duration="1" charset="utf-8">
        <link class="clip" data-start="1" data-duration="1" rel="stylesheet" href="a.css">
        <template class="clip" data-start="1" data-duration="1"><span>t</span></template>
        <noscript class="clip" data-start="1" data-duration="1">fallback</noscript>
        <span id="real" class="clip" data-start="1" data-duration="2">Real</span>
      </div>
    `;
    const tree = createClipTree({
      startResolver: mockResolver,
      timelineRegistry: {},
      rootDuration: 10,
    });

    const ids = tree.roots.map((n) => n.id);
    expect(ids).not.toContain(null);
    expect(ids).toContain("real");
    expect(ids).toHaveLength(1);
  });

  it("gracefully returns empty tree when no composition found", () => {
    document.body.innerHTML = `<p class="clip" data-start="0">orphan</p>`;
    const tree = createClipTree({
      startResolver: mockResolver,
      timelineRegistry: {},
      rootDuration: 0,
    });
    expect(tree.roots.length).toBe(0);
  });
});
