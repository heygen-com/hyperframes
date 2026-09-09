/** Read a download without trusting Content-Length or retaining an oversized response. */
export async function readBoundedResponse(
  response: Response,
  maxBytes: number,
): Promise<Buffer | null> {
  if (!response.body) return null;
  const reader = response.body.getReader();
  let complete = false;
  try {
    const declared = Number(response.headers.get("content-length"));
    if (declared > maxBytes) return null;
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        return Buffer.concat(chunks, total);
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
