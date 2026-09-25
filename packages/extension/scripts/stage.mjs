import { cp, mkdir, readdir, readFile, rm } from "node:fs/promises";
import { resolve, relative } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const stage = resolve(root, "store/unpacked");
const allowed = new Set([
  "background.js",
  "content.js",
  "offscreen.js",
  "popup.js",
  "manifest.json",
  "popup.html",
  "offscreen.html",
  "chunks/shared.js",
  "icons/icon-16.png",
  "icons/icon-32.png",
  "icons/icon-48.png",
  "icons/icon-128.png",
]);

async function filesUnder(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : [relative(dist, path)];
    }),
  );
  return nested.flat().sort();
}

const built = await filesUnder(dist);
const unexpected = built.filter((file) => !allowed.has(file) && !file.endsWith(".map"));
const missing = [...allowed].filter((file) => !built.includes(file));
if (unexpected.length || missing.length) {
  throw new Error(
    `Staged tree mismatch. Missing: ${missing.join(", ") || "none"}. Unexpected: ${unexpected.join(", ") || "none"}.`,
  );
}
const manifest = JSON.parse(await readFile(resolve(dist, "manifest.json"), "utf8"));
if ("web_accessible_resources" in manifest || "host_permissions" in manifest) {
  throw new Error(
    "The staged manifest must not expose web-accessible resources or host permissions.",
  );
}
for (const file of built.filter((path) => path.endsWith(".js"))) {
  const source = await readFile(resolve(dist, file), "utf8");
  if (/https?:\/\/|\beval\s*\(|\bnew Function\b|\bimport\s*\(/.test(source)) {
    throw new Error(`${file} contains remote or dynamic code.`);
  }
}
if (/^\s*import\b/m.test(await readFile(resolve(dist, "content.js"), "utf8"))) {
  throw new Error("content.js must be a self-contained injectable classic script.");
}
await rm(stage, { recursive: true, force: true });
await mkdir(stage, { recursive: true });
for (const file of allowed) {
  const target = resolve(stage, file);
  await mkdir(resolve(target, ".."), { recursive: true });
  await cp(resolve(dist, file), target);
}
console.log(`Staged ${allowed.size} extension files in store/unpacked.`);
