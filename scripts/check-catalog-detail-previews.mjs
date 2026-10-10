import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { assertDetailPreview, readJson, resolveDocsRoot } from "./docs-catalog-shared.mjs";

const { docs } = resolveDocsRoot(process.argv[2]);
let checked = 0;
for (const kind of ["blocks", "components"]) {
  const pages = join(docs, "catalog", kind);
  for (const name of readdirSync(pages).filter((name) => name.endsWith(".mdx"))) {
    const source = `/public/catalog/${kind}/${name.slice(0, -4)}.json`;
    const payload = join(docs, source.slice(1));
    assertDetailPreview(
      readFileSync(join(pages, name), "utf8"),
      existsSync(payload) ? readJson(payload) : {},
      source,
    );
    checked += 1;
  }
}
console.log(`PASS ${checked} catalog detail previews match their published payloads.`);
