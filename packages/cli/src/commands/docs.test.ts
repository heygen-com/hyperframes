// @vitest-environment node
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { renderMarkdown } from "./docs.js";

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

  it("has a file for every topic it lists, including motion-blur, audio and transcribe", () => {
    const files = [...source.matchAll(/file: "([^"]+)"/g)].map((match) => match[1] ?? "");
    expect(files).toEqual(expect.arrayContaining(["motion-blur.md", "audio.md", "transcribe.md"]));
    for (const file of files) {
      expect(readdirSync(join(REPO_ROOT, "packages", "cli", "src", "docs"))).toContain(file);
    }
  });
});

describe("renderMarkdown", () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...process.env };
  });

  afterEach(() => {
    process.env = originalEnv as NodeJS.ProcessEnv;
  });

  it("strips **bold** markers from output", () => {
    const content = "This is **bold** text and **another** bold.";
    // Capture console.log by overriding it
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(Array.from(args).join(" "));
    };

    renderMarkdown(content);

    console.log = originalLog;

    const combined = logs.join("\n");
    expect(combined).not.toContain("**bold**");
    expect(combined).not.toContain("**another**");
    expect(combined).toContain("bold");
    expect(combined).toContain("another bold");
  });

  it("preserves text without bold markers", () => {
    const content = "This is normal text without any markup.";
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(Array.from(args).join(" "));
    };

    renderMarkdown(content);

    console.log = originalLog;

    expect(logs.join("\n")).toContain("normal text without any markup.");
  });

  it("handles bold at start of line", () => {
    const content = "**Hello** world";
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(Array.from(args).join(" "));
    };

    renderMarkdown(content);

    console.log = originalLog;

    expect(logs.join("\n")).toContain("Hello world");
    expect(logs.join("\n")).not.toContain("**Hello**");
  });

  it("handles multiple bold sections on same line", () => {
    const content = "**a** and **b** and **c**";
    const logs: string[] = [];
    const originalLog = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(Array.from(args).join(" "));
    };

    renderMarkdown(content);

    console.log = originalLog;

    expect(logs.join("\n")).toMatch(/a and b and c/);
    expect(logs.join("\n")).not.toMatch(/\*\*.*\*\*/);
  });
});
