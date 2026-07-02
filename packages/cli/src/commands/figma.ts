/**
 * `hyperframes figma` — import figma assets, tokens, and components over
 * the REST API (design spec: phases 1–3 run on REST; motion/shaders are
 * MCP-only and live in the /figma skill, not this command).
 *
 * Requires FIGMA_TOKEN (personal access token from figma.com/settings).
 */

import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  [
    "Import a frame as a frozen SVG asset",
    "hyperframes figma asset 'https://www.figma.com/design/KEY/T?node-id=1-2'",
  ],
  ["Import as PNG at 2x", "hyperframes figma asset KEY:1-2 --format png --scale 2"],
  ["Pull brand tokens into the composition", "hyperframes figma tokens KEY"],
  ["Import a frame as an editable HTML component", "hyperframes figma component KEY:10-20"],
];

const HELP = `
${c.bold("hyperframes figma")} ${c.dim("<subcommand> [args]")}

Import figma content over the REST API. Requires ${c.accent("FIGMA_TOKEN")}.

${c.bold("SUBCOMMANDS:")}
  ${c.accent("asset")}   ${c.dim("Render a node (png/svg/jpg/pdf), freeze under .media/, print a snippet.")}
  ${c.accent("tokens")}  ${c.dim("Import variables/styles as composition brand variables.")}

${c.bold("ENV VARS:")}
  ${c.accent("FIGMA_TOKEN")}  Personal access token (figma.com/settings → security).

${c.dim("Motion and shader import are agent-only (figma exposes no REST endpoint for")}
${c.dim("either) — use the /figma skill in a Claude session for those.")}
`;

export default defineCommand({
  meta: { name: "figma", description: "Import figma assets, tokens, and components (REST)" },
  subCommands: {
    asset: () => import("./figma/asset.js").then((m) => m.default),
  },
  async run({ args }) {
    if (!args._?.[0]) console.log(HELP);
  },
});
