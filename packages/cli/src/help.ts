/**
 * Custom help renderer for the hyperframes CLI.
 *
 * Root-level: grouped command categories + examples.
 * Subcommands: citty's standard USAGE/ARGUMENTS/OPTIONS + appended examples.
 */
import { renderUsage } from "citty";
import type { CommandDef } from "citty";
import { c } from "./ui/colors.js";
import { VERSION } from "./version.js";

// ── Root-level command groups ──────────────────────────────────────────────
interface Group {
  title: string;
  commands: [name: string, description: string][];
}

const GROUPS: Group[] = [
  {
    title: "Getting Started",
    commands: [
      ["init", "Scaffold a new composition project"],
      ["preview", "Start the studio for previewing compositions"],
      ["render", "Render a composition to MP4 or WebM"],
    ],
  },
  {
    title: "Project",
    commands: [
      ["lint", "Validate a composition for common mistakes"],
      ["info", "Print project metadata"],
      ["compositions", "List all compositions in a project"],
      ["docs", "View inline documentation in the terminal"],
    ],
  },
  {
    title: "Tooling",
    commands: [
      [
        "benchmark",
        "Render with preset fps/quality/worker configs and compare speed and file size",
      ],
      ["browser", "Manage the Chrome browser used for rendering"],
      ["doctor", "Check system dependencies and environment"],
      ["upgrade", "Check for updates and show upgrade instructions"],
    ],
  },
  {
    title: "AI & Integrations",
    commands: [
      ["skills", "Install HyperFrames and GSAP skills for AI coding tools"],
      [
        "transcribe",
        "Transcribe audio/video to word-level timestamps, or import an existing transcript",
      ],
    ],
  },
  {
    title: "Settings",
    commands: [["telemetry", "Manage anonymous usage telemetry"]],
  },
];

// ── Root-level examples ────────────────────────────────────────────────────
import type { Example } from "./commands/_examples.js";

const ROOT_EXAMPLES: Example[] = [
  ["Create a new project", "hyperframes init my-video"],
  ["Start the live preview studio", "hyperframes preview"],
  ["Render to MP4", "hyperframes render -o out.mp4"],
  ["Transparent WebM overlay", "hyperframes render --format webm -o out.webm"],
  ["Validate your composition", "hyperframes lint"],
  ["Check system dependencies", "hyperframes doctor"],
];

// ── Per-command examples loaded from command files ────────────────────────
// Each command file exports `examples: Example[]`. This function dynamically
// imports them so examples live next to the command they document.
async function loadExamples(name: string): Promise<Example[] | undefined> {
  try {
    const mod = await import(`./commands/${name}.js`);
    return mod.examples;
  } catch {
    return undefined;
  }
}

// Commands without their own file (e.g. listed in help but not yet a real command)
const STATIC_EXAMPLES: Record<string, Example[]> = {
  skills: [["Install all skills to all supported AI tools", "hyperframes skills"]],
};

// ── Render root help ───────────────────────────────────────────────────────
function renderRootHelp(): string {
  const NAME_COL = 16;
  const CMD_COL = 46;
  const lines: string[] = [];

  lines.push(
    `${c.bold("hyperframes")} ${c.dim(`v${VERSION}`)} — Create and render HTML video compositions`,
  );
  lines.push("");
  lines.push(`${c.bold("Usage:")}  hyperframes ${c.cyan("<command>")} [options]`);
  lines.push("");

  for (const group of GROUPS) {
    lines.push(c.bold(`${group.title}:`));
    for (const [name, desc] of group.commands) {
      lines.push(`  ${c.cyan(name.padEnd(NAME_COL))}${desc}`);
    }
    lines.push("");
  }

  lines.push(c.bold("Examples:"));
  for (const [comment, command] of ROOT_EXAMPLES) {
    lines.push(`  ${c.dim("$")} ${command.padEnd(CMD_COL)} ${c.dim(comment)}`);
  }
  lines.push("");

  lines.push(`Run ${c.cyan("hyperframes <command> --help")} for more information about a command.`);

  return lines.join("\n");
}

// ── Format examples section (comment + command style) ────────────────────────────────
function formatExamples(examples: Example[]): string {
  const lines: string[] = [];
  lines.push(c.bold("Examples:"));
  for (const [comment, command] of examples) {
    lines.push(`  ${c.gray(`# ${comment}`)}`);
    lines.push(`  ${command}`);
    lines.push("");
  }
  return lines.join("\n");
}

// ── Main showUsage override ────────────────────────────────────────────────
export async function showUsage(cmd: CommandDef, parent?: CommandDef): Promise<void> {
  if (!parent) {
    console.log(renderRootHelp() + "\n");
    return;
  }

  const meta = await (typeof cmd.meta === "function" ? cmd.meta() : cmd.meta);
  const usage = await renderUsage(cmd, parent);
  console.log(usage + "\n");

  const name = meta?.name;
  if (name) {
    const examples = STATIC_EXAMPLES[name] ?? (await loadExamples(name));
    if (examples) {
      console.log(formatExamples(examples) + "\n");
    }
  }
}
