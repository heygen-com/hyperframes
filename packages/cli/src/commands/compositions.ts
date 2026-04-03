import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { existsSync, readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";

export const examples: Example[] = [
  ["List compositions in the current project", "hyperframes compositions"],
  ["Output as JSON", "hyperframes compositions --json"],
];
import { c } from "../ui/colors.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

interface CompositionInfo {
  id: string;
  duration: number;
  width: number;
  height: number;
  elementCount: number;
  source?: string;
}

function parseCompositions(html: string, baseDir: string): CompositionInfo[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const compositionDivs = doc.querySelectorAll("[data-composition-id]");
  const compositions: CompositionInfo[] = [];

  compositionDivs.forEach((div) => {
    const id = div.getAttribute("data-composition-id") ?? "unknown";
    const width = parseInt(div.getAttribute("data-width") ?? "1920", 10);
    const height = parseInt(div.getAttribute("data-height") ?? "1080", 10);
    const compositionSrc = div.getAttribute("data-composition-src");

    // If this references an external sub-composition, parse that file
    if (compositionSrc) {
      const subPath = resolve(baseDir, compositionSrc);
      if (existsSync(subPath)) {
        const subHtml = readFileSync(subPath, "utf-8");
        const subInfo = parseSubComposition(subHtml, id, width, height);
        compositions.push({ ...subInfo, source: compositionSrc });
        return;
      }
    }

    const timedChildren = div.querySelectorAll("[data-start]");
    let maxEnd = 0;
    let elementCount = 0;

    timedChildren.forEach((el) => {
      elementCount++;
      const start = parseFloat(el.getAttribute("data-start") ?? "0");
      const endAttr = el.getAttribute("data-end");
      const durationAttr = el.getAttribute("data-duration");

      let end: number;
      if (endAttr) {
        end = parseFloat(endAttr);
      } else if (durationAttr) {
        end = start + parseFloat(durationAttr);
      } else {
        end = start + 5;
      }

      if (end > maxEnd) {
        maxEnd = end;
      }
    });

    compositions.push({
      id,
      duration: maxEnd,
      width,
      height,
      elementCount,
    });
  });

  return compositions;
}

function parseSubComposition(
  html: string,
  fallbackId: string,
  fallbackWidth: number,
  fallbackHeight: number,
): CompositionInfo {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  // Sub-compositions may use <template> wrappers or direct divs
  const compDiv =
    doc.querySelector("[data-composition-id]") ??
    doc.querySelector("template [data-composition-id]");

  const id = compDiv?.getAttribute("data-composition-id") ?? fallbackId;
  const width = parseInt(compDiv?.getAttribute("data-width") ?? String(fallbackWidth), 10);
  const height = parseInt(compDiv?.getAttribute("data-height") ?? String(fallbackHeight), 10);

  // Count timed elements inside the sub-composition
  const searchRoot = compDiv ?? doc;
  const timedChildren = searchRoot.querySelectorAll("[data-start], .clip, .caption-group");
  let elementCount = timedChildren.length;

  // Parse duration from the composition's own data-duration attribute
  let duration = 0;
  const durationAttr = compDiv?.getAttribute("data-duration");
  if (durationAttr && !durationAttr.startsWith("__")) {
    duration = parseFloat(durationAttr) || 0;
  }

  // Also check timed children for max end time
  if (compDiv) {
    const timedEls = compDiv.querySelectorAll("[data-start]");
    timedEls.forEach((el) => {
      elementCount = Math.max(elementCount, timedEls.length);
      const start = parseFloat(el.getAttribute("data-start") ?? "0");
      const endAttr = el.getAttribute("data-end");
      const durAttr = el.getAttribute("data-duration");

      let end: number;
      if (endAttr) {
        end = parseFloat(endAttr);
      } else if (durAttr) {
        end = start + parseFloat(durAttr);
      } else {
        end = start + 5;
      }
      if (end > duration) {
        duration = end;
      }
    });
  }

  return { id, duration, width, height, elementCount };
}

export default defineCommand({
  meta: { name: "compositions", description: "List all compositions in a project" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    const html = readFileSync(project.indexPath, "utf-8");

    ensureDOMParser();
    const compositions = parseCompositions(html, dirname(project.indexPath));

    if (compositions.length === 0) {
      console.log(`${c.success("◇")}  ${c.accent(project.name)} — no compositions found`);
      return;
    }

    if (args.json) {
      console.log(JSON.stringify(withMeta({ compositions }), null, 2));
      return;
    }

    const compositionLabel =
      compositions.length === 1 ? "1 composition" : `${compositions.length} compositions`;
    console.log(
      `${c.success("◇")}  ${c.accent(project.name)} ${c.dim("—")} ${c.dim(compositionLabel)}`,
    );
    console.log();

    // Calculate padding for alignment
    const maxIdLen = compositions.reduce((max, comp) => Math.max(max, comp.id.length), 0);

    for (const comp of compositions) {
      const id = c.accent(comp.id.padEnd(maxIdLen));
      const duration = c.bold(`${comp.duration.toFixed(1)}s`);
      const resolution = c.dim(`${comp.width}×${comp.height}`);
      const elements = c.dim(
        `${comp.elementCount} ${comp.elementCount === 1 ? "element" : "elements"}`,
      );
      const source = comp.source ? c.dim(` ← ${comp.source}`) : "";

      console.log(`   ${id}   ${duration}   ${resolution}   ${elements}${source}`);
    }
  },
});
