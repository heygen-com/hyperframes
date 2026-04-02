import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { readFileSync } from "node:fs";

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
}

function parseCompositions(html: string): CompositionInfo[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");

  const compositionDivs = doc.querySelectorAll("[data-composition-id]");
  const compositions: CompositionInfo[] = [];

  compositionDivs.forEach((div) => {
    const id = div.getAttribute("data-composition-id") ?? "unknown";
    const width = parseInt(div.getAttribute("data-width") ?? "1920", 10);
    const height = parseInt(div.getAttribute("data-height") ?? "1080", 10);

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
    const compositions = parseCompositions(html);

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

      console.log(`   ${id}   ${duration}   ${resolution}   ${elements}`);
    }
  },
});
