/**
 * T-contract: sub-composition scoped id suite (Stage 6 / F9).
 *
 * All tests use pre-inlined HTML (flat DOM with data-composition-file boundaries)
 * because the SDK only opens pre-inlined HTML — sub-comp loading is not the SDK's job.
 *
 * Boundary detection rule: an element is a host (starts a new scope) when it has
 * data-composition-file AND its value differs from its parent's data-composition-file.
 * This correctly handles the outerHTML innerRoot case (same dcf as parent → not a new host)
 * and nested hosts (different dcf from parent → new host).
 */

import { describe, it, expect } from "vitest";
import { parseHTML } from "linkedom";
import { ensureHfIds } from "@hyperframes/core/hf-ids";
import { resolveScoped } from "./engine/model.js";
import { parseMutable } from "./engine/model.js";
import { buildRoots, flatElements } from "./document.js";
import { openComposition } from "./session.js";

// ─── Fixture helpers ──────────────────────────────────────────────────────────

/** Build a flat inlined HTML string simulating what inlineSubCompositions produces. */
function inlinedHtml(inner: string): string {
  return `<!DOCTYPE html><html><body>${inner}</body></html>`;
}

/** Stamp hf-ids and return a linkedom document (same as parseMutable's path). */
function makeDoc(html: string) {
  const { document } = parseHTML(ensureHfIds(html));
  return document;
}

// ─── 1. resolveScoped ─────────────────────────────────────────────────────────

describe("resolveScoped — flat id", () => {
  it("resolves a bare id at top level (same as findById)", () => {
    const doc = makeDoc(
      `<!DOCTYPE html><html><body><div data-hf-id="hf-aaaa">hi</div></body></html>`,
    );
    const el = resolveScoped(doc as unknown as Document, "hf-aaaa");
    expect(el).not.toBeNull();
    expect(el?.getAttribute("data-hf-id")).toBe("hf-aaaa");
  });

  it("returns null for a missing bare id", () => {
    const doc = makeDoc(
      `<!DOCTYPE html><html><body><div data-hf-id="hf-aaaa"></div></body></html>`,
    );
    expect(resolveScoped(doc as unknown as Document, "hf-xxxx")).toBeNull();
  });
});

describe("resolveScoped — scoped id", () => {
  it("resolves hf-HOST/hf-LEAF inside the host's subtree", () => {
    // Simulated post-inline structure: host has data-composition-file
    const doc = makeDoc(
      inlinedHtml(`
      <div data-hf-id="hf-host" data-composition-file="sub.html">
        <p data-hf-id="hf-leaf">text</p>
      </div>
    `),
    );
    const el = resolveScoped(doc as unknown as Document, "hf-host/hf-leaf");
    expect(el?.getAttribute("data-hf-id")).toBe("hf-leaf");
    expect(el?.textContent?.trim()).toBe("text");
  });

  it("does NOT match a leaf outside the host when ids collide", () => {
    // Two elements with the same hf-id — one inside host, one outside.
    // resolveScoped must return the one INSIDE the host.
    const doc = makeDoc(
      inlinedHtml(`
      <div data-hf-id="hf-host" data-composition-file="sub.html">
        <p data-hf-id="hf-dup" class="inside">inside</p>
      </div>
      <p data-hf-id="hf-dup" class="outside">outside</p>
    `),
    );
    const el = resolveScoped(doc as unknown as Document, "hf-host/hf-dup");
    expect(el?.getAttribute("class")).toBe("inside");
  });

  it("resolves 3-level nesting hf-H1/hf-H2/hf-leaf", () => {
    const doc = makeDoc(
      inlinedHtml(`
      <div data-hf-id="hf-h1" data-composition-file="sub1.html">
        <div data-hf-id="hf-h2" data-composition-file="sub2.html">
          <span data-hf-id="hf-leaf">deep</span>
        </div>
      </div>
    `),
    );
    const el = resolveScoped(doc as unknown as Document, "hf-h1/hf-h2/hf-leaf");
    expect(el?.getAttribute("data-hf-id")).toBe("hf-leaf");
    expect(el?.textContent?.trim()).toBe("deep");
  });

  it("returns null when the first segment is not found", () => {
    const doc = makeDoc(
      inlinedHtml(`<div data-hf-id="hf-other"><p data-hf-id="hf-leaf"></p></div>`),
    );
    expect(resolveScoped(doc as unknown as Document, "hf-host/hf-leaf")).toBeNull();
  });

  it("returns null when the leaf is not found inside the host", () => {
    const doc = makeDoc(
      inlinedHtml(`
      <div data-hf-id="hf-host" data-composition-file="sub.html">
        <p data-hf-id="hf-other">text</p>
      </div>
    `),
    );
    expect(resolveScoped(doc as unknown as Document, "hf-host/hf-leaf")).toBeNull();
  });
});

// ─── 2. ElementSnapshot.scopedId via buildRoots ───────────────────────────────

describe("ElementSnapshot.scopedId", () => {
  it("top-level element has scopedId equal to its bare id", () => {
    const parsed = parseMutable(
      `<div data-hf-id="hf-root" data-hf-root><p data-hf-id="hf-p">hi</p></div>`,
    );
    const elements = flatElements(buildRoots(parsed.document));
    const p = elements.find((e) => e.id === "hf-p");
    expect(p?.scopedId).toBe("hf-p");
  });

  it("element inside sub-comp gets hf-HOST/hf-LEAF scopedId", () => {
    const parsed = parseMutable(
      inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-leaf">text</p>
        </div>
      </div>
    `),
    );
    const elements = flatElements(buildRoots(parsed.document));
    const leaf = elements.find((e) => e.id === "hf-leaf");
    expect(leaf?.scopedId).toBe("hf-host/hf-leaf");
  });

  it("host element itself has bare scopedId (it lives in parent scope)", () => {
    const parsed = parseMutable(
      inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-leaf">text</p>
        </div>
      </div>
    `),
    );
    const elements = flatElements(buildRoots(parsed.document));
    const host = elements.find((e) => e.id === "hf-host");
    expect(host?.scopedId).toBe("hf-host");
  });

  it("3-level nesting produces hf-H1/hf-H2/hf-LEAF", () => {
    const parsed = parseMutable(
      inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-h1" data-composition-file="sub1.html">
          <div data-hf-id="hf-h2" data-composition-file="sub2.html">
            <span data-hf-id="hf-leaf">deep</span>
          </div>
        </div>
      </div>
    `),
    );
    const elements = flatElements(buildRoots(parsed.document));
    const leaf = elements.find((e) => e.id === "hf-leaf");
    expect(leaf?.scopedId).toBe("hf-h1/hf-h2/hf-leaf");
  });

  it("same sub-comp mounted twice gets different scopedIds", () => {
    // hf-x exists in both mounts — different host ids disambiguate
    const parsed = parseMutable(
      inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-mount-a" data-composition-file="sub.html">
          <p data-hf-id="hf-x" class="in-a">A</p>
        </div>
        <div data-hf-id="hf-mount-b" data-composition-file="sub.html">
          <p data-hf-id="hf-x" class="in-b">B</p>
        </div>
      </div>
    `),
    );
    const elements = flatElements(buildRoots(parsed.document));
    const xs = elements.filter((e) => e.id === "hf-x");
    const scopedIds = xs.map((e) => e.scopedId);
    expect(scopedIds).toContain("hf-mount-a/hf-x");
    expect(scopedIds).toContain("hf-mount-b/hf-x");
    expect(new Set(scopedIds).size).toBe(2);
  });

  it("outerHTML innerRoot (same dcf as parent) is NOT itself a new host boundary", () => {
    // outerHTML case: host and innerRoot both get data-composition-file="sub.html"
    const parsed = parseMutable(
      inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <div data-hf-id="hf-inner" data-composition-id="my-sub" data-composition-file="sub.html">
            <p data-hf-id="hf-leaf">text</p>
          </div>
        </div>
      </div>
    `),
    );
    const elements = flatElements(buildRoots(parsed.document));
    const leaf = elements.find((e) => e.id === "hf-leaf");
    // Leaf should be scoped under hf-host, not hf-host/hf-inner
    expect(leaf?.scopedId).toBe("hf-host/hf-leaf");
  });
});

// ─── 3. Dispatch to scoped target ─────────────────────────────────────────────

describe("dispatch — scoped target", () => {
  it("setStyle with scoped id mutates the correct element when id collides", async () => {
    // Both host subtree and sibling have an element hf-x — scoped target must hit the right one
    const html = inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-x">inside</p>
        </div>
        <p data-hf-id="hf-x">outside</p>
      </div>
    `);
    const comp = await openComposition(html);
    comp.setStyle("hf-host/hf-x", { color: "red" });

    const inside = comp.getElement("hf-host/hf-x");
    const outside = comp.getElement("hf-x");
    expect(inside?.inlineStyles.color).toBe("red");
    // Outside element should be unchanged
    expect(outside?.inlineStyles.color).toBeUndefined();
  });

  it("dispatch emits scoped id in patch path", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-leaf">text</p>
        </div>
      </div>
    `);
    const comp = await openComposition(html);
    const patches: string[] = [];
    comp.on("patch", (e) => {
      patches.push(...e.patches.map((p) => p.path));
    });
    comp.setStyle("hf-host/hf-leaf", { color: "blue" });
    // Patch path should encode the scoped id with RFC 6902 escaping (/ → ~1)
    expect(patches.some((p) => p.includes("hf-host~1hf-leaf"))).toBe(true);
  });

  it("getElement by scopedId returns the correct snapshot", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-leaf">inside text</p>
        </div>
      </div>
    `);
    const comp = await openComposition(html);
    const el = comp.getElement("hf-host/hf-leaf");
    expect(el).not.toBeNull();
    expect(el?.text).toBe("inside text");
  });

  it("find() returns scopedIds for sub-comp elements", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-leaf" class="target">inside</p>
        </div>
        <p data-hf-id="hf-outer" class="target">outside</p>
      </div>
    `);
    const comp = await openComposition(html);
    const ids = comp.find({ tag: "p" });
    expect(ids).toContain("hf-host/hf-leaf");
    expect(ids).toContain("hf-outer");
  });
});

// ─── 4. Override-set keys for scoped ids ──────────────────────────────────────

describe("override-set — scoped id keys", () => {
  it("setStyle on scoped id produces scoped key in getOverrides()", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-leaf">text</p>
        </div>
      </div>
    `);
    const comp = await openComposition(html);
    comp.setStyle("hf-host/hf-leaf", { color: "green" });
    const overrides = comp.getOverrides();
    expect(overrides["hf-host/hf-leaf.style.color"]).toBe("green");
  });

  it("removeElement on host purges all sub-comp keys from override-set", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-leaf">text</p>
        </div>
      </div>
    `);
    const comp = await openComposition(html);
    comp.setStyle("hf-host/hf-leaf", { color: "green" });
    comp.removeElement("hf-host");
    const overrides = comp.getOverrides();
    // Removal marker for host is preserved (null); scoped property sub-keys are purged
    expect(overrides["hf-host"]).toBeNull();
    expect(
      Object.keys(overrides).some((k) => k.startsWith("hf-host/") || k.startsWith("hf-host.")),
    ).toBe(false);
  });
});

// ─── 5. find({ composition }) filter ─────────────────────────────────────────

describe("find({ composition })", () => {
  it("returns elements inside the named host sub-composition", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-leaf">inside</p>
        </div>
        <p data-hf-id="hf-outer">outside</p>
      </div>
    `);
    const comp = await openComposition(html);
    const ids = comp.find({ composition: "hf-host" });
    expect(ids).toContain("hf-host/hf-leaf");
    expect(ids).not.toContain("hf-outer");
    expect(ids).not.toContain("hf-host"); // host itself is in parent scope
  });

  it("returns empty array for unknown host id", async () => {
    const html = inlinedHtml(
      `<div data-hf-id="hf-root" data-hf-root><p data-hf-id="hf-p">x</p></div>`,
    );
    const comp = await openComposition(html);
    expect(comp.find({ composition: "hf-no-such" })).toEqual([]);
  });

  it("can combine composition filter with other query fields", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-a">match</p>
          <span data-hf-id="hf-b">no</span>
        </div>
      </div>
    `);
    const comp = await openComposition(html);
    const ids = comp.find({ composition: "hf-host", tag: "p" });
    expect(ids).toEqual(["hf-host/hf-a"]);
  });
});

// ─── 6. Scoped id stability across serialize ──────────────────────────────────

describe("scopedId stability across serialize/re-parse", () => {
  it("scopedId values are identical after serialize + re-open", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-leaf">text</p>
        </div>
        <p data-hf-id="hf-outer">outer</p>
      </div>
    `);
    const comp1 = await openComposition(html);
    const serialized = comp1.serialize();
    const comp2 = await openComposition(serialized);

    const ids1 = comp1
      .getElements()
      .map((e) => e.scopedId)
      .sort();
    const ids2 = comp2
      .getElements()
      .map((e) => e.scopedId)
      .sort();
    expect(ids1).toEqual(ids2);
  });
});
