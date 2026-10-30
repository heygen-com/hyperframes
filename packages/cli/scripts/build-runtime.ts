import { copyFileSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const coreDistDir = resolve(__dirname, "../../core/dist");

// Read the pre-built manifest to find the IIFE artifact name
const manifest = JSON.parse(readFileSync(resolve(coreDistDir, "hyperframe.manifest.json"), "utf8"));
const iifeFileName = manifest.artifacts?.iife ?? "hyperframe.runtime.iife.js";

// Copy the pre-built artifacts from core/dist — these have matching SHA256
// checksums. Do NOT regenerate via loadHyperframeRuntimeSource() as that
// produces output without the trailing newline, causing a checksum mismatch.
copyFileSync(resolve(coreDistDir, "hyperframe.manifest.json"), "dist/hyperframe.manifest.json");
copyFileSync(resolve(coreDistDir, iifeFileName), `dist/${iifeFileName}`);
