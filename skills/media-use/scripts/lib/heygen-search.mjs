import { execSync } from "node:child_process";

export function heygenSearch(subcommand, query, { type, limit = 5, minScore } = {}) {
  try {
    const q = query.replace(/'/g, "'\\''");
    const parts = [`heygen --x-source media-use ${subcommand} --query '${q}'`];
    if (type) parts.push(`--type ${type}`);
    parts.push(`--limit ${limit}`);
    if (minScore != null) parts.push(`--min-score ${minScore}`);
    const out = execSync(parts.join(" "), {
      encoding: "utf8",
      timeout: 15000,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const data = JSON.parse(out)?.data;
    return Array.isArray(data) && data.length > 0 ? data : null;
  } catch {
    return null;
  }
}
