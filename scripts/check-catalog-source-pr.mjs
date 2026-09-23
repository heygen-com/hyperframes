import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { isGeneratedCatalogPath } from "./catalog-generated-paths.mjs";

export function committedCatalogOutputs(paths) {
  if (!paths.some((path) => /^registry\/(blocks|components|examples)\/[^/]+\//.test(path)))
    return [];
  return paths.filter(isGeneratedCatalogPath);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const base = process.argv[2] ?? "origin/main";
  const paths = execFileSync("git", ["diff", "--name-only", "-z", `${base}...HEAD`], {
    encoding: "utf8",
  })
    .split("\0")
    .filter(Boolean);
  const outputs = committedCatalogOutputs(paths);
  if (outputs.length > 0) {
    console.error(
      `Catalog PRs commit item sources only. Restore these generated files from the base branch:\n${outputs.join("\n")}`,
    );
    process.exitCode = 1;
  } else console.log("Catalog source PR contains no derived catalog files.");
}
