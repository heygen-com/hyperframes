// @ts-check
// The bytes of a review version: its checksum, and the signed PUT to storage.
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { reviewUploadOrigins } from "./host.mjs";

/** The checksum the export route takes: the SHA-256 digest as padded base64, never hex.
 * @param {string} file @returns {Promise<string>} */
export function fileSha256Base64(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    createReadStream(file)
      .on("data", (chunk) => hash.update(chunk))
      .on("error", reject)
      .on("end", () => resolve(hash.digest("base64")));
  });
}

/** @typedef {"sent" | "expired" | "refused" | "offline"} PutOutcome */

/** Streams the file to the signed URL through main's fetch (the app's proxy), the server's headers as given plus
 * the length, and no bearer. Nothing sent or answered for `stallMs` ends it as offline, never "Uploading" forever.
 * @param {{ put_url: string, headers: Record<string, string> }} upload @param {string} file @param {number} size
 * @param {(sent: number) => void} onSent @param {{ stallMs?: number, fetchImpl?: typeof fetch }} [options] */
export async function putFile(
  upload,
  file,
  size,
  onSent,
  { stallMs = 60_000, fetchImpl = fetch } = {},
) {
  let target;
  try {
    target = new URL(upload.put_url);
  } catch {
    return "refused";
  }
  const loopback = target.protocol === "http:" && target.hostname === "127.0.0.1";
  if (
    (target.protocol !== "https:" && !loopback) ||
    target.username ||
    target.password ||
    target.hash ||
    !reviewUploadOrigins().includes(target.origin)
  ) {
    return "refused";
  }
  const stall = new AbortController();
  /** @type {ReturnType<typeof setTimeout> | undefined} */
  let timer;
  const arm = () => (clearTimeout(timer), (timer = setTimeout(() => stall.abort(), stallMs)));
  let sent = 0;
  // Pulled, never read ahead: a chunk is read when the network takes it, so the stall timer measures sending.
  const stream = createReadStream(file);
  const chunks = stream[Symbol.asyncIterator]();
  const body = new ReadableStream(
    {
      async pull(controller) {
        const { value, done } = await chunks.next();
        if (done) return controller.close();
        sent += value.length;
        arm();
        onSent(sent);
        controller.enqueue(value);
      },
      cancel: () => void chunks.return?.(),
    },
    { highWaterMark: 0 },
  );
  arm();
  try {
    /** @type {RequestInit & {duplex: "half"}} */
    const request = {
      method: "PUT",
      headers: { ...upload.headers, "content-length": String(size) },
      body,
      duplex: "half",
      redirect: "manual",
      signal: stall.signal,
    };
    const reply = await fetchImpl(target, request);
    return await outcomeOf(reply);
  } catch (error) {
    console.error("[review] upload failed:", /** @type {Error} */ (error).name);
    return "offline";
  } finally {
    clearTimeout(timer);
    stream.destroy();
  }
}

/** S3 answers 403 both when the signed URL has expired and when the signature does not match; only the first is
 * fixed by fresh instructions. @param {Response} reply @returns {Promise<PutOutcome>} */
async function outcomeOf(reply) {
  if (reply.status < 300) return (await reply.body?.cancel(), "sent");
  const text = await reply.text().catch(() => "");
  return reply.status === 403 && /expired/i.test(text) ? "expired" : "refused";
}
