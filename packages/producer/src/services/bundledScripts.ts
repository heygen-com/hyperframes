import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { gsapCdnDist } from "@hyperframes/core/gsap-cdn";

/** The folder holding the host's own copy of `gsap.min.js` at the version `gsapCdnDist()` names; set by a host that
 * ships one (the CLI's render), so a render needs no network for it. Unset, nothing is bundled. */
export const GSAP_VENDOR_DIR_ENV = "HYPERFRAMES_GSAP_VENDOR_DIR";

/** The host's own bytes for `url` when it is exactly the default CDN's GSAP file, else null. A mirror's URL differs, so
 * a configured `HYPERFRAMES_GSAP_BASE_URL` never matches and still wins. */
export function bundledScript(url: string): Uint8Array | null {
  const dir = process.env[GSAP_VENDOR_DIR_ENV];
  if (!dir || url !== `${gsapCdnDist()}gsap.min.js`) return null;
  const file = join(dir, "gsap.min.js");
  return existsSync(file) ? readFileSync(file) : null;
}
