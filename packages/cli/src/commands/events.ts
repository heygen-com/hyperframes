import { defineCommand } from "citty";
import { trackEvent, flush } from "../telemetry/client.js";

// Skill-usage telemetry endpoint. A skill reports its own invocation/outcome —
// ideally from its own bundled script, so it fires deterministically rather
// than relying on the agent to remember:
//
//   npx hyperframes events --skill=product-launch-video
//   npx hyperframes events --skill=product-launch-video --event=skill_completed --outcome=success
//
// Rides the SAME anonymous PostHog pipeline + consent gates as every other CLI
// event (DO_NOT_TRACK / telemetry opt-out, anonymous install UUID, IP stripped).
//
// Telemetry must NEVER break the calling skill: every arg is optional (a missing
// or malformed value is a silent no-op, not a non-zero exit), the body is
// guarded, and flush() carries its own hard timeout. This command always exits 0.

const ALLOWED_EVENTS = ["skill_invoked", "skill_completed"];
const ALLOWED_OUTCOMES = ["success", "error", "abort"];
// Skill names are lowercase slugs (e.g. "product-launch-video"). Anything that
// doesn't match is dropped, so a caller can't push high-cardinality or PII
// strings (paths, shell output, free text) into the anonymous event stream.
const SKILL_SLUG = /^[a-z0-9][a-z0-9-]{0,63}$/;

export default defineCommand({
  meta: {
    name: "events",
    description:
      "Emit an anonymous skill-usage telemetry event (skills report their own invocation/outcome). Honors DO_NOT_TRACK / telemetry opt-out.",
  },
  args: {
    skill: {
      type: "string",
      description: "Authoring skill slug, e.g. product-launch-video",
    },
    event: {
      type: "string",
      description: "Event name: skill_invoked | skill_completed (default: skill_invoked)",
      default: "skill_invoked",
    },
    outcome: {
      type: "string",
      description: "Optional outcome for completion events: success | error | abort",
    },
  },
  async run({ args }) {
    // Best-effort: nothing here may fail the skill that called us. Missing or
    // malformed input is a silent no-op rather than a non-zero exit.
    try {
      const skill = typeof args.skill === "string" ? args.skill.trim() : "";
      if (!SKILL_SLUG.test(skill)) return; // missing / non-slug → no-op

      const event = ALLOWED_EVENTS.includes(args.event) ? args.event : "skill_invoked";
      const props: Record<string, string> = { authoring_skill: skill };
      if (args.outcome && ALLOWED_OUTCOMES.includes(args.outcome)) {
        props["outcome"] = args.outcome;
      }
      trackEvent(event, props);
      await flush();
    } catch {
      // swallow — telemetry must never surface a non-zero exit to the caller
    }
  },
});
