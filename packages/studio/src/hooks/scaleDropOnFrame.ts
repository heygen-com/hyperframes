/** The scale route's drop correction on a sealed frame: the frame draws and measures, over its port. */
import type { EditingDraft } from "@hyperframes/core/runtime/editing-port";
import {
  drawPreviewDraft,
  previewDraftRidingGsapSet,
  previewDraftsSent,
  previewStandIn,
} from "../components/editor/previewDrafts";
import { previewRequest } from "../player/lib/previewChannel";
import { previewGeometry } from "../player/lib/previewElements";

type Point = { x: number; y: number };
export type SealedScaleFrame = { standIn: Element; iframe: HTMLIFrameElement; handle: string };

export function sealedScaleFrame(standIn: Element): SealedScaleFrame | null {
  const target = previewStandIn(standIn);
  return target ? { standIn, ...target } : null;
}

/** The centre of the frame element's box, as the frame shows it once every drawn draft has landed. */
export async function frameBoxCentre(frame: SealedScaleFrame): Promise<Point | null> {
  await previewDraftsSent(frame.iframe);
  const rect = (await previewGeometry(frame.iframe, [frame.handle]))?.elements[0]?.rect;
  return rect ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 } : null;
}

const gsapSet = (frame: SealedScaleFrame, props: Record<string, number>, drafts?: EditingDraft[]) =>
  previewRequest(frame.iframe, "gsap-set", {
    handle: frame.handle,
    props,
    ...(drafts && { drafts }),
  });

async function endSizeAndSetInOneFrameTask(frame: SealedScaleFrame, props: Record<string, number>) {
  await previewDraftsSent(frame.iframe);
  const ending = previewDraftRidingGsapSet(frame.standIn, { size: null, translate: null });
  if (!ending) return false;
  await gsapSet(frame, props, [ending]);
  return true;
}

/** The box with the committed scale at `at` and no draft, as the save will render it; its centre. */
export async function frameCentreScaledAt(
  frame: SealedScaleFrame,
  scale: Point,
  at: Point,
): Promise<Point | null> {
  const props = { scaleX: scale.x, scaleY: scale.y, x: at.x, y: at.y };
  if (!(await endSizeAndSetInOneFrameTask(frame, props))) {
    drawPreviewDraft(frame.standIn, { size: null, translate: null });
    await previewDraftsSent(frame.iframe);
    await gsapSet(frame, props);
  }
  return frameBoxCentre(frame);
}

export const drawFramePosition = (frame: SealedScaleFrame, at: Point) =>
  gsapSet(frame, { x: at.x, y: at.y });
