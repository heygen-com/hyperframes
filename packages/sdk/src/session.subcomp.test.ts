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
import { RUNTIME_BOOTSTRAP_ATTR } from "@hyperframes/core";
import { resolveScoped, findById, isNewHostBoundary, bareId } from "./engine/model.js";
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

  // A sub-composition ROOT is addressed by its composition id. When no element
  // carries that as a data-hf-id, fall back to [data-composition-id]: comp-ids
  // become first-class resolvable addresses (fixes validate / getElement).
  it("resolves a bare id to a sub-comp root via data-composition-id fallback", () => {
    const doc = makeDoc(
      `<!DOCTYPE html><html><body><div data-hf-id="hf-host" data-composition-id="sub-1"></div></body></html>`,
    ) as unknown as Document;
    const viaComp = resolveScoped(doc, "sub-1");
    const viaHf = resolveScoped(doc, "hf-host");
    expect(viaComp).not.toBeNull();
    expect(viaComp?.getAttribute("data-hf-id")).toBe("hf-host");
    // Both addresses resolve to the SAME host element.
    expect(viaComp).toBe(viaHf);
  });

  // data-hf-id MUST take precedence: a bare id that matches a real data-hf-id
  // never falls back to data-composition-id, even if some other element carries
  // that string as its composition id.
  it("data-hf-id takes precedence over data-composition-id for a bare id", () => {
    const doc = makeDoc(
      `<!DOCTYPE html><html><body>
        <div data-hf-id="dup" class="byHfId"></div>
        <div data-hf-id="hf-host" data-composition-id="dup" class="byCompId"></div>
      </body></html>`,
    ) as unknown as Document;
    const el = resolveScoped(doc, "dup");
    expect(el?.getAttribute("class")).toBe("byHfId");
  });

  // Regression: findById is the patch-replay/undo resolver. It must agree with
  // resolveScoped (forward dispatch) on an ambiguous bare id — both pick the
  // canonical (top-level) instance — or undo reverts the wrong duplicate.
  it("findById resolves an ambiguous bare id to the canonical instance (== resolveScoped)", () => {
    const doc = makeDoc(
      inlinedHtml(`
      <div data-hf-id="hf-host" data-composition-file="sub.html">
        <p data-hf-id="hf-dup" class="inside">inside</p>
      </div>
      <p data-hf-id="hf-dup" class="outside">outside</p>
    `),
    ) as unknown as Document;
    const viaFind = findById(doc, "hf-dup");
    const viaResolve = resolveScoped(doc, "hf-dup");
    expect(viaFind).toBe(viaResolve);
    expect(viaFind?.getAttribute("class")).toBe("outside");
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

// ─── 3b. Comp-root GSAP tween attribution ─────────────────────────────────────

describe("sub-comp root GSAP tween — canonical hf-id attribution", () => {
  it("getElement(host).animationIds includes a tween added by comp-id target", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-id="sub-1" data-composition-file="sub.html">
          <p data-hf-id="hf-leaf">text</p>
        </div>
        <script>var tl = gsap.timeline({ paused: true });
window.__timelines = { t: tl };</script>
      </div>
    `);
    const comp = await openComposition(html);
    // Target the sub-comp ROOT by its composition id.
    const animId = comp.addGsapTween("sub-1", {
      method: "to",
      duration: 0.3,
      properties: { x: 200 },
    });
    // The tween is filed under the host's own data-hf-id (canonical form), so
    // it surfaces on the host element snapshot.
    const host = comp.getElement("hf-host");
    expect(host?.animationIds).toContain(animId);
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

// ─── 5b. Ambiguous bare id: removeElement / getElement agreement ──────────────

describe("ambiguous bare id — removeElement and getElement agree", () => {
  // Inner sub-comp dup appears FIRST in document order; the canonical top-level
  // dup appears AFTER it. querySelector document-order would return the inner one,
  // but getElement prefers the canonical (top-level) match. The two APIs must agree.
  const ambiguousHtml = () =>
    inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-dup" class="inner">inner</p>
        </div>
        <p data-hf-id="hf-dup" class="outer">outer</p>
      </div>
    `);

  it("bare id resolves to the canonical (top-level) instance, matching getElement", async () => {
    const comp = await openComposition(ambiguousHtml());

    // getElement prefers the canonical match (scopedId === id) → top-level "outer".
    const got = comp.getElement("hf-dup");
    expect(got?.scopedId).toBe("hf-dup");
    expect(got?.classNames).toContain("outer");

    // removeElement(bareId) must remove the SAME instance getElement returned.
    comp.removeElement("hf-dup");

    // The canonical top-level instance is gone — getElement(bareId) no longer
    // finds it (and does NOT silently fall through to the inner sub-comp dup).
    expect(comp.getElement("hf-dup")).toBeNull();

    // The inner instance survives, addressable only via its fully-scoped path.
    const inner = comp.getElement("hf-host/hf-dup");
    expect(inner?.classNames).toContain("inner");
  });

  it("fully-scoped path still targets the inner instance exactly", async () => {
    const comp = await openComposition(ambiguousHtml());
    comp.removeElement("hf-host/hf-dup");

    // Inner gone; canonical top-level survives.
    const inner = comp.getElement("hf-host/hf-dup");
    expect(inner).toBeNull();
    const top = comp.getElement("hf-dup");
    expect(top?.scopedId).toBe("hf-dup");
    expect(top?.classNames).toContain("outer");
  });

  it("non-duplicated bare id still resolves and removes normally", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-root" data-hf-root>
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <p data-hf-id="hf-leaf">inside</p>
        </div>
        <p data-hf-id="hf-solo">solo</p>
      </div>
    `);
    const comp = await openComposition(html);
    expect(comp.getElement("hf-solo")?.scopedId).toBe("hf-solo");
    comp.removeElement("hf-solo");
    expect(comp.getElement("hf-solo")).toBeNull();
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

// ─── 7. isNewHostBoundary ──────────────────────────────────────────────────────

describe("isNewHostBoundary", () => {
  it("is true for a host with no ancestor dcf (top-level sub-comp host)", () => {
    const doc = makeDoc(
      inlinedHtml(`<div data-hf-id="hf-host" data-composition-file="sub.html"></div>`),
    ) as unknown as Document;
    const host = doc.querySelector('[data-hf-id="hf-host"]') as unknown as Element;
    expect(isNewHostBoundary(host)).toBe(true);
  });

  it("is false for an element with no data-composition-file at all", () => {
    const doc = makeDoc(inlinedHtml(`<div data-hf-id="hf-plain"></div>`)) as unknown as Document;
    const el = doc.querySelector('[data-hf-id="hf-plain"]') as unknown as Element;
    expect(isNewHostBoundary(el)).toBe(false);
  });

  it("is false for the outerHTML innerRoot (same dcf value as its host parent)", () => {
    const doc = makeDoc(
      inlinedHtml(`
        <div data-hf-id="hf-host" data-composition-file="sub.html">
          <div data-hf-id="hf-inner" data-composition-file="sub.html"></div>
        </div>
      `),
    ) as unknown as Document;
    const inner = doc.querySelector('[data-hf-id="hf-inner"]') as unknown as Element;
    expect(isNewHostBoundary(inner)).toBe(false);
  });

  it("is true for a nested host with a DIFFERENT dcf from its parent", () => {
    const doc = makeDoc(
      inlinedHtml(`
        <div data-hf-id="hf-outer" data-composition-file="outer.html">
          <div data-hf-id="hf-inner-host" data-composition-file="inner.html"></div>
        </div>
      `),
    ) as unknown as Document;
    const innerHost = doc.querySelector('[data-hf-id="hf-inner-host"]') as unknown as Element;
    expect(isNewHostBoundary(innerHost)).toBe(true);
  });
});

// ─── 8. bareId ──────────────────────────────────────────────────────────────────

describe("bareId", () => {
  it("returns the leaf segment of a scoped id", () => {
    expect(bareId("hf-host/hf-leaf")).toBe("hf-leaf");
  });

  it("returns a deeply nested id's leaf segment", () => {
    expect(bareId("hf-a/hf-b/hf-c")).toBe("hf-c");
  });

  it("passes a bare id through unchanged", () => {
    expect(bareId("hf-solo")).toBe("hf-solo");
  });
});

// ─── 9. getRootElements — no descendant duplication ────────────────────────────

describe("getRootElements", () => {
  it("excludes descendants that getElements() also lists as top-level entries", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-panel">
        <h1 data-hf-id="hf-title">Title</h1>
      </div>
      <p data-hf-id="hf-solo">solo</p>
    `);
    const comp = await openComposition(html);

    // getElements() is flat: hf-title appears once nested under hf-panel AND
    // once again as its own top-level entry.
    const flatIds = comp.getElements().map((e) => e.id);
    expect(flatIds).toContain("hf-title");
    expect(flatIds).toContain("hf-panel");

    // getRootElements() only returns true roots — hf-title is not one, since
    // it's hf-panel's descendant.
    const rootIds = comp.getRootElements().map((e) => e.id);
    expect(rootIds).toEqual(["hf-panel", "hf-solo"]);
    expect(comp.getRootElements().find((e) => e.id === "hf-panel")?.children[0]?.id).toBe(
      "hf-title",
    );
  });

  it("treats a sub-composition host as a root even though it has descendants", async () => {
    const html = inlinedHtml(`
      <div data-hf-id="hf-host" data-composition-file="sub.html">
        <p data-hf-id="hf-leaf">inside</p>
      </div>
    `);
    const comp = await openComposition(html);
    expect(comp.getRootElements().map((e) => e.id)).toEqual(["hf-host"]);
  });
});

// ─── 10. serialize({ stripRuntime }) ───────────────────────────────────────────

describe("serialize({ stripRuntime })", () => {
  const RUNTIME_SCRIPT =
    '<script data-hyperframes-preview-runtime="1" src="https://cdn.jsdelivr.net/npm/@hyperframes/core/dist/hyperframe.runtime.iife.js"></script>';

  it("keeps the embedded runtime script by default", async () => {
    const html = `<!DOCTYPE html><html><head>${RUNTIME_SCRIPT}</head><body><div data-hf-id="hf-a"></div></body></html>`;
    const comp = await openComposition(html);
    expect(comp.serialize()).toContain("hyperframe.runtime");
  });

  it("strips the embedded runtime script when stripRuntime is true", async () => {
    const html = `<!DOCTYPE html><html><head>${RUNTIME_SCRIPT}</head><body><div data-hf-id="hf-a"></div></body></html>`;
    const comp = await openComposition(html);
    const out = comp.serialize({ stripRuntime: true });
    expect(out).not.toContain("hyperframe.runtime");
    expect(out).toContain('data-hf-id="hf-a"');
  });

  it("re-exports RUNTIME_BOOTSTRAP_ATTR from @hyperframes/core, matching the marker generators stamp", async () => {
    expect(RUNTIME_BOOTSTRAP_ATTR).toBe("data-hyperframes-preview-runtime");
    // The fixture's marker attribute above is authored by hand — confirm it's not
    // drifted from the real constant a generator would actually stamp.
    expect(RUNTIME_SCRIPT).toContain(RUNTIME_BOOTSTRAP_ATTR);
  });
});
