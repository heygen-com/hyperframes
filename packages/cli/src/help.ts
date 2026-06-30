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
      ["add", "Install a block or component from the registry"],
      ["capture", "Capture a website for video production"],
      ["catalog", "Browse and install blocks and components"],
      ["preview", "Start the studio for previewing compositions"],
      ["present", "Open a slideshow deck in presenter mode (with audience sync)"],
      ["publish", "Upload a project and get a stable public URL"],
      ["render", "Render a composition to MP4 or WebM"],
    ],
  },
  {
    title: "Project",
    commands: [
      ["lint", "Validate a composition for common mistakes"],
      [
        "validate",
        "Runtime-validate a composition in headless Chrome (JS errors, missing assets, contrast)",
      ],
      ["beats", "Detect beats in the music track and write beats/<audio>.json"],
      ["inspect", "Inspect rendered visual layout across the timeline"],
      ["snapshot", "Capture key frames as PNG screenshots for visual verification"],
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
    title: "Deploy",
    commands: [
      ["cloud", "Render compositions on HeyGen's cloud (no local Chrome/ffmpeg)"],
      ["lambda", "Deploy and drive distributed renders on AWS Lambda"],
      ["cloudrun", "Deploy and drive distributed renders on Google Cloud Run"],
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
      ["tts", "Generate speech audio from text using a local AI model (Kokoro-82M)"],
      ["remove-background", "Remove background from a video or image to produce transparent media"],
    ],
  },
  {
    title: "Account",
    commands: [["auth", "Sign in to HeyGen and manage credentials"]],
  },
  {
    title: "Settings",
    commands: [
      ["feedback", "Submit anonymous feedback about your experience"],
      ["telemetry", "Manage anonymous usage telemetry"],
    ],
  },
];

// ── Root-level examples ────────────────────────────────────────────────────
import type { Example } from "./commands/_examples.js";

const ROOT_EXAMPLES: Example[] = [
  ["Create a new project", "hyperframes init my-video"],
  ["Start the live preview studio", "hyperframes preview"],
  ["Publish to hyperframes.dev", "hyperframes publish"],
  ["Render to MP4", "hyperframes render -o out.mp4"],
  ["Transparent WebM overlay", "hyperframes render --format webm -o out.webm"],
  ["Validate your composition", "hyperframes lint"],
  ["Inspect visual layout", "hyperframes inspect"],
  ["Check system dependencies", "hyperframes doctor"],
];

// ── Per-command examples loaded from command files ────────────────────────
// Each command file exports `examples: Example[]`. This function dynamically
// imports them so examples live next to the command they document.
//
// For nested subverbs (e.g. `cloud render`), try the parent-scoped path
// first (`commands/cloud/render.js`) so we don't collide with the
// top-level command of the same name (`commands/render.js`).
// fallow-ignore-next-line complexity
async function loadExamples(name: string, parentName?: string): Promise<Example[] | undefined> {
  // Skip the parent-scoped lookup for the root command — `parentName`
  // is `'hyperframes'` for every top-level subcommand and no
  // `./commands/hyperframes/<name>.js` directory will ever exist.
  if (parentName && parentName !== "hyperframes") {
    const examples = await tryLoadExamples(`./commands/${parentName}/${name}.js`);
    if (examples) return examples;
  }
  return await tryLoadExamples(`./commands/${name}.js`);
}

async function tryLoadExamples(modulePath: string): Promise<Example[] | undefined> {
  try {
    const mod = await import(modulePath);
    return mod.examples;
  } catch (err) {
    // Only swallow "file doesn't exist" — re-throw real load errors
    // (syntax error, broken import, init-time throw) so a developer
    // sees the diagnostic instead of getting silently wrong help.
    if ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") return undefined;
    throw err;
  }
}

// Commands without their own file (e.g. listed in help but not yet a real command)
const STATIC_EXAMPLES: Record<string, Example[]> = {
  skills: [["Install all skills to all supported AI tools", "hyperframes skills"]],
};

// ── Render root help ───────────────────────────────────────────────────────
function renderRootHelp(): string {
  const NAME_COL = 19;
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
// fallow-ignore-next-line complexity
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
    const parentMeta = await (typeof parent.meta === "function" ? parent.meta() : parent.meta);
    const parentName = parentMeta?.name;
    const examples = STATIC_EXAMPLES[name] ?? (await loadExamples(name, parentName));
    if (examples) {
      console.log(formatExamples(examples) + "\n");
    }
  }
}
