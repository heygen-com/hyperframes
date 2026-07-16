import * as readline from "node:readline";
import { readConfig, writeConfig } from "./config.js";
import { shouldTrack } from "./client.js";
import { trackRenderFeedback } from "./events.js";
import { detectAgentRuntime } from "./agent_runtime.js";
import { c } from "../ui/colors.js";
import { parseFeedbackRating } from "../utils/feedbackRating.js";

const DEFAULT_FEEDBACK_INTERVAL = 15;

function getFeedbackInterval(): number {
  const env = process.env.HYPERFRAMES_FEEDBACK_INTERVAL;
  if (env) {
    const n = parseInt(env, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return DEFAULT_FEEDBACK_INTERVAL;
}

let promptedThisSession = false;

/**
 * Increment the successful render counter and maybe prompt for feedback.
 * Returns immediately if conditions aren't met.
 */
// fallow-ignore-next-line complexity
export async function maybePromptRenderFeedback(opts: {
  renderDurationMs: number;
  quiet: boolean;
}): Promise<void> {
  if (promptedThisSession) return;
  if (opts.quiet) return;
  if (!shouldTrack()) return;
  if (process.env.CI) return;

  const config = readConfig();
  config.renderSuccessCount = (config.renderSuccessCount ?? 0) + 1;

  const lastAt = config.lastFeedbackPromptAt ?? 0;
  const isFirstEverRender = lastAt === 0;
  const sinceLastPrompt = config.renderSuccessCount - lastAt;
  if (!isFirstEverRender && sinceLastPrompt < getFeedbackInterval()) {
    writeConfig(config);
    return;
  }

  if (detectAgentRuntime()) {
    promptedThisSession = true;
    config.lastFeedbackPromptAt = config.renderSuccessCount;
    writeConfig(config);
    console.log(
      c.dim("  [hyperframes] ") +
        c.dim("Agent feedback: ") +
        c.accent('hyperframes feedback --rating <0-10> --comment "..."'),
    );
    return;
  }

  if (!process.stdin.isTTY) {
    writeConfig(config);
    return;
  }

  // Time to ask
  promptedThisSession = true;
  config.lastFeedbackPromptAt = config.renderSuccessCount;
  writeConfig(config);

  const answer = await askQuestion(
    `  ${c.dim("How likely are you to recommend HyperFrames?")} ${c.accent("[0=not likely 10=extremely likely, enter to skip]")} `,
  );

  const rating = parseFeedbackRating(answer);
  if (rating !== null) {
    // Ask for optional text feedback
    const details = await askQuestion(`  ${c.dim("Any details?")} ${c.accent("(enter to skip)")} `);
    const trimmedDetails = details.trim();

    trackRenderFeedback({
      rating,
      renderDurationMs: opts.renderDurationMs,
      comment: trimmedDetails || undefined,
      doctorSummary: await getDoctorSummary(),
    });
    console.log(c.dim("  Thanks for the feedback!"));
  }
}

export async function getDoctorSummary(): Promise<string> {
  try {
    const [{ getSystemMeta }, { findFFmpeg }] = await Promise.all([
      import("../telemetry/system.js"),
      import("../browser/ffmpeg.js"),
    ]);
    const sys = getSystemMeta();
    const parts = [
      `os=${process.platform}/${process.arch}`,
      `node=${process.version}`,
      `cpu=${sys.cpu_count}cores`,
      `mem=${(sys.memory_total_mb / 1024).toFixed(0)}GB`,
      `ffmpeg=${findFFmpeg() ? "yes" : "no"}`,
    ];
    if (sys.is_docker) parts.push("docker");
    if (sys.is_wsl) parts.push("wsl");
    return parts.join(" ");
  } catch {
    return "";
  }
}

function askQuestion(prompt: string): Promise<string> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer);
    });
    // Auto-resolve after 10 seconds so the CLI never hangs
    const timeout = setTimeout(() => {
      rl.close();
      resolve("");
    }, 10_000);
    // Don't keep the process alive just for the timeout
    if (typeof timeout === "object" && timeout !== null && "unref" in timeout) {
      (timeout as { unref: () => void }).unref();
    }
  });
}
