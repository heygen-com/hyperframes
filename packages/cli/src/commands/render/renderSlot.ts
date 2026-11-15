import { c } from "../../ui/colors.js";
import { errorBox } from "../../ui/format.js";
import { failCommand } from "../../utils/commandResult.js";
import {
  acquireRenderLock,
  describeRenderLockHolder,
  RenderLockBusy,
  type RenderLockOptions,
} from "../../utils/renderLock.js";
import { RenderLockStaleBreak, RenderLockUnwritable } from "../../utils/renderLockClaim.js";
import type { RenderPlan } from "./plan.js";

/** One local render at a time per user account: a second waits for the slot, or fails under --no-wait. */
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
              "Renders run one at a time per user account; pass --no-wait to stop instead.",
          ) + c.dim(`\n  Lock: ${path}`),
        ),
      ...lock,
    });
  } catch (error) {
    if (error instanceof RenderLockStaleBreak || error instanceof RenderLockUnwritable) {
      errorBox("The render slot cannot be taken", error.message);
      return failCommand(1, error);
    }
    if (!(error instanceof RenderLockBusy)) throw error;
    errorBox(
      "Another render is running for this user account",
      describeRenderLockHolder(error.holder, Date.now()),
      "Rerun without --no-wait to start when it finishes, or set HYPERFRAMES_RENDER_LOCK=off to render side by side. " +
        "Set HYPERFRAMES_CACHE_DIR to a shared folder to share the slot across user accounts.",
    );
    return failCommand(1, error);
  }
}
