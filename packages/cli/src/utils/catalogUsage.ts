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
import { isAbsolute, relative, resolve } from "node:path";
import { collectSubCompositionSrcs } from "@hyperframes/parsers/asset-resolution";
import { type RegistryItemRecord, readProjectConfigWithStatus } from "./projectConfig.js";

/** Installed catalog items, and the subset the rendered composition reaches. */
export interface CatalogUsage {
  /**
   * Every item name recorded by `hyperframes add`, sorted, deduped, slug-gated.
   * Not truncated: the reporting cap belongs to whoever builds the event
   * string, so a count taken from this array is the real number.
   */
  installed: string[];
  /**
   * Installed `hyperframes:block` items whose file is reachable from the render
   * entry. Always a subset of {@link installed}. Components are excluded: they
   * are pasted inline into the user's own markup rather than mounted by src, so
   * a component leaves no trace to match.
   */
  usedBlocks: string[];
  /**
   * True when `hyperframes.json` exists but could not be read or parsed.
   *
   * A degraded read must not look like a project that never touched the
   * catalog: the no-catalog cohort is the control this whole feature is
   * measured against, and quietly enrolling failures into it biases the
   * comparison toward "the catalog makes no difference".
   */
  manifestUnreadable: boolean;
}

const EMPTY: CatalogUsage = Object.freeze({
  installed: [],
  usedBlocks: [],
  manifestUnreadable: false,
});

const UNREADABLE: CatalogUsage = Object.freeze({
  installed: [],
  usedBlocks: [],
  manifestUnreadable: true,
});

/**
 * Cap on files visited while walking the sub-composition tree. A composition
 * nests a handful of blocks; anything past this is a pathological or cyclic
 * project, and telemetry must not turn into an unbounded filesystem crawl.
 */
const MAX_VISITED_FILES = 250;

/** Cap on a single file fed to the scanner, mirroring the composition census. */
const MAX_HTML_BYTES = 20 * 1024 * 1024;

/**
 * Item names are slug-gated before they reach the anonymous event stream, the
 * same guard `normalizeSkillSlug` applies to authoring skills: a custom or
 * hand-edited registry must not be able to push paths, PII, or unbounded
 * cardinality into telemetry. The two rules share a shape but not an owner —
 * a registry name and a skill slug are free to diverge.
 */
const REGISTRY_ITEM_NAME = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Absolute paths of every composition file reachable from `entryPath` through
 * `data-composition-src`, entry included.
 *
 * Two invariants are borrowed rather than re-derived, because getting either
 * wrong silently reports a block that renders in every video as abandoned:
 * references are collected by text scan (`collectSubCompositionSrcs`, so
 * `<template>`-wrapped sub-compositions are visible), and each one resolves
 * against the PROJECT ROOT at every nesting level, never the referencing
 * file's directory. Both mirror the renderer's `parseSubCompositions`.
 *
 * Unreadable files are skipped rather than thrown: this feeds a telemetry
 * property, and a render that produced a video must never fail on the way to
 * reporting it.
 */
function reachableCompositions(projectDir: string, entryPath: string): Set<string> {
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
    for (const src of collectSubCompositionSrcs(html)) {
      queue.push(resolve(projectDir, src));
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

function reportableNames(names: string[]): string[] {
  return [...new Set(names.filter((name) => REGISTRY_ITEM_NAME.test(name)))].sort();
}

/**
 * Read the project's catalog manifest and resolve it against the composition
 * being rendered. Returns empty sets for a project that never ran
 * `hyperframes add`, which is the honest answer: no catalog items, not unknown.
 */
export function summarizeCatalogUsage(projectDir: string, entryPath: string): CatalogUsage {
  const { status, config } = readProjectConfigWithStatus(projectDir);
  if (status === "unreadable") return UNREADABLE;

  const items: RegistryItemRecord[] = config?.registryItems ?? [];
  if (items.length === 0) return EMPTY;

  const installed = reportableNames(items.map((item) => item.name));
  if (installed.length === 0) return EMPTY;

  const reachable = reachableCompositions(projectDir, entryPath);
  const usedBlocks = reportableNames(
    items
      .filter(
        (item) =>
          item.type === "hyperframes:block" && isReached(projectDir, item.target, reachable),
      )
      .map((item) => item.name),
  );
  return { installed, usedBlocks, manifestUnreadable: false };
}
