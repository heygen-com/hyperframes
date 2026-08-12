import { isDegradableEvaluateTimeoutError, withRemainingBudget } from "./captureTimeout.js";

const LAZY_SCROLL_STEP_DELAY_MS = 400;
const LAZY_SCROLL_MAX_IMAGE_WAIT_MS = 5_000;
const LAZY_SCROLL_BOTTOM_SETTLE_MS = 800;
const LAZY_SCROLL_IMAGE_POLL_MS = 250;

export interface LazyScrollPage {
  evaluate(pageFunction: string): Promise<unknown>;
}

export interface LazyScrollResult {
  steps: number;
  timedOut: boolean;
  degraded: boolean;
}

async function evaluateWithinBudget(
  page: LazyScrollPage,
  expression: string,
  deadline: number,
  label: string,
): Promise<unknown> {
  return withRemainingBudget(page.evaluate(expression), deadline - Date.now(), label);
}

async function settleAfterScroll(
  page: LazyScrollPage,
  deadline: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const bottomSettleMs = Math.min(LAZY_SCROLL_BOTTOM_SETTLE_MS, Math.max(0, deadline - Date.now()));
  if (bottomSettleMs > 0) {
    await evaluateWithinBudget(
      page,
      `window.scrollTo(0, document.body.scrollHeight)`,
      deadline,
      "lazy-scroll-bottom",
    );
    await sleep(bottomSettleMs);
  }

  const imageDeadline = Math.min(deadline, Date.now() + LAZY_SCROLL_MAX_IMAGE_WAIT_MS);
  while (Date.now() < imageDeadline) {
    const pending = (await evaluateWithinBudget(
      page,
      `Array.from(document.images).filter(function(img) { return !img.complete; }).length`,
      imageDeadline,
      "lazy-scroll-image-pending",
    )) as number;
    if (!(pending > 0)) {
      break;
    }
    const waitMs = Math.min(LAZY_SCROLL_IMAGE_POLL_MS, imageDeadline - Date.now());
    if (waitMs <= 0) {
      break;
    }
    await sleep(waitMs);
  }

  if (deadline - Date.now() > 0) {
    await evaluateWithinBudget(page, `window.scrollTo(0, 0)`, deadline, "lazy-scroll-reset");
  }
}

// fallow-ignore-next-line complexity
export async function lazyScrollForCapture(
  page: LazyScrollPage,
  budgetMs: number,
  opts: {
    stepDelayMs?: number;
    onWarning?: (message: string) => void;
    sleep?: (ms: number) => Promise<void>;
  } = {},
): Promise<LazyScrollResult> {
  if (budgetMs <= 0) {
    return { steps: 0, timedOut: false, degraded: false };
  }

  const stepDelayMs = opts.stepDelayMs ?? LAZY_SCROLL_STEP_DELAY_MS;
  const sleep = opts.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const deadline = Date.now() + budgetMs;
  let steps = 0;
  let timedOut = false;
  let degraded = false;

  try {
    while (Date.now() < deadline) {
      const state = (await evaluateWithinBudget(
        page,
        `(() => {
        var y = window.scrollY || window.pageYOffset || 0;
        var view = window.innerHeight || 0;
        var height = document.body ? document.body.scrollHeight : 0;
        var next = Math.min(y + view * 0.7, Math.max(0, height - view));
        var atBottom = height <= view + 2 || next <= y + 1;
        window.scrollTo(0, atBottom ? height : next);
        return { atBottom: atBottom };
      })()`,
        deadline,
        "lazy-scroll-step",
      )) as { atBottom: boolean };

      steps += 1;
      if (state.atBottom) {
        break;
      }

      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        timedOut = true;
        break;
      }
      await sleep(Math.min(stepDelayMs, remaining));
    }

    if (Date.now() >= deadline) {
      timedOut = true;
    }

    if (deadline - Date.now() > 0) {
      await settleAfterScroll(page, deadline, sleep);
    }
  } catch (err) {
    if (!isDegradableEvaluateTimeoutError(err)) {
      throw err;
    }
    degraded = true;
    timedOut = true;
    opts.onWarning?.("lazy-scroll evaluate timed out; continuing with current page state");
    if (deadline - Date.now() > 0) {
      try {
        await evaluateWithinBudget(page, `window.scrollTo(0, 0)`, deadline, "lazy-scroll-recovery");
      } catch {
        /* page may be wedged; do not spend another unbounded protocol wait */
      }
    }
  }

  return { steps, timedOut, degraded };
}
