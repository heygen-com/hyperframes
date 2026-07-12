import { applySoftReload } from "../utils/gsapSoftReload";
import { formatTimelineAttributeNumber } from "../player/components/timelineEditing";

export function patchDocumentRootDuration(doc: Document | null | undefined, contentEnd: number): boolean {
  if (!doc || !Number.isFinite(contentEnd) || contentEnd <= 0) return false;
  const nodes = Array.from(doc.querySelectorAll("[data-composition-id]"));
  const root = nodes.find((node) => !node.parentElement?.closest("[data-composition-id]")) ?? nodes[0] ?? null;
  if (!root) return false;
  root.setAttribute("data-duration", formatTimelineAttributeNumber(contentEnd));
  return true;
}

export function patchIframeRootDuration(iframe: HTMLIFrameElement | null, contentEnd: number): void {
  try { patchDocumentRootDuration(iframe?.contentDocument ?? null, contentEnd); } catch { /* best effort */ }
}

export interface GsapMutationOutcome { scriptText: string | null }

function readGsapMutationScriptText(body: unknown): string | null {
  if (typeof body !== "object" || body === null) return null;
  const text = (body as { scriptText?: unknown }).scriptText;
  return typeof text === "string" ? text : null;
}

export async function shiftGsapPositionsBatch(
  projectId: string,
  filePath: string,
  shifts: Array<{ elementId: string; delta: number }>,
): Promise<GsapMutationOutcome> {
  const payload = shifts.filter((s) => s.elementId && Number.isFinite(s.delta) && s.delta !== 0)
    .map((s) => ({ targetSelector: `#${s.elementId}`, delta: s.delta }));
  if (payload.length === 0) return { scriptText: null };
  const res = await fetch(`/api/projects/${projectId}/gsap-mutations/${encodeURIComponent(filePath)}`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ type: "shift-positions-batch", shifts: payload }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => null);
    throw new Error((err as { error?: string })?.error ?? "shift-positions-batch failed");
  }
  return { scriptText: readGsapMutationScriptText(await res.json().catch(() => null)) };
}

export function syncTimingEditPreview(
  iframe: HTMLIFrameElement | null,
  outcome: GsapMutationOutcome,
  currentTime: number,
  reloadPreview: () => void,
): void {
  if (!iframe || !outcome.scriptText) { reloadPreview(); return; }
  const result = applySoftReload(iframe, outcome.scriptText, {
    onAsyncFailure: reloadPreview, currentTimeOverride: currentTime,
  });
  if (result === "cannot-soft-reload") reloadPreview();
}
