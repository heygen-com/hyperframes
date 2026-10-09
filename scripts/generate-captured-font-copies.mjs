import { copyFileSync } from "node:fs";

// Each workflow installs independently. Edit the product-launch-video owner.
const source = new URL(
  "../skills/product-launch-video/scripts/lib/captured-fonts.mjs",
  import.meta.url,
);
for (const skill of ["faceless-explainer", "pr-to-video"]) {
  copyFileSync(
    source,
    new URL(`../skills/${skill}/scripts/lib/captured-fonts.mjs`, import.meta.url),
  );
}
