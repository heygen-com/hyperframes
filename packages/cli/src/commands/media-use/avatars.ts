import { defineCommand } from "../../utils/defineCommand.js";
import type { Example } from "../_examples.js";
import { jsonArg, num, runMeasure } from "../../measure/command.js";
import { ownAvatarLooks } from "../../heygen/avatars.js";

export const examples: Example[] = [
  ["The avatar looks the film's own account can present with", "hyperframes media-use avatars"],
];

export default defineCommand({
  meta: {
    name: "avatars",
    description:
      "List the avatar looks on the HyperFrames account that makes the film, for --avatar in `generate --type avatar`. Never use `heygen avatar list` for this: that is a separate sign-in and can be another account",
  },
  args: {
    limit: { type: "string", description: "How many to list (default 20)" },
    json: jsonArg,
  },
  async run({ args }) {
    await runMeasure(async () => ({
      avatars: await ownAvatarLooks(num(args.limit, "--limit", 20)),
    }));
  },
});
