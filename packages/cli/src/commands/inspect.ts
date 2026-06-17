import type { Example } from "./_examples.js";
import { createInspectCommand } from "./layout.js";

export const examples: Example[] = [
  ["Inspect visual layout across the current composition", "hyperframes inspect"],
  ["Inspect a specific project", "hyperframes inspect ./my-video"],
  ["Output agent-readable JSON", "hyperframes inspect --json"],
  ["Use explicit hero-frame timestamps", "hyperframes inspect --at 1.5,4.0,7.25"],
  [
    "Also sample at tween boundaries to catch transient overlaps",
    "hyperframes inspect --at-transitions",
  ],
  [
    "Verify motion intent (add a *.motion.json sidecar next to the composition)",
    "hyperframes inspect --json",
  ],
  ["Run the compatibility alias", "hyperframes layout --json"],
];

export default createInspectCommand("inspect");
