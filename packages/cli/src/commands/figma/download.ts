import { exceedsFreezeCap, MAX_FREEZE_BYTES } from "@hyperframes/core/figma";

/** Fetch a short-lived figma CDN render url into bytes. */
export async function downloadRender(url: string): Promise<Uint8Array> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`figma render download failed: HTTP ${res.status}`);
  // Reject oversized responses before buffering the body — the freeze cap
  // alone only fires after the full allocation.
  const declared = Number(res.headers.get("content-length") ?? 0);
  if (exceedsFreezeCap(declared))
    throw new Error(
      `figma render download failed: content-length ${declared} exceeds ${MAX_FREEZE_BYTES} cap`,
    );
  return new Uint8Array(await res.arrayBuffer());
}
