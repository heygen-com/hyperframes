import { openBrowser } from "../auth/browser.js";
import { pageUrl, readPlan, type Plan } from "../heygen/plan.js";
import { c } from "../ui/colors.js";
import { failCommand } from "../utils/commandResult.js";
import { defineCommand } from "../utils/defineCommand.js";

const describe = (p: Plan | null) =>
  p && p.plan !== "none" ? `${p.plan} plan, ${p.credits.toLocaleString("en-US")} credits` : "Free";

/** Opens the plans or credits page, then waits until the account shows the change, so the run continues on its own. */
export default defineCommand({
  meta: {
    name: "billing",
    description:
      "Open the HyperFrames plans or credits page and wait until the person is done (subscribe | top-up)",
  },
  args: {
    action: { type: "positional", description: "subscribe | top-up", required: true },
    needed: {
      type: "string",
      description: "Credits the waiting step needs (top-up waits until the balance covers it)",
    },
    tool: { type: "string", description: "The step that is waiting, shown on the page" },
    timeout: { type: "string", description: "Seconds to wait (default 600)" },
  },
  // fallow-ignore-next-line complexity
  async run({ args }) {
    const action = String(args.action);
    if (action !== "subscribe" && action !== "top-up") {
      console.error(c.error("Use `billing subscribe` or `billing top-up`."));
      failCommand();
    }
    const needed = Number(args.needed) || undefined;
    const before = await readPlan();
    const done = (p: Plan | null) =>
      action === "subscribe"
        ? !!p && p.plan !== "none"
        : !!p && p.plan !== "none" && p.credits >= (needed ?? (before?.credits ?? 0) + 1);
    if (done(before) && (action === "subscribe" || needed)) {
      console.log(c.success(`✓ Already covered: ${describe(before)}.`));
      return;
    }
    const url = pageUrl(action === "subscribe" ? "plans" : "credits", { needed, tool: args.tool });
    console.log(`${action === "subscribe" ? "Plans" : "Credits"} page: ${c.accent(url)}`);
    await openBrowser(url);
    console.log("Waiting for the person to finish there ...");
    const deadline = Date.now() + (Number(args.timeout) || 600) * 1000;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, 2000));
      const now = await readPlan();
      if (done(now)) {
        console.log(c.success(`✓ Done: ${describe(now)}. Carry on.`));
        return;
      }
    }
    console.error(
      c.error(
        `Still waiting on the ${action === "subscribe" ? "plans" : "credits"} page; run this again once it is done.`,
      ),
    );
    failCommand();
  },
});
