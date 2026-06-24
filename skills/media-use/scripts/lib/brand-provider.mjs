import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";

function findDesignSpec(projectDir) {
  for (const name of ["frame.md", "design.md", "DESIGN.md"]) {
    const p = join(projectDir, name);
    if (existsSync(p)) return { path: p, name };
  }
  return null;
}

function parseFrontmatter(content) {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const yaml = match[1];
  const tokens = {};
  for (const line of yaml.split("\n")) {
    const m = line.match(/^\s*(\w[\w-]*):\s*(.+)/);
    if (m) tokens[m[1]] = m[2].trim().replace(/^["']|["']$/g, "");
  }
  return tokens;
}

function extractColors(tokens) {
  const colors = [];
  for (const [k, v] of Object.entries(tokens)) {
    if (typeof v === "string" && /^#[0-9a-fA-F]{3,8}$/.test(v)) {
      colors.push({ name: k, hex: v });
    }
  }
  return colors;
}

export const brandProvider = {
  async search(intent, { projectDir } = {}) {
    if (!projectDir) return null;
    const spec = findDesignSpec(projectDir);
    if (!spec) return null;
    const content = readFileSync(spec.path, "utf8");
    const tokens = parseFrontmatter(content);
    if (!tokens) return null;
    const colors = extractColors(tokens);
    return {
      localPath: spec.path,
      source: "local",
      ext: ".md",
      metadata: {
        description: "Brand tokens from " + spec.name,
        provider: "design_spec",
        provenance: {
          file: spec.name,
          colors,
          font: tokens.font || tokens.typography || null,
          logo: tokens.logo || null,
        },
      },
    };
  },
};
