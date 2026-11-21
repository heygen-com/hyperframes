// A scene-windowed preview mounts only the scenes near the playhead. Studio holds the scenes an element
// lives in, swaps edited scenes in place, and marks scenes stale; a sealed frame does each on itself.
import { SCENE_PART_ATTR, SCENE_PARTS_META, type SceneParts } from "../../sceneParts";
import { escapeCssString } from "../editingElement";
import { wallClearTimeout, wallSetTimeout } from "../wallClock";

const MAX_SCENE_NAMES = 256;
const MAX_NAME = 512;
const MAX_FILES = 256;
const MAX_FILE = 2_048;
export const MAX_SWAP_HTML = 50_000_000;
const MAX_SWAP_MS = 60_000;
const MAX_REASON = 500;

type SceneWindow = Window & {
  __hfHoldScenes?: (names: string[]) => Promise<void>;
  __hfSwapScenes?: (html: string, signal?: AbortSignal) => Promise<void>;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Object.prototype.toString.call(value) === "[object Object]";

const stringList = (value: unknown, count: number, length: number): value is string[] =>
  Array.isArray(value) &&
  value.length <= count &&
  value.every((item) => typeof item === "string" && item.length <= length);

/** Each preview file is inlined under a host marked with it; clearing a scene's hash makes the next swap redo it. */
export function markScenesStaleIn(doc: Document, files: readonly string[]): void {
  const meta = doc.querySelector<HTMLMetaElement>(`meta[name="${SCENE_PARTS_META}"]`);
  if (!meta) return;
  let parts: SceneParts;
  try {
    parts = JSON.parse(meta.content);
  } catch {
    return;
  }
  for (const file of files) {
    const hosts = doc.querySelectorAll(`[data-composition-file="${escapeCssString(file)}"]`);
    if (hosts.length === 0 && file.endsWith(".html")) parts.shared = "";
    for (const host of hosts) {
      const scene = host.closest(`[${SCENE_PART_ATTR}]`)?.getAttribute(SCENE_PART_ATTR);
      if (scene && scene in parts.scenes) parts.scenes[scene] = "";
    }
  }
  meta.content = JSON.stringify(parts);
}

export type HoldScenesParams = { names: string[] };
export type MarkScenesStaleParams = { files: string[] };
export type SwapScenesParams = { html: string; timeoutMs: number };
export type SwapScenesResult = { swapped: true } | { swapped: false; reason: string };

export function parseHoldScenes(params: unknown): HoldScenesParams | null {
  if (!isRecord(params) || Object.keys(params).join() !== "names") return null;
  return stringList(params.names, MAX_SCENE_NAMES, MAX_NAME) ? { names: params.names } : null;
}

export function parseMarkScenesStale(params: unknown): MarkScenesStaleParams | null {
  if (!isRecord(params) || Object.keys(params).join() !== "files") return null;
  return stringList(params.files, MAX_FILES, MAX_FILE) ? { files: params.files } : null;
}

export function parseSwapScenes(params: unknown): SwapScenesParams | null {
  if (!isRecord(params) || Object.keys(params).sort().join() !== "html,timeoutMs") return null;
  const { html, timeoutMs } = params;
  if (typeof html !== "string" || html.length === 0 || html.length > MAX_SWAP_HTML) return null;
  const okTimeout = typeof timeoutMs === "number" && timeoutMs > 0 && timeoutMs <= MAX_SWAP_MS;
  return okTimeout ? { html, timeoutMs } : null;
}

/** Waits until the named scenes are mounted; false when this preview mounts every scene anyway. */
export async function holdScenes({ names }: HoldScenesParams): Promise<{ held: boolean }> {
  const hold = (window as SceneWindow).__hfHoldScenes;
  if (typeof hold !== "function") return { held: false };
  await hold(names);
  return { held: true };
}

export function markScenesStale({ files }: MarkScenesStaleParams): { marked: true } {
  markScenesStaleIn(document, files);
  return { marked: true };
}

/** Swaps the edited scenes from the preview document Studio fetched; a swap past its time is aborted. */
export async function swapScenes({ html, timeoutMs }: SwapScenesParams): Promise<SwapScenesResult> {
  const swap = (window as SceneWindow).__hfSwapScenes;
  if (typeof swap !== "function")
    return { swapped: false, reason: "the preview cannot swap scenes" };
  const deadline = new AbortController();
  const timer = wallSetTimeout(
    () => deadline.abort(new Error("the swap took too long")),
    timeoutMs,
  );
  try {
    await swap(html, deadline.signal);
    return { swapped: true };
  } catch (error) {
    return { swapped: false, reason: String(error).slice(0, MAX_REASON) };
  } finally {
    wallClearTimeout(timer);
  }
}
