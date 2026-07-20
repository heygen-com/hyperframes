import { defineCommand } from "citty";
import type { Example } from "./_examples.js";
import { trackRenderFeedback } from "../telemetry/events.js";
import { shouldTrack, flush } from "../telemetry/client.js";
import { getDoctorSummary } from "../telemetry/feedback.js";
import { parseFeedbackRating } from "../telemetry/rating.js";
import { c } from "../ui/colors.js";

export const examples: Example[] = [
  ["Submit render feedback", 'hyperframes feedback --rating 8 --comment "fast but font missing"'],
  ["Quick rating only", "hyperframes feedback --rating 10"],
];

export const parseRating = parseFeedbackRating;

export default defineCommand({
  meta: { name: "feedback", description: "Submit anonymous feedback about your experience" },
  args: {
    rating: {
      type: "string",
      description: "Satisfaction rating (1=poor, 10=great)",
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
      console.error(c.error("Rating must be between 1 and 10"));
      process.exit(1);
    }

    if (!shouldTrack()) {
      console.log(c.dim("Telemetry is disabled. Feedback not sent."));
      return;
    }

    const doctorSummary = await getDoctorSummary();

    trackRenderFeedback({
      rating,
      renderDurationMs: 0,
      comment: args.comment || undefined,
      doctorSummary,
    });

    await flush();
    console.log(c.dim("Thanks for the feedback!"));
  },
});
