import { defineCommand } from "citty";
import { readHarnessUsage } from "../utils/harnessUsage.js";

export default defineCommand({
  meta: {
    name: "usage",
    description: "Read remaining harness subscription usage without telemetry",
  },
  args: {
    harness: {
      type: "string",
      description:
        "Harness to read (claude-code, codex, grok); otherwise detect the current harness",
    },
    json: { type: "boolean", description: "Print subscription usage as JSON", default: false },
  },
  async run({ args }) {
    const harness = args.harness ?? detectHarness();
    const usage = await readHarnessUsage(harness);
    if (args.json) console.log(JSON.stringify(usage));
    else if (usage.status === "unknown") console.log(`Usage unknown (${usage.reason}).`);
    else console.log(JSON.stringify(usage, null, 2));
  },
});

function detectHarness(): string {
  if (process.env.CODEX_THREAD_ID) return "codex";
  if (process.env.GROK_AGENT === "1") return "grok";
  if (process.env.CLAUDECODE) return "claude-code";
  return "unknown";
}
