import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readTrackedPaths } from "./check-tracked-artifacts.mjs";

const KEY_SHAPES = [
  /sk_V2_[A-Za-z0-9]+_[A-Za-z0-9]{8,}_[A-Za-z0-9]{24,}/g,
  /\bhg_[A-Za-z0-9]{24,}/g,
];
const MAX_SCANNED_BYTES = 4 * 1024 * 1024;

function looksRandom(value) {
  const tail = value.slice(value.lastIndexOf("_") + 1);
  const classes = [/[a-z]/, /[A-Z]/, /[0-9]/].filter((re) => re.test(tail)).length;
  return classes >= 2 && new Set(tail).size >= tail.length / 3;
}

export function findKeyShapedValues(text) {
  const found = [];
  for (const shape of KEY_SHAPES) {
    for (const match of text.matchAll(shape)) {
      if (looksRandom(match[0])) found.push(match.index);
    }
  }
  return found;
}

export function lineOf(text, index) {
  return text.slice(0, index).split("\n").length;
}

export function checkCommittedKeys(cwd = process.cwd()) {
  const hits = [];
  for (const path of readTrackedPaths(cwd)) {
    let buffer;
    try {
      buffer = readFileSync(resolve(cwd, path));
    } catch {
      continue;
    }
    if (buffer.length > MAX_SCANNED_BYTES || buffer.includes(0)) continue;
    const text = buffer.toString("utf8");
    for (const index of findKeyShapedValues(text)) hits.push(`${path}:${lineOf(text, index)}`);
  }
  return hits.sort();
}

function main() {
  const hits = checkCommittedKeys();
  if (hits.length === 0) {
    console.log("Committed key check passed.");
    return;
  }
  console.error("Values shaped like a live HeyGen API key are tracked by Git:");
  for (const hit of hits) console.error(`- ${hit}`);
  console.error('Build test keys at runtime from obvious filler, such as "x".repeat(32).');
  process.exitCode = 1;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) main();
