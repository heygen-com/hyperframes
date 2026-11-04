import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import { jsonArg, num, runMeasure } from "../../measure/command.js";
import { ownVoices } from "../../heygen/v3.js";

export const examples: Example[] = [
  ["The voice clones the film's own account can speak with", "hyperframes media-use voices"],
];

export default defineCommand({
  meta: {
    name: "voices",
    description:
      "List the voice clones on the HyperFrames account that makes the film. Never use `heygen voice list` for this: that is a separate sign-in and can be another account",
  },
  args: {
    limit: { type: "string", description: "How many to list (default 20)" },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(async () => ({
      voices: await ownVoices(num(args.limit, "--limit", 20)),
    }));
  },
});
