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

import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import type { RegistryManifestEntry } from "@hyperframes/core";
import { collectSubCompositionSrcs } from "@hyperframes/parsers/asset-resolution";
import {
  DEFAULT_PROJECT_CONFIG,
  type RegistryItemRecord,
  readProjectConfigWithStatus,
} from "./projectConfig.js";

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

/** Absolute path of a project-relative `target`, or null for an absolute or escaping one. */
function projectFile(projectDir: string, target: string): string | null {
  // A manifest target is written project-relative. Guard against an absolute
  // or escaping one rather than resolving it against the wrong root.
  if (isAbsolute(target)) return null;
  const abs = resolve(projectDir, target);
  return relative(projectDir, abs).startsWith("..") ? null : abs;
}

/** True when `target` (project-relative, per the manifest) is in `reachable`. */
function isReached(projectDir: string, target: string, reachable: Set<string>): boolean {
  const abs = projectFile(projectDir, target);
  return abs !== null && reachable.has(abs);
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

/**
 * Whether the project's video uses an item. A component is pasted into the
 * user's own markup rather than mounted by file, so its use leaves no trace to
 * check: "pasted-inline" says that instead of guessing.
 */
export type CatalogItemStatus = "in-use" | "not-used" | "file-missing" | "pasted-inline";

/** One catalog item found in a project. */
export interface ProjectCatalogItem {
  name: string;
  type: "block" | "component";
  /** Project-relative file the item installed. */
  file: string;
  status: CatalogItemStatus;
  /**
   * "recorded": `hyperframes add` listed it in hyperframes.json. "file": found
   * only by its install path, as for items added before recording existed or
   * copied in by hand.
   */
  foundBy: "recorded" | "file";
}

export interface ProjectCatalogItems {
  items: ProjectCatalogItem[];
  /** False when no registry list was available, so only recorded items are listed. */
  scannedFiles: boolean;
  /** The same answer in the shape the render event reports, for the view's event. */
  usage: CatalogUsage;
}

const ITEM_TYPES = { "hyperframes:block": "block", "hyperframes:component": "component" } as const;

function itemStatus(
  type: ProjectCatalogItem["type"],
  abs: string | null,
  reachable: Set<string>,
): CatalogItemStatus {
  if (abs === null || !existsSync(abs)) return "file-missing";
  if (type === "component") return "pasted-inline";
  return reachable.has(abs) ? "in-use" : "not-used";
}

/**
 * Every catalog item in a project: those `hyperframes add` recorded, plus any
 * registry item whose file sits at its install path, and whether the video
 * (the project's `index.html`, as render uses by default) mounts each one.
 * `catalog` is the registry's item list; without it only recorded items show.
 */
export function listProjectCatalogItems(
  projectDir: string,
  catalog: readonly RegistryManifestEntry[] | undefined,
): ProjectCatalogItems {
  const { status, config } = readProjectConfigWithStatus(projectDir);
  const paths = config?.paths ?? DEFAULT_PROJECT_CONFIG.paths;
  const reachable = reachableCompositions(projectDir, resolve(projectDir, "index.html"));
  const items: ProjectCatalogItem[] = [];
  const seen = new Set<string>();

  for (const record of config?.registryItems ?? []) {
    const type = ITEM_TYPES[record.type as keyof typeof ITEM_TYPES];
    if (!type || seen.has(record.name)) continue;
    seen.add(record.name);
    const abs = projectFile(projectDir, record.target);
    items.push({
      name: record.name,
      type,
      file: record.target,
      status: itemStatus(type, abs, reachable),
      foundBy: "recorded",
    });
  }

  for (const entry of catalog ?? []) {
    const type = ITEM_TYPES[entry.type as keyof typeof ITEM_TYPES];
    if (!type || seen.has(entry.name)) continue;
    // Every registry item installs to <dir>/<name>.html or <dir>/<name>/<name>.html.
    const dir = (type === "block" ? paths.blocks : paths.components).replace(/\/+$/, "");
    const file = [`${dir}/${entry.name}.html`, `${dir}/${entry.name}/${entry.name}.html`].find(
      (candidate) => existsSync(resolve(projectDir, candidate)),
    );
    if (!file) continue;
    seen.add(entry.name);
    items.push({
      name: entry.name,
      type,
      file,
      status: itemStatus(type, projectFile(projectDir, file), reachable),
      foundBy: "file",
    });
  }

  items.sort((a, b) => a.name.localeCompare(b.name));
  return {
    items,
    scannedFiles: catalog !== undefined,
    usage: {
      installed: reportableNames(items.map((item) => item.name)),
      usedBlocks: reportableNames(
        items.filter((item) => item.status === "in-use").map((item) => item.name),
      ),
      manifestUnreadable: status === "unreadable",
    },
  };
}
