#!/usr/bin/env node
// Rebuilds the Catalog tab's sidebar from catalog-gallery-data.mdx, so counts and grouping
// are generated, not hand-maintained — the transform kaolti's build-docs-gallery.mjs applies
// to its own docs.json, ported and re-pointed at our file.
import fs from "node:fs";
import path from "node:path";
import { getCatalogTab, readCatalogGalleryData, readJson, resolveDocsRoot } from "./docs-catalog-shared.mjs";

export function buildNav(docs) {
  const data = readCatalogGalleryData(docs);
  const config = readJson(path.join(docs, "docs.json"));
  const tab = getCatalogTab(config);

  const groups = data.groups.map((g) => {
    const items = data.items.filter((i) => i.group === g.id);
    const sections = [...new Set(items.map((i) => i.section))];
    // Flattening a single section into the group's own page list loses that section's label
    // (sync-docs-catalog.mjs's walk() re-derives it from nav depth); only safe when the label
    // is the same as the group's, so nothing is lost.
    const pages = sections.length === 1 && sections[0] === g.label
      ? items.map((i) => i.href.slice(1))
      : sections.map((section) => {
          const selected = items.filter((i) => i.section === section);
          return { group: section, tag: String(selected.length), expanded: false, pages: selected.map((i) => i.href.slice(1)) };
        });
    return { group: g.label, tag: String(items.length), expanded: false, pages };
  });
  tab.groups = [{ group: "Catalog", pages: ["catalog/index", ...groups] }];
  fs.writeFileSync(path.join(docs, "docs.json"), JSON.stringify(config, null, 2) + "\n");
  console.log(`Rebuilt Catalog nav: ${groups.length} groups, ${data.items.length} items.`);
}

if (import.meta.url === `file://${process.argv[1]}`) buildNav(resolveDocsRoot(process.argv[2]).docs);
