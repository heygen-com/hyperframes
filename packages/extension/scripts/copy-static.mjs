import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
for (const file of ["manifest.json", "popup.html", "offscreen.html"]) {
  await writeFile(resolve(dist, file), await readFile(resolve(root, file)));
}
const icons = JSON.parse(await readFile(resolve(root, "assets/icons.base64.json"), "utf8"));
await mkdir(resolve(dist, "icons"), { recursive: true });
for (const [name, base64] of Object.entries(icons)) {
  await writeFile(resolve(dist, "icons", name), Buffer.from(base64, "base64"));
}
