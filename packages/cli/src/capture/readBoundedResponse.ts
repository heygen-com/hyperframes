export interface DownloadByteBudget {
  remainingBytes: number;
}

/** Shared by the font and image passes of one website capture. */
export function createCaptureDownloadBudget(): DownloadByteBudget {
  return { remainingBytes: 100 * 1024 * 1024 };
}

/** Read a download without trusting Content-Length or retaining an oversized response. */
export async function readBoundedResponse(
  response: Response,
  maxBytes: number,
  budget?: DownloadByteBudget,
): Promise<Buffer | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  let complete = false;
  try {
    const declared = Number(response.headers.get("content-length"));
    if (declared > Math.min(maxBytes, budget?.remainingBytes ?? maxBytes)) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        return Buffer.concat(chunks, total);
      }
      if (budget) {
        const available = budget.remainingBytes;
        budget.remainingBytes = Math.max(0, available - value.byteLength);
        if (value.byteLength > available) return null;
      }
      total += value.byteLength;
      if (total > maxBytes) return null;
      chunks.push(value);
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
