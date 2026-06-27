import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";

// Asset in-use detection: which manifest assets are actually referenced by the
// project's compositions. Answers "is this safe to prune?" from the CLI. (The
// Studio Asset tab computes its in-use filter separately from the live timeline;
// this is the skill-side equivalent for headless use.)
//
// ponytail: substring match of each asset's filename against the .html text
// (covers src= / href= / url() / data-* without parsing HTML). False positives
// only if a filename literally appears in prose; fine for a filter. Upgrade to
// attribute parsing if that ever bites.

function compositionHtml(projectDir) {
  let files = [];
  try {
    files = readdirSync(projectDir).filter((f) => f.endsWith(".html"));
  } catch {
    return "";
  }
  const sub = join(projectDir, "compositions");
  if (existsSync(sub)) {
    try {
      for (const f of readdirSync(sub))
        if (f.endsWith(".html")) files.push(join("compositions", f));
    } catch {
      // ignore unreadable subdir
    }
  }
  return files
    .map((f) => {
      try {
        return readFileSync(join(projectDir, f), "utf8");
      } catch {
        return "";
      }
    })
    .join("\n");
}

/** Tag each record with `inUse` (referenced by some composition). */
export function tagUsage(records, projectDir) {
  const html = compositionHtml(projectDir);
  return records.map((r) => {
    const file = r.path ? r.path.split("/").pop() : r.id;
    return { ...r, inUse: Boolean(file) && html.includes(file) };
  });
}

/** Split records into { used, unused } for the filter. */
export function partitionUsage(records, projectDir) {
  const tagged = tagUsage(records, projectDir);
  return {
    used: tagged.filter((r) => r.inUse),
    unused: tagged.filter((r) => !r.inUse),
  };
}
