import { postRuntimeMessage } from "./bridge";

type CopyState = { state: "making" | "ready" | "failed"; progress: number | null };

const REPORT_EVERY_MS = 1000;
const copies = new Map<HTMLMediaElement, CopyState>();
let reporting = false;
let reportedAny = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let dirtyWhileWaiting = false;

function report(): boolean {
  for (const el of copies.keys()) if (!el.isConnected) copies.delete(el);
  const states = [...copies.values()];
  const wanted = reporting && states.length > 0;
  if (!wanted && !reportedAny) return false;
  reportedAny = wanted;
  const made = states.reduce(
    (sum, copy) => sum + (copy.state === "ready" ? 1 : (copy.progress ?? 0)),
    0,
  );
  postRuntimeMessage({
    source: "hf-preview",
    type: "preview-copies",
    copies: wanted
      ? {
          total: states.length,
          ready: states.filter((copy) => copy.state === "ready").length,
          failed: states.filter((copy) => copy.state === "failed").length,
          progress: made / states.length,
          error: states.some((copy) => copy.state === "failed") ? "failed" : null,
        }
      : null,
  });
  return true;
}

function scheduleReport(): void {
  if (timer !== undefined) {
    dirtyWhileWaiting = true;
    return;
  }
  if (!report()) return;
  timer = setTimeout(() => {
    timer = undefined;
    if (dirtyWhileWaiting) {
      dirtyWhileWaiting = false;
      scheduleReport();
    }
  }, REPORT_EVERY_MS);
}

/** Starts counting the copies wanted at a level; at full quality none are wanted. */
export function setCopyReportingLevel(level: number): void {
  copies.clear();
  reporting = level < 1;
  clearTimeout(timer);
  timer = undefined;
  dirtyWhileWaiting = false;
  scheduleReport();
}

export function noteCopy(
  el: HTMLMediaElement,
  state: CopyState["state"],
  progress: number | null = null,
): void {
  if (!reporting) return;
  copies.set(el, { state, progress });
  scheduleReport();
}

export function failedCopyElements(): HTMLMediaElement[] {
  return [...copies].filter(([, copy]) => copy.state === "failed").map(([el]) => el);
}

/** True when every lighter copy wanted at this level is ready; true when none are wanted. */
export function copiesReady(): boolean {
  return [...copies.values()].every((copy) => copy.state === "ready");
}
