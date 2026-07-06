#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { duckKeyframes, speechSpans } from "./lib/duck.mjs";
import { track } from "./lib/telemetry.mjs";

const { values: args } = parseArgs({
  options: {
    meta: { type: "string" },
    target: { type: "string" },
    duck: { type: "string", default: "0.25" },
    attack: { type: "string", default: "0.15" },
    release: { type: "string", default: "0.4" },
    "merge-gap": { type: "string", default: "0.6" },
    sequential: { type: "boolean", default: false },
    gap: { type: "string", default: "0" },
    offsets: { type: "string" },
    composition: { type: "string" },
    json: { type: "boolean", default: false },
    help: { type: "boolean", short: "h", default: false },
  },
  strict: true,
});

if (args.help) {
  console.log(`media-use audio-duck — generate GSAP volume ducking keyframes

Usage:
  node audio-duck.mjs --meta audio_meta.json --target "#bgm"

Options:
  --meta          audio_meta.json or JSON word transcript
  --target        GSAP selector for the background audio element
  --duck          Duck multiplier (default: 0.25)
  --attack        Duck-in duration seconds (default: 0.15)
  --release       Restore duration seconds (default: 0.4)
  --merge-gap     Bridge speech gaps smaller than this many seconds (default: 0.6)
  --sequential    Place multi-line meta back to back at composition time
  --gap           Extra seconds between sequential lines (default: 0)
  --offsets       Explicit placement, "l1=0,l2=3.4" (voice id = start seconds)
  --composition   Read target data-volume from this HTML file
  --json          Output { spans, keyframes }
  --help, -h      Show this help`);
  process.exit(0);
}

try {
  run();
  await track("media_use_duck", { sequential: !!args.sequential });
} catch (err) {
  if (args.json) console.log(JSON.stringify({ ok: false, error: err.message }));
  else console.error(`error: ${err.message}`);
  process.exit(1);
}

function run() {
  if (!args.meta || !args.target) throw new Error("--meta and --target are required");
  const meta = JSON.parse(readFileSync(resolve(args.meta), "utf8"));
  const target = args.target;
  const baseVolume = readBaseVolume(args.composition, target);
  const offsets = args.offsets
    ? Object.fromEntries(
        args.offsets.split(",").map((pair) => {
          const [id, t] = pair.split("=");
          return [id.trim(), Number(t)];
        }),
      )
    : undefined;
  const spans = speechSpans(meta, {
    mergeGap: Number(args["merge-gap"]),
    sequential: args.sequential,
    gap: Number(args.gap),
    offsets,
  });
  const keyframes = duckKeyframes(spans, {
    duck: Number(args.duck),
    attack: Number(args.attack),
    release: Number(args.release),
    baseVolume,
  });

  if (args.json) {
    console.log(JSON.stringify({ spans, keyframes }));
    return;
  }

  console.log(
    `// auto-duck: ${target} under narration (generated; base volume ${fmt(baseVolume)})`,
  );
  for (const keyframe of keyframes) {
    console.log(
      `tl.to(${JSON.stringify(target)}, { volume: ${fmt(keyframe.volume)}, duration: ${fmt(
        keyframe.duration,
      )} }, ${fmt(keyframe.time)});`,
    );
  }
}

function readBaseVolume(composition, target) {
  if (!composition || !target.startsWith("#")) return 1;
  const id = target.slice(1);
  const html = readFileSync(resolve(composition), "utf8");
  // ponytail: regex is enough here because this only reads one attribute from
  // one user-authored composition element, not arbitrary HTML.
  const tag = html.match(new RegExp(`<[^>]*\\bid=["']${escapeRegExp(id)}["'][^>]*>`, "i"))?.[0];
  const raw = tag?.match(/\bdata-volume=["']([^"']+)["']/i)?.[1];
  const volume = Number(raw);
  return Number.isFinite(volume) ? volume : 1;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fmt(n) {
  return Number(n)
    .toFixed(3)
    .replace(/\.?0+$/, "");
}
