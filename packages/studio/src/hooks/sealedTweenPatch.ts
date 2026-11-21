import type { RuntimeTweenChange } from "./gsapRuntimePatch";
import { sendPreviewWrite, type PreviewTicket } from "../utils/sealedPreviewLedger";

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

/** A sealed preview patches its own tweens; a refusal or no answer runs `fallback` after the group's last write. */
export function patchSealedPreview(
  ticket: PreviewTicket,
  patches: ReadonlyArray<{ selector: string; change: RuntimeTweenChange }>,
  lastWrite: boolean,
  fallback: () => void,
): void {
  const request = { patches: patches.map(wirePatch), seek: lastWrite };
  const { iframe } = ticket;
  const patched = sendPreviewWrite(ticket, "patch-tweens", request).then(
    (r) => typeof r === "object" && r?.patched === true,
  );
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
