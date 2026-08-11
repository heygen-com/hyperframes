import { isProtocolEvaluateTimeoutError } from "./captureTimeout.js";

const LAZY_SCROLL_STEP_DELAY_MS = 400;
const LAZY_SCROLL_MAX_IMAGE_WAIT_MS = 5_000;
const LAZY_SCROLL_BOTTOM_SETTLE_MS = 800;

export interface LazyScrollPage {
  evaluate(pageFunction: string): Promise<unknown>;
}

export interface LazyScrollResult {
  steps: number;
  timedOut: boolean;
  degraded: boolean;
}

async function settleAfterScroll(
  page: LazyScrollPage,
  deadline: number,
  sleep: (ms: number) => Promise<void>,
): Promise<void> {
  const bottomSettleMs = Math.min(LAZY_SCROLL_BOTTOM_SETTLE_MS, Math.max(0, deadline - Date.now()));
  if (bottomSettleMs > 0) {
    await page.evaluate(`window.scrollTo(0, document.body.scrollHeight)`);
    await sleep(bottomSettleMs);
  }

  const imageWaitMs = Math.min(LAZY_SCROLL_MAX_IMAGE_WAIT_MS, Math.max(0, deadline - Date.now()));
  if (imageWaitMs > 0) {
    const pending = (await page.evaluate(
      `Array.from(document.images).filter(function(img) { return !img.complete; }).length`,
    )) as number;
    if (pending > 0) {
      await sleep(imageWaitMs);
    }
  }

  await page.evaluate(`window.scrollTo(0, 0)`);
}

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
      const state = (await page.evaluate(`(() => {
        var y = window.scrollY || window.pageYOffset || 0;
        var view = window.innerHeight || 0;
        var height = document.body ? document.body.scrollHeight : 0;
        var next = Math.min(y + view * 0.7, Math.max(0, height - view));
        var atBottom = height <= view + 2 || next <= y + 1;
        window.scrollTo(0, atBottom ? height : next);
        return { atBottom: atBottom };
      })()`)) as { atBottom: boolean };

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

    await settleAfterScroll(page, deadline, sleep);
  } catch (err) {
    if (!isProtocolEvaluateTimeoutError(err)) {
      throw err;
    }
    degraded = true;
    timedOut = true;
    opts.onWarning?.("lazy-scroll evaluate timed out; continuing with current page state");
    try {
      await page.evaluate(`window.scrollTo(0, 0)`);
    } catch {
      /* page may be wedged */
    }
  }

  return { steps, timedOut, degraded };
}
