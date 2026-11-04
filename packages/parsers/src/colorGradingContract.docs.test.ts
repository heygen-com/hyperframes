import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { validateColorGradingContract } from "./colorGradingContract";

const REPO = resolve(import.meta.dirname, "../../..");
const GRADING_SECTIONS = ["adjust", "wheels", "curves", "hueCurves", "secondaries", "details"];

function markdownFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (name === "node_modules") return [];
    if (statSync(path).isDirectory()) return markdownFiles(path);
    return /\.mdx?$/.test(name) ? [path] : [];
  });
}

/** Every grading payload the docs and skills show: inline CLI/attribute JSON and fenced JSON objects. */
function documentedGradings(): { where: string; grading: unknown }[] {
  return ["docs", "skills"].flatMap((root) =>
    markdownFiles(join(REPO, root)).flatMap((file) => {
      const text = readFileSync(file, "utf8");
      const where = relative(REPO, file);
      const inline = [...text.matchAll(/(?:--grading\s+|data-color-grading=)'(\{[^']*\})'/g)].map(
        (match) => ({ where, grading: JSON.parse(match[1]!) as unknown }),
      );
      const fenced = [...text.matchAll(/```jsonc?\n([\s\S]*?)```/g)].flatMap((match) => {
        let value: unknown;
        try {
          value = JSON.parse(match[1]!);
        } catch {
          return [];
        }
        const entries = Array.isArray(value) ? value : [value];
        return entries
          .map((entry) => (entry as { grading?: unknown })?.grading ?? entry)
          .filter(
            (g) => typeof g === "object" && g !== null && GRADING_SECTIONS.some((k) => k in g),
          )
          .map((grading) => ({ where, grading }));
      });
      return [...inline, ...fenced];
    }),
  );
}

describe("documented color-grading payloads", () => {
  it("are all accepted by the validator", () => {
    const documented = documentedGradings();
    expect(documented.length).toBeGreaterThan(10);
    const rejected = documented
      .map(({ where, grading }) => ({ where, issues: validateColorGradingContract(grading) }))
      .filter(({ issues }) => issues.length > 0);
    expect(rejected).toEqual([]);
  });
});
