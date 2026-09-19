import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { describeProject } from "../timeline/describeProject.js";
import { formatTimeline } from "../timeline/formatTimeline.js";
import { ensureDOMParser } from "../utils/dom.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  ["Show every track and clip of the project in the current directory", "hyperframes timeline"],
  ["Same, as JSON for an agent", "hyperframes timeline ./my-video --json"],
];

export default defineCommand({
  meta: {
    name: "timeline",
    description: "Print the project's tracks and clips (start, duration, source, volume, rate)",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    json: { type: "boolean", description: "Output as JSON", default: false },
  },
  async run({ args }) {
    const project = resolveProject(args.dir);
    ensureDOMParser();
    const timeline = await describeProject(project.indexPath);
    console.log(
      args.json ? JSON.stringify(withMeta({ timeline }), null, 2) : formatTimeline(timeline),
    );
  },
});
