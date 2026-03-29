import { defineCommand } from "citty";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { parseHtml } from "@hyperframes/core";
import { c } from "../ui/colors.js";
import { formatBytes, label } from "../ui/format.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

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

    ensureDOMParser();
    const parsed = parseHtml(html);

    // Read actual dimensions from root composition element via DOM query
    // (same approach as compositions.ts — avoids regex matching wrong element)
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, "text/html");
    const root = doc.querySelector("[data-composition-id]");
    const width = parseInt(root?.getAttribute("data-width") ?? "1920", 10);
    const height = parseInt(root?.getAttribute("data-height") ?? "1080", 10);
    const resolution = width > height ? "landscape" : "portrait";

    const tracks = new Set(parsed.elements.map((el) => el.zIndex));
    const maxEnd = parsed.elements.reduce(
      (max, el) => Math.max(max, el.startTime + el.duration),
      0,
    );
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
            resolution: resolution as "landscape" | "portrait",
            width,
            height,
            duration: maxEnd,
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
    console.log(label("Resolution", `${width}x${height}`));
    console.log(label("Duration", `${maxEnd.toFixed(1)}s`));
    console.log(label("Elements", `${parsed.elements.length}${typeStr ? ` (${typeStr})` : ""}`));
    console.log(label("Tracks", `${tracks.size}`));
    console.log(label("Size", formatBytes(size)));
  },
});
