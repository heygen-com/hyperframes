import * as readline from "node:readline";
import { readConfig, writeConfig } from "./config.js";
import { shouldTrack } from "./client.js";
import { trackRenderFeedback } from "./events.js";
import { c } from "../ui/colors.js";

const FEEDBACK_INTERVAL = 15;

let promptedThisSession = false;

/**
 * Increment the successful render counter and maybe prompt for feedback.
 * Returns immediately if conditions aren't met.
 */
export async function maybePromptRenderFeedback(opts: {
  renderDurationMs: number;
  quiet: boolean;
}): Promise<void> {
  if (promptedThisSession) return;
  if (opts.quiet) return;
  if (!process.stdin.isTTY) return;
  if (!shouldTrack()) return;
  if (process.env.CI) return;

  const config = readConfig();
  config.renderSuccessCount = (config.renderSuccessCount ?? 0) + 1;

  const sinceLastPrompt = config.renderSuccessCount - (config.lastFeedbackPromptAt ?? 0);
  if (sinceLastPrompt < FEEDBACK_INTERVAL) {
    writeConfig(config);
    return;
  }

  // Time to ask
  promptedThisSession = true;
  config.lastFeedbackPromptAt = config.renderSuccessCount;
  writeConfig(config);

  const answer = await askQuestion(
    `  ${c.dim("How was this render?")} ${c.accent("[1=poor 5=great, enter to skip]")} `,
  );

  const rating = parseInt(answer.trim(), 10);
  if (rating >= 1 && rating <= 5) {
    trackRenderFeedback({
      rating,
      renderDurationMs: opts.renderDurationMs,
    });
    console.log(c.dim("  Thanks for the feedback!"));
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
