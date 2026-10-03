import { defineCommand } from "citty";
import { listAuthoredChapters, parseChapters, type ChapterListing } from "@hyperframes/core";
import { readFileSync } from "node:fs";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  ["List authored chapter markers", "hyperframes chapters"],
  ["Output as JSON", "hyperframes chapters --json"],
];

export function parseProjectChapters(html: string, rootDuration?: number): ChapterListing[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(html, "text/html");
  return listAuthoredChapters(parseChapters(doc, { rootDuration }));
}

function formatChapterTable(chapters: readonly ChapterListing[]): string {
  const headers = ["#", "Start", "Title", "Element"];
  const rows = chapters.map((chapter) => [
    String(chapter.index),
    chapter.start.toFixed(3),
    chapter.title,
    chapter.elementId,
  ]);
  const widths = headers.map((header, col) =>
    Math.max(header.length, ...rows.map((row) => (row[col] ?? "").length)),
  );
  const formatRow = (cells: string[]) =>
    cells.map((cell, col) => cell.padEnd(widths[col] ?? 0)).join("  ");
  return [formatRow(headers), ...rows.map(formatRow)].join("\n");
}

export default defineCommand({
  meta: { name: "chapters", description: "List authored chapter markers in a project" },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    const html = readFileSync(project.indexPath, "utf-8");
    ensureDOMParser();
    const chapters = parseProjectChapters(html);

    if (args.json) {
      console.log(JSON.stringify(withMeta({ chapters }), null, 2));
      return;
    }

    if (chapters.length === 0) {
      console.log(`${c.success("◇")}  ${c.accent(project.name)} — no chapters`);
      return;
    }

    const label = chapters.length === 1 ? "1 chapter" : `${chapters.length} chapters`;
    console.log(`${c.success("◇")}  ${c.accent(project.name)} ${c.dim("—")} ${c.dim(label)}`);
    console.log();
    console.log(formatChapterTable(chapters));
  },
});
