import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GSAP_CDN_VERSION } from "@hyperframes/core/gsap-cdn";

/** The host's GSAP_CDN_VERSION files; other versions it ships sit beside them at `../../gsap@<version>/dist`. */
export const GSAP_VENDOR_DIR_ENV = "HYPERFRAMES_GSAP_VENDOR_DIR";

const DEFAULT_CDN_GSAP_3 =
  /^https:\/\/cdn\.jsdelivr\.net\/npm\/gsap@(3\.\d+\.\d+)\/dist\/([A-Za-z]+\.min\.js)$/;

const read = (file: string) => (existsSync(file) ? readFileSync(file) : null);

/** The host's bytes for exactly this default-CDN GSAP file, at any version the host ships. */
export function bundledScript(url: string): Uint8Array | null {
  const dir = process.env[GSAP_VENDOR_DIR_ENV];
  const [, version, file] = DEFAULT_CDN_GSAP_3.exec(url) ?? [];
  if (!dir || !version || !file) return null;
  const at = version === GSAP_CDN_VERSION ? dir : join(dir, "..", "..", `gsap@${version}`, "dist");
  return read(join(at, file));
}

/** The same file at the host's own GSAP version, for one the network could not bring. */
export function bundledGsapStandIn(url: string): Uint8Array | null {
  const dir = process.env[GSAP_VENDOR_DIR_ENV];
  const [, , file] = DEFAULT_CDN_GSAP_3.exec(url) ?? [];
  return dir && file ? read(join(dir, file)) : null;
}
