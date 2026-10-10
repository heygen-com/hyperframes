import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import type { AssetLedger } from "@hyperframes/core/asset-ledger";
import { setCommandExitCode } from "../utils/commandResult.js";
import { c } from "../ui/colors.js";
import { resolveProject } from "../utils/project.js";
import { withMeta } from "../utils/updateCheck.js";

export const examples: Example[] = [
  ["Inventory every declared asset", "hyperframes ledger"],
  ["Machine-readable asset graph", "hyperframes ledger ./my-video --json"],
  ["Fail CI when any remote reference remains", "hyperframes ledger --strict-offline"],
];

const STATUS_LABEL: Record<string, (s: string) => string> = {
  remote: (s) => c.warn(s),
  missing: (s) => c.error(s),
  local: (s) => c.success(s),
  data: (s) => c.dim(s),
};

function printHumanLedger(ledger: AssetLedger, projectName: string): void {
  console.log(`${c.accent("◆")}  Asset ledger for ${c.accent(projectName)}`);
  console.log(
    `   ${ledger.files.length} HTML file${ledger.files.length === 1 ? "" : "s"} scanned, ` +
      `${ledger.counts.total} asset reference${ledger.counts.total === 1 ? "" : "s"}`,
  );
  console.log();
  console.log(
    `   ${c.success(String(ledger.counts.local))} local   ` +
      `${c.warn(String(ledger.counts.remote))} remote   ` +
      `${c.dim(String(ledger.counts.data))} data   ` +
      `${c.error(String(ledger.counts.missing))} missing`,
  );

  const actionable = ledger.assets.filter(
    (asset) => asset.status === "remote" || asset.status === "missing",
  );
  if (actionable.length > 0) {
    console.log();
    for (const asset of actionable) {
      const paint = STATUS_LABEL[asset.status] ?? ((s: string) => s);
      console.log(`   ${paint(asset.status.padEnd(7))} ${asset.kind.padEnd(10)} ${asset.url}`);
      console.log(`   ${" ".repeat(7)} ${c.dim(`${asset.file} (${asset.via})`)}`);
    }
  }

  if (ledger.counts.remote > 0) {
    console.log();
    console.log(
      `   ${c.dim("Run")} hyperframes vendor ${c.dim("to download remote assets and rewrite references for offline, deterministic renders.")}`,
    );
  }
}

function printStrictViolation(remoteCount: number): void {
  console.log();
  console.log(
    c.error(
      `✖  --strict-offline: ${remoteCount} remote reference${remoteCount === 1 ? "" : "s"} remain.`,
    ),
  );
}

export default defineCommand({
  meta: {
    name: "ledger",
    description: "Inventory every declared asset and classify it remote | local | data | missing",
  },
  args: {
    dir: {
      type: "positional",
      description: "Project directory",
      required: false,
    },
    json: {
      type: "boolean",
      description: "Output the asset ledger as JSON",
      default: false,
    },
    "strict-offline": {
      type: "boolean",
      description: "Exit non-zero when any remote asset reference remains",
      default: false,
    },
  },
  async run({ args }) {
    const strictOffline = Boolean(args["strict-offline"]);
    try {
      const project = resolveProject(args.dir, { requireIndex: false });
      const { buildProjectAssetLedger } = await import("@hyperframes/core/asset-ledger");
      const ledger = buildProjectAssetLedger(project.dir);
      const strictViolation = strictOffline && ledger.counts.remote > 0;

      if (args.json) {
        console.log(
          JSON.stringify(
            withMeta({
              ok: !strictViolation,
              strictOffline,
              files: ledger.files,
              counts: ledger.counts,
              remoteUrls: ledger.remoteUrls,
              assets: ledger.assets,
            }),
            null,
            2,
          ),
        );
        setCommandExitCode(strictViolation ? 1 : 0);
        return;
      }

      printHumanLedger(ledger, project.name);
      if (strictViolation) printStrictViolation(ledger.counts.remote);
      setCommandExitCode(strictViolation ? 1 : 0);
      return;
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      if (args.json) {
        console.log(JSON.stringify(withMeta({ ok: false, error: message }), null, 2));
      } else {
        console.error(message);
      }
      setCommandExitCode(1);
    }
  },
});
