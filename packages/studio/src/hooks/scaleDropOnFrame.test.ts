// @vitest-environment happy-dom
import { afterEach, describe, expect, it, vi } from "vitest";
import type { EditingDraft } from "@hyperframes/core/runtime/editing-port";
import { drawPreviewDraft, registerPreviewStandIn } from "../components/editor/previewDrafts";
import { previewRequest } from "../player/lib/previewChannel";
import { frameCentreScaledAt } from "./scaleDropOnFrame";

vi.mock("../player/lib/previewChannel", () => ({ previewRequest: vi.fn() }));
vi.mock("../player/lib/previewElements", () => ({
  previewGeometry: async () => ({ elements: [{ rect: { x: 0, y: 0, width: 10, height: 10 } }] }),
}));

afterEach(() => vi.mocked(previewRequest).mockReset());

type Shown = { sizeDrawn: boolean; scale: number };
type Sent = { kind: string; drafts?: EditingDraft[] };

type Asked = { drafts?: EditingDraft[]; props?: { scaleX?: number } };

/** A sealed frame that may paint after any message: what each message left on screen, and what was sent. */
function frameShowing(scale: number, { takesDraftsWithSet = true } = {}) {
  const painted: Shown[] = [];
  const sent: Sent[] = [];
  let sizeDrawn = true;
  const apply = (kind: string, { drafts = [], props }: Asked) => {
    for (const draft of drafts) if ("size" in draft) sizeDrawn = draft.size !== null;
    if (kind === "gsap-set") scale = props?.scaleX ?? scale;
  };
  const draftReply = {
    drawn: 1,
    drafts: {},
    ...(takesDraftsWithSet && { gsapSetTakesDrafts: true }),
  };
  vi.mocked(previewRequest).mockImplementation(async (_iframe, kind, params) => {
    const asked = params as Asked;
    sent.push({ kind, ...(asked.drafts && { drafts: asked.drafts }) });
    apply(kind, asked);
    painted.push({ sizeDrawn, scale });
    return kind === "draft" ? draftReply : { applied: true };
  });
  return { painted, sent };
}

async function dropScaledResize() {
  const standIn = document.createElement("div");
  const iframe = document.createElement("iframe");
  registerPreviewStandIn(standIn, iframe, "a:1");
  drawPreviewDraft(standIn, { size: { width: 307, height: 204 }, translate: { x: -33, y: -21 } });
  await frameCentreScaledAt(
    { standIn, iframe, handle: "a:1" },
    { x: 1.9, y: 1.9 },
    { x: 40, y: 30 },
  );
}

describe("frameCentreScaledAt", () => {
  // fails without the fix: the size ended in its own message, so the frame could paint the old scale with no size.
  it("never leaves the frame showing the old scale with the drawn size ended", async () => {
    const { painted } = frameShowing(1.5);
    await dropScaledResize();
    expect(painted).not.toContainEqual({ sizeDrawn: false, scale: 1.5 });
    expect(painted.at(-1)).toEqual({ sizeDrawn: false, scale: 1.9 });
  });

  it("sends an older runtime today's two messages and never a draft riding the set", async () => {
    const { painted, sent } = frameShowing(1.5, { takesDraftsWithSet: false });
    await dropScaledResize();
    const ending = { handle: "a:1", translate: null, size: null };
    expect(sent.slice(-2)).toEqual([{ kind: "draft", drafts: [ending] }, { kind: "gsap-set" }]);
    expect(sent.filter(({ kind, drafts }) => kind === "gsap-set" && drafts)).toEqual([]);
    expect(painted.at(-1)).toEqual({ sizeDrawn: false, scale: 1.9 });
  });
});
