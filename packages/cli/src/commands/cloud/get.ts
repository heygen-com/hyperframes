/**
 * `hyperframes cloud get <render_id>` — fetch detail for a single render.
 *
 * Includes the signed `video_url` and `thumbnail_url` when status is
 * `completed`. The signed URLs are short-lived; don't paste them into
 * docs / chat — fetch them on demand.
 */

import { defineCommand } from "citty";
import { createCloudClient } from "../../cloud/index.js";
import { reportApiError } from "../../cloud/errors.js";
import { colorStatus } from "../../cloud/statusColor.js";
import { withMeta } from "../../utils/updateCheck.js";
import type { HyperframesRenderDetail } from "../../cloud/index.js";
import { c } from "../../ui/colors.js";

export default defineCommand({
  meta: { name: "get", description: "Fetch detail for one cloud render" },
  args: {
    id: {
      type: "positional",
      required: true,
      description: "Render ID (returned by `cloud render` / `cloud list`)",
    },
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON",
      default: false,
    },
  },
  async run({ args }) {
    const client = await createCloudClient();
    try {
      const detail = await client.getRender({ render_id: args.id });
      if (args.json) {
        console.log(JSON.stringify(withMeta({ render: detail }), null, 2));
        return;
      }
      printHuman(detail);
    } catch (err) {
      reportApiError("Could not fetch render", err, {
        notFound: `No render found with id "${args.id}".`,
      });
    }
  },
});

// fallow-ignore-next-line complexity
function printHuman(detail: HyperframesRenderDetail): void {
  const rows: [string, string | undefined][] = [
    ["Render ID:", c.accent(detail.render_id)],
    ["Status:   ", colorStatus(detail.status)],
    ["Format:   ", detail.format],
    ["Quality:  ", detail.quality ?? undefined],
    ["Fps:      ", detail.fps?.toString()],
    ["Resolution:", detail.resolution ?? undefined],
    ["Composition:", detail.composition ?? undefined],
    ["Title:    ", detail.title ?? undefined],
    ["Callback ID:", detail.callback_id ?? undefined],
    [
      "Duration: ",
      detail.duration !== undefined && detail.duration !== null
        ? `${detail.duration.toFixed(2)}s`
        : undefined,
    ],
    [
      "Created:  ",
      detail.created_at !== undefined && detail.created_at !== null
        ? new Date(detail.created_at * 1000).toISOString()
        : undefined,
    ],
    [
      "Completed:",
      detail.completed_at !== undefined && detail.completed_at !== null
        ? new Date(detail.completed_at * 1000).toISOString()
        : undefined,
    ],
    ["Video URL:", detail.video_url ?? undefined],
    ["Thumbnail:", detail.thumbnail_url ?? undefined],
    ["Failure:  ", detail.failure_message ?? undefined],
  ];
  for (const [label, value] of rows) {
    if (value === undefined) continue;
    console.log(`${c.bold(label)} ${value}`);
  }
}
