#!/usr/bin/env tsx
/**
 * Announce the newest weekly digest in Slack and Discord.
 *
 *   tsx scripts/changelog-announce.ts            # print both payloads (dry run)
 *   tsx scripts/changelog-announce.ts --post     # post to SLACK_WEBHOOK_URL / DISCORD_WEBHOOK_URL
 *
 * Reads the first <Update> in docs/weekly-updates.mdx: its label, the embedded video, the bold
 * summary line and the "The 5 you'll feel" headlines. A webhook that is not set is skipped.
 */
import { readFileSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";

const ROOT = join(import.meta.dirname, "..");
const PAGE_URL = "https://hyperframes.heygen.com/weekly-updates";

export interface Digest {
  label: string;
  video: string | null;
  summary: string;
  highlights: string[];
}

const stripMd = (s: string): string =>
  s
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\*\*|__|\*/g, "")
    .trim();

export function parseLatestDigest(mdx: string): Digest {
  const start = mdx.indexOf("<Update");
  const end = mdx.indexOf("</Update>", start);
  if (start < 0 || end < 0) throw new Error("no <Update> entry found in weekly-updates.mdx");
  const entry = mdx.slice(start, end);

  const label = /label="([^"]+)"/.exec(entry)?.[1] ?? "This week";
  const video = /src="(https:[^"]+\.mp4)"/.exec(entry)?.[1] ?? null;

  // body = everything after the attribute block and the video frame
  const body = entry
    .slice(entry.indexOf(">", entry.indexOf("tags=")) + 1)
    .replace(/<Frame>[\s\S]*?<\/Frame>/g, "");
  const paragraphs = body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter((p) => p && !p.startsWith("<") && !p.startsWith("#") && !p.startsWith("{/*"));
  const summary = stripMd(paragraphs[0] ?? "");

  // "**1. Headline.** detail" lines under the top-5 heading; fall back to the old "## Section" headings
  const numbered = [...body.matchAll(/^\*\*\d+\.\s*(.+?)\*\*/gm)].map((m) =>
    stripMd(m[1]).replace(/\.$/, ""),
  );
  const highlights = numbered.length
    ? numbered
    : [...body.matchAll(/^##\s+(.+)$/gm)].map((m) => m[1].trim()).slice(0, 5);

  return { label, video, summary, highlights };
}

export function slackPayload(d: Digest): Record<string, unknown> {
  const lines = d.highlights.map((h) => `• ${h}`).join("\n");
  const links = [d.video ? `<${d.video}|Watch the video>` : null, `<${PAGE_URL}|Read the notes>`]
    .filter(Boolean)
    .join("  ·  ");
  return {
    text: `HyperFrames: ${d.label}`,
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `HyperFrames · ${d.label}` },
      },
      { type: "section", text: { type: "mrkdwn", text: d.summary } },
      ...(lines ? [{ type: "section", text: { type: "mrkdwn", text: lines } }] : []),
      { type: "context", elements: [{ type: "mrkdwn", text: links }] },
    ],
  };
}

export function discordPayload(d: Digest): Record<string, unknown> {
  // Discord turns a bare .mp4 link in `content` into an inline player.
  const list = d.highlights.map((h) => `- ${h}`).join("\n");
  return {
    content: d.video ?? undefined,
    embeds: [
      {
        title: `HyperFrames · ${d.label}`,
        url: PAGE_URL,
        description: [d.summary, list].filter(Boolean).join("\n\n").slice(0, 4000),
        color: 0x3ce6ac,
      },
    ],
  };
}

async function post(name: string, url: string | undefined, payload: unknown): Promise<void> {
  if (!url) {
    console.log(`${name}: no webhook set, skipped`);
    return;
  }
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error(`${name}: ${res.status} ${await res.text()}`);
  console.log(`${name}: posted`);
}

async function main(argv: string[]): Promise<void> {
  const file =
    argv.find((a) => a.startsWith("--file="))?.slice(7) ?? join(ROOT, "docs/weekly-updates.mdx");
  const digest = parseLatestDigest(readFileSync(file, "utf8"));
  const slack = slackPayload(digest);
  const discord = discordPayload(digest);
  if (!argv.includes("--post")) {
    console.log(JSON.stringify({ digest, slack, discord }, null, 2));
    return;
  }
  await post("slack", process.env.SLACK_WEBHOOK_URL, slack);
  await post("discord", process.env.DISCORD_WEBHOOK_URL, discord);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
