import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { readFileSync, existsSync } from "node:fs";

export const examples: Example[] = [
  ["List all available topics", "hyperframes docs"],
  ["Read about data attributes", "hyperframes docs data-attributes"],
  ["Read about rendering", "hyperframes docs rendering"],
  ["Read about GSAP integration", "hyperframes docs gsap"],
];
import { resolve, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { c } from "../ui/colors.js";

interface TopicEntry {
  file: string;
  description: string;
}

const TOPICS: Record<string, TopicEntry> = {
  "data-attributes": {
    file: "data-attributes.md",
    description: "Timing, media, and composition attributes",
  },
  templates: {
    file: "templates.md",
    description: "Built-in project templates for init",
  },
  rendering: {
    file: "rendering.md",
    description: "Render compositions to MP4 (local & Docker)",
  },
  gsap: {
    file: "gsap.md",
    description: "GSAP animation setup and usage",
  },
  troubleshooting: {
    file: "troubleshooting.md",
    description: "Common issues and fixes",
  },
  compositions: {
    file: "compositions.md",
    description: "Composition structure, nesting, and variables",
  },
};

function docsDir(): string {
  const thisFile = fileURLToPath(import.meta.url);
  const dir = dirname(thisFile);
  // In dev: cli/src/commands/ → ../docs = cli/src/docs/
  // In built: cli/dist/ → docs = cli/dist/docs/
  const devPath = resolve(dir, "..", "docs");
  const builtPath = resolve(dir, "docs");
  return existsSync(devPath) ? devPath : builtPath;
}

function formatInlineCode(line: string): string {
  // Replace inline backtick spans with accented text
  return line.replace(/`([^`]+)`/g, (_match, code: string) => c.accent(code));
}

function renderMarkdown(content: string): void {
  const lines = content.split("\n");

  for (const line of lines) {
    // Skip code fences
    if (line.trim().startsWith("```")) {
      continue;
    }

    // H1 heading
    if (line.startsWith("# ")) {
      console.log(c.bold(line.slice(2)));
      continue;
    }

    // H2 subheading
    if (line.startsWith("## ")) {
      console.log(c.bold(c.dim(line.slice(3))));
      continue;
    }

    // List items
    if (line.startsWith("- ")) {
      const rest = formatInlineCode(line.slice(2));
      console.log(`${c.dim("  \u2022")} ${rest}`);
      continue;
    }

    // Everything else
    console.log(formatInlineCode(line));
  }
}

const TOPIC_NAMES = Object.keys(TOPICS).join(", ");

export default defineCommand({
  meta: { name: "docs", description: "View inline documentation in the terminal" },
  args: {
    topic: {
      type: "positional",
      description: `Topic: ${TOPIC_NAMES}. Omit to list all.`,
      required: false,
    },
  },
  async run({ args }) {
    const topic = args.topic;

    // No topic: list available topics
    if (topic === undefined || topic === "") {
      console.log(c.bold("Available topics:"));
      console.log();
      for (const [name, entry] of Object.entries(TOPICS)) {
        console.log(`  ${c.accent(name.padEnd(20))} ${c.dim(entry.description)}`);
      }
      console.log();
      console.log(c.dim(`Run ${c.accent("hyperframes docs <topic>")} to view a topic.`));
      return;
    }

    // Look up the topic
    const entry = TOPICS[topic];
    if (entry === undefined) {
      console.error(c.error(`Unknown topic: ${topic}`));
      console.error();
      console.error("Available topics:");
      for (const name of Object.keys(TOPICS)) {
        console.error(`  ${c.accent(name)}`);
      }
      process.exit(1);
    }

    const filePath = join(docsDir(), entry.file);
    if (!existsSync(filePath)) {
      console.error(c.error(`Doc file not found: ${filePath}`));
      process.exit(1);
    }

    const content = readFileSync(filePath, "utf-8");
    console.log();
    renderMarkdown(content);
  },
});
