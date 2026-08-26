// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import type { TimelineElement } from "../player/store/timelineElement";
import {
  mintElementHandle,
  parseElementHandle,
  resolveElementHandle,
  timelineElementAddress,
} from "./handles";

function timelineElement(overrides: Partial<TimelineElement>): TimelineElement {
  return { id: "synthetic-id", tag: "div", start: 0, duration: 1, track: 0, ...overrides };
}

/** A separate document, standing in for the preview iframe's realm. */
function previewDoc(html: string): Document {
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  const doc = iframe.contentDocument;
  if (!doc) throw new Error("expected iframe document");
  doc.body.innerHTML = html;
  return doc;
}

describe("mintElementHandle", () => {
  it("prefers data-hf-id, the stable patch target", () => {
    const handle = mintElementHandle(
      timelineElementAddress(
        timelineElement({ hfId: "abc123", domId: "headline", selector: ".title" }),
      ),
    );
    expect(handle).toBe("hf:abc123");
  });

  it("falls back to the DOM id when there is no hf id", () => {
    expect(
      mintElementHandle(
        timelineElementAddress(timelineElement({ domId: "headline", selector: ".title" })),
      ),
    ).toBe("dom:headline");
  });

  it("falls back to a selector with its occurrence index", () => {
    expect(
      mintElementHandle(
        timelineElementAddress(timelineElement({ selector: ".card", selectorIndex: 2 })),
      ),
    ).toBe("sel:.card#2");
  });

  it("defaults a missing occurrence index to the first match", () => {
    expect(mintElementHandle(timelineElementAddress(timelineElement({ selector: ".card" })))).toBe(
      "sel:.card#0",
    );
  });

  it("returns null when the element carries no way to address it", () => {
    // The synthesised `id` is deliberately NOT used: it cannot resolve.
    expect(mintElementHandle(timelineElementAddress(timelineElement({})))).toBeNull();
  });
});

describe("parseElementHandle", () => {
  it("splits the index off the LAST hash, so id selectors survive", () => {
    expect(parseElementHandle("sel:#card > .title#3")).toEqual({
      scheme: "sel",
      value: "#card > .title",
      index: 3,
    });
  });

  it("treats a selector with no index as the first match", () => {
    expect(parseElementHandle("sel:.card")).toEqual({ scheme: "sel", value: ".card", index: 0 });
  });

  it("rejects an unknown scheme", () => {
    expect(parseElementHandle("xpath://div")).toBeNull();
  });

  it("rejects a handle with no value", () => {
    expect(parseElementHandle("dom:")).toBeNull();
    expect(parseElementHandle("")).toBeNull();
    expect(parseElementHandle(":headline")).toBeNull();
  });
});

describe("resolveElementHandle", () => {
  it("round-trips every handle scheme a read can mint", () => {
    const doc = previewDoc(
      `<div id="headline" data-hf-id="abc123">A</div>
       <div class="card">first</div>
       <div class="card">second</div>`,
    );

    expect(resolveElementHandle(doc, "hf:abc123")?.id).toBe("headline");
    expect(resolveElementHandle(doc, "dom:headline")?.id).toBe("headline");
    expect(resolveElementHandle(doc, "sel:.card#1")?.textContent).toBe("second");
  });

  it("resolves across realms, where a naive instanceof check fails", () => {
    const doc = previewDoc('<div id="headline">A</div>');
    const resolved = resolveElementHandle(doc, "dom:headline");

    expect(resolved).not.toBeNull();
    // The preview element is NOT an instance of Studio's own HTMLElement.
    expect(resolved instanceof HTMLElement).toBe(false);
  });

  it("returns null for a handle that no longer matches", () => {
    const doc = previewDoc('<div id="headline">A</div>');
    expect(resolveElementHandle(doc, "dom:deleted")).toBeNull();
    expect(resolveElementHandle(doc, "hf:missing")).toBeNull();
    expect(resolveElementHandle(doc, "sel:.card#0")).toBeNull();
  });

  it("returns null for an out-of-range occurrence rather than the wrong element", () => {
    const doc = previewDoc('<div class="card">only</div>');
    expect(resolveElementHandle(doc, "sel:.card#4")).toBeNull();
  });

  it("returns null for a selector that is invalid in this document", () => {
    const doc = previewDoc('<div class="card">only</div>');
    expect(resolveElementHandle(doc, "sel:>>>broken#0")).toBeNull();
  });

  it("returns null for a malformed handle", () => {
    const doc = previewDoc('<div id="headline">A</div>');
    expect(resolveElementHandle(doc, "nonsense")).toBeNull();
  });
});
