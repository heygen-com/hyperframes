import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Check current telemetry status", "hyperframes telemetry status"],
  ["Disable telemetry", "hyperframes telemetry disable"],
  ["Enable telemetry", "hyperframes telemetry enable"],
];
import { readConfig, writeConfig, CONFIG_PATH } from "../telemetry/config.js";

function runEnable(): void {
  const config = readConfig();
  config.telemetryEnabled = true;
  writeConfig(config);
  console.log(`\n  ${c.success("\u2713")}  Telemetry ${c.success("enabled")}\n`);
}

function runDisable(): void {
  const config = readConfig();
  config.telemetryEnabled = false;
  writeConfig(config);
  console.log(`\n  ${c.success("\u2713")}  Telemetry ${c.bold("disabled")}\n`);
}

function runStatus(): void {
  const config = readConfig();
  const status = config.telemetryEnabled ? c.success("enabled") : c.dim("disabled");
  console.log();
  console.log(`  ${c.dim("Status:")}     ${status}`);
  console.log(`  ${c.dim("Config:")}     ${c.accent(CONFIG_PATH)}`);
  console.log(`  ${c.dim("Commands:")}   ${c.bold(String(config.commandCount))}`);
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
        return runEnable();
      case "disable":
        return runDisable();
      case "status":
        return runStatus();
      default:
        console.error(
          `${c.error("Unknown subcommand:")} ${subcommand}\n\nRun ${c.accent("hyperframes telemetry --help")} for usage.`,
        );
        process.exit(1);
    }
  },
});
