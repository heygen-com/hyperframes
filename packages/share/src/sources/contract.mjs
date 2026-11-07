// @ts-check
// Load the bundled snapshot policy and Unicode registries from JSON or Brotli.
import { existsSync, readFileSync } from "node:fs";
import { brotliDecompressSync } from "node:zlib";

/** A registry's parsed JSON. @param {string} name a file in contract/, such as "path-policy.json" @returns {any} */
export function readContract(name) {
  const packed = new URL(`./contract/${name}.br`, import.meta.url);
  const text = existsSync(packed)
    ? brotliDecompressSync(readFileSync(packed)).toString("utf8")
    : readFileSync(new URL(`./contract/${name}`, import.meta.url), "utf8");
  return JSON.parse(text);
}
