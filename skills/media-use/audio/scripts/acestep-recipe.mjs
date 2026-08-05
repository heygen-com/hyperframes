#!/usr/bin/env node
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { generateWithAceStep } from "../../scripts/lib/acestep-provider.mjs";
import { freezeUrl } from "../../scripts/lib/freeze.mjs";

const { values } = parseArgs({
  options: {
    output: { type: "string" },
    duration: { type: "string", default: "30" },
    prompt: { type: "string" },
  },
  strict: true,
});

if (!values.output || !values.prompt) {
  console.error(
    "usage: acestep-recipe.mjs --output <path> --duration <seconds> --prompt <description>",
  );
  process.exit(2);
}

const result = await generateWithAceStep(values.prompt, { duration: Number(values.duration) });
if (!result?.url) throw new Error("ACE-Step is not configured");
await freezeUrl(result.url, resolve(values.output), { headers: result.downloadHeaders });
console.log(`ACE-Step wrote ${values.output}`);
