import { describe, expect, it } from "bun:test";
import type { ElementStackingInfo } from "@hyperframes/engine";
import {
  type DomSnapshotLike,
  findBlindSpotsInSnapshot,
  overlayFingerprintKey,
  stackingFingerprint,
} from "./overlayFingerprint.js";

function entry(id: string, overrides: Partial<ElementStackingInfo> = {}): ElementStackingInfo {
  return {
    id,
    zIndex: 0,
    x: 0,
    y: 0,
    width: 10,
    height: 10,
    layoutWidth: 10,
    layoutHeight: 10,
    opacity: 1,
    visible: true,
    renderFrameVisible: false,
    isHdr: false,
    transform: "none",
    borderRadius: [0, 0, 0, 0],
    objectFit: "fill",
    objectPosition: "50% 50%",
    clipRect: null,
    ...overrides,
  };
}

describe("stackingFingerprint", () => {
  it("leaves out the passthrough video's own entry", () => {
    const shown = [entry("video", { isHdr: true, renderFrameVisible: true }), entry("cue")];
    const hidden = [entry("video", { isHdr: true, renderFrameVisible: false }), entry("cue")];
    expect(stackingFingerprint(shown, "video")).toBe(stackingFingerprint(hidden, "video"));
  });

  it("changes with any overlay entry's box, opacity or visibility", () => {
    const base = stackingFingerprint([entry("video"), entry("cue")], "video");
    for (const change of [{ x: 1 }, { opacity: 0.99 }, { visible: false }, { zIndex: 2 }]) {
      expect(stackingFingerprint([entry("video"), entry("cue", change)], "video")).not.toBe(base);
    }
  });
});

describe("overlayFingerprintKey", () => {
  it("is a sha256 that separates page states, stackings and kinds", () => {
    const key = overlayFingerprintKey({ kind: "digest", value: "ab" }, "[]");
    expect(key).toMatch(/^[0-9a-f]{64}$/);
    expect(overlayFingerprintKey({ kind: "digest", value: "ab" }, "[]")).toBe(key);
    expect(overlayFingerprintKey({ kind: "text", value: "ab" }, "[]")).not.toBe(key);
    expect(overlayFingerprintKey({ kind: "digest", value: "ac" }, "[]")).not.toBe(key);
    expect(overlayFingerprintKey({ kind: "digest", value: "ab" }, "[1]")).not.toBe(key);
    // The separator keeps a shifted boundary between the two parts from colliding.
    expect(overlayFingerprintKey({ kind: "digest", value: "a" }, "b[]")).not.toBe(
      overlayFingerprintKey({ kind: "digest", value: "ab" }, "[]"),
    );
  });
});

/**
 * A snapshot of one or more documents: node names, each node's parent (default: the node before
 * it), and the shadow tree type of the nodes inside one (`trees`, node index -> type).
 */
function snapshot(
  ...documents: Array<{ names: string[]; parents?: number[]; trees?: Record<number, string> }>
): DomSnapshotLike {
  const strings: string[] = [];
  const intern = (text: string) => {
    const at = strings.indexOf(text);
    return at >= 0 ? at : strings.push(text) - 1;
  };
  return {
    strings,
    documents: documents.map(({ names, parents, trees = {} }) => ({
      nodes: {
        parentIndex: parents ?? names.map((_, i) => i - 1),
        nodeName: names.map(intern),
        shadowRootType: {
          index: Object.keys(trees).map(Number),
          value: Object.values(trees).map(intern),
        },
      },
    })),
  };
}

describe("findBlindSpotsInSnapshot", () => {
  it("finds nothing in a page of plain elements, open and user-agent shadow roots", () => {
    // VIDEO hosts its controls (user-agent), DIV an open tree holding SPAN and its text.
    const page = snapshot({
      names: ["#document", "HTML", "BODY", "VIDEO", "DIV", "DIV", "SPAN", "#text"],
      parents: [-1, 0, 1, 2, 3, 2, 5, 6],
      trees: { 4: "user-agent", 6: "open", 7: "open" },
    });
    expect(findBlindSpotsInSnapshot(page)).toBeNull();
  });

  it("counts closed shadow roots by host, as the snapshot flattens their trees", () => {
    // Two hosts (3 and 6); host 3's closed tree holds two elements and a text node.
    const page = snapshot({
      names: ["#document", "HTML", "BODY", "DIV", "B", "#text", "DIV", "I", "I"],
      parents: [-1, 0, 1, 2, 3, 4, 2, 6, 3],
      trees: { 4: "closed", 5: "closed", 7: "closed", 8: "closed" },
    });
    expect(findBlindSpotsInSnapshot(page)).toBe("2 closed shadow root(s)");
  });

  it("finds every element that embeds a document, whatever case its name is in", () => {
    const page = snapshot(
      { names: ["#document", "HTML", "OBJECT", "embed", "IFRAME", "OBJECT"] },
      { names: ["#document", "svg"] },
    );
    expect(findBlindSpotsInSnapshot(page)).toBe("2 <object>, 1 <embed>, 1 <iframe>");
  });

  it("finds a content document even when no embedding element is named", () => {
    const page = snapshot({ names: ["#document", "HTML"] }, { names: ["#document"] });
    expect(findBlindSpotsInSnapshot(page)).toBe("1 embedded document(s)");
  });
});
