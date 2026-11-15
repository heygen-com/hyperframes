import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import { jsonArg, num, runMeasure } from "../../measure/command.js";
import { ownVoices } from "../../heygen/v3.js";

export const examples: Example[] = [
  ["The voice clones the film's workspace can speak with", "hyperframes media-use voices"],
];

const WHOSE =
  "Every clone this workspace can use, a teammate's included: HeyGen does not say who made one. Use a clone only when the person says it is theirs or that its owner agreed, whether they name it or give its id; never pick one by count, language or name. This is one page of at most --limit, so an id missing here may still be a teammate's clone, never proof of a stock voice.";

export default defineCommand({
  meta: {
    name: "voices",
    description:
      "List the voice clones the HyperFrames account's workspace can use, a teammate's included. Use one only when the person names it as their own. Never use `heygen voice list` for this: that is a separate sign-in and can be another account",
  },
  args: {
    limit: { type: "string", description: "How many to list (default 20)" },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(async () => ({
      voices: await ownVoices(num(args.limit, "--limit", 20)),
      whose: WHOSE,
    }));
  },
});
