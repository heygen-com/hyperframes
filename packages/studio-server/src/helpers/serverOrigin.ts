import { isIP, type AddressInfo } from "node:net";

export function originForListeningAddress(
  address: AddressInfo | string | null | undefined,
  protocol: "http" | "https" = "http",
  bindHost?: string,
): string | undefined {
  if (!address || typeof address === "string") return undefined;
  const bindName = bindHost?.trim() ?? "";
  if (bindName !== "" && bindName !== "*" && isIP(bindName) === 0) {
    return `${protocol}://${bindName}:${address.port}`;
  }
  const unspecified = address.address === "0.0.0.0" || address.address === "::";
  const host = unspecified ? "127.0.0.1" : address.address;
  return `${protocol}://${host.includes(":") ? `[${host}]` : host}:${address.port}`;
}

// Anchored at both ends: a `user@host` or path after the port would move the URL built from it.
const LOOPBACK_HOST_HEADER = /^(?:localhost|127(?:\.\d{1,3}){3}|\[::1\])(?::\d{1,5})?$/i;
const IN_PROCESS_ORIGIN = "http://localhost";

export function thumbnailPreviewOrigin(
  serverOrigin: string | undefined,
  hostHeader: string | undefined,
): string | null {
  if (serverOrigin) return serverOrigin;
  if (hostHeader === undefined) return IN_PROCESS_ORIGIN;
  return LOOPBACK_HOST_HEADER.test(hostHeader) ? `http://${hostHeader}` : null;
}
