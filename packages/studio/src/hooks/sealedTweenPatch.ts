import type { RuntimeTweenChange } from "./gsapRuntimePatch";
import { sendPreviewWrite, type PreviewTicket } from "../utils/sealedPreviewLedger";
import { sendPreviewDraftEnds, takePreviewDraftEnds } from "../components/editor/previewDrafts";

const definedChannels = <T extends object>(props: T): T =>
  Object.fromEntries(Object.entries(props).filter(([, v]) => v !== undefined)) as T;

function wireChange(change: RuntimeTweenChange): RuntimeTweenChange {
  switch (change.kind) {
    case "keyframes":
      return { ...change, keyframes: change.keyframes.map(definedChannels) };
    case "keyframe-rebuild":
      return { ...change, props: definedChannels(change.props) };
    default:
      return { ...change, props: definedChannels(change.props) };
  }
}

const wirePatch = ({ selector, change }: { selector: string; change: RuntimeTweenChange }) => ({
  selector,
  change: wireChange(change),
});

const sealedGroupPatched = new WeakMap<HTMLIFrameElement, Promise<boolean>>();

const channelsOf = (change: RuntimeTweenChange) =>
  change.kind === "keyframes" ? change.keyframes.flatMap(Object.keys) : Object.keys(change.props);

const selectorsNotWritingScale = (
  patches: ReadonlyArray<{ selector: string; change: RuntimeTweenChange }>,
) =>
  patches
    .filter(({ change }) => !channelsOf(change).some((channel) => channel.startsWith("scale")))
    .map(({ selector }) => selector);

/** A sealed preview patches its own tweens; a refusal or no answer runs `fallback` after the group's last write. */
export function patchSealedPreview(
  ticket: PreviewTicket,
  patches: ReadonlyArray<{ selector: string; change: RuntimeTweenChange }>,
  lastWrite: boolean,
  fallback: () => void,
): void {
  const { iframe } = ticket;
  const endsDrafts = takePreviewDraftEnds(iframe, selectorsNotWritingScale(patches));
  const request = {
    patches: patches.map(wirePatch),
    seek: lastWrite,
    ...(endsDrafts.length && { endsDrafts }),
  };
  const patched = sendPreviewWrite(ticket, "patch-tweens", request).then((r) => {
    const landed = typeof r === "object" && r?.patched === true;
    if (!landed) sendPreviewDraftEnds(iframe, endsDrafts);
    return landed;
  });
  const earlier = sealedGroupPatched.get(iframe) ?? Promise.resolve(true);
  const group = Promise.all([earlier, patched]).then(([a, b]) => a && b);
  if (!lastWrite) {
    sealedGroupPatched.set(iframe, group);
    return;
  }
  sealedGroupPatched.delete(iframe);
  void group.then((all) => {
    if (!all) fallback();
  });
}
