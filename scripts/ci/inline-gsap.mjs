#!/usr/bin/env node
// inline-gsap.mjs <project dir>: puts GSAP into the project's html in place of its CDN script tags,
// so a smoke test's page never waits on the network. Fails when no tag is found, so a template change is noticed.
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const GSAP_TAG = /<script src="[^"]*\/gsap\.min\.js"><\/script>/g;

export const inlineGsap = (html, gsap) => html.replace(GSAP_TAG, () => `<script>${gsap}</script>`);

function htmlFiles(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return entry.name === "node_modules" ? [] : htmlFiles(path);
    return entry.name.endsWith(".html") ? [path] : [];
  });
}

export function inlineGsapInProject(dir, gsap) {
  let tags = 0;
  for (const file of htmlFiles(dir)) {
    const html = readFileSync(file, "utf8");
    const next = inlineGsap(html, gsap);
    if (next === html) continue;
    tags += html.match(GSAP_TAG).length;
    writeFileSync(file, next);
  }
  if (tags === 0) throw new Error(`no GSAP CDN script tag found under ${dir}`);
  return tags;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
  const gsapPath = createRequire(join(root, "packages", "core", "package.json")).resolve(
    "gsap/dist/gsap.min.js",
  );
  const tags = inlineGsapInProject(resolve(process.argv[2]), readFileSync(gsapPath, "utf8"));
  console.log(`inlined GSAP into ${tags} script tag(s)`);
}
