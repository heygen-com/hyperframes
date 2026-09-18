/** A composition is "ready" once every declared input settles, not just once
 * its duration is known. Each input returns null (nothing to wait on) or a
 * promise that resolves once it settles. */
export type CompositionReadinessInput = (doc: Document) => Promise<void> | null;

export interface PendingCompositionAssets {
  pendingMedia: HTMLMediaElement[];
  pendingImages: HTMLImageElement[];
  fontsLoading: boolean;
}

// HTMLMediaElement.HAVE_FUTURE_DATA per spec, used as a literal because not
// every DOM implementation defines the named static (e.g. happy-dom leaves
// it undefined).
const HAVE_FUTURE_DATA = 3;

// `doc` is a foreign (same-origin) iframe document, so its elements belong to
// that iframe's own realm — instanceof checks against this window's globals
// would silently reject every one of them. Resolve the class from the node's
// own defaultView first.
export function isRealmElement(node: Node): node is Element {
  const view = node.ownerDocument?.defaultView;
  if (view && node instanceof view.Element) return true;
  return node instanceof Element;
}

export function isRealmHtmlMediaElement(node: Node): node is HTMLMediaElement {
  if (!isRealmElement(node)) return false;
  if (node.tagName !== "AUDIO" && node.tagName !== "VIDEO") return false;
  const view = node.ownerDocument?.defaultView;
  if (view && node instanceof view.HTMLMediaElement) return true;
  return node instanceof HTMLMediaElement;
}

/** One DOM pass for every declared-media asset not yet ready. */
export function scanPendingCompositionAssets(doc: Document): PendingCompositionAssets {
  const pendingMedia = Array.from(doc.querySelectorAll("video, audio"))
    .filter(isRealmHtmlMediaElement)
    .filter((el) => el.readyState < HAVE_FUTURE_DATA);
  const pendingImages = Array.from(doc.querySelectorAll("img")).filter((img) => !img.complete);
  const fontsLoading = doc.fonts?.status === "loading";
  return { pendingMedia, pendingImages, fontsLoading };
}

function collectPendingCompositionAssets(
  doc: Document,
  { pendingMedia, pendingImages, fontsLoading }: PendingCompositionAssets,
): Promise<void> {
  const mediaReady = pendingMedia.map(
    (el) =>
      new Promise<void>((resolve) => {
        const onSettled = () => {
          el.removeEventListener("canplay", onSettled);
          el.removeEventListener("error", onSettled);
          resolve();
        };
        el.addEventListener("canplay", onSettled);
        el.addEventListener("error", onSettled);
      }),
  );
  const imagesReady = pendingImages.map((img) =>
    img.decode ? img.decode().catch(() => {}) : Promise.resolve(),
  );
  const fontsReady = fontsLoading && doc.fonts ? doc.fonts.ready.then(() => {}) : Promise.resolve();
  return Promise.all([...mediaReady, ...imagesReady, fontsReady]).then(() => {});
}

/** Declared-media readiness input: waits on the composition's own video,
 * audio, image and font-face loads. */
export function mediaReadinessInput(doc: Document): Promise<void> | null {
  const scan = scanPendingCompositionAssets(doc);
  if (scan.pendingMedia.length === 0 && scan.pendingImages.length === 0 && !scan.fontsLoading) {
    return null;
  }
  return collectPendingCompositionAssets(doc, scan);
}

const DEFAULT_TIMEOUT_MS = 8_000;

export interface CompositionReadinessResult {
  timedOut: boolean;
}

/** Invokes `onSettled` once every input settles, or the timeout elapses.
 * Calls back synchronously, before returning, when nothing is pending — a
 * caller that plays right after this call sees the decision already
 * applied, same as before this gate existed. */
export function settleCompositionReadiness(
  doc: Document,
  onSettled: (result: CompositionReadinessResult) => void,
  opts: { inputs?: CompositionReadinessInput[]; timeoutMs?: number } = {},
): void {
  const inputs = opts.inputs ?? [mediaReadinessInput];
  const pending = inputs.map((input) => input(doc)).filter((p): p is Promise<void> => p !== null);
  if (pending.length === 0) {
    onSettled({ timedOut: false });
    return;
  }

  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  let timeoutId: ReturnType<typeof setTimeout>;
  const timeout = new Promise<"timed-out">((resolve) => {
    timeoutId = setTimeout(() => resolve("timed-out"), timeoutMs);
  });
  Promise.race([Promise.all(pending).then(() => "done" as const), timeout]).then((result) => {
    clearTimeout(timeoutId);
    onSettled({ timedOut: result === "timed-out" });
  });
}
