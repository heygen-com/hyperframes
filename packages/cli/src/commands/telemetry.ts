import { failCommand } from "../utils/commandResult.js";
import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Check current telemetry status", "hyperframes telemetry status"],
  ["Disable telemetry", "hyperframes telemetry disable"],
  ["Enable telemetry", "hyperframes telemetry enable"],
];
import { readConfigFresh, writeConfig, CONFIG_PATH } from "../telemetry/config.js";

type TelemetryStatus = {
  enabled: boolean;
  source: "config" | "HYPERFRAMES_NO_TELEMETRY" | "DO_NOT_TRACK";
};

function effectiveTelemetryStatus(configEnabled: boolean): TelemetryStatus {
  if (process.env["HYPERFRAMES_NO_TELEMETRY"] === "1") {
    return { enabled: false, source: "HYPERFRAMES_NO_TELEMETRY" };
  }
  if (process.env["DO_NOT_TRACK"] === "1") {
    return { enabled: false, source: "DO_NOT_TRACK" };
  }
  return { enabled: configEnabled, source: "config" };
}

function setTelemetryEnabled(enabled: boolean): void {
  // Bypass the module cache so this privacy preference starts from the latest
  // on-disk state rather than a snapshot held by another config consumer.
  const config = readConfigFresh();
  config.telemetryEnabled = enabled;
  if (!writeConfig(config)) {
    console.error(
      `\n  ${c.error("\u2717")}  Could not persist telemetry preference to ${c.accent(CONFIG_PATH)}\n`,
    );
    failCommand();
  }
  const label = enabled ? c.success("enabled") : c.bold("disabled");
  console.log(`\n  ${c.success("\u2713")}  Telemetry ${label}\n`);
}

function runStatus(): void {
  const config = readConfigFresh();
  const effective = effectiveTelemetryStatus(config.telemetryEnabled);
  const status = effective.enabled ? c.success("enabled") : c.dim("disabled");
  console.log();
  console.log(`  ${c.dim("Status:")}     ${status}`);
  console.log(`  ${c.dim("Source:")}     ${effective.source}`);
  console.log(`  ${c.dim("Config:")}     ${c.accent(CONFIG_PATH)}`);
  console.log(`  ${c.dim("Tracked commands:")} ${c.bold(String(config.commandCount))}`);
  console.log();
  console.log(`  ${c.dim("Disable:")}    ${c.accent("hyperframes telemetry disable")}`);
  console.log(`  ${c.dim("Env var:")}    ${c.accent("HYPERFRAMES_NO_TELEMETRY=1")}`);
  console.log();
}

export default defineCommand({
  meta: { name: "telemetry", description: "Manage anonymous usage telemetry" },
  args: {
    subcommand: {
      type: "positional",
      description: "Subcommand: enable, disable, status",
      required: false,
    },
  },
  async run({ args }) {
    const subcommand = args.subcommand;

    if (!subcommand || subcommand === "") {
      console.log(`
${c.bold("hyperframes telemetry")} ${c.dim("<subcommand>")}

Manage anonymous usage data collection.

${c.bold("SUBCOMMANDS:")}
  ${c.accent("status")}    ${c.dim("Show current telemetry status")}
  ${c.accent("enable")}    ${c.dim("Enable anonymous telemetry")}
  ${c.accent("disable")}   ${c.dim("Disable anonymous telemetry")}

${c.bold("WHAT WE COLLECT:")}
  ${c.dim("\u2022")} Command names (init, render, preview, etc.)
  ${c.dim("\u2022")} Render performance (duration, fps, quality)
  ${c.dim("\u2022")} Template choices
  ${c.dim("\u2022")} OS, architecture, Node.js version, CLI version

${c.bold("WHAT WE DON'T COLLECT:")}
  ${c.dim("\u2022")} File paths, project names, or video content
  ${c.dim("\u2022")} IP addresses (discarded by our analytics provider)
  ${c.dim("\u2022")} Any personally identifiable information

${c.dim("You can also set")} ${c.accent("HYPERFRAMES_NO_TELEMETRY=1")} ${c.dim("to disable.")}
`);
      return;
    }

    switch (subcommand) {
      case "enable":
        return setTelemetryEnabled(true);
      case "disable":
        return setTelemetryEnabled(false);
      case "status":
        return runStatus();
      default:
        console.error(
          `${c.error("Unknown subcommand:")} ${subcommand}\n\nRun ${c.accent("hyperframes telemetry --help")} for usage.`,
        );
        failCommand();
    }
  },
});
