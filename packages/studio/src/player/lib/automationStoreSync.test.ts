// @vitest-environment happy-dom
import { beforeEach, describe, expect, it } from "vitest";
import { syncStoredAutomationFromPreview } from "./automationStoreSync";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";

const TWO_POINTS = '{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1}]}]}';
const RESTORED =
  '{"version":1,"lanes":[{"target":"volume","points":[{"t":0,"v":1},{"t":4,"v":0}]}]}';

const el = (over: Partial<TimelineElement> = {}): TimelineElement => ({
  id: "bgm",
  key: "bgm",
  tag: "audio",
  start: 0,
  duration: 10,
  track: 1,
  domId: "bgm",
  ...over,
});

/** A stand-in preview document carrying the attributes an undo would have written. */
function previewWith(attrs: Record<string, string>): Document {
  const doc = document.implementation.createHTMLDocument("preview");
  const audio = doc.createElement("audio");
  audio.id = "bgm";
  for (const [name, value] of Object.entries(attrs)) audio.setAttribute(name, value);
  doc.body.append(audio);
  return doc;
}

beforeEach(() => {
  usePlayerStore.getState().reset();
});

describe("syncStoredAutomationFromPreview", () => {
  it("reads back an envelope an undo restored on the preview", () => {
    // The bug: a soft undo patches the preview document and re-runs the timeline, but
    // the store keeps its own copy of the attributes and that copy is what a lane
    // draws — so an undone delete stayed invisible until the page was reloaded.
    usePlayerStore.setState({ elements: [el({ automation: TWO_POINTS })] });
    syncStoredAutomationFromPreview(previewWith({ "data-automation": RESTORED }));
    expect(usePlayerStore.getState().elements[0]?.automation).toBe(RESTORED);
  });

  it("reads back an undone FX chain too, since a lane's targets come from it", () => {
    const chain = '{"version":1,"nodes":[{"type":"lowpass","id":"n1","params":{}}]}';
    usePlayerStore.setState({ elements: [el()] });
    syncStoredAutomationFromPreview(previewWith({ "data-fx-chain": chain }));
    expect(usePlayerStore.getState().elements[0]?.fxChain).toBe(chain);
  });

  it("clears an attribute the undo removed", () => {
    usePlayerStore.setState({ elements: [el({ automation: TWO_POINTS })] });
    syncStoredAutomationFromPreview(previewWith({}));
    expect(usePlayerStore.getState().elements[0]?.automation).toBeUndefined();
  });

  it("finds the node by data-hf-id when the dom id does not match", () => {
    // Studio stamps hf-ids; an element discovered under a suffixed dom id still has
    // to resolve, or the sync silently skips it.
    const doc = document.implementation.createHTMLDocument("preview");
    const audio = doc.createElement("audio");
    audio.setAttribute("data-hf-id", "hf-snao");
    audio.setAttribute("data-automation", RESTORED);
    doc.body.append(audio);
    usePlayerStore.setState({ elements: [el({ domId: "bgm-2", hfId: "hf-snao" })] });
    syncStoredAutomationFromPreview(doc);
    expect(usePlayerStore.getState().elements[0]?.automation).toBe(RESTORED);
  });

  it("keeps the same array when nothing changed, so nothing re-renders", () => {
    usePlayerStore.setState({ elements: [el({ automation: RESTORED })] });
    const before = usePlayerStore.getState().elements;
    syncStoredAutomationFromPreview(previewWith({ "data-automation": RESTORED }));
    expect(usePlayerStore.getState().elements).toBe(before);
  });

  it("does nothing without a preview document", () => {
    usePlayerStore.setState({ elements: [el({ automation: TWO_POINTS })] });
    syncStoredAutomationFromPreview(null);
    expect(usePlayerStore.getState().elements[0]?.automation).toBe(TWO_POINTS);
  });
});
