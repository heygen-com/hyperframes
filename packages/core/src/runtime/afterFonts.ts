import {
  AFTER_FONTS_CLAIM,
  COMPOSITION_SOURCE_URL,
  DEFERRED_FILE,
  typeAfterFonts,
} from "../compiler/scriptRuns";
import { postRuntimeMessage } from "./bridge";

/** Past the 3 s a font-display:block face holds text back, far under the engine's 45 s player-ready wait. */
export const FONT_WAIT_TIMEOUT_MS = 5000;

(window as unknown as Record<string, unknown>)[AFTER_FONTS_CLAIM] = true;

/** Resolves once the page's web fonts are ready or the timeout passes, reporting faces still loading. */
export async function waitForFonts(): Promise<void> {
  const fonts = document.fonts;
  if (!fonts) return;
  // Layout starts loading the faces laid-out text uses; with none loading, ready resolves at once.
  void document.body?.offsetHeight;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = await Promise.race([
    fonts.ready.then(() => false),
    new Promise<boolean>((resolve) => (timer = setTimeout(resolve, FONT_WAIT_TIMEOUT_MS, true))),
  ]);
  clearTimeout(timer);
  if (!timedOut) return;
  const loadingFamilies = [
    ...new Set(
      Array.from(fonts)
        .filter((face) => face.status === "loading")
        .map((face) => face.family),
    ),
  ];
  console.warn(
    `[hyperframes] fonts still loading after ${FONT_WAIT_TIMEOUT_MS} ms, composition scripts run without them: ${loadingFamilies.join(", ")}`,
  );
  postRuntimeMessage({
    source: "hf-preview",
    type: "diagnostic",
    code: "runtime_font_wait_timeout",
    details: { loadingFamilies, timeoutMs: FONT_WAIT_TIMEOUT_MS },
  });
}

type HeldListener = {
  target: EventTarget;
  type: string;
  listener: EventListenerOrEventListenerObject;
};

/** Queues DOMContentLoaded listeners, and load listeners once the page has loaded: both events have passed. */
function holdPassedLoadEvents(target: Document | Window, held: HeldListener[]): () => void {
  const own = Object.getOwnPropertyDescriptor(target, "addEventListener");
  const add = target.addEventListener;
  const hold = (
    type: string,
    listener: EventListenerOrEventListenerObject | null,
    options?: boolean | AddEventListenerOptions,
  ) => {
    if (!listener) return;
    const passed =
      type === "DOMContentLoaded" ||
      (type === "load" && target === window && document.readyState === "complete");
    if (passed) held.push({ target, type, listener });
    else add.call(target, type, listener, options);
  };
  target.addEventListener = hold;
  return () => {
    // A script that wrapped it meanwhile keeps its wrapper.
    if (target.addEventListener !== hold) return;
    if (own) Object.defineProperty(target, "addEventListener", own);
    else delete (target as { addEventListener?: unknown }).addEventListener;
  };
}

function endsWithSourceUrl(code: string): boolean {
  const trimmed = code.trimEnd();
  const lastLine = trimmed.slice(trimmed.lastIndexOf("\n") + 1).trimStart();
  return lastLine.startsWith("//# sourceURL=") || lastLine.startsWith("//@ sourceURL=");
}

function runInPlace(el: Element): HTMLScriptElement | undefined {
  if (!el.isConnected) return;
  const script = document.createElement("script");
  for (const { name, value } of Array.from(el.attributes)) script.setAttribute(name, value);
  const type = typeAfterFonts(el);
  if (type === null) script.removeAttribute("type");
  else script.setAttribute("type", type);
  // Not async: inserted src and module scripts then run in insertion order.
  script.async = el.hasAttribute("async");
  const text = el.textContent ?? "";
  const rendering = (window as Window & { __HF_RENDER_CAPTURE_MODE?: boolean })
    .__HF_RENDER_CAPTURE_MODE;
  const nameForPageErrors = rendering && !script.hasAttribute("src") && !endsWithSourceUrl(text);
  script.text = nameForPageErrors ? `${text}\n//# sourceURL=${COMPOSITION_SOURCE_URL}` : text;
  el.replaceWith(script);
  return script;
}

const loaded = (script: HTMLScriptElement) =>
  new Promise((resolve) => {
    script.addEventListener("load", resolve);
    script.addEventListener("error", resolve);
  });

// An inline module fires no load event; a module queued after the others runs once they have.
function afterQueuedModules(): Promise<unknown> {
  const sentinel = document.createElement("script");
  sentinel.type = "module";
  sentinel.async = false;
  sentinel.text = `document.dispatchEvent(new Event("hf-after-fonts-modules"))`;
  const ran = new Promise((resolve) =>
    document.addEventListener("hf-after-fonts-modules", resolve, { once: true }),
  );
  document.body.appendChild(sentinel);
  return ran.then(() => sentinel.remove());
}

/**
 * Once fonts are ready, runs each script in its own place in parser order (classic, then module and
 * deferred), calls `afterRun`, then the load listeners the scripts added after those events passed.
 */
export async function runScriptsAfterFonts(
  scripts: readonly Element[],
  afterRun?: () => void,
): Promise<void> {
  await waitForFonts();
  const isLate = (el: Element) => typeAfterFonts(el) === "module" || el.matches(DEFERRED_FILE);
  const held: HeldListener[] = [];
  const release = [document, window].map((target) => holdPassedLoadEvents(target, held));
  for (const el of [...scripts.filter((el) => !isLate(el)), ...scripts.filter(isLate)]) {
    const script = runInPlace(el);
    if (script?.hasAttribute("src") && !script.async && !script.noModule) await loaded(script);
    else if (typeAfterFonts(el) === "module") await afterQueuedModules();
  }
  for (const undo of release) undo();
  afterRun?.();
  for (const { target, type, listener } of held) {
    const event = new Event(type);
    try {
      if (typeof listener === "function") listener.call(target, event);
      else listener.handleEvent(event);
    } catch (error) {
      reportError(error);
    }
  }
}
