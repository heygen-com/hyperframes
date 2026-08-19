// @vitest-environment happy-dom
import { describe, expect, it } from "vitest";
import { collectCarveCandidates } from "./useFxCarveGrouping";

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
