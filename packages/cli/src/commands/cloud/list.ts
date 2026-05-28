/**
 * `hyperframes cloud list` — page through GET /v3/hyperframes/renders.
 *
 * Cursor pagination: `--limit` caps a single page (max 100 per the
 * spec), `--all` walks `next_token` until exhausted. Default page size
 * mirrors the API default (10).
 */

import { defineCommand } from "citty";
import { createCloudClient, HyperframesApiError } from "../../cloud/index.js";
import { colorStatus } from "../../cloud/statusColor.js";
import type { HyperframesRenderDetail } from "../../cloud/index.js";
import { c } from "../../ui/colors.js";
import { errorBox } from "../../ui/format.js";

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
    const limit = parseLimit(args.limit);
    const client = await createCloudClient();

    try {
      if (args.all) {
        const renders = await fetchAll(client, limit);
        emit(renders, args.json, null);
      } else {
        const page = await client.listRenders({ limit, token: args.token });
        emit(page.data ?? [], args.json, page.next_token ?? null);
      }
    } catch (err) {
      handleListError(err);
    }
  },
});

// fallow-ignore-next-line complexity
async function fetchAll(
  client: Awaited<ReturnType<typeof createCloudClient>>,
  pageSize: number | undefined,
): Promise<HyperframesRenderDetail[]> {
  const out: HyperframesRenderDetail[] = [];
  let token: string | undefined;
  while (true) {
    const page = await client.listRenders({ limit: pageSize, token });
    out.push(...(page.data ?? []));
    if (!page.has_more || !page.next_token) return out;
    token = page.next_token;
  }
}

// fallow-ignore-next-line complexity
function emit(renders: HyperframesRenderDetail[], asJson: boolean, nextToken: string | null): void {
  if (asJson) {
    const payload: Record<string, unknown> = { renders };
    if (nextToken !== null) payload["next_token"] = nextToken;
    console.log(JSON.stringify(payload, null, 2));
    return;
  }
  if (renders.length === 0) {
    console.log(c.dim("No renders found."));
    return;
  }
  const idWidth = Math.max(8, ...renders.map((r) => r.render_id.length));
  const statusWidth = Math.max(6, ...renders.map((r) => r.status.length));
  for (const r of renders) {
    const id = r.render_id.padEnd(idWidth);
    const status = colorStatus(r.status).padEnd(
      statusWidth + visibleAnsiOverhead(colorStatus(r.status)),
    );
    const created = r.created_at ? new Date(r.created_at * 1000).toISOString() : "—";
    const title = r.title ? `  ${c.dim(r.title)}` : "";
    console.log(`${c.accent(id)}  ${status}  ${c.dim(created)}${title}`);
  }
  if (nextToken) {
    console.log("");
    console.log(c.dim(`More results — pass --token ${nextToken} to continue.`));
  }
}

// Padding helper: padEnd counts ANSI escape codes as printable, which
// throws off column alignment. Subtract the escape-code overhead so the
// rendered output lines up.
function visibleAnsiOverhead(s: string): number {
  return s.length - s.replace(/\[\d+m/g, "").length;
}

// fallow-ignore-next-line complexity
function parseLimit(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    errorBox("Invalid --limit", `Got "${raw}". Must be a positive integer between 1 and 100.`);
    process.exit(1);
  }
  return n;
}

function handleListError(err: unknown): never {
  if (err instanceof HyperframesApiError) {
    errorBox(
      `API error (HTTP ${err.status})`,
      err.message,
      err.code ? `code: ${err.code}` : undefined,
    );
    process.exit(1);
  }
  if (err instanceof Error) {
    errorBox("Could not list cloud renders", err.message);
    process.exit(1);
  }
  errorBox("Could not list cloud renders", String(err));
  process.exit(1);
}
