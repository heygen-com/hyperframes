/**
 * Which catalog (registry) items a project installed, and which of them the
 * composition being rendered actually reaches.
 *
 * `hyperframes add` is the only place that knows a file came from the registry
 * — installed files are plain composition HTML and carry no provenance marker —
 * so it records each item in `hyperframes.json`. Render reads that manifest
 * back and walks the composition's `data-composition-src` tree, letting the
 * render event report both halves: what the project pulled in, and what
 * survived into the video.
 *
 * The delta is the part no add-time event can produce. `registry_item_added`
 * says a block was installed; only this says it was then thrown away.
 */

import { readFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { parseHTML } from "linkedom";
import { type RegistryItemRecord, loadProjectConfig } from "./projectConfig.js";

/** Installed catalog items, and the subset the rendered composition reaches. */
export interface CatalogUsage {
  /** Every item name recorded by `hyperframes add`, sorted, deduped. */
  installed: string[];
  /**
   * Installed `hyperframes:block` items whose file is reachable from the render
   * entry. Components are excluded: they are pasted inline into the user's own
   * markup rather than mounted by src, so a component leaves no trace to match.
   */
  usedBlocks: string[];
}

const EMPTY: CatalogUsage = Object.freeze({ installed: [], usedBlocks: [] });

/**
 * Cap on files visited while walking the sub-composition tree. A composition
 * nests a handful of blocks; anything past this is a pathological or cyclic
 * project, and telemetry must not turn into an unbounded filesystem crawl.
 */
const MAX_VISITED_FILES = 250;

/** Cap on a single file fed to the parser, mirroring the composition census. */
const MAX_HTML_BYTES = 20 * 1024 * 1024;

/**
 * Cap on names reported per render. Registry names are low-cardinality slugs,
 * but a project with a hundred blocks should not push a hundred-name string
 * into every event.
 */
const MAX_REPORTED_ITEMS = 40;

/**
 * Item names are slug-gated before they reach the anonymous event stream, the
 * same guard `normalizeSkillSlug` applies to authoring skills: a custom or
 * hand-edited registry must not be able to push paths, PII, or unbounded
 * cardinality into telemetry. The two rules share a shape but not an owner —
 * a registry name and a skill slug are free to diverge.
 */
const REGISTRY_ITEM_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** Every `data-composition-src` value in one composition file. */
function subCompositionSrcs(html: string): string[] {
  const { document } = parseHTML(html);
  const srcs: string[] = [];
  for (const el of document.querySelectorAll("[data-composition-src]")) {
    const src = el.getAttribute("data-composition-src")?.trim();
    // Remote mounts have no local file to match an installed item against.
    if (src && !/^[a-z][a-z0-9+.-]*:/i.test(src)) srcs.push(src);
  }
  return srcs;
}

/**
 * Absolute paths of every composition file reachable from `entryPath` through
 * `data-composition-src`, entry included. Unreadable or unparseable files are
 * skipped rather than thrown: this feeds a telemetry property, and a render
 * that produced a video must never fail on the way to reporting it.
 */
function reachableCompositions(entryPath: string): Set<string> {
  const seen = new Set<string>();
  const queue = [resolve(entryPath)];
  while (queue.length > 0 && seen.size < MAX_VISITED_FILES) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);
    let html: string;
    try {
      html = readFileSync(current, "utf-8");
    } catch {
      continue;
    }
    if (html.length > MAX_HTML_BYTES) continue;
    try {
      for (const src of subCompositionSrcs(html)) {
        queue.push(resolve(dirname(current), src));
      }
    } catch {
      // Malformed markup: this file contributes no children, the walk goes on.
    }
  }
  return seen;
}

/** True when `target` (project-relative, per the manifest) is in `reachable`. */
function isReached(projectDir: string, target: string, reachable: Set<string>): boolean {
  // A manifest target is written project-relative. Guard against an absolute
  // or escaping one rather than resolving it against the wrong root.
  if (isAbsolute(target)) return false;
  const abs = resolve(projectDir, target);
  if (relative(projectDir, abs).startsWith("..")) return false;
  return reachable.has(abs);
}

function reportable(names: string[]): string[] {
  return [...new Set(names.filter((n) => REGISTRY_ITEM_NAME.test(n)))]
    .sort()
    .slice(0, MAX_REPORTED_ITEMS);
}

/**
 * Read the project's catalog manifest and resolve it against the composition
 * being rendered. Returns empty sets for a project that never ran
 * `hyperframes add`, which is the honest answer: no catalog items, not unknown.
 */
export function summarizeCatalogUsage(projectDir: string, entryPath: string): CatalogUsage {
  const items: RegistryItemRecord[] = loadProjectConfig(projectDir).registryItems ?? [];
  if (items.length === 0) return EMPTY;

  const installed = reportable(items.map((i) => i.name));
  if (installed.length === 0) return EMPTY;

  const reachable = reachableCompositions(entryPath);
  const usedBlocks = reportable(
    items
      .filter((i) => i.type === "hyperframes:block" && isReached(projectDir, i.target, reachable))
      .map((i) => i.name),
  );
  return { installed, usedBlocks };
}
