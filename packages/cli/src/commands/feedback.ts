import { resolve } from "node:path";
import { defineCommand } from "citty";
import * as clack from "@clack/prompts";
import open from "open";
import type { Example } from "./_examples.js";
import { trackRenderFeedback } from "../telemetry/events.js";
import { shouldTrack, flush } from "../telemetry/client.js";
import { getDoctorSummary } from "../telemetry/feedback.js";
import { publishProjectArchive } from "../utils/publishProject.js";
import { submitFeedback } from "../utils/submitFeedback.js";
import { buildIssueUrl, HYPERFRAMES_REPO_URL } from "../utils/feedbackIssue.js";
import { VERSION } from "../version.js";
import { c } from "../ui/colors.js";
import { parseFeedbackRating } from "../utils/feedbackRating.js";
import { lintFeedbackComment, type FeedbackLintInput } from "../utils/feedbackLint.js";

export const examples: Example[] = [
  ["Submit render feedback", 'hyperframes feedback --rating 8 --comment "fast but font missing"'],
  ["Quick rating only", "hyperframes feedback --rating 10"],
  [
    "Also file a GitHub issue with a published repro",
    'hyperframes feedback --rating 3 --comment "GSAP timeline froze" --file-issue',
  ],
];

function normalizeComment(raw?: string): string | undefined {
  return raw || undefined;
}

function printIssueConsent(dir: string): void {
  console.log();
  console.log(
    `  ${c.bold("Filing an issue will publish this project publicly and open a GitHub issue draft.")}`,
  );
  console.log(`  ${c.dim(`Project at ${dir} will be uploaded to a public URL.`)}`);
  console.log(
    `  ${c.dim("The issue draft will contain that public link plus your feedback; you review and submit it.")}`,
  );
  console.log();
}

async function promptConfirm(): Promise<boolean> {
  const approved = await clack.confirm({ message: "Publish this project and draft the issue?" });
  return !clack.isCancel(approved) && approved === true;
}

/**
 * Consent gate: publishing uploads the project to a PUBLIC url, so confirm
 * before proceeding. Returns true when the caller may publish + file.
 */
async function confirmFileIssue(dir: string, yes: boolean): Promise<boolean> {
  printIssueConsent(dir);
  if (yes) return true;
  if (!process.stdout.isTTY) {
    console.log(`  ${c.dim("Re-run with --yes to publish the repro and file the issue.")}\n`);
    return false;
  }
  if (await promptConfirm()) return true;
  console.log(`\n  ${c.dim("Aborted. Feedback was still sent.")}\n`);
  return false;
}

/**
 * Publish a minimal repro and return its public URL. Degrades gracefully:
 * on failure it returns undefined so the issue still opens without a link.
 */
async function publishRepro(dir: string): Promise<string | undefined> {
  const spinner = clack.spinner();
  spinner.start("Publishing minimal repro...");
  try {
    const published = await publishProjectArchive(dir);
    spinner.stop(c.success("Repro published"));
    return published.url;
  } catch (err: unknown) {
    spinner.stop(c.error("Publish failed"));
    console.error(`  ${(err as Error).message}`);
    console.log(`  ${c.dim("Filing the issue without a repro link.")}`);
    return undefined;
  }
}

/**
 * Print soft-warn feedback-lint messages to stdout. Extracted so the
 * command's `run` stays a flat control-flow driver — the warning loop is
 * incidental to the command logic and its complexity would otherwise push
 * `run` over the Fallow CRAP threshold.
 */
function printFeedbackLintWarnings(input: FeedbackLintInput): void {
  for (const warning of lintFeedbackComment(input)) {
    console.log(c.warn(`⚠ ${warning.message}`));
  }
}

async function openAndPrintIssue(url: string): Promise<void> {
  if (process.stdout.isTTY) {
    try {
      await open(url);
    } catch {
      // Headless or no browser; the printed URL below is the fallback.
    }
  }
  console.log();
  console.log(`  ${c.dim("Review and submit the pre-filled issue (it is not auto-submitted):")}`);
  console.log(`  ${c.accent(url)}`);
  console.log();
}

async function fileGithubIssue(opts: {
  rating: number;
  comment?: string;
  rawDir?: string;
  yes: boolean;
  doctorSummary: string;
}): Promise<void> {
  const dir = resolve(opts.rawDir ?? ".");
  if (!(await confirmFileIssue(dir, opts.yes))) return;
  const repoPublicUrl = await publishRepro(dir);
  const url = buildIssueUrl({
    repoUrl: HYPERFRAMES_REPO_URL,
    rating: opts.rating,
    comment: opts.comment,
    repoPublicUrl,
    environment: opts.doctorSummary,
    cliVersion: VERSION,
  });
  await openAndPrintIssue(url);
}

export default defineCommand({
  meta: { name: "feedback", description: "Submit anonymous feedback about your experience" },
  args: {
    rating: {
      type: "string",
      description: "Likelihood to recommend (0=not likely, 10=extremely likely)",
      required: true,
    },
    comment: {
      type: "string",
      description: "Optional details about your experience",
    },
    "file-issue": {
      type: "boolean",
      description: "Also open a pre-filled GitHub issue with a published minimal repro",
      default: false,
    },
    dir: {
      type: "string",
      description: "Project directory to publish as the repro (default: current directory)",
    },
    yes: {
      type: "boolean",
      alias: "y",
      description: "Skip the publish + file-issue consent prompt",
      default: false,
    },
  },
  async run({ args }) {
    const rating = parseFeedbackRating(args.rating);
    if (rating === null) {
      console.error(c.error("Rating must be an integer between 0 and 10"));
      process.exit(1);
    }

    if (!shouldTrack()) {
      console.log(c.dim("Telemetry is disabled. Feedback not sent."));
      return;
    }

    const comment = normalizeComment(args.comment);
    const doctorSummary = await getDoctorSummary();

    // Soft-warn (never blocks) when the comment for a non-clean report is
    // missing the mandated reproduction-packet markers. Prints before the
    // submission ack so the reporter sees the nudge while their run is fresh.
    printFeedbackLintWarnings({ rating, comment });

    // The standalone command runs separately from `render`, so it has no real
    // elapsed time to report. Omit it rather than recording a fake duration.
    trackRenderFeedback({ rating, comment, doctorSummary });

    await flush();
    // Ack first so the user isn't kept waiting on the best-effort forward (which
    // is bounded to a few seconds and never surfaces an error either way).
    console.log(c.dim("Thanks for the feedback!"));
    await submitFeedback({ rating, comment, cliVersion: VERSION, env: doctorSummary });

    if (args["file-issue"] === true) {
      await fileGithubIssue({
        rating,
        comment,
        rawDir: args.dir,
        yes: args.yes === true,
        doctorSummary,
      });
    }
  },
});
