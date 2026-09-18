#!/usr/bin/env node
// AD92: rebuild the Catalog tab's sidebar from catalog-gallery-data.mdx, so counts and
// grouping are generated, not hand-maintained — the same transform kaolti's
// build-docs-gallery.mjs applies to its own docs.json (ported logic, re-pointed at our file).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const docs = path.resolve(process.argv[2] || path.join(root, "docs"));
const data = JSON.parse(fs.readFileSync(path.join(docs, "snippets/catalog-gallery-data.mdx"), "utf8").replace(/^export const catalogGalleryData = /, "").replace(/;\s*$/, ""));
const config = JSON.parse(fs.readFileSync(path.join(docs, "docs.json"), "utf8"));
const tab = config.navigation.tabs.find((t) => t.tab === "Catalog");

const groups = data.groups.map((g) => {
  const items = data.items.filter((i) => i.group === g.id);
  const sections = [...new Set(items.map((i) => i.section))];
  const pages = sections.length === 1
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
