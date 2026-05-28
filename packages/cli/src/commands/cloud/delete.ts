/**
 * `hyperframes cloud delete <render_id>` — soft-delete a cloud render.
 *
 * Subsequent GET calls return 404. The signed video URL stops working
 * shortly after. There's no undo from the CLI side.
 */

import { defineCommand } from "citty";
import { createCloudClient, HyperframesApiError } from "../../cloud/index.js";
import { c } from "../../ui/colors.js";
import { errorBox } from "../../ui/format.js";

export default defineCommand({
  meta: { name: "delete", description: "Soft-delete a cloud render" },
  args: {
    id: {
      type: "positional",
      required: true,
      description: "Render ID to delete",
    },
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON",
      default: false,
    },
    "no-confirm": {
      type: "boolean",
      description: "Skip the interactive confirmation prompt (for scripts)",
      default: false,
    },
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    if (!args["no-confirm"] && !args.json && process.stdin.isTTY) {
      const ok = await confirmDelete(args.id);
      if (!ok) {
        console.log(c.dim("Aborted."));
        process.exit(1);
      }
    }
    const client = await createCloudClient();
    try {
      const response = await client.deleteRender({ render_id: args.id });
      if (args.json) {
        console.log(JSON.stringify(response, null, 2));
        return;
      }
      console.log(`${c.success("✓")}  Deleted ${c.accent(response.render_id)}`);
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
        errorBox("Could not delete render", err.message);
        process.exit(1);
      }
      errorBox("Could not delete render", String(err));
      process.exit(1);
    }
  },
});

async function confirmDelete(id: string): Promise<boolean> {
  const clack = await import("@clack/prompts");
  const answer = await clack.confirm({
    message: `Delete render ${id}? This is irreversible.`,
    initialValue: false,
  });
  return answer === true;
}
