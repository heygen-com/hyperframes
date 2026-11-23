import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Registry files that read composition variables and still write markup with `innerHTML` and friends, with how
 * many such writes each has today. A variable's value comes from whoever configures the item, including a docs
 * link someone shares, so a value written as markup can add elements and run script. New files that read
 * variables must set text with `textContent` or build nodes instead, and the files below may only lose writes.
 * Lower a count, or delete the entry, when a file is converted.
 *
 * chatgpt-exchange's remaining writes are its own icons and layout; its variable text already goes through
 * `textContent`.
 */
export const MARKUP_WRITE_BASELINE = new Map([
  ["registry/blocks/ai-chat-reveal/ai-chat-reveal.html", 2],
  ["registry/blocks/chatgpt-exchange/chatgpt-exchange.html", 4],
  ["registry/blocks/claude-exchange/claude-exchange.html", 6],
  ["registry/blocks/exploded-stack/exploded-stack.html", 1],
  ["registry/blocks/message-thread-reveal/message-thread-reveal.html", 1],
  ["registry/blocks/share-sheet-carousel/share-sheet-carousel.html", 1],
  ["registry/blocks/slack-notification-ad/slack-notification-ad.html", 1],
  ["registry/blocks/wireframe-portal-title/wireframe-portal-title.html", 1],
  ["registry/components/beat-timeline/beat-timeline.html", 1],
  ["registry/components/chat-message/chat-message.html", 2],
  ["registry/components/chat-thread/chat-thread.html", 4],
  ["registry/components/chat-thread/demo.html", 4],
  ["registry/components/cursor-context-menu/cursor-context-menu.html", 2],
  ["registry/components/cursor-marquee-select/cursor-marquee-select.html", 1],
  ["registry/components/multiplayer-cursors/multiplayer-cursors.html", 1],
  ["registry/components/notes-typing/demo.html", 1],
  ["registry/components/notes-typing/notes-typing.html", 1],
  ["registry/components/pan-stations/pan-stations.html", 2],
  ["registry/components/perspective-marquee/demo.html", 1],
  ["registry/components/perspective-marquee/perspective-marquee.html", 1],
  ["registry/components/screen-flow-carousel/screen-flow-carousel.html", 1],
  ["registry/components/scroll-feed/scroll-feed.html", 3],
  ["registry/components/social-proof-card/demo.html", 2],
  ["registry/components/social-proof-card/social-proof-card.html", 2],
  ["registry/components/sticky-mock-swap/sticky-mock-swap.html", 1],
]);

const READS_VARIABLES = /\bgetVariables\b|\b__hfVariables\b/;
const MARKUP_WRITE =
  /\.(?:inner|outer)HTML\s*\+?=(?!=)|\binsertAdjacentHTML\s*\(|\bdocument\.write(?:ln)?\s*\(/g;
const SOURCE_FILE = /\.(?:html|js|mjs)$/;

/** How many markup writes `source` makes, or 0 when it reads no variables. */
export function markupWrites(source) {
  if (!READS_VARIABLES.test(source)) return 0;
  return source.match(MARKUP_WRITE)?.length ?? 0;
}

/** Files whose markup writes exceed their baseline (0 for a file not listed), sorted by path. */
export function findMarkupWriteGrowth(counts, baseline = MARKUP_WRITE_BASELINE) {
  return [...counts]
    .filter(([path, count]) => count > (baseline.get(path) ?? 0))
    .map(([path, count]) => ({ path, count, allowed: baseline.get(path) ?? 0 }))
    .sort((a, b) => a.path.localeCompare(b.path));
}

export function registrySourceFiles(cwd = process.cwd()) {
  const result = spawnSync("git", ["ls-files", "-z", "registry"], { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ls-files exited with status ${result.status}`);
  }
  return result.stdout
    .split("\0")
    .filter((path) => SOURCE_FILE.test(path) && !path.includes(".test."));
}

export function checkRegistryMarkupWrites(cwd = process.cwd()) {
  const counts = new Map(
    registrySourceFiles(cwd).map((path) => [
      path,
      markupWrites(readFileSync(join(cwd, path), "utf8")),
    ]),
  );
  return findMarkupWriteGrowth(counts);
}

function main() {
  const grown = checkRegistryMarkupWrites();
  if (grown.length === 0) {
    console.log("Registry markup-write check passed.");
    return;
  }
  console.error(
    "Registry files that read variables write more markup than scripts/check-registry-innerhtml.mjs allows:",
  );
  for (const { path, count, allowed } of grown)
    console.error(`- ${path}: ${count} (allowed ${allowed})`);
  console.error(
    "Set variable text with textContent, or build elements with createElement, instead of innerHTML.",
  );
  process.exitCode = 1;
}

const entryPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (entryPath === fileURLToPath(import.meta.url)) main();
