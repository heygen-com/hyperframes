import type { TimelineElement } from "../player/store/playerStore";
import { applyPatchByTarget, readAttributeByTarget } from "../utils/sourcePatcher";
import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";
import { saveProjectFilesWithHistory } from "../utils/studioFileHistory";
import type { EditHistoryKind } from "../utils/editHistory";

// ── Types ──

export interface RecordEditInput {
  label: string;
  kind: EditHistoryKind;
  coalesceKey?: string;
  files: Record<string, { before: string; after: string }>;
}

export function buildPatchTarget(element: {
  domId?: string;
  hfId?: string;
  selector?: string;
  selectorIndex?: number;
}) {
  if (element.domId) {
    return {
      id: element.domId,
      hfId: element.hfId,
      selector: element.selector,
      selectorIndex: element.selectorIndex,
    };
  }
  if (element.hfId) {
    return { hfId: element.hfId, selector: element.selector, selectorIndex: element.selectorIndex };
  }
  if (element.selector) {
    return { selector: element.selector, selectorIndex: element.selectorIndex };
  }
  return null;
}

export type PatchTarget = NonNullable<ReturnType<typeof buildPatchTarget>>;

// The runtime re-reads data-start/data-duration from the DOM on each sync tick
// (packages/core/src/runtime/init.ts:1324-1368), so attribute mutations here are
// picked up automatically on the next frame without a rebind call.
export function patchIframeDomTiming(
  iframe: HTMLIFrameElement | null,
  element: TimelineElement,
  attrs: Array<[string, string]>,
): void {
  try {
    const doc = iframe?.contentDocument;
    if (!doc) return;
    const el = element.domId
      ? doc.getElementById(element.domId)
      : element.selector
        ? (doc.querySelectorAll(element.selector)[element.selectorIndex ?? 0] ?? null)
        : null;
    if (!el) return;
    for (const [name, value] of attrs) el.setAttribute(name, value);
  } catch {
    // Cross-origin or mid-navigation — file save is enqueued; iframe patch is best-effort.
  }
}

export function resolveResizePlaybackStart(
  original: string,
  target: PatchTarget,
  element: TimelineElement,
  updates: Pick<TimelineElement, "start" | "playbackStart">,
): { attrName: string; value: number } | null {
  if (updates.playbackStart != null) {
    const attrName =
      element.playbackStartAttr === "playback-start" ? "playback-start" : "media-start";
    return { attrName, value: updates.playbackStart };
  }
  const trimDelta = updates.start - element.start;
  if (trimDelta === 0) return null;
  const raw =
    readAttributeByTarget(original, target, "playback-start") ??
    readAttributeByTarget(original, target, "media-start");
  const current = raw != null ? parseFloat(raw) : undefined;
  if (current == null || !Number.isFinite(current)) return null;
  const attrName =
    element.playbackStartAttr === "playback-start" ? "playback-start" : "media-start";
  return {
    attrName,
    value: Math.max(0, current + trimDelta * Math.max(element.playbackRate ?? 1, 0.1)),
  };
}

export interface PersistTimelineEditInput {
  projectId: string;
  element: TimelineElement;
  activeCompPath: string | null;
  label: string;
  buildPatches: (original: string, target: PatchTarget) => string;
  writeProjectFile: (path: string, content: string) => Promise<void>;
  recordEdit: (input: RecordEditInput) => Promise<void>;
  domEditSaveTimestampRef: React.MutableRefObject<number>;
  pendingTimelineEditPathRef: React.MutableRefObject<Set<string>>;
  coalesceKey?: string;
}

export async function persistTimelineEdit(input: PersistTimelineEditInput): Promise<void> {
  const targetPath = input.element.sourceFile || input.activeCompPath || "index.html";
  const originalContent = await readFileContent(input.projectId, targetPath);

  const patchTarget = buildPatchTarget(input.element);
  if (!patchTarget) {
    throw new Error(`Timeline element ${input.element.id} is missing a patchable target`);
  }

  const patchedContent = input.buildPatches(originalContent, patchTarget);
  if (patchedContent === originalContent) {
    throw new Error(`Unable to patch timeline element ${input.element.id} in ${targetPath}`);
  }

  input.pendingTimelineEditPathRef.current.add(targetPath);
  input.domEditSaveTimestampRef.current = Date.now();
  await saveProjectFilesWithHistory({
    projectId: input.projectId,
    label: input.label,
    kind: "timeline",
    coalesceKey: input.coalesceKey,
    files: { [targetPath]: patchedContent },
    readFile: async () => originalContent,
    writeFile: input.writeProjectFile,
    recordEdit: input.recordEdit,
  });
  input.domEditSaveTimestampRef.current = Date.now();
}

export async function readFileContent(projectId: string, targetPath: string): Promise<string> {
  if (targetPath.includes("\0") || targetPath.includes("..")) {
    throw new Error(`Unsafe path: ${targetPath}`);
  }
  const response = await fetch(
    `/api/projects/${projectId}/files/${encodeURIComponent(targetPath)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to read ${targetPath}`);
  }
  const data = (await response.json()) as { content?: string };
  if (typeof data.content !== "string") {
    throw new Error(`Missing file contents for ${targetPath}`);
  }
  return data.content;
}

/**
 * Shift all GSAP animation positions targeting a given element by a time delta.
 * Calls the server-side GSAP mutation endpoint which uses the AST-based parser.
 */
export async function shiftGsapPositions(
  projectId: string,
  filePath: string,
  elementId: string,
  delta: number,
): Promise<void> {
  if (delta === 0 || !elementId) return;
  const res = await fetch(
    `/api/projects/${projectId}/gsap-mutations/${encodeURIComponent(filePath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "shift-positions",
        targetSelector: `#${elementId}`,
        delta,
      }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error((err as { error?: string })?.error ?? "shift-positions failed");
  }
}

export async function scaleGsapPositions(
  projectId: string,
  filePath: string,
  elementId: string,
  oldStart: number,
  oldDuration: number,
  newStart: number,
  newDuration: number,
): Promise<void> {
  if (!elementId || oldDuration <= 0 || newDuration <= 0) return;
  if (oldStart === newStart && oldDuration === newDuration) return;
  const res = await fetch(
    `/api/projects/${projectId}/gsap-mutations/${encodeURIComponent(filePath)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "scale-positions",
        targetSelector: `#${elementId}`,
        oldStart,
        oldDuration,
        newStart,
        newDuration,
      }),
    },
  );
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error((err as { error?: string })?.error ?? "scale-positions failed");
  }
}

// Re-export applyPatchByTarget for use in the hook (avoids double import in callers)
export { applyPatchByTarget, formatTimelineAttributeNumber };
