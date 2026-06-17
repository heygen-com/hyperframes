import { defineCommand } from "citty";
import { resolve } from "node:path";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["Capture a website", "hyperframes capture https://stripe.com"],
  ["Capture to a specific directory", "hyperframes capture https://linear.app -o linear-video"],
  ["JSON output for AI agents", "hyperframes capture https://example.com --json"],
  [
    "Pull a video from the captured manifest by index",
    "hyperframes capture --video ./linear-video --index 0",
  ],
  [
    "List videos referenced in the captured manifest",
    "hyperframes capture --video ./linear-video --list",
  ],
];

export default defineCommand({
  meta: {
    name: "capture",
    description: "Capture a website as editable HyperFrames components",
  },
  args: {
    url: {
      type: "positional",
      description: "Website URL to capture (omit when using --video)",
      required: false,
    },
    output: {
      type: "string",
      description: "Output directory name",
      alias: "o",
    },
    "skip-assets": {
      type: "boolean",
      description: "Skip downloading assets (images, SVGs)",
      default: false,
    },
    "max-screenshots": {
      type: "string",
      description: "Maximum screenshots to capture (default: 24)",
    },
    timeout: {
      type: "string",
      description: "Page load timeout in ms (default: 120000)",
    },
    json: {
      type: "boolean",
      description: "Output JSON (for AI agents / programmatic use)",
      default: false,
    },
    video: {
      type: "string",
      description:
        "Switch to video-download mode: path to a captured project directory whose video-manifest.json should be read. Pair with --index, --video-url, or --list.",
    },
    index: {
      type: "string",
      description: "(--video mode) Manifest entry index to download (0-based)",
    },
    "video-url": {
      type: "string",
      description: "(--video mode) Exact video URL to download (must match a manifest entry)",
    },
    list: {
      type: "boolean",
      description: "(--video mode) List manifest entries and exit",
      default: false,
    },
  },
  async run({ args }) {
    if (args.video) {
      const { runVideoMode } = await import("./capture/video.js");
      await runVideoMode({
        project: args.video as string,
        index: (args.index as string | undefined) ?? null,
        url: (args["video-url"] as string | undefined) ?? null,
        list: args.list as boolean,
      });
      return;
    }

    const url = args.url as string | undefined;
    if (!url) {
      console.error(
        "Missing URL. Pass a website URL, or use --video <project> for video download.",
      );
      process.exit(1);
    }

    try {
      new URL(url);
    } catch {
      console.error(`Invalid URL: ${url}`);
      process.exit(1);
    }

    // Determine output directory — default to captures/<hostname> to keep repo root clean
    let outputName = args.output as string | undefined;
    if (!outputName) {
      const hostname = new URL(url).hostname.replace(/^www\./, "");
      outputName = `captures/${hostname.replace(/\./g, "-")}`;
    }
    const outputDir = resolve(outputName);

    const isJson = args.json as boolean;

    if (!isJson) {
      const { c } = await import("../ui/colors.js");
      console.log();
      console.log(c.dim("◆") + "  Capturing " + c.bold(url));
      console.log();
    }

    const { captureWebsite } = await import("../capture/index.js");

    try {
      const result = await captureWebsite(
        {
          url,
          outputDir,
          skipAssets: args["skip-assets"] as boolean,
          maxScreenshots: args["max-screenshots"]
            ? parseInt(args["max-screenshots"] as string)
            : undefined,
          timeout: args.timeout ? parseInt(args.timeout as string) : undefined,
          json: isJson,
        },
        isJson
          ? undefined
          : (stage: string, detail?: string) => {
              const stages: Record<string, string> = {
                browser: "  Launching browser...",
                navigate: "  Loading page...",
                extract: "  Extracting HTML & CSS...",
                tokens: "  Extracting design tokens...",
                screenshots: "  Capturing screenshots...",
                assets: "  Downloading assets...",
                style: "  Generating visual style...",
                done: "  Done",
              };
              const label = stages[stage] || `  ${stage}`;
              console.log(detail ? `${label} ${detail}` : label);
            },
      );

      if (isJson) {
        // Output structured JSON for Claude Code / programmatic use
        console.log(
          JSON.stringify(
            {
              ok: result.ok,
              projectDir: result.projectDir,
              url: result.url,
              title: result.title,
              screenshots: result.screenshots.length,
              assets: result.assets.length,
              detectedSections: result.tokens.sections.length,
              fonts: result.tokens.fonts.map((f) => f.family),
              fontsDetailed: result.tokens.fonts,
              animations: result.animationCatalog?.summary,
              warnings: result.warnings,
            },
            null,
            2,
          ),
        );
      } else {
        const { c } = await import("../ui/colors.js");
        console.log();
        console.log(c.success("◇") + `  Captured ${c.bold(result.title)} → ${c.dim(outputDir)}`);
        console.log();
        console.log(`  ${c.dim("Screenshots:")} ${result.screenshots.length}`);
        console.log(`  ${c.dim("Assets:")} ${result.assets.length}`);
        console.log(`  ${c.dim("Sections:")} ${result.tokens.sections.length}`);
        console.log(
          `  ${c.dim("Fonts:")} ${result.tokens.fonts
            .map(function (f) {
              return (
                f.family +
                " (" +
                (f.variable && f.weightRange
                  ? f.weightRange[0] + "-" + f.weightRange[1] + " variable"
                  : f.weights.join(",")) +
                ")"
              );
            })
            .join(", ")}`,
        );
        if (result.warnings.length > 0) {
          console.log();
          for (const w of result.warnings) {
            console.log(`  ${c.warn("⚠")} ${w}`);
          }
        }
        console.log();
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      // Write BLOCKED.md so the user/agent knows the capture failed
      try {
        const { mkdirSync, writeFileSync } = await import("node:fs");
        mkdirSync(outputDir, { recursive: true });
        const isTimeout = /timeout|timed out/i.test(errMsg);
        const reason = isTimeout
          ? "Page navigation timed out — the site may be blocking headless browsers or requires authentication."
          : `Capture failed: ${errMsg}`;
        writeFileSync(
          `${outputDir}/BLOCKED.md`,
          `# Capture Failed\n\n${reason}\n\nURL: ${url}\n\n## What to try\n\n- Re-run with a longer timeout: \`--timeout 60000\`\n- The site may block headless browsers (anti-bot protection)\n- Try capturing a different page on the same domain\n`,
          "utf-8",
        );
      } catch {
        /* best-effort */
      }
      if (isJson) {
        console.log(JSON.stringify({ ok: false, error: errMsg }));
      } else {
        console.error(`\n  ✗ Capture failed: ${errMsg}\n`);
      }
      process.exit(1);
    }
  },
});
