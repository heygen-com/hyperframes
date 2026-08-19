import { failCommand } from "../../utils/commandResult.js";
/**
 * `hyperframes cloud delete <render_id>` — soft-delete a cloud render.
 *
 * Subsequent GET calls return 404. The signed video URL stops working
 * shortly after. There's no undo from the CLI side.
 */

import { defineCommand } from "citty";
import { createCloudClient } from "../../cloud/index.js";
import { reportApiError } from "../../cloud/errors.js";
import { withMeta } from "../../utils/updateCheck.js";
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
    // Citty intercepts the `--no-` prefix as a negation of the base
    // flag, so a flag literally named "no-confirm" gets parsed as
    // `--confirm=false` and the `args["no-confirm"]` lookup never
    // sees `true`. Naming the flag `confirm` with `default: true` lets
    // citty's negation handle `--no-confirm` correctly — same
    // user-facing flag (`--no-confirm` to skip the prompt), correct
    // runtime semantics.
    confirm: {
      type: "boolean",
      description:
        "Prompt before deleting (default: true). Pass `--no-confirm` to skip — required for scripts and --json.",
      default: true,
    },
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    if (args.confirm) {
      // Don't auto-bypass the prompt just because stdin isn't a TTY
      // or `--json` was passed — both used to silently skip the
      // safety check. Force the caller to opt in via `--no-confirm`
      // so cron jobs, CI shells, and JSON consumers can't soft-delete
      // by accident.
      if (args.json || !process.stdin.isTTY) {
        errorBox(
          "Confirmation required",
          "delete cannot prompt for confirmation here — stdin isn't a TTY or --json was passed.",
          "Re-run with --no-confirm to acknowledge the irreversible delete.",
        );
        failCommand();
      }
      const ok = await confirmDelete(args.id);
      if (!ok) {
        // Distinct exit code so wrapper scripts can tell an explicit
        // decline apart from an API/system error.
        console.log(c.dim("Aborted."));
        failCommand(2);
      }
    }
    const client = await createCloudClient();
    try {
      const response = await client.deleteRender({ render_id: args.id });
      if (args.json) {
        console.log(
          JSON.stringify(
            withMeta({ render: { render_id: response.render_id }, deleted: true }),
            null,
            2,
          ),
        );
        return;
      }
      console.log(`${c.success("✓")}  Deleted ${c.accent(response.render_id)}`);
    } catch (err) {
      reportApiError("Could not delete render", err, {
        notFound: `No render found with id "${args.id}".`,
      });
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
