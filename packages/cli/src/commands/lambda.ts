/**
 * `hyperframes lambda` — top-level dispatcher for AWS Lambda subcommands.
 *
 * Each subverb lives in `./lambda/<name>.ts` and exports a single
 * `runXxx(args)` async function. The subcommand surface is intentionally
 * thin glue: argument parsing + help text here; the actual work
 * (`renderToLambda` / `getRenderProgress` / `deploySite` / SAM driver)
 * lives in `@hyperframes/aws-lambda/sdk`.
 */

import { defineCommand } from "citty";
import type { DistributedFormat } from "@hyperframes/aws-lambda/sdk";
import type { Example } from "./_examples.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Deploy the Lambda render stack to AWS", "hyperframes lambda deploy"],
  [
    "Render a composition on the deployed stack",
    "hyperframes lambda render ./my-project --width 1920 --height 1080",
  ],
  [
    "Render and stream progress until done",
    "hyperframes lambda render ./my-project --width 1920 --height 1080 --wait",
  ],
  [
    "Render with composition variables (personalised template)",
    'hyperframes lambda render ./my-template --site-id abc1234deadbeef0 --width 1920 --height 1080 --variables \'{"title":"Hello Alice","accent":"#ff0000"}\'',
  ],
  [
    "Render with variables from a JSON file",
    "hyperframes lambda render ./my-template --site-id abc1234deadbeef0 --width 1920 --height 1080 --variables-file ./alice.json",
  ],
  [
    "Batch-render N personalised videos from a JSONL file (deploys the site once)",
    "hyperframes lambda render-batch ./my-template --batch ./users.jsonl --width 1920 --height 1080 --max-concurrent 10",
  ],
  ["Check progress for a started render", "hyperframes lambda progress hf-render-abcd1234"],
  [
    "Pre-upload a project so multiple renders share the upload",
    "hyperframes lambda sites create ./my-project",
  ],
  ["Tear the stack down", "hyperframes lambda destroy"],
  ["Print the IAM policy the CLI needs", "hyperframes lambda policies user"],
  [
    "Validate a checked-in IAM policy still covers the CLI",
    "hyperframes lambda policies validate ./infra/iam/hyperframes.json",
  ],
];

const HELP = `
${c.bold("hyperframes lambda")} ${c.dim("<subcommand> [args]")}

Deploy + drive distributed video renders on AWS Lambda.

${c.bold("SUBCOMMANDS:")}
  ${c.accent("deploy")}            ${c.dim("Provision the Lambda + Step Functions + S3 stack via SAM")}
  ${c.accent("sites create")}      ${c.dim("Tar + upload a project to S3 (reusable across renders)")}
  ${c.accent("render")}            ${c.dim("Start a distributed render (returns a renderId)")}
  ${c.accent("render-batch")}      ${c.dim("Fan out N personalised renders from a JSONL batch file")}
  ${c.accent("progress")}          ${c.dim("Print progress + cost for an in-flight or finished render")}
  ${c.accent("destroy")}           ${c.dim("Tear the stack down (S3 bucket is retained)")}
  ${c.accent("policies")}          ${c.dim("Print or validate the IAM permissions the CLI needs")}

${c.bold("FIRST RUN:")}
  ${c.accent("hyperframes lambda deploy")}
  ${c.accent("hyperframes lambda render ./my-project --width 1920 --height 1080 --wait")}

${c.bold("REQUIREMENTS:")}
  • AWS CLI configured (env vars, ~/.aws/credentials, or SSO)
  • AWS SAM CLI installed (https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/install-sam-cli.html)
  • bun on PATH (used to build the handler ZIP)
`;

export default defineCommand({
  meta: { name: "lambda", description: "Deploy and drive renders on AWS Lambda" },
  args: {
    subcommand: {
      type: "positional",
      required: false,
      description: "deploy | sites | render | progress | destroy | policies",
    },
    target: {
      type: "positional",
      required: false,
      description: "Subcommand-specific positional (project dir, render id, policies verb, etc.)",
    },
    extra: {
      type: "positional",
      required: false,
      description:
        "Extra positional (e.g. `sites create <projectDir>` or `policies validate <policy.json>`)",
    },

    // Stack identity
    "stack-name": {
      type: "string",
      description: "CloudFormation stack name (default: hyperframes-default)",
    },
    region: { type: "string", description: "AWS region (default: AWS_REGION env or us-east-1)" },
    profile: { type: "string", description: "AWS profile name (default: AWS_PROFILE env)" },

    // deploy
    concurrency: { type: "string", description: "Lambda reserved concurrency (default: 8)" },
    "chrome-source": {
      type: "string",
      description: "sparticuz | chrome-headless-shell (default: sparticuz)",
    },
    memory: { type: "string", description: "Lambda memory MB (default: 10240)" },
    "skip-build": { type: "boolean", description: "Reuse existing handler.zip (deploy)" },

    // sites / render
    "site-id": { type: "string", description: "Explicit site id (overrides content hash)" },
    width: { type: "string", description: "Render width in pixels" },
    height: { type: "string", description: "Render height in pixels" },
    fps: { type: "string", description: "Render fps (24 | 30 | 60)" },
    format: { type: "string", description: "mp4 | mov | png-sequence | webm (default: mp4)" },
    codec: { type: "string", description: "h264 | h265 (mp4 only)" },
    quality: { type: "string", description: "draft | standard | high" },
    "chunk-size": { type: "string", description: "Frames per chunk (default: 240)" },
    "max-parallel-chunks": { type: "string", description: "Max concurrent chunks (default: 16)" },
    "execution-name": {
      type: "string",
      description: "Step Functions execution name (default: hf-render-<uuid>)",
    },
    "output-key": {
      type: "string",
      description: "Final output S3 key (default: renders/<exec>/output.<ext>)",
    },
    // Variables — mirrors the local `hyperframes render` UX. Inline JSON or
    // file path, plus --strict-variables for type-checked validation against
    // the composition's `data-composition-variables` declaration.
    variables: {
      type: "string",
      description:
        'JSON object of variable values for the composition. Example: --variables \'{"title":"Hello"}\'. Values flow into window.__hfVariables on the Lambda chunk workers.',
    },
    "variables-file": {
      type: "string",
      description:
        "Path to a JSON file with variable values (alternative to --variables). The file must contain a single JSON object.",
    },
    "strict-variables": {
      type: "boolean",
      description:
        "Fail the render command if any --variables key is undeclared or has a wrong type vs the composition's data-composition-variables. Without this flag, mismatches are warnings.",
      default: false,
    },
    // render-batch
    batch: {
      type: "string",
      description:
        'Path to a JSONL batch file for `render-batch`. Each line: {"outputKey":"...","variables":{...}}',
    },
    "max-concurrent": {
      type: "string",
      description:
        "Max in-flight Step Functions executions for `render-batch` (default: 50). Distinct from --max-parallel-chunks (which caps chunks per render).",
    },
    "dry-run": {
      type: "boolean",
      description:
        "For `render-batch`: parse the batch file and print the manifest without invoking AWS. Every entry's status becomes `would-invoke`.",
      default: false,
    },
    wait: { type: "boolean", description: "Block until the render finishes" },
    "wait-interval-ms": {
      type: "string",
      description: "Poll cadence in ms when --wait is set (default: 5000)",
    },

    // shared
    json: { type: "boolean", description: "Emit machine-readable JSON" },
  },
  async run({ args }) {
    const subcommand = args.subcommand;
    if (!subcommand) {
      console.log(HELP);
      return;
    }

    const stackName =
      (args["stack-name"] as string | undefined) ??
      // Lazy-imported so the dispatcher doesn't pull state.ts (and its
      // node:fs deps) on every CLI invocation — only on lambda runs.
      (await import("./lambda/state.js")).DEFAULT_STACK_NAME;

    // Apply --profile globally before any AWS-SDK / `aws` / `sam` call runs.
    // The AWS SDK + the SAM CLI both read AWS_PROFILE from the environment,
    // so setting it here threads the value through render / progress / sites
    // (which don't take an explicit awsProfile arg) without each subverb
    // having to know about it. Region gets the same treatment so the SDK
    // clients constructed inside the SDK pick it up too.
    const profileFlag = args.profile as string | undefined;
    if (profileFlag) process.env.AWS_PROFILE = profileFlag;
    const regionFlag = args.region as string | undefined;
    if (regionFlag) process.env.AWS_REGION = regionFlag;

    // The lambda subverbs dynamic-import `@hyperframes/aws-lambda` at call
    // time. We keep aws-lambda as a workspace devDependency (not a runtime
    // dep) so the published CLI install stays small for users who don't
    // deploy to Lambda. Subverbs other than `policies` need aws-lambda;
    // catch the missing-module error here and turn it into a friendly hint.
    const verbsNeedingSDK = new Set([
      "deploy",
      "sites",
      "render",
      "render-batch",
      "progress",
      "destroy",
    ]);
    if (verbsNeedingSDK.has(subcommand)) {
      try {
        await import("@hyperframes/aws-lambda/sdk");
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code === "ERR_MODULE_NOT_FOUND") {
          console.error(
            `${c.error("@hyperframes/aws-lambda is not installed.")} The ${c.accent(`hyperframes lambda ${subcommand}`)} command needs it at runtime.\n` +
              `Install it alongside the CLI:\n` +
              `  ${c.accent("npm install -g @hyperframes/aws-lambda")}\n` +
              `Or, for an opt-in dev setup:\n` +
              `  ${c.accent("npm install @hyperframes/aws-lambda")}`,
          );
          process.exit(1);
        }
        throw err;
      }
    }

    switch (subcommand) {
      case "deploy": {
        const { runDeploy } = await import("./lambda/deploy.js");
        await runDeploy({
          stackName,
          region: args.region as string | undefined,
          awsProfile: args.profile as string | undefined,
          reservedConcurrency: parsePositiveInt(args.concurrency, "--concurrency"),
          chromeSource: parseChromeSource(args["chrome-source"]),
          lambdaMemoryMb: parsePositiveInt(args.memory, "--memory"),
          skipBuild: Boolean(args["skip-build"]),
        });
        return;
      }
      case "sites": {
        if (args.target !== "create") {
          console.error(
            `[lambda sites] unknown verb "${String(args.target)}". Only "create" is supported.`,
          );
          process.exit(1);
        }
        const projectDir = args.extra as string | undefined;
        if (!projectDir) {
          console.error(
            "[lambda sites create] usage: hyperframes lambda sites create <projectDir>",
          );
          process.exit(1);
        }
        const { runSitesCreate } = await import("./lambda/sites.js");
        await runSitesCreate({
          projectDir,
          stackName,
          siteId: args["site-id"] as string | undefined,
          json: Boolean(args.json),
        });
        return;
      }
      case "render": {
        const projectDir = args.target as string | undefined;
        if (!projectDir) {
          console.error(
            "[lambda render] usage: hyperframes lambda render <projectDir> --width <px> --height <px>",
          );
          process.exit(1);
        }
        const width = parsePositiveInt(args.width, "--width");
        const height = parsePositiveInt(args.height, "--height");
        if (width === undefined || height === undefined) {
          console.error("[lambda render] --width and --height are required.");
          process.exit(1);
        }
        const fpsRaw = parseIntFlag(args.fps) ?? 30;
        if (fpsRaw !== 24 && fpsRaw !== 30 && fpsRaw !== 60) {
          console.error(`[lambda render] --fps must be 24, 30, or 60; got ${fpsRaw}.`);
          process.exit(1);
        }
        const { runRender } = await import("./lambda/render.js");
        await runRender({
          projectDir,
          stackName,
          siteId: args["site-id"] as string | undefined,
          fps: fpsRaw,
          width,
          height,
          format: parseFormat(args.format),
          codec: parseCodec(args.codec),
          quality: parseQuality(args.quality),
          chunkSize: parsePositiveInt(args["chunk-size"], "--chunk-size"),
          maxParallelChunks: parsePositiveInt(args["max-parallel-chunks"], "--max-parallel-chunks"),
          executionName: args["execution-name"] as string | undefined,
          outputKey: args["output-key"] as string | undefined,
          variables: args.variables as string | undefined,
          variablesFile: args["variables-file"] as string | undefined,
          strictVariables: Boolean(args["strict-variables"]),
          json: Boolean(args.json),
          wait: Boolean(args.wait),
          waitIntervalMs: parsePositiveInt(args["wait-interval-ms"], "--wait-interval-ms") ?? 5000,
        });
        return;
      }
      case "render-batch": {
        const projectDir = args.target as string | undefined;
        if (!projectDir) {
          console.error(
            "[lambda render-batch] usage: hyperframes lambda render-batch <projectDir> --batch <path.jsonl> --width <px> --height <px>",
          );
          process.exit(1);
        }
        const batch = args.batch as string | undefined;
        if (!batch) {
          console.error(
            "[lambda render-batch] --batch <path.jsonl> is required. Each line is a JSON object with at least { outputKey: '...' }.",
          );
          process.exit(1);
        }
        const width = parsePositiveInt(args.width, "--width");
        const height = parsePositiveInt(args.height, "--height");
        if (width === undefined || height === undefined) {
          console.error("[lambda render-batch] --width and --height are required.");
          process.exit(1);
        }
        const fpsRaw = parseIntFlag(args.fps) ?? 30;
        if (fpsRaw !== 24 && fpsRaw !== 30 && fpsRaw !== 60) {
          console.error(`[lambda render-batch] --fps must be 24, 30, or 60; got ${fpsRaw}.`);
          process.exit(1);
        }
        const { runRenderBatch } = await import("./lambda/render-batch.js");
        await runRenderBatch({
          projectDir,
          stackName,
          batch,
          siteId: args["site-id"] as string | undefined,
          fps: fpsRaw,
          width,
          height,
          format: parseFormat(args.format),
          codec: parseCodec(args.codec),
          quality: parseQuality(args.quality),
          chunkSize: parsePositiveInt(args["chunk-size"], "--chunk-size"),
          maxParallelChunks: parsePositiveInt(args["max-parallel-chunks"], "--max-parallel-chunks"),
          maxConcurrent: parsePositiveInt(args["max-concurrent"], "--max-concurrent"),
          strictVariables: Boolean(args["strict-variables"]),
          dryRun: Boolean(args["dry-run"]),
          json: Boolean(args.json),
        });
        return;
      }
      case "progress": {
        const target = args.target as string | undefined;
        if (!target) {
          console.error(
            "[lambda progress] usage: hyperframes lambda progress <renderId | executionArn>",
          );
          process.exit(1);
        }
        const { runProgress } = await import("./lambda/progress.js");
        await runProgress({ target, stackName, json: Boolean(args.json) });
        return;
      }
      case "destroy": {
        const { runDestroy } = await import("./lambda/destroy.js");
        await runDestroy({ stackName, awsProfile: args.profile as string | undefined });
        return;
      }
      case "policies": {
        const verb = args.target as string | undefined;
        if (verb !== "role" && verb !== "user" && verb !== "validate") {
          console.error(
            `[lambda policies] usage: hyperframes lambda policies <role|user|validate> [args]`,
          );
          process.exit(1);
        }
        const { runPolicies } = await import("./lambda/policies.js");
        await runPolicies({
          verb,
          inputPath: args.extra as string | undefined,
          json: Boolean(args.json),
        });
        return;
      }
      default:
        console.error(`${c.error("Unknown subcommand:")} ${subcommand}\n${HELP}`);
        process.exit(1);
    }
  },
});

function parseIntFlag(raw: unknown): number | undefined {
  if (raw === undefined || raw === null || raw === "") return undefined;
  const n = Number.parseInt(String(raw), 10);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Parse a flag that must be a positive integer (>= 1) when supplied.
 * Negative values or non-integers fail loudly instead of flowing into
 * the SDK and producing opaque AWS validation errors mid-render.
 */
function parsePositiveInt(raw: unknown, flagName: string): number | undefined {
  const n = parseIntFlag(raw);
  if (n === undefined) return undefined;
  if (!Number.isInteger(n) || n < 1) {
    throw new Error(`[lambda] ${flagName} must be a positive integer; got ${n}`);
  }
  return n;
}

/**
 * Parse a string-union flag against a closed set of allowed values.
 * Returns `defaultValue` (which may be `undefined`) when the input is
 * empty; throws with a flag-specific message when the value is set
 * but unrecognised.
 */
function parseEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  errorPrefix: string,
  defaultValue: T | undefined,
): T | undefined {
  if (raw === undefined || raw === null || raw === "") return defaultValue;
  const s = String(raw);
  if ((allowed as readonly string[]).includes(s)) return s as T;
  throw new Error(`${errorPrefix} must be ${allowed.join("|")}; got ${s}`);
}

const FORMATS = [
  "mp4",
  "mov",
  "png-sequence",
  "webm",
] as const satisfies readonly DistributedFormat[];
const CODECS = ["h264", "h265"] as const;
const QUALITIES = ["draft", "standard", "high"] as const;
const CHROME_SOURCES = ["sparticuz", "chrome-headless-shell"] as const;

const parseFormat = (raw: unknown): (typeof FORMATS)[number] =>
  parseEnum(raw, FORMATS, "[lambda render] --format", "mp4")!;
const parseCodec = (raw: unknown): (typeof CODECS)[number] | undefined =>
  parseEnum(raw, CODECS, "[lambda render] --codec", undefined);
const parseQuality = (raw: unknown): (typeof QUALITIES)[number] | undefined =>
  parseEnum(raw, QUALITIES, "[lambda render] --quality", undefined);
const parseChromeSource = (raw: unknown): (typeof CHROME_SOURCES)[number] =>
  parseEnum(raw, CHROME_SOURCES, "[lambda deploy] --chrome-source", "sparticuz")!;
