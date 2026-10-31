// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const REPO_ROOT = join(fileURLToPath(new URL(".", import.meta.url)), "..", "..", "..", "..");
const EXAMPLES_DIR = join(REPO_ROOT, "registry", "examples");
const EXAMPLES_TOPIC = join(REPO_ROOT, "packages", "cli", "src", "docs", "examples.md");

interface ExampleItem {
  name: string;
  description: string;
}

function registryExamples(): ExampleItem[] {
  return readdirSync(EXAMPLES_DIR, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map(
      (entry) =>
        JSON.parse(
          readFileSync(join(EXAMPLES_DIR, entry.name, "registry-item.json"), "utf8"),
        ) as ExampleItem,
    );
}

function topicSections(): Map<string, string> {
  const sections = new Map<string, string>();
  const parts = readFileSync(EXAMPLES_TOPIC, "utf8").split(/^## /m).slice(1);
  for (const part of parts) {
    const [heading = "", ...body] = part.split("\n");
    sections.set(heading.trim(), body.join("\n").trim());
  }
  sections.delete("Custom Templates");
  return sections;
}

describe("docs examples topic", () => {
  it("lists exactly blank and the examples in registry/examples", () => {
    const expected = ["blank", ...registryExamples().map((item) => item.name)].sort();
    expect([...topicSections().keys()].sort()).toEqual(expected);
  });

  it("describes each registry example with its registry-item description", () => {
    const sections = topicSections();
    for (const item of registryExamples()) {
      expect(sections.get(item.name) ?? "").toContain(item.description);
    }
  });
});

describe("docs topics", () => {
  const source = readFileSync(
    join(REPO_ROOT, "packages", "cli", "src", "commands", "docs.ts"),
    "utf8",
  );

  it("has a file for every topic it lists, including motion-blur", () => {
    const files = [...source.matchAll(/file: "([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(files).toContain("motion-blur.md");
    for (const file of files) {
      expect(readdirSync(join(REPO_ROOT, "packages", "cli", "src", "docs"))).toContain(file);
    }
  });
});
