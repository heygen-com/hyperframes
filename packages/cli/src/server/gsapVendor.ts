import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { GSAP_CDN_VERSION, gsapCdnDist } from "@hyperframes/core/gsap-cdn";
import { readBundleFile } from "./readBundleFile.js";

export const GSAP_VENDOR_FILES = new Set([
  "gsap.min.js",
  "CustomEase.min.js",
  "MotionPathPlugin.min.js",
]);

function installedGsapDist(): string | null {
  try {
    const coreRequire = createRequire(resolve(__dirname, "..", "..", "..", "core", "package.json"));
    return join(dirname(coreRequire.resolve("gsap/package.json")), "dist");
  } catch {
    return null;
  }
}

/** The bundled GSAP dist dir, or null so preview keeps loading GSAP from jsDelivr. */
export function resolveGsapVendorDir(): string | null {
  const vendored = join("vendor", "npm", `gsap@${GSAP_CDN_VERSION}`, "dist");
  const candidates = [
    resolve(__dirname, vendored),
    // Running from source: the built CLI next door, then core's installed gsap.
    resolve(__dirname, "..", "..", "dist", vendored),
    installedGsapDist(),
  ];
  for (const dir of candidates) {
    if (!dir) continue;
    if (!existsSync(join(dir, "gsap.min.js"))) continue;
    const manifest = readBundleFile(join(dir, "..", "package.json"));
    if (manifest && JSON.parse(manifest.toString("utf-8")).version !== GSAP_CDN_VERSION) continue;
    return dir;
  }
  return null;
}

const CDN_DIST = gsapCdnDist();

/** The bundled copy of a jsDelivr GSAP file at the CLI's own version, or null for any other URL. */
export function bundledGsapFor(url: string): { body: Buffer; contentType: string } | null {
  if (!url.startsWith(CDN_DIST)) return null;
  const file = url.slice(CDN_DIST.length);
  const dir = GSAP_VENDOR_FILES.has(file) ? resolveGsapVendorDir() : null;
  const body = dir ? readBundleFile(join(dir, file)) : null;
  return body ? { body, contentType: "text/javascript; charset=utf-8" } : null;
}
