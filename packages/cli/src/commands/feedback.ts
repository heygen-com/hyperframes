import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { trackRenderFeedback } from "../telemetry/events.js";
import { shouldTrack, flush } from "../telemetry/client.js";
import { getDoctorSummary } from "../telemetry/feedback.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Submit render feedback", 'hyperframes feedback --rating 4 --comment "fast but font missing"'],
  ["Quick rating only", "hyperframes feedback --rating 5"],
];

function parseRating(raw: string): number | null {
  const n = parseInt(raw, 10);
  return n >= 1 && n <= 5 && Number.isFinite(n) ? n : null;
}

export default defineCommand({
  meta: { name: "feedback", description: "Submit anonymous feedback about your experience" },
  args: {
    rating: {
      type: "string",
      description: "Satisfaction rating (1=poor, 5=great)",
      required: true,
    },
    comment: {
      type: "string",
      description: "Optional details about your experience",
    },
  },
  async run({ args }) {
    const rating = parseRating(args.rating);
    if (rating === null) {
      console.error(c.error("Rating must be between 1 and 5"));
      process.exit(1);
    }

    if (!shouldTrack()) {
      console.log(c.dim("Telemetry is disabled. Feedback not sent."));
      return;
    }

    const doctorSummary = await getDoctorSummary();

    // The standalone command runs separately from `render`, so it has no real
    // elapsed time to report. Omit it rather than recording a fake duration.
    trackRenderFeedback({
      rating,
      comment: args.comment || undefined,
      doctorSummary,
    });

    await flush();
    console.log(c.dim("Thanks for the feedback!"));
  },
});
