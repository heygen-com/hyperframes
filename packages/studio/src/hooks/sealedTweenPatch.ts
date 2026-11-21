import type { RuntimeTweenChange } from "./gsapRuntimePatch";
import { previewRequest } from "../player/lib/previewChannel";

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

/** A sealed preview patches its own tweens; a refusal, or no answer, reloads it once after the group's last write. */
export function patchSealedPreview(
  iframe: HTMLIFrameElement,
  patches: ReadonlyArray<{ selector: string; change: RuntimeTweenChange }>,
  lastWrite: boolean,
  reloadPreview: () => void,
): void {
  const request = { patches: patches.map(wirePatch), seek: lastWrite };
  const patched = previewRequest(iframe, "patch-tweens", request).then((r) => r?.patched === true);
  const earlier = sealedGroupPatched.get(iframe) ?? Promise.resolve(true);
  const group = Promise.all([earlier, patched]).then(([a, b]) => a && b);
  if (!lastWrite) {
    sealedGroupPatched.set(iframe, group);
    return;
  }
  sealedGroupPatched.delete(iframe);
  void group.then((all) => {
    if (!all) reloadPreview();
  });
}
