import { WEB_CAPTURE_BUDGETS } from "@hyperframes/core/web-capture";

export interface CapturedModelDraft {
  mime: "model/gltf-binary";
  bytes: number;
  data: string;
  sourceName: string;
}

interface ResourceEntryLike {
  name: string;
}

type FetchModel = (input: string, init: RequestInit) => Promise<Response>;

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    chunks.push(String.fromCharCode(...bytes.subarray(offset, offset + 0x8000)));
  }
  return btoa(chunks.join(""));
}

function isGlb(bytes: Uint8Array): boolean {
  if (bytes.length < 12) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return (
    bytes[0] === 0x67 &&
    bytes[1] === 0x6c &&
    bytes[2] === 0x54 &&
    bytes[3] === 0x46 &&
    view.getUint32(4, true) === 2 &&
    view.getUint32(8, true) === bytes.length
  );
}

async function readBoundedBody(response: Response): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > WEB_CAPTURE_BUDGETS.modelBytes) return null;
  if (!response.body) return null;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > WEB_CAPTURE_BUDGETS.modelBytes) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

export async function discoverSameOriginGlb(
  entries: readonly ResourceEntryLike[],
  pageUrl: string,
  fetchModel: FetchModel = fetch,
): Promise<CapturedModelDraft | null> {
  const page = new URL(pageUrl);
  const candidates = [
    ...new Set(
      entries.flatMap(({ name }) => {
        try {
          const url = new URL(name, page);
          return url.origin === page.origin && /\.glb$/i.test(url.pathname) ? [url.href] : [];
        } catch {
          return [];
        }
      }),
    ),
  ];
  if (candidates.length !== 1) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), WEB_CAPTURE_BUDGETS.phaseDeadlineMs);
  try {
    const response = await fetchModel(candidates[0]!, {
      cache: "force-cache",
      credentials: "same-origin",
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const bytes = await readBoundedBody(response);
    if (!bytes || !isGlb(bytes)) return null;
    return {
      mime: "model/gltf-binary",
      bytes: bytes.byteLength,
      data: bytesToBase64(bytes),
      sourceName: new URL(candidates[0]!).pathname.split("/").pop() ?? "captured-model.glb",
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export function containsCanvas(target: Element): boolean {
  return target.tagName === "CANVAS" || target.querySelector("canvas") !== null;
}
