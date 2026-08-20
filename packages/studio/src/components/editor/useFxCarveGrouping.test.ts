// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { carverAgainst, collectCarveCandidates } from "./useFxCarveGrouping";

function previewDoc(html: string): Document {
  const doc = document.implementation.createHTMLDocument("preview");
  doc.body.innerHTML = html;
  return doc;
}

/** What the panel would offer as sources for `bedId`, the way useFxCarve asks. */
function candidatesFor(doc: Document, bedId: string) {
  const others = Array.from(doc.querySelectorAll<HTMLAudioElement>("audio[id]")).filter(
    (a) => a.id !== bedId,
  );
  return collectCarveCandidates(doc, others, () => true, bedId).map((c) => c.id);
}

const GROUPED_VOICES = `
  <hf-audio-group id="voiceover" data-label="Voiceover"></hf-audio-group>
  <audio id="vo-1" data-audio-group="voiceover"></audio>
  <audio id="vo-2" data-audio-group="voiceover"></audio>
  <audio id="music-bed"></audio>
`;

describe("collectCarveCandidates", () => {
  // The observed bug: selecting vo-2 offered "Voiceover (2)" — the group vo-2 is
  // itself a member of. The caller filters out the bed element, but vo-1 survives
  // that filter and rolls up into exactly that group. Being the only candidate, it
  // was then applied without the author asking: a member ducking the bus it feeds.
  it("never offers a member the group it belongs to", () => {
    expect(candidatesFor(previewDoc(GROUPED_VOICES), "vo-2")).toEqual(["music-bed"]);
  });

  // And the mirror: a group bed's own id matches no <audio> id, so nothing
  // excluded it. Its members rolled up and handed the group back to itself.
  it("never offers a group itself", () => {
    const doc = previewDoc(GROUPED_VOICES);
    expect(candidatesFor(doc, "voiceover")).toEqual(["music-bed"]);
  });

  it("still offers a group the bed has nothing to do with", () => {
    const doc = previewDoc(`
      ${GROUPED_VOICES}
      <hf-audio-group id="sfx" data-label="SFX"></hf-audio-group>
      <audio id="sfx-click" data-audio-group="sfx"></audio>
    `);
    expect(candidatesFor(doc, "music-bed")).toEqual(["voiceover", "sfx"]);
  });

  it("leaves an ungrouped bed's candidates alone", () => {
    const doc = previewDoc(`<audio id="music-bed"></audio><audio id="vo-1"></audio>`);
    expect(candidatesFor(doc, "music-bed")).toEqual(["vo-1"]);
  });
});

describe("carverAgainst", () => {
  // The far-end guard has to see through a GROUP source. A plural carve names a
  // group — that is what the lint rule pushes authors toward — so matching raw
  // ids never found the member, the carve module was offered on a voice already
  // being ducked against, and switching it on wrote a reciprocal carve.
  it("finds the bed carving a voice through its group", () => {
    const doc = previewDoc(`
      ${GROUPED_VOICES}
      <audio id="bed" data-fx-carve='{"enabled":true,"sources":["voiceover"],"strength":0.3}'></audio>
    `);
    expect(carverAgainst(doc, "vo-1")).toBe("bed");
    expect(carverAgainst(doc, "vo-2")).toBe("bed");
  });

  it("still finds a carve that names the clip directly", () => {
    const doc = previewDoc(`
      ${GROUPED_VOICES}
      <audio id="bed" data-fx-carve='{"enabled":true,"sources":["vo-1"],"strength":0.3}'></audio>
    `);
    expect(carverAgainst(doc, "vo-1")).toBe("bed");
    expect(carverAgainst(doc, "vo-2")).toBeNull();
  });

  it("is null for a track nobody carves against", () => {
    const doc = previewDoc(GROUPED_VOICES);
    expect(carverAgainst(doc, "vo-1")).toBeNull();
  });
});
