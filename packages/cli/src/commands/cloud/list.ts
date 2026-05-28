/**
 * `hyperframes cloud list` — page through GET /v3/hyperframes/renders.
 *
 * Cursor pagination: `--limit` caps a single page (max 100 per the
 * spec), `--all` walks `next_token` until exhausted. Default page size
 * mirrors the API default (10).
 */

import { defineCommand } from "citty";
import { createCloudClient } from "../../cloud/index.js";
import { padEndVisible } from "../../cloud/ansi.js";
import { reportApiError } from "../../cloud/errors.js";
import { parseIntFlag } from "../../cloud/parsing.js";
import { colorStatus } from "../../cloud/statusColor.js";
import { withMeta } from "../../utils/updateCheck.js";
import type { HyperframesRenderDetail } from "../../cloud/index.js";
import { c } from "../../ui/colors.js";
import { errorBox } from "../../ui/format.js";

// Safety cap on --all to defend against a buggy backend serving the
// same next_token in a loop. 50 pages at the maximum page size of 100
// covers 5,000 renders — well past anyone's expected list size.
const MAX_ALL_PAGES = 50;

export default defineCommand({
  meta: { name: "list", description: "List recent cloud renders" },
  args: {
    limit: {
      type: "string",
      description: "Items per page (1-100; default 10)",
    },
    token: {
      type: "string",
      description: "Resume from a previous next_token cursor",
    },
    all: {
      type: "boolean",
      description: "Fetch every page (follows next_token until exhausted)",
      default: false,
    },
    json: {
      type: "boolean",
      description: "Emit machine-readable JSON",
      default: false,
    },
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const limit = parseIntFlag(args.limit, { flag: "--limit", min: 1, max: 100 });

    const client = await createCloudClient();

    try {
      if (args.all) {
        const renders = await fetchAll(client, limit);
        emit(renders, args.json, null, false);
      } else {
        const page = await client.listRenders({ limit, token: args.token });
        emit(page.data ?? [], args.json, page.next_token ?? null, Boolean(page.has_more));
      }
    } catch (err) {
      reportApiError("Could not list cloud renders", err);
    }
  },
});

// fallow-ignore-next-line complexity
async function fetchAll(
  client: Awaited<ReturnType<typeof createCloudClient>>,
  pageSize: number | undefined,
): Promise<HyperframesRenderDetail[]> {
  const out: HyperframesRenderDetail[] = [];
  const seenCursors = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < MAX_ALL_PAGES; page++) {
    const result = await client.listRenders({ limit: pageSize, token });
    out.push(...(result.data ?? []));
    if (!result.has_more) return out;
    // Defensive: server said `has_more: true` but didn't hand us a
    // cursor to use. Better to surface the malformed shape than
    // return a silently-truncated list.
    if (!result.next_token) {
      errorBox(
        "Pagination cursor missing",
        "Server returned has_more: true with no next_token — incomplete response.",
        "Retry the command, or report this if it persists.",
      );
      process.exit(1);
    }
    if (seenCursors.has(result.next_token)) {
      errorBox(
        "Pagination loop detected",
        `Server returned the same next_token (${result.next_token}) twice.`,
        "Retry the command, or report this if it persists.",
      );
      process.exit(1);
    }
    seenCursors.add(result.next_token);
    token = result.next_token;
  }
  errorBox(
    "Pagination cap reached",
    `Stopped after ${MAX_ALL_PAGES} pages to avoid an unbounded loop.`,
    `Re-run with a higher --limit, or paginate manually with --token.`,
  );
  process.exit(1);
}

// fallow-ignore-next-line complexity
function emit(
  renders: HyperframesRenderDetail[],
  asJson: boolean,
  nextToken: string | null,
  hasMore: boolean,
): void {
  if (asJson) {
    const payload: Record<string, unknown> = { renders, has_more: hasMore };
    if (nextToken !== null) payload["next_token"] = nextToken;
    console.log(JSON.stringify(withMeta(payload), null, 2));
    return;
  }
  if (renders.length === 0) {
    console.log(c.dim("No renders found."));
    return;
  }
  const idWidth = Math.max(8, ...renders.map((r) => r.render_id.length));
  const statusWidth = Math.max(6, ...renders.map((r) => r.status.length));
  for (const r of renders) {
    const id = c.accent(r.render_id);
    const status = colorStatus(r.status);
    const created =
      r.created_at !== undefined && r.created_at !== null
        ? new Date(r.created_at * 1000).toISOString()
        : "—";
    const title = r.title ? `  ${c.dim(r.title)}` : "";
    console.log(
      `${padEndVisible(id, idWidth)}  ${padEndVisible(status, statusWidth)}  ${c.dim(created)}${title}`,
    );
  }
  if (nextToken) {
    console.log("");
    console.log(c.dim(`More results — pass --token ${nextToken} to continue.`));
  }
}
