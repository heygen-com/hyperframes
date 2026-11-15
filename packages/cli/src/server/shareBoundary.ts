import { randomBytes, timingSafeEqual } from "node:crypto";

const isLoopbackSocketPeer = (address: string | undefined): boolean => {
  const ip = address?.replace(/^::ffff:/i, "") ?? "";
  return ip === "::1" || /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(ip);
};

export function localShareRequestAllowed(
  request: Request,
  socketPeer: string | undefined,
): boolean {
  if (!isLoopbackSocketPeer(socketPeer)) return false;
  const host = request.headers.get("host");
  if (!host || request.headers.get("sec-fetch-site") !== "same-origin") return false;
  try {
    const local = new URL(`http://${host}`);
    if (local.host !== host || !["localhost", "127.0.0.1", "[::1]"].includes(local.hostname))
      return false;
    const origin = request.headers.get("origin");
    if (origin !== null) return origin === local.origin;
    const referer = request.headers.get("referer");
    return referer !== null && new URL(referer).origin === local.origin;
  } catch {
    return false;
  }
}

export function createShareCsrf() {
  const token = randomBytes(32).toString("base64url");
  return {
    token,
    accepts(value: string | null) {
      return (
        value !== null &&
        Buffer.byteLength(value) === Buffer.byteLength(token) &&
        timingSafeEqual(Buffer.from(value), Buffer.from(token))
      );
    },
  };
}
