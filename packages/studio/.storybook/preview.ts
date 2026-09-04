/**
 * Studio's entry stylesheet is the gallery's stylesheet: `studio.css` pulls in
 * Tailwind and `theme.css`, pins `color-scheme: dark` and paints the body from
 * `--color-bg-0`. A story therefore sits on the same surface, at the same
 * contrast, as the panel the control ships in.
 *
 * The a11y addon runs on every story and a violation is an error, not a
 * warning. A violation on a primitive is fixed in the primitive; there is no
 * per-story suppression here to reach for.
 */

import type { Preview } from "@storybook/react-vite";
import "../src/styles/studio.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    controls: { expanded: true },
    a11y: { test: "error" },
  },
};

export default preview;
