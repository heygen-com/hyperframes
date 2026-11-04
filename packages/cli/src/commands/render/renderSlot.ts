import { c } from "../../ui/colors.js";
import { errorBox } from "../../ui/format.js";
import { failCommand } from "../../utils/commandResult.js";
import {
  acquireRenderLock,
  describeRenderLockHolder,
  RenderLockBusy,
  type RenderLockOptions,
} from "../../utils/renderLock.js";
import type { RenderPlan } from "./plan.js";

/** One local render at a time per machine: a second waits for the slot, or fails under --no-wait. */
export async function acquireRenderSlot(
  plan: Pick<RenderPlan, "project" | "waitForRenderSlot">,
  signal?: AbortSignal,
  lock: Partial<RenderLockOptions> = {},
): Promise<() => void> {
  try {
    return await acquireRenderLock({
      project: plan.project.dir,
      wait: plan.waitForRenderSlot,
      signal,
      onWait: (holder, path) =>
        console.error(
          c.warn(
            `  Waiting for another render to finish (${describeRenderLockHolder(holder, Date.now())}). ` +
              "Renders run one at a time on this machine; pass --no-wait to stop instead.",
          ) + c.dim(`\n  Lock: ${path}`),
        ),
      ...lock,
    });
  } catch (error) {
    if (!(error instanceof RenderLockBusy)) throw error;
    errorBox(
      "Another render is running on this machine",
      describeRenderLockHolder(error.holder, Date.now()),
      "Rerun without --no-wait to start when it finishes, or set HYPERFRAMES_RENDER_LOCK=off to render side by side.",
    );
    return failCommand(1, error);
  }
}
