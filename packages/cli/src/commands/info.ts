import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { readFileSync, readdirSync, statSync } from "node:fs";

export const examples: Example[] = [
  ["Show project metadata", "hyperframes info"],
  ["Output as JSON", "hyperframes info --json"],
];
import { join } from "node:path";
import { parseHtml, CANVAS_DIMENSIONS } from "@hyperframes/core";
import {
  findRootCompositionElement,
  readCompositionSize,
} from "@hyperframes/core/runtime/composition-length";
import { readDataDurationSeconds } from "@hyperframes/parsers/media-duration";
import { c } from "../ui/colors.js";
import { formatBytes, label } from "../ui/format.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

/** Derive orientation label from actual pixel dimensions. */
export function orientation(width: number, height: number): "landscape" | "portrait" | "square" {
  if (width > height) return "landscape";
  if (height > width) return "portrait";
  return "square";
}

/**
 * Duration of the composition: prefer the root element's data-duration,
 * fall back to the computed timeline end.
 */
export function durationFromHtml(html: string, fallback: number): number {
  return durationFromRoot(rootFromHtml(html), fallback);
}

function rootFromHtml(html: string): HTMLElement | null {
  ensureDOMParser();
  return findRootCompositionElement(new DOMParser().parseFromString(html, "text/html"));
}

function durationFromRoot(root: Element | null, fallback: number): number {
  return readDataDurationSeconds((name) => root?.getAttribute(name)) ?? fallback;
}

function totalSize(dir: string): number {
  let total = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      total += totalSize(path);
    } else {
      total += statSync(path).size;
    }
  }
  return total;
}

export default defineCommand({
  meta: { name: "info", description: "Print project metadata" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    const html = readFileSync(project.indexPath, "utf-8");

    const root = rootFromHtml(html);
    const parsed = parseHtml(html);

    const tracks = new Set(parsed.elements.map((el) => el.zIndex));
    const maxEnd = parsed.elements.reduce(
      (max, el) => Math.max(max, el.startTime + el.duration),
      0,
    );
    const dimensions = root ? readCompositionSize(root) : null;
    const fallback = CANVAS_DIMENSIONS[parsed.resolution];
    const width = dimensions?.width ?? fallback.width;
    const height = dimensions?.height ?? fallback.height;
    const resolution = `${width}x${height}`;
    const duration = durationFromRoot(root, maxEnd);
    const size = totalSize(project.dir);

    const typeCounts: Record<string, number> = {};
    for (const el of parsed.elements) {
      typeCounts[el.type] = (typeCounts[el.type] ?? 0) + 1;
    }
    const typeStr = Object.entries(typeCounts)
      .map(([t, count]) => `${count} ${t}`)
      .join(", ");

    if (args.json) {
      console.log(
        JSON.stringify(
          withMeta({
            name: project.name,
            resolution: orientation(width, height),
            width,
            height,
            duration,
            elements: parsed.elements.length,
            tracks: tracks.size,
            types: typeCounts,
            size,
          }),
          null,
          2,
        ),
      );
      return;
    }

    console.log(`${c.success("◇")}  ${c.accent(project.name)}`);
    console.log(label("Resolution", resolution));
    console.log(label("Duration", `${duration.toFixed(1)}s`));
    console.log(label("Elements", `${parsed.elements.length}${typeStr ? ` (${typeStr})` : ""}`));
    console.log(label("Tracks", `${tracks.size}`));
    console.log(label("Size", formatBytes(size)));
  },
});
