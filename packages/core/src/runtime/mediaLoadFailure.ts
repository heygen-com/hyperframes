import { postRuntimeMessage } from "./bridge";
import { isAudioElement, isSourceElement } from "./domRealm";
import { isRenderMode } from "./mediaProxy";
import { RUNTIME_MEDIA_LOAD_FAILED, type MediaLoadStage } from "./protocol";
import type { RuntimeJson } from "./types";

const reported = new WeakMap<HTMLMediaElement, Set<MediaLoadStage>>();

/** The file's extension, lower-cased, from the URL path; never its name. */
function extensionOf(el: HTMLMediaElement): string | null {
  const src = el.currentSrc || el.getAttribute("src") || "";
  try {
    const match = /\.([a-z0-9]{1,5})$/i.exec(new URL(src, document.baseURI).pathname);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

/** Tells the host once per element and stage that its media failed to load. `code` is the HTTP status of a fetch
 * that answered or the element's MediaError code; `bytes` the size fetched before a decode failed. */
export function reportMediaLoadFailure(
  el: HTMLMediaElement,
  stage: MediaLoadStage,
  code: number | null,
  bytes: number | null = null,
): void {
  if (isRenderMode(el)) return;
  const stages = reported.get(el) ?? new Set<MediaLoadStage>();
  if (stages.has(stage)) return;
  stages.add(stage);
  reported.set(el, stages);
  const asset = el.getAttribute("src") ?? "";
  const details: Record<string, RuntimeJson> = {
    asset,
    elementId: el.id || null,
    kind: el.tagName.toLowerCase(),
    stage,
    code,
    bytes,
    extension: extensionOf(el),
  };
  postRuntimeMessage({
    source: "hf-preview",
    type: "diagnostic",
    code: RUNTIME_MEDIA_LOAD_FAILED,
    details,
  });
  console.info(
    `[hyperframes] ${RUNTIME_MEDIA_LOAD_FAILED}: "${asset}" failed at ${stage}${code === null ? "" : ` (${code})`}.`,
  );
}

/** Reports each `<audio>` that fails to load; returns the cleanup. `error` does not bubble, so this listens in capture.
 * A `<source>` child gets the error instead of its `<audio>`.
 * Video is left out: mediaProxy answers a video's load error with a lighter copy, so it is not yet a failure. */
export function watchAudioLoadErrors(doc: Document): () => void {
  const onError = (event: Event) => {
    const target = event.target;
    const el = isSourceElement(target) ? target.parentElement : target;
    if (isAudioElement(el)) reportMediaLoadFailure(el, "element", el.error?.code ?? null);
  };
  doc.addEventListener("error", onError, true);
  return () => doc.removeEventListener("error", onError, true);
}
