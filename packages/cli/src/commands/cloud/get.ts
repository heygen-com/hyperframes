/**
 * `hyperframes cloud get <render_id>` — fetch detail for a single render.
 *
 * Includes the signed `video_url` and `thumbnail_url` when status is
 * `completed`. The signed URLs are short-lived; don't paste them into
 * docs / chat — fetch them on demand.
 */

import { defineCommand } from "citty";
import { createCloudClient, HyperframesApiError } from "../../cloud/index.js";
import { colorStatus } from "../../cloud/statusColor.js";
import type { HyperframesRenderDetail } from "../../cloud/index.js";
import { c } from "../../ui/colors.js";
import { errorBox } from "../../ui/format.js";

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
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const client = await createCloudClient();
    try {
      const detail = await client.getRender({ render_id: args.id });
      if (args.json) {
        console.log(JSON.stringify(detail, null, 2));
        return;
      }
      printHuman(detail);
    } catch (err) {
      if (err instanceof HyperframesApiError && err.status === 404) {
        errorBox("Render not found", `No render found with id "${args.id}".`);
        process.exit(1);
      }
      if (err instanceof HyperframesApiError) {
        errorBox(
          `API error (HTTP ${err.status})`,
          err.message,
          err.code ? `code: ${err.code}` : undefined,
        );
        process.exit(1);
      }
      if (err instanceof Error) {
        errorBox("Could not fetch render", err.message);
        process.exit(1);
      }
      errorBox("Could not fetch render", String(err));
      process.exit(1);
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
    ["Duration: ", detail.duration ? `${detail.duration.toFixed(2)}s` : undefined],
    [
      "Created:  ",
      detail.created_at ? new Date(detail.created_at * 1000).toISOString() : undefined,
    ],
    [
      "Completed:",
      detail.completed_at ? new Date(detail.completed_at * 1000).toISOString() : undefined,
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
