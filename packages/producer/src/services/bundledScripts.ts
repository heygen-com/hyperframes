import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gsapCdnDist } from "@hyperframes/core/gsap-cdn";

/** The folder a host that ships its own GSAP names, so a render needs no network for it. */
export const GSAP_VENDOR_DIR_ENV = "HYPERFRAMES_GSAP_VENDOR_DIR";

/** The host's bytes for exactly the default CDN's GSAP file; a mirror's URL differs, so it never matches. */
export function bundledScript(url: string): Uint8Array | null {
  const dir = process.env[GSAP_VENDOR_DIR_ENV];
  if (!dir || url !== `${gsapCdnDist()}gsap.min.js`) return null;
  const file = join(dir, "gsap.min.js");
  return existsSync(file) ? readFileSync(file) : null;
}
