import { failCommand } from "../utils/commandResult.js";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
import { defineCommand } from "citty";
import * as clack from "@clack/prompts";
import open from "open";
import type { Example } from "./_examples.js";
import {
  trackCatalogSearchMiss,
  trackFeedbackComment,
  trackRenderFeedback,
} from "../telemetry/events.js";
import { shouldTrack } from "../telemetry/client.js";
import { getDoctorSummary } from "../telemetry/feedback.js";
import { readConfig, type RecentRenderRecord } from "../telemetry/config.js";
import { publishProjectArchive } from "../utils/publishProject.js";
import { submitCatalogSearchMiss, submitFeedback } from "../utils/submitFeedback.js";
import { buildIssueUrl, HYPERFRAMES_REPO_URL } from "../utils/feedbackIssue.js";
import { VERSION } from "../version.js";
import { c } from "../ui/colors.js";
import { parseFeedbackRating } from "../utils/feedbackRating.js";
import { feedbackEmail, parseFeedbackSource } from "../utils/feedbackSource.js";
import { lintFeedbackComment, type FeedbackLintInput } from "../utils/feedbackLint.js";

export const examples: Example[] = [
  ["Submit render feedback", 'hyperframes feedback --rating 8 --comment "fast but font missing"'],
  ["Quick rating only", "hyperframes feedback --rating 10"],
  [
    "Report something you needed that is missing (no rating)",
    'hyperframes feedback --comment "MISSING FEATURE: trim a clip from the timeline | WORKAROUND: none"',
  ],
  [
    "Report a catalog gap after a fruitless search",
    'hyperframes feedback --search-miss "typewriter that deletes" --wanted "text that types then backspaces"',
  ],
  [
    "Also file a GitHub issue with a published repro",
    'hyperframes feedback --rating 3 --comment "GSAP timeline froze" --file-issue',
  ],
];

function normalizeComment(raw?: string): string | undefined {
  return raw || undefined;
}

/**
 * Compact PostHog join keys appended to the environment string that rides
 * along with the forwarded report (and therefore lands verbatim in the wild
 * feedback channel): `fid` = the PostHog `feedback_id` (`cli_render_feedback` or
 * `cli_feedback_comment`); `tid` = the install's telemetry distinct_id; `renders` =
 * recent `render_job_id`s (newest last, `!` suffix = the render failed).
 * Together they turn a wild report into an exact telemetry lookup instead of
 * a hardware-fingerprint hunt.
 */
export function buildTelemetryJoinKeys(input: {
  feedbackId: string;
  anonymousId: string;
  recentRenders?: RecentRenderRecord[];
}): string {
  const parts = [`fid=${input.feedbackId}`, `tid=${input.anonymousId}`];
  if (input.recentRenders?.length) {
    parts.push(`renders=${input.recentRenders.map((r) => `${r.id}${r.ok ? "" : "!"}`).join(",")}`);
  }
  return parts.join(" ");
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

// A comment with no rating is its own report (a missing feature, host-app
// friction): it scores nothing, so it must stay out of the rating metric.
function reportRating(
  raw: string | undefined,
  comment: string | undefined,
  fileIssue: boolean,
): number | undefined {
  const rating = raw === undefined ? undefined : parseFeedbackRating(raw);
  if (rating === null) {
    console.error(c.error("Rating must be an integer between 0 and 10"));
    failCommand();
  }
  if (rating === undefined && !comment?.trim()) {
    console.error(c.error("Give a --rating (an integer from 0 to 10), a --comment, or both"));
    failCommand();
  }
  if (rating === undefined && fileIssue) {
    console.error(c.error("--file-issue needs a --rating"));
    failCommand();
  }
  return rating;
}

function trackFeedback(report: {
  rating: number | undefined;
  comment: string | undefined;
  doctorSummary: string;
  feedbackId: string;
  recentRenderIds: string[] | undefined;
}): void {
  const { rating, comment, ...keys } = report;
  if (rating === undefined) {
    if (comment) trackFeedbackComment({ comment, ...keys });
    return;
  }
  // Soft-warn (never blocks) when the comment for a non-clean report is
  // missing the mandated reproduction-packet markers. Prints before the
  // submission ack so the reporter sees the nudge while their run is fresh.
  printFeedbackLintWarnings({ rating, comment });
  // The standalone command runs separately from `render`, so it has no real
  // elapsed time to report. Omit it rather than recording a fake duration.
  trackRenderFeedback({ rating, comment, ...keys });
}

export default defineCommand({
  meta: { name: "feedback", description: "Submit feedback about your experience" },
  args: {
    rating: {
      type: "string",
      // Optional: --search-miss and a lone --comment are reports with no
      // rating to give, so the check lives in the run body.
      description: "Likelihood to recommend (0=not likely, 10=extremely likely)",
    },
    comment: {
      type: "string",
      description: "Details about your experience; alone, a report with no rating",
    },
    source: {
      type: "string",
      description: 'Who wrote the report: "person" or "agent"',
    },
    "search-miss": {
      type: "string",
      description: "Report a catalog search that found nothing useful; pass the query you ran",
    },
    wanted: {
      type: "string",
      description: "What you needed the catalog to have (used with --search-miss)",
    },
    tier: {
      type: "string",
      description: 'Which search tier answered: "on-device" or "words"',
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
    // A search miss is a different report from a rating: it names a gap in the
    // catalog rather than scoring an experience, so it carries no rating and
    // must not land in the same number.
    const searchMiss = normalizeComment(args["search-miss"]);
    if (searchMiss) {
      if (!shouldTrack()) {
        console.log(c.dim("Telemetry is disabled. Nothing sent."));
        return;
      }
      const wanted = normalizeComment(args.wanted);
      const tier = normalizeComment(args.tier);
      trackCatalogSearchMiss({ query: searchMiss, wanted, tier });
      // Ack before the forward, which is best-effort and bounded, so the
      // reporter is never left waiting on it.
      console.log(c.dim("Logged the gap. Thanks — that is how the catalog grows."));
      await submitCatalogSearchMiss({ query: searchMiss, wanted, tier, cliVersion: VERSION });
      return;
    }

    const comment = normalizeComment(args.comment);
    const rating = reportRating(args.rating, comment, args["file-issue"] === true);

    const source = parseFeedbackSource(args.source);
    if (source === null) {
      console.error(c.error('Source must be "person" or "agent"'));
      failCommand();
    }

    if (!shouldTrack()) {
      console.log(c.dim("Telemetry is disabled. Feedback not sent."));
      return;
    }

    const doctorSummary = await getDoctorSummary();

    // Join keys tying this report to the install's PostHog rows — see
    // buildTelemetryJoinKeys. Appended to the env string so they surface in
    // the forwarded report; mirrored as structured props on the PostHog event.
    const feedbackId = randomUUID();
    const config = readConfig();
    const joinKeys = buildTelemetryJoinKeys({
      feedbackId,
      anonymousId: config.anonymousId,
      recentRenders: config.recentRenders,
    });
    const envWithJoinKeys = doctorSummary ? `${doctorSummary} ${joinKeys}` : joinKeys;

    trackFeedback({
      rating,
      comment,
      doctorSummary,
      feedbackId,
      recentRenderIds: config.recentRenders?.map((r) => r.id),
    });

    // Ack first so the user isn't kept waiting on the best-effort forward (which
    // is bounded to a few seconds and never surfaces an error either way).
    console.log(c.dim("Thanks for the feedback!"));
    await submitFeedback({
      rating,
      comment,
      cliVersion: VERSION,
      env: envWithJoinKeys,
      source,
      email: feedbackEmail(),
    });

    if (args["file-issue"] === true && rating !== undefined) {
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
