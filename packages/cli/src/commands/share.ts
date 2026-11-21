import { defineCommand } from "../utils/defineCommand.js";
import { resolveProjectOrThrow } from "../utils/project.js";
import { CliUsageError, setCommandExitCode } from "../utils/commandResult.js";
import { isUnattended } from "../utils/attendedTerminal.js";
import * as prompts from "../ui/prompts.js";
import { c } from "../ui/colors.js";
import { terminalLines, terminalText } from "@hyperframes/core";
import { receivedRecordStatus } from "../utils/privateProjectFile.js";
import {
  changesNamedReview,
  createShareService,
  type ShareAction,
  type ShareState,
  type ShareService,
} from "../share/service.js";
import { shareError } from "../share/errors.js";
import { jsonFailure } from "../utils/jsonError.js";
import { parsePositiveIntegerArg } from "../utils/integerArg.js";
import type { Example } from "./_examples.js";

export const examples: Example[] = [
  ["Create a review anyone with its link can open", "hyperframes share --public"],
  ["Add the current video as a new version", "hyperframes share --update"],
  ["Read the existing share without uploading edits", "hyperframes share --status --json"],
  ["Open sharing settings on the web", "hyperframes share --manage"],
];

export default defineCommand({
  meta: {
    name: "share",
    description: "Share a rendered video for review, using the same sharing as Desktop",
  },
  args: {
    dir: { type: "positional", description: "Project directory", required: false },
    public: {
      type: "boolean",
      description: "Explicitly allow anyone with the link on first share",
    },
    team: { type: "boolean", description: "Share with workspace members (paid plan)" },
    "invite-only": { type: "boolean", description: "Share with invited people only (paid plan)" },
    private: { type: "boolean", description: "First share with private access" },
    update: {
      type: "boolean",
      description: "Render and add a new video version to the existing share",
    },
    "include-source": {
      type: "boolean",
      description: "Upload editable project files, including unused and Git-ignored files",
    },
    "video-only": {
      type: "boolean",
      description: "Share only the rendered video, without editable source",
    },
    status: { type: "boolean", description: "Read status without rendering or uploading" },
    manage: { type: "boolean", description: "Open this share's web management page" },
    space: { type: "string", description: "Owning workspace for a new share" },
    review: {
      type: "string",
      description:
        "The review id this run may change; needed without a prompt in a folder that came from someone else",
    },
    "wait-seconds": {
      type: "string",
      description: "Wait for processing (1–1800 seconds)",
      default: "300",
    },
    json: { type: "boolean", description: "Emit a machine-readable result" },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Do not prompt; an explicit first-share audience is still required",
    },
  },
  async run({ args }) {
    try {
      const input = parseInput(args);
      const project = resolveProjectOrThrow(args.dir, { searchParents: true });
      let lastProgress = "";
      const service: ShareService = createShareService(project.dir, (value) => {
        if (!value || args.json) return;
        const message = `Sharing: ${terminalText(value.step)}${value.slow ? " (still processing)" : ""}`;
        if (message !== lastProgress) process.stderr.write(`${message}\n`);
        lastProgress = message;
      });
      await confirmNamedReview(input, args, service, project.dir);
      await chooseAudience(input, args, service);
      const result = await service.run(input);
      await presentResult(result, input, Boolean(args.json));
    } catch (error) {
      const failure = shareError(error);
      if (args.json)
        console.log(
          JSON.stringify({ ...jsonFailure(failure.code, failure.message), error: failure }),
        );
      else console.error(terminalLines(failure.message));
      setCommandExitCode(error instanceof CliUsageError ? 2 : 1);
    }
  },
});

interface ShareArgs {
  public?: boolean;
  team?: boolean;
  "invite-only"?: boolean;
  private?: boolean;
  update?: boolean;
  status?: boolean;
  manage?: boolean;
  yes?: boolean;
  json?: boolean;
  "wait-seconds"?: string;
  space?: string;
  review?: string;
  "video-only"?: boolean;
  "include-source"?: boolean;
}
function parseInput(args: ShareArgs): ShareAction {
  const waitSeconds =
    parsePositiveIntegerArg(args["wait-seconds"], "--wait-seconds", { max: 1800 }) ?? 300;
  if ([args.update, args.status, args.manage].filter(Boolean).length > 1)
    throw new CliUsageError("Choose only one of --update, --status or --manage.");
  const audience = requestedAudience(args);
  const action = args.status ? "status" : args.manage ? "manage" : args.update ? "update" : "share";

  validateActionOptions(action, audience, args);
  return {
    action,
    audience,
    space: args.space,
    waitSeconds,
    videoOnly: args["video-only"],
    includeSource: args["include-source"] === true,
  };
}

function validateActionOptions(
  action: ShareAction["action"],
  audience: ShareAction["audience"],
  args: ShareArgs,
) {
  validateSourceOptions(args);
  if (action !== "share" && audience)
    throw new CliUsageError(
      "Use audience flags with hyperframes share, without --update, --status or --manage.",
    );
  if (
    (action === "status" || action === "manage") &&
    (args.space || args["video-only"] || args["include-source"] || args.review !== undefined)
  )
    throw new CliUsageError(
      "--space, --include-source, --video-only and --review cannot be used with --status or --manage.",
    );
}

function validateSourceOptions(args: ShareArgs) {
  if (args["include-source"] && args["video-only"])
    throw new CliUsageError("Choose only one of --include-source or --video-only.");
}

function requestedAudience(args: ShareArgs) {
  const audiences: NonNullable<ShareAction["audience"]>[] = [];
  if (args.public) audiences.push("public");
  if (args.team) audiences.push("team");
  if (args["invite-only"]) audiences.push("invite");
  if (args.private) audiences.push("private");
  if (audiences.length > 1) throw new CliUsageError("Choose one audience.");
  return audiences[0];
}

function canAsk(args: ShareArgs) {
  return !args.yes && !args.json && !isUnattended();
}

function shouldPrompt(input: ShareAction, args: ShareArgs) {
  return input.action === "share" && !input.audience && canAsk(args);
}

async function confirmNamedReview(
  input: ShareAction,
  args: ShareArgs,
  service: ShareService,
  dir: string,
) {
  if (input.action !== "share" && input.action !== "update") return;
  if (args.review === undefined && receivedRecordStatus(dir) === null) return;
  const current = await service.status();
  if (args.review !== undefined) {
    if (current.reviewId !== args.review) throw reviewMismatch(args.review, current.reviewId);
    input.confirmedReview = args.review;
    return;
  }
  if (changesNamedReview(current, input)) {
    if (!canAsk(args)) throw reviewConfirmationRequired(current);
    await askToChangeReview(current);
  }
  input.confirmedReview = current.reviewId;
}

function namedReview(current: ShareState) {
  const title = current.reviewTitle
    ? `"${terminalText(current.reviewTitle)}"`
    : "(title not available)";
  return `${title} (${terminalText(current.reviewId ?? "")})`;
}

async function askToChangeReview(current: ShareState) {
  console.log();
  console.log(
    `  ${c.bold("This folder came from someone else, and its review record names an existing review.")}`,
  );
  console.log(
    `  ${c.bold("Sharing changes that review under your account: who can open it, its link or its versions.")}`,
  );
  console.log(`  ${c.dim(`Review: ${namedReview(current)}`)}`);
  if (current.share?.url) console.log(`  ${c.dim(`Link: ${terminalText(current.share.url)}`)}`);
  console.log(`  ${c.dim("If you did not share this review before, cancel.")}`);
  console.log();
  const approved = await prompts.confirm({ message: "Share to this review?", initialValue: false });
  if (prompts.isCancel(approved) || approved !== true)
    throw new CliUsageError("Sharing cancelled.");
}

function reviewConfirmationRequired(current: ShareState) {
  const id = terminalText(current.reviewId ?? "");
  return new CliUsageError(
    `This folder came from someone else, and its review record names an existing review, ${namedReview(current)}. ` +
      `This run cannot ask you to confirm it, so nothing was changed. Pass --review ${id} to share to that review, ` +
      "or remove the review record in this folder's .hyperframes folder to share it as a new review.",
    { code: "review_confirmation_required" },
  );
}

function reviewMismatch(given: string, named: string | null) {
  return new CliUsageError(
    `--review ${terminalText(given)} is not the review this folder's record names (${named ? terminalText(named) : "none"}). Nothing was changed.`,
    { code: "review_mismatch" },
  );
}

async function chooseAudience(input: ShareAction, args: ShareArgs, service: ShareService) {
  if (!shouldPrompt(input, args)) return;
  if ((await service.status()).share) return;
  const selected = await prompts.select({
    message: "Who should be able to open this review?",
    options: [
      { value: "public", label: "Anyone with the link (available on Free)" },
      { value: "team", label: "Workspace members" },
      { value: "invite", label: "Invited people" },
      { value: "private", label: "Only me" },
    ],
  });
  if (prompts.isCancel(selected)) throw new CliUsageError("Sharing cancelled.");
  if (
    selected === "public" ||
    selected === "team" ||
    selected === "invite" ||
    selected === "private"
  )
    input.audience = selected;
}

async function presentResult(result: ShareState, input: ShareAction, json: boolean) {
  if (input.action === "manage" && result.state === "not_shared")
    throw new CliUsageError("There is no share to manage yet. Create a share first.", {
      code: "not_shared",
    });
  if (!json && !result.upToDate && result.source.at === "video_only")
    console.error(sourceNotice(result.source.reason));
  if (result.state === "failed" && input.action !== "manage") {
    presentFailure(result, json);
    return;
  }
  await presentSuccessfulResult(result, input, json);
}

async function presentSuccessfulResult(result: ShareState, input: ShareAction, json: boolean) {
  if (json) console.log(JSON.stringify({ ok: true, ...result }));
  else if (result.activity)
    console.log(
      `Sharing: ${terminalText(result.activity.step.replaceAll("_", " "))}. Run hyperframes share --status to check progress.`,
    );
  else if (result.upToDate) console.log("Already up to date.");
  else if (input.action === "manage") {
    console.log(terminalText(result.manageUrl));
    if (!isUnattended()) await (await import("open")).default(result.manageUrl);
  } else if (result.ready) console.log(`Shared video ready: ${terminalText(String(result.url))}`);
  else if (result.state === "not_shared") console.log("This project has not been shared yet.");
  else if (result.state === "link_off")
    console.log("This share's link is off. Run hyperframes share --manage to turn it on.");
  else console.log("Your video is still processing. Run hyperframes share --status to check it.");
}

function presentFailure(result: ShareState, json: boolean) {
  const message = result.version.failure ?? "The shared video could not be processed.";
  if (json)
    console.log(JSON.stringify({ ...result, ...jsonFailure("share_export_failed", message) }));
  else {
    console.error(terminalLines(message));
    if (result.previousUrl)
      console.log(`Previous shared version: ${terminalText(result.previousUrl)}`);
  }
  setCommandExitCode(1);
}

function sourceNotice(reason: string): string {
  if (reason === "source_plan_required")
    return "Your video is shared without editable project files. Upgrade to Pro to include source files: https://hyperframes.studio/pricing?from=cli&entry=cli_share";
  if (reason === "requested")
    return "Sharing the video without editable project files. Use --include-source to upload project files.";
  return "Sharing the video without editable project files; source sharing is unavailable in this workspace.";
}
