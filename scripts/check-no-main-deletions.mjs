#!/usr/bin/env node
/**
 * Fail if this branch would delete files that exist on the base.
 *
 * Written after a scare that turned out to be a measurement error, which is
 * the reason it uses the three-dot form. Comparing tip to tip (two dots) on a
 * branch that is a month behind reports every file main added since the merge
 * base as a deletion: 1,284 of them, including an entire skills tree. None of
 * that is real. A merge keeps main's side, and a pull request shows the
 * three-dot diff, which reported zero.
 *
 * So this exists to catch deletions a branch genuinely proposes, and to make
 * the distinction hard to get wrong again. If it ever disagrees with a manual
 * git diff, check which form the manual one used before believing it.
 *
 * Renames are reported separately. In a name-only diff a rename is
 * indistinguishable from a deletion, so treating them alike would either mask
 * real loss or block every legitimate move.
 *
 *   node scripts/check-no-main-deletions.mjs [--base origin/main]
 */

import { execFileSync } from "node:child_process";

const BASE_FLAG = "--base";

/**
 * Deletions this repository has already agreed to, each with the reason.
 *
 * A blanket escape hatch (a flag, an env var, `--force`) would turn the guard
 * off exactly when it matters, because the branch deleting something by
 * accident is also the branch that would reach for it. Naming each path here
 * instead keeps the default absolute and makes every intentional removal a
 * reviewable line in a diff.
 *
 * Entries are for deletions that are NOT renames — git already pairs those on
 * its own. Remove an entry once its deletion has landed on the base.
 */
const STORYBOARD_VIEW_REASON =
  "owner-directed removal of the Studio storyboard view; its only readers were deleted with it";

const SIMULATED_CURSOR_REASON =
  "owner-directed removal of simulated-cursor; the Cursors section's new pointer animations replace it";

const CATALOG_FONT_REASON =
  "superseded catalog font: the regenerated block payloads load their fonts from newly hashed files, nothing references this one";

const DESIGN_NOTES_REASON =
  "plan and contract notes are working notes kept out of the repo; docs/contracts/ and docs/plans/ are gitignored";

const INSPECTOR_TOOLS_REASON =
  "the inspector ships the capability, not agent tools; each harness defines its own tool names, descriptions and schemas";

const RETIRED_WORKFLOW_REASON =
  "the eight workflow skills are retired; their measured knowledge lives in the hyperframes skill's references (film, captions, overlays, motion, look, format)";

const RETIRED_GUIDE_REASON =
  "the folded domain guides are retired; their knowledge lives in the hyperframes skill's references and media-use's mixing reference";

const RETIRED_ROUTING_REASON =
  "routing, interview and production-loop references for the retired workflows; the skills carry knowledge, not process";

const RETIRED_WORKFLOW_FILES = [
  "skills/embedded-captions/.gitignore",
  "skills/embedded-captions/CATALOG.md",
  "skills/embedded-captions/SKILL.md",
  "skills/embedded-captions/assets/fonts/char-widths.json",
  "skills/embedded-captions/assets/strokefonts/HersheyScript1.svg",
  "skills/embedded-captions/assets/strokefonts/HersheyScriptMed.svg",
  "skills/embedded-captions/dna/README.md",
  "skills/embedded-captions/dna/chrome.json",
  "skills/embedded-captions/dna/cream.json",
  "skills/embedded-captions/dna/documentary.json",
  "skills/embedded-captions/dna/editorial.json",
  "skills/embedded-captions/dna/glitch.json",
  "skills/embedded-captions/dna/ink.json",
  "skills/embedded-captions/dna/keynote.json",
  "skills/embedded-captions/dna/loud.json",
  "skills/embedded-captions/dna/neon.json",
  "skills/embedded-captions/dna/velocity.json",
  "skills/embedded-captions/modes/cinematic/README.md",
  "skills/embedded-captions/modes/cinematic/_archive/champion/spec.md",
  "skills/embedded-captions/modes/cinematic/_archive/champion/template.html",
  "skills/embedded-captions/modes/cinematic/_archive/memory-wall/spec.md",
  "skills/embedded-captions/modes/cinematic/_archive/memory-wall/template.html",
  "skills/embedded-captions/modes/cinematic/_archive/portrait-header/spec.md",
  "skills/embedded-captions/modes/cinematic/_archive/portrait-header/template.html",
  "skills/embedded-captions/modes/cinematic/cinematic-cream/spec.md",
  "skills/embedded-captions/modes/cinematic/cinematic-cream/template.html",
  "skills/embedded-captions/modes/cinematic/engine.html",
  "skills/embedded-captions/modes/standard/_anatomy.md",
  "skills/embedded-captions/modes/standard/_motion.md",
  "skills/embedded-captions/modes/standard/fonts/build-fonts-css.cjs",
  "skills/embedded-captions/modes/standard/fonts/files/anton-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/audiowide-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/baloo-2-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/baloo-2-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/bangers-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/bodoni-moda-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/bodoni-moda-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/caveat-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/caveat-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/chakra-petch-latin-500-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/chakra-petch-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/cinzel-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/cinzel-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/cormorant-garamond-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/cormorant-garamond-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/creepster-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/fredoka-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/fredoka-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/inter-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/inter-latin-500-italic.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/inter-latin-500-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/inter-latin-600-italic.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/inter-latin-600-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/inter-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/inter-latin-800-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/inter-latin-900-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/monoton-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/orbitron-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/orbitron-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/permanent-marker-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/press-start-2p-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/rajdhani-latin-500-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/rajdhani-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/saira-stencil-one-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/shippori-mincho-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/shippori-mincho-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/sora-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/sora-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/space-grotesk-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/space-grotesk-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/special-elite-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/teko-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/teko-latin-700-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/files/vt323-latin-400-normal.woff2",
  "skills/embedded-captions/modes/standard/fonts/fonts.css",
  "skills/embedded-captions/references/aesthetic-principles.md",
  "skills/embedded-captions/references/anti-patterns.md",
  "skills/embedded-captions/references/bespoke-vs-presets.md",
  "skills/embedded-captions/references/caption-grouping.md",
  "skills/embedded-captions/references/composition-craft.md",
  "skills/embedded-captions/references/direction-catalog.md",
  "skills/embedded-captions/references/example-renders/champion.html",
  "skills/embedded-captions/references/example-renders/memory-wall.html",
  "skills/embedded-captions/references/failure-modes.md",
  "skills/embedded-captions/references/layout-heuristics.md",
  "skills/embedded-captions/references/motion-vocabulary.md",
  "skills/embedded-captions/references/rail.md",
  "skills/embedded-captions/references/reference-bar.md",
  "skills/embedded-captions/references/scene-types.md",
  "skills/embedded-captions/references/typographic-moves.md",
  "skills/embedded-captions/references/typography-presets.md",
  "skills/embedded-captions/scripts/audio-envelope.cjs",
  "skills/embedded-captions/scripts/check-occlusion.cjs",
  "skills/embedded-captions/scripts/check-overflow.cjs",
  "skills/embedded-captions/scripts/check-rail-climax.cjs",
  "skills/embedded-captions/scripts/check-timing.cjs",
  "skills/embedded-captions/scripts/fill-timings.cjs",
  "skills/embedded-captions/scripts/fit-fonts.cjs",
  "skills/embedded-captions/scripts/fixtures/heroless/theme.json",
  "skills/embedded-captions/scripts/fixtures/heroless/transcript.json",
  "skills/embedded-captions/scripts/gen-stroke-path.py",
  "skills/embedded-captions/scripts/hf-cli.cjs",
  "skills/embedded-captions/scripts/hf-cli.test.mjs",
  "skills/embedded-captions/scripts/inject-fonts.cjs",
  "skills/embedded-captions/scripts/lib-dna.cjs",
  "skills/embedded-captions/scripts/make-cinematic.cjs",
  "skills/embedded-captions/scripts/make-composition.cjs",
  "skills/embedded-captions/scripts/make-theme.cjs",
  "skills/embedded-captions/scripts/make-theme.test.mjs",
  "skills/embedded-captions/scripts/matte.cjs",
  "skills/embedded-captions/scripts/measure-layout.cjs",
  "skills/embedded-captions/scripts/prepare.sh",
  "skills/embedded-captions/scripts/preview-frames.cjs",
  "skills/embedded-captions/scripts/preview-frames.test.mjs",
  "skills/embedded-captions/scripts/render-and-composite.sh",
  "skills/embedded-captions/scripts/render-and-composite.test.mjs",
  "skills/embedded-captions/scripts/render-theme.sh",
  "skills/embedded-captions/scripts/safe-zones.cjs",
  "skills/embedded-captions/scripts/transcribe.cjs",
  "skills/embedded-captions/scripts/transcribe.test.mjs",
  "skills/embedded-captions/themes/README.md",
  "skills/embedded-captions/themes/anchor.json",
  "skills/embedded-captions/themes/arcade.json",
  "skills/embedded-captions/themes/aurora.json",
  "skills/embedded-captions/themes/biolume.json",
  "skills/embedded-captions/themes/brush.json",
  "skills/embedded-captions/themes/chalkboard.json",
  "skills/embedded-captions/themes/dossier.json",
  "skills/embedded-captions/themes/graffiti.json",
  "skills/embedded-captions/themes/hologram.json",
  "skills/embedded-captions/themes/inkwater.json",
  "skills/embedded-captions/themes/laser.json",
  "skills/embedded-captions/themes/lastpage.json",
  "skills/embedded-captions/themes/neonsign.json",
  "skills/embedded-captions/themes/ordnance.json",
  "skills/embedded-captions/themes/papercut.json",
  "skills/embedded-captions/themes/popup.json",
  "skills/embedded-captions/themes/ransom.json",
  "skills/embedded-captions/themes/scoreboard.json",
  "skills/embedded-captions/themes/spectrum.json",
  "skills/embedded-captions/themes/stardust.json",
  "skills/embedded-captions/themes/stomp.json",
  "skills/embedded-captions/themes/terminal.json",
  "skills/embedded-captions/themes/thunder.json",
  "skills/embedded-captions/themes/transit.json",
  "skills/embedded-captions/themes/vhs.json",
  "skills/faceless-explainer/SKILL.md",
  "skills/faceless-explainer/references/cut-catalog.md",
  "skills/faceless-explainer/references/motion-language.md",
  "skills/faceless-explainer/references/story-design.md",
  "skills/faceless-explainer/references/visual-design.md",
  "skills/faceless-explainer/scripts/assemble-index.mjs",
  "skills/faceless-explainer/scripts/assemble-index.test.mjs",
  "skills/faceless-explainer/scripts/audio.mjs",
  "skills/faceless-explainer/scripts/audio.test.mjs",
  "skills/faceless-explainer/scripts/build-frame.mjs",
  "skills/faceless-explainer/scripts/captions.mjs",
  "skills/faceless-explainer/scripts/captions.test.mjs",
  "skills/faceless-explainer/scripts/frame-packets.mjs",
  "skills/faceless-explainer/scripts/frame-packets.test.mjs",
  "skills/faceless-explainer/scripts/lib/assets.mjs",
  "skills/faceless-explainer/scripts/lib/bgm-volume.mjs",
  "skills/faceless-explainer/scripts/lib/captured-fonts.mjs",
  "skills/faceless-explainer/scripts/lib/dimensions.mjs",
  "skills/faceless-explainer/scripts/lib/frame-packets-core.mjs",
  "skills/faceless-explainer/scripts/lib/host-audio.mjs",
  "skills/faceless-explainer/scripts/lib/main-module.mjs",
  "skills/faceless-explainer/scripts/lib/pad-frame-duration.mjs",
  "skills/faceless-explainer/scripts/lib/storyboard.mjs",
  "skills/faceless-explainer/scripts/lib/tokens.mjs",
  "skills/faceless-explainer/scripts/lib/transition-registry.mjs",
  "skills/faceless-explainer/scripts/lib/transitions.json",
  "skills/faceless-explainer/scripts/transitions.mjs",
  "skills/faceless-explainer/scripts/transitions.test.mjs",
  "skills/faceless-explainer/sub-agents/frame-worker.md",
  "skills/general-video/SKILL.md",
  "skills/general-video/scripts/frame-packets.mjs",
  "skills/general-video/scripts/frame-packets.test.mjs",
  "skills/general-video/scripts/lib/frame-packets-core.mjs",
  "skills/general-video/scripts/lib/main-module.mjs",
  "skills/general-video/sub-agents/frame-worker.md",
  "skills/motion-graphics/SKILL.md",
  "skills/motion-graphics/agents/builder.md",
  "skills/motion-graphics/agents/director.md",
  "skills/motion-graphics/agents/finalize.md",
  "skills/motion-graphics/catalog-map.md",
  "skills/motion-graphics/categories/asset-fusion/module.md",
  "skills/motion-graphics/categories/charts/module.md",
  "skills/motion-graphics/categories/kinetic-type/module.md",
  "skills/motion-graphics/categories/logo-reveal/module.md",
  "skills/motion-graphics/categories/lower-thirds/module.md",
  "skills/motion-graphics/categories/maps/module.md",
  "skills/motion-graphics/categories/news/module.md",
  "skills/motion-graphics/categories/stat/module.md",
  "skills/motion-graphics/categories/tweet/module.md",
  "skills/motion-graphics/categories/webpage/module.md",
  "skills/motion-graphics/grounding/PROTOCOL.md",
  "skills/motion-graphics/phases/source/guide.md",
  "skills/motion-graphics/references/builder-contract.md",
  "skills/motion-graphics/references/motion-vocabulary.md",
  "skills/motion-graphics/references/shot-plan-ir.md",
  "skills/motion-graphics/samples/asset-fusion/_ref-circle-highlight.html",
  "skills/music-to-video/SKILL.md",
  "skills/music-to-video/references/frame-skeleton.md",
  "skills/music-to-video/references/montage.md",
  "skills/music-to-video/references/motion-primitive-catalog.md",
  "skills/music-to-video/references/motion-primitives/3d-card-flip/index.html",
  "skills/music-to-video/references/motion-primitives/3d-card-flip/scene.html",
  "skills/music-to-video/references/motion-primitives/assets/gsap.min.js",
  "skills/music-to-video/references/motion-primitives/bg-flow-field/index.html",
  "skills/music-to-video/references/motion-primitives/bg-flow-field/scene.html",
  "skills/music-to-video/references/motion-primitives/binary-decrypt/index.html",
  "skills/music-to-video/references/motion-primitives/binary-decrypt/scene.html",
  "skills/music-to-video/references/motion-primitives/blur-resolve/index.html",
  "skills/music-to-video/references/motion-primitives/blur-resolve/scene.html",
  "skills/music-to-video/references/motion-primitives/braam-punch/index.html",
  "skills/music-to-video/references/motion-primitives/braam-punch/scene.html",
  "skills/music-to-video/references/motion-primitives/chromatic-split/index.html",
  "skills/music-to-video/references/motion-primitives/chromatic-split/scene.html",
  "skills/music-to-video/references/motion-primitives/chrome-sweep/index.html",
  "skills/music-to-video/references/motion-primitives/chrome-sweep/scene.html",
  "skills/music-to-video/references/motion-primitives/counting-punch/index.html",
  "skills/music-to-video/references/motion-primitives/counting-punch/scene.html",
  "skills/music-to-video/references/motion-primitives/crash-zoom-in/index.html",
  "skills/music-to-video/references/motion-primitives/crash-zoom-in/scene.html",
  "skills/music-to-video/references/motion-primitives/datamosh-smear/index.html",
  "skills/music-to-video/references/motion-primitives/datamosh-smear/scene.html",
  "skills/music-to-video/references/motion-primitives/directional-fill/index.html",
  "skills/music-to-video/references/motion-primitives/directional-fill/scene.html",
  "skills/music-to-video/references/motion-primitives/dolly-zoom/index.html",
  "skills/music-to-video/references/motion-primitives/dolly-zoom/scene.html",
  "skills/music-to-video/references/motion-primitives/electric-arc/index.html",
  "skills/music-to-video/references/motion-primitives/electric-arc/scene.html",
  "skills/music-to-video/references/motion-primitives/flash-cut/index.html",
  "skills/music-to-video/references/motion-primitives/flash-cut/scene.html",
  "skills/music-to-video/references/motion-primitives/gooey-metaball/index.html",
  "skills/music-to-video/references/motion-primitives/gooey-metaball/scene.html",
  "skills/music-to-video/references/motion-primitives/hard-cut/index.html",
  "skills/music-to-video/references/motion-primitives/hard-cut/scene.html",
  "skills/music-to-video/references/motion-primitives/hypercut-whip/index.html",
  "skills/music-to-video/references/motion-primitives/hypercut-whip/scene.html",
  "skills/music-to-video/references/motion-primitives/iris-open/index.html",
  "skills/music-to-video/references/motion-primitives/iris-open/scene.html",
  "skills/music-to-video/references/motion-primitives/kinetic-letter-in/index.html",
  "skills/music-to-video/references/motion-primitives/kinetic-letter-in/scene.html",
  "skills/music-to-video/references/motion-primitives/liquid-morph/index.html",
  "skills/music-to-video/references/motion-primitives/liquid-morph/scene.html",
  "skills/music-to-video/references/motion-primitives/mask-reveal/index.html",
  "skills/music-to-video/references/motion-primitives/mask-reveal/scene.html",
  "skills/music-to-video/references/motion-primitives/mosaic-pack/index.html",
  "skills/music-to-video/references/motion-primitives/mosaic-pack/scene.html",
  "skills/music-to-video/references/motion-primitives/neon-flicker/index.html",
  "skills/music-to-video/references/motion-primitives/neon-flicker/scene.html",
  "skills/music-to-video/references/motion-primitives/outline-to-fill/index.html",
  "skills/music-to-video/references/motion-primitives/outline-to-fill/scene.html",
  "skills/music-to-video/references/motion-primitives/palette-flip/index.html",
  "skills/music-to-video/references/motion-primitives/palette-flip/scene.html",
  "skills/music-to-video/references/motion-primitives/particle-burst/index.html",
  "skills/music-to-video/references/motion-primitives/particle-burst/scene.html",
  "skills/music-to-video/references/motion-primitives/pixel-dissolve/index.html",
  "skills/music-to-video/references/motion-primitives/pixel-dissolve/scene.html",
  "skills/music-to-video/references/motion-primitives/radial-burst-lines/index.html",
  "skills/music-to-video/references/motion-primitives/radial-burst-lines/scene.html",
  "skills/music-to-video/references/motion-primitives/screen-shake/index.html",
  "skills/music-to-video/references/motion-primitives/screen-shake/scene.html",
  "skills/music-to-video/references/motion-primitives/slot-machine-reveal/index.html",
  "skills/music-to-video/references/motion-primitives/slot-machine-reveal/scene.html",
  "skills/music-to-video/references/motion-primitives/spotlight-sweep/index.html",
  "skills/music-to-video/references/motion-primitives/spotlight-sweep/scene.html",
  "skills/music-to-video/references/motion-primitives/staggered-exit/index.html",
  "skills/music-to-video/references/motion-primitives/staggered-exit/scene.html",
  "skills/music-to-video/references/motion-primitives/text-spectral-rays/USAGE.md",
  "skills/music-to-video/references/motion-primitives/text-spectral-rays/index.html",
  "skills/music-to-video/references/motion-primitives/text-spectral-rays/scene.html",
  "skills/music-to-video/references/motion-primitives/text-wave-distort/index.html",
  "skills/music-to-video/references/motion-primitives/text-wave-distort/scene.html",
  "skills/music-to-video/references/motion-primitives/tile-mosaic/index.html",
  "skills/music-to-video/references/motion-primitives/tile-mosaic/scene.html",
  "skills/music-to-video/references/motion-primitives/typewriter-reveal/index.html",
  "skills/music-to-video/references/motion-primitives/typewriter-reveal/scene.html",
  "skills/music-to-video/references/motion-primitives/word-grid-burst/index.html",
  "skills/music-to-video/references/motion-primitives/word-grid-burst/scene.html",
  "skills/music-to-video/references/planning.md",
  "skills/music-to-video/references/storyboard-format.md",
  "skills/music-to-video/references/template-catalog.md",
  "skills/music-to-video/references/templates/card-flyby/index.html",
  "skills/music-to-video/references/templates/card-flyby/program.json",
  "skills/music-to-video/references/templates/held-message-living-field/index.html",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/asphalt-031.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/bark-014.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/brick.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/bricks-075-a.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/bricks-101.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/bricks-102.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/bricks-104.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/carpet.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/concrete-034.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/concrete-042-a.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/concrete-046.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/concrete-047-a.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/concrete.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/diamond-plate-009.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/fabric-080.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/fabric-083.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/grass-001.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/grass-004.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/grass-005.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/ground-037.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/ground-054.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/ground-068.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/ground-080.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/ground-103.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/ground-104.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/lava.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/leather-037.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/marble-012.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/marble-016.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/metal-032.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/metal-038.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/metal-041-a.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/metal-046-b.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/metal-048-a.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/metal-049-a.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/metal-055-a.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/metal-061-b.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/metal.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/onyx.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/painted-plaster-017.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/paving-stones-138.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/paving-stones-150.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/plaster-001.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/road-007.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/road-008-a.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/road-009-c.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/road-012-a.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/road-012-b.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/road-013-a.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/rock-058.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/rock-063.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/rock.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/snow-015.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/snow.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/tiles-138.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/travertine-009.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/wood-049.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/wood-051.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/wood-058.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/wood-066.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/wood-092.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/wood-094.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/wood-floor-051.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/wood-floor-064.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/wood-floor-070.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/assets/texture-mask-text/masks/wood.png",
  "skills/music-to-video/references/templates/held-text-strobe-burst/index.html",
  "skills/music-to-video/references/templates/intro-kinetic-cascade/index.html",
  "skills/music-to-video/references/templates/intro-kinetic-cascade/program.json",
  "skills/music-to-video/references/templates/logo-split-lockup-pulse/assets/fredoka-700.woff2",
  "skills/music-to-video/references/templates/logo-split-lockup-pulse/index.html",
  "skills/music-to-video/references/templates/poster-tile-mosaic/index.html",
  "skills/music-to-video/references/templates/poster-tile-mosaic/program.json",
  "skills/music-to-video/references/templates/roll-flipbook-word-cycle/index.html",
  "skills/music-to-video/references/templates/split-anchor-word-slot/index.html",
  "skills/music-to-video/references/templates/split-anchor-word-slot/program.json",
  "skills/music-to-video/references/templates/typewriter-phrase-keyword-shuffle/index.html",
  "skills/music-to-video/scripts/analyze-beatgrid.py",
  "skills/music-to-video/scripts/assemble-index.mjs",
  "skills/music-to-video/scripts/lib/storyboard.mjs",
  "skills/music-to-video/scripts/stage-assets.mjs",
  "skills/music-to-video/scripts/validate-plan.mjs",
  "skills/music-to-video/sub-agents/frame-worker.md",
  "skills/pr-to-video/SKILL.md",
  "skills/pr-to-video/references/code-vocabulary.md",
  "skills/pr-to-video/references/cut-catalog.md",
  "skills/pr-to-video/references/motion-language.md",
  "skills/pr-to-video/references/story-design.md",
  "skills/pr-to-video/references/visual-design.md",
  "skills/pr-to-video/scripts/assemble-index.mjs",
  "skills/pr-to-video/scripts/assemble-index.test.mjs",
  "skills/pr-to-video/scripts/audio.mjs",
  "skills/pr-to-video/scripts/build-frame.mjs",
  "skills/pr-to-video/scripts/captions.mjs",
  "skills/pr-to-video/scripts/captions.test.mjs",
  "skills/pr-to-video/scripts/fetch-people-avatars.mjs",
  "skills/pr-to-video/scripts/fetch-pr.mjs",
  "skills/pr-to-video/scripts/frame-contract.test.mjs",
  "skills/pr-to-video/scripts/frame-packets.mjs",
  "skills/pr-to-video/scripts/ingest.mjs",
  "skills/pr-to-video/scripts/lib/assets.mjs",
  "skills/pr-to-video/scripts/lib/bgm-volume.mjs",
  "skills/pr-to-video/scripts/lib/captured-fonts.mjs",
  "skills/pr-to-video/scripts/lib/dimensions.mjs",
  "skills/pr-to-video/scripts/lib/frame-contract.mjs",
  "skills/pr-to-video/scripts/lib/frame-packets-core.mjs",
  "skills/pr-to-video/scripts/lib/host-audio.mjs",
  "skills/pr-to-video/scripts/lib/main-module.mjs",
  "skills/pr-to-video/scripts/lib/pad-frame-duration.mjs",
  "skills/pr-to-video/scripts/lib/storyboard.mjs",
  "skills/pr-to-video/scripts/lib/tokens.mjs",
  "skills/pr-to-video/scripts/lib/transition-registry.mjs",
  "skills/pr-to-video/scripts/lib/transitions.json",
  "skills/pr-to-video/scripts/preflight.mjs",
  "skills/pr-to-video/scripts/project-dir.mjs",
  "skills/pr-to-video/scripts/transitions.mjs",
  "skills/pr-to-video/scripts/workflow-guardrails.test.mjs",
  "skills/pr-to-video/sub-agents/frame-worker.md",
  "skills/product-launch-video/SKILL.md",
  "skills/product-launch-video/references/cut-catalog.md",
  "skills/product-launch-video/references/motion-language.md",
  "skills/product-launch-video/references/story-design.md",
  "skills/product-launch-video/references/visual-design.md",
  "skills/product-launch-video/scripts/assemble-index.mjs",
  "skills/product-launch-video/scripts/assemble-index.test.mjs",
  "skills/product-launch-video/scripts/audio.mjs",
  "skills/product-launch-video/scripts/audio.test.mjs",
  "skills/product-launch-video/scripts/build-frame-colors.test.mjs",
  "skills/product-launch-video/scripts/build-frame-subsets.test.mjs",
  "skills/product-launch-video/scripts/build-frame.mjs",
  "skills/product-launch-video/scripts/captions.mjs",
  "skills/product-launch-video/scripts/captions.test.mjs",
  "skills/product-launch-video/scripts/capture-skill-guardrails.test.mjs",
  "skills/product-launch-video/scripts/frame-packets.mjs",
  "skills/product-launch-video/scripts/frame-packets.test.mjs",
  "skills/product-launch-video/scripts/lib/assets.mjs",
  "skills/product-launch-video/scripts/lib/bgm-volume.mjs",
  "skills/product-launch-video/scripts/lib/captured-fonts.mjs",
  "skills/product-launch-video/scripts/lib/dimensions.mjs",
  "skills/product-launch-video/scripts/lib/frame-packets-core.mjs",
  "skills/product-launch-video/scripts/lib/host-audio.mjs",
  "skills/product-launch-video/scripts/lib/main-module.mjs",
  "skills/product-launch-video/scripts/lib/pad-frame-duration.mjs",
  "skills/product-launch-video/scripts/lib/pad-frame-duration.test.mjs",
  "skills/product-launch-video/scripts/lib/storyboard.mjs",
  "skills/product-launch-video/scripts/lib/tokens.mjs",
  "skills/product-launch-video/scripts/lib/tokens.test.mjs",
  "skills/product-launch-video/scripts/lib/transition-registry.mjs",
  "skills/product-launch-video/scripts/lib/transitions.json",
  "skills/product-launch-video/scripts/media-contract.test.mjs",
  "skills/product-launch-video/scripts/stage-assets.mjs",
  "skills/product-launch-video/scripts/stage-assets.test.mjs",
  "skills/product-launch-video/scripts/transitions.mjs",
  "skills/product-launch-video/scripts/transitions.test.mjs",
  "skills/product-launch-video/sub-agents/frame-worker.md",
  "skills/talking-head-recut/NOTICE.md",
  "skills/talking-head-recut/SKILL.md",
  "skills/talking-head-recut/assets/fonts/Caveat-400-latin.woff2",
  "skills/talking-head-recut/assets/fonts/Caveat-700-latin.woff2",
  "skills/talking-head-recut/assets/fonts/Inter-400-latin.woff2",
  "skills/talking-head-recut/assets/fonts/Inter-700-latin.woff2",
  "skills/talking-head-recut/assets/fonts/LXGWWenKaiTC-400-latin.woff2",
  "skills/talking-head-recut/assets/fonts/Virgil.woff2",
  "skills/talking-head-recut/assets/vendor/gsap.min.js",
  "skills/talking-head-recut/media-contract.test.mjs",
  "skills/talking-head-recut/references/DESIGN_INDEX.md",
  "skills/talking-head-recut/references/frames/clean.html",
  "skills/talking-head-recut/references/frames/hairline.html",
  "skills/talking-head-recut/references/frames/polaroid.html",
  "skills/talking-head-recut/references/layouts/overlay.html",
  "skills/talking-head-recut/references/layouts/pip.html",
  "skills/talking-head-recut/references/layouts/split.html",
  "skills/talking-head-recut/references/layouts/stack.html",
  "skills/talking-head-recut/references/styles/academic.html",
  "skills/talking-head-recut/references/styles/audit.html",
  "skills/talking-head-recut/references/styles/editorial.html",
  "skills/talking-head-recut/references/styles/geom.html",
  "skills/talking-head-recut/references/styles/minimal.html",
  "skills/talking-head-recut/references/styles/spotlight.html",
  "skills/talking-head-recut/references/styles/swiss.html",
  "skills/talking-head-recut/references/styles/terminal.html",
  "skills/talking-head-recut/references/styles/whiteboard.html",
  "skills/talking-head-recut/references/styles/xhs.html",
];

const RETIRED_GUIDE_FILES = [
  "skills/hyperframes-animation/SKILL.md",
  "skills/hyperframes-animation/adapters/animate-text.md",
  "skills/hyperframes-animation/adapters/animejs.md",
  "skills/hyperframes-animation/adapters/css-animations.md",
  "skills/hyperframes-animation/adapters/gsap-easing-and-stagger.md",
  "skills/hyperframes-animation/adapters/gsap-timeline-and-labels.md",
  "skills/hyperframes-animation/adapters/gsap-transforms-and-perf.md",
  "skills/hyperframes-animation/adapters/gsap.md",
  "skills/hyperframes-animation/adapters/html-in-canvas-patterns.md",
  "skills/hyperframes-animation/adapters/lottie.md",
  "skills/hyperframes-animation/adapters/three.md",
  "skills/hyperframes-animation/adapters/typegpu.md",
  "skills/hyperframes-animation/adapters/waapi.md",
  "skills/hyperframes-animation/blueprints-index.md",
  "skills/hyperframes-animation/blueprints/agent-progress-theater.md",
  "skills/hyperframes-animation/blueprints/camera-journey.md",
  "skills/hyperframes-animation/blueprints/comparison-split.md",
  "skills/hyperframes-animation/blueprints/constellation-hub.md",
  "skills/hyperframes-animation/blueprints/cta-morph-press.md",
  "skills/hyperframes-animation/blueprints/cursor-ui-demo.md",
  "skills/hyperframes-animation/blueprints/dataviz-countup.md",
  "skills/hyperframes-animation/blueprints/device-surface-showcase.md",
  "skills/hyperframes-animation/blueprints/fixed-anchor-cycle.md",
  "skills/hyperframes-animation/blueprints/grid-card-assemble.md",
  "skills/hyperframes-animation/blueprints/kinetic-type-beats.md",
  "skills/hyperframes-animation/blueprints/logo-assemble-lockup.md",
  "skills/hyperframes-animation/blueprints/overwhelm-surround.md",
  "skills/hyperframes-animation/blueprints/panel-edit-live-sync.md",
  "skills/hyperframes-animation/blueprints/prompt-type-submit-generate.md",
  "skills/hyperframes-animation/blueprints/spatial-pan-stations.md",
  "skills/hyperframes-animation/blueprints/ticker-takeover.md",
  "skills/hyperframes-animation/blueprints/titlecard-reveal.md",
  "skills/hyperframes-animation/blueprints/transcript-scroll-artifact-reveal.md",
  "skills/hyperframes-animation/blueprints/typewriter-reveal.md",
  "skills/hyperframes-animation/blueprints/video-text-pivot.md",
  "skills/hyperframes-animation/blueprints/zoom-out-workspace-reveal.md",
  "skills/hyperframes-animation/examples/brand-reveal-assemble-zoom.html",
  "skills/hyperframes-animation/examples/comparison-split-cards.html",
  "skills/hyperframes-animation/examples/concept-demo-decode-pan.html",
  "skills/hyperframes-animation/examples/cta-morph-press.html",
  "skills/hyperframes-animation/examples/cta-orbit-collapse.html",
  "skills/hyperframes-animation/examples/demo-page-scroll-spotlight.html",
  "skills/hyperframes-animation/examples/hook-counter-burst.html",
  "skills/hyperframes-animation/examples/messaging-multi-phrase.html",
  "skills/hyperframes-animation/examples/metric-video-text-pivot.html",
  "skills/hyperframes-animation/examples/problem-mockup-overwhelm.html",
  "skills/hyperframes-animation/examples/proof-logo-chain.html",
  "skills/hyperframes-animation/examples/takeover-ticker-displace.html",
  "skills/hyperframes-animation/examples/workflow-approve-press.html",
  "skills/hyperframes-animation/references/motion-blur.md",
  "skills/hyperframes-animation/rules-index.md",
  "skills/hyperframes-animation/rules/3d-camera-flight.md",
  "skills/hyperframes-animation/rules/3d-page-scroll.md",
  "skills/hyperframes-animation/rules/3d-text-depth-layers.md",
  "skills/hyperframes-animation/rules/ai-tracking-box.md",
  "skills/hyperframes-animation/rules/ambient-glow-bloom.md",
  "skills/hyperframes-animation/rules/anchored-layout-expand.md",
  "skills/hyperframes-animation/rules/asr-keyword-glow.md",
  "skills/hyperframes-animation/rules/avatar-cloud-network.md",
  "skills/hyperframes-animation/rules/camera-cursor-tracking.md",
  "skills/hyperframes-animation/rules/card-morph-anchor.md",
  "skills/hyperframes-animation/rules/center-outward-expansion.md",
  "skills/hyperframes-animation/rules/chart-scrub-readout.md",
  "skills/hyperframes-animation/rules/chromatic-glitch.md",
  "skills/hyperframes-animation/rules/context-sensitive-cursor.md",
  "skills/hyperframes-animation/rules/control-target-sync.md",
  "skills/hyperframes-animation/rules/coordinate-target-zoom.md",
  "skills/hyperframes-animation/rules/counting-dynamic-scale.md",
  "skills/hyperframes-animation/rules/css-marker-patterns.md",
  "skills/hyperframes-animation/rules/cursor-click-ripple.md",
  "skills/hyperframes-animation/rules/cursor-drag.md",
  "skills/hyperframes-animation/rules/depth-of-field-blur.md",
  "skills/hyperframes-animation/rules/depth-scatter-assemble.md",
  "skills/hyperframes-animation/rules/discrete-text-sequence.md",
  "skills/hyperframes-animation/rules/dynamic-content-sequencing.md",
  "skills/hyperframes-animation/rules/gradient-text-sweep.md",
  "skills/hyperframes-animation/rules/gsap-effects.md",
  "skills/hyperframes-animation/rules/hacker-flip-3d.md",
  "skills/hyperframes-animation/rules/kinetic-beat-slam.md",
  "skills/hyperframes-animation/rules/motion-blur-streak.md",
  "skills/hyperframes-animation/rules/multi-cursor-choreography.md",
  "skills/hyperframes-animation/rules/multi-phase-camera.md",
  "skills/hyperframes-animation/rules/nudge-curve.md",
  "skills/hyperframes-animation/rules/orbit-3d-entry.md",
  "skills/hyperframes-animation/rules/particle-burst.md",
  "skills/hyperframes-animation/rules/physics-press-reaction.md",
  "skills/hyperframes-animation/rules/press-release-spring.md",
  "skills/hyperframes-animation/rules/reactive-displacement.md",
  "skills/hyperframes-animation/rules/scale-swap-transition.md",
  "skills/hyperframes-animation/rules/sine-wave-loop.md",
  "skills/hyperframes-animation/rules/split-tilt-cards.md",
  "skills/hyperframes-animation/rules/spring-pop-entrance.md",
  "skills/hyperframes-animation/rules/stat-bars-and-fills.md",
  "skills/hyperframes-animation/rules/svg-icon-enrichment.md",
  "skills/hyperframes-animation/rules/svg-path-draw.md",
  "skills/hyperframes-animation/rules/theme-crossfade-morph.md",
  "skills/hyperframes-animation/rules/vertical-spring-ticker.md",
  "skills/hyperframes-animation/rules/viewport-change.md",
  "skills/hyperframes-animation/rules/waterfall-entry.md",
  "skills/hyperframes-animation/scripts/animation-map-sampling.mjs",
  "skills/hyperframes-animation/scripts/animation-map-sampling.test.mjs",
  "skills/hyperframes-animation/scripts/animation-map.mjs",
  "skills/hyperframes-animation/scripts/animation-map.test.mjs",
  "skills/hyperframes-animation/scripts/package-loader.mjs",
  "skills/hyperframes-animation/scripts/package-loader.test.mjs",
  "skills/hyperframes-animation/techniques.md",
  "skills/hyperframes-animation/transitions/TRANSITION-REGISTRY.md",
  "skills/hyperframes-animation/transitions/catalog.md",
  "skills/hyperframes-animation/transitions/css-3d.md",
  "skills/hyperframes-animation/transitions/css-blur.md",
  "skills/hyperframes-animation/transitions/css-cover.md",
  "skills/hyperframes-animation/transitions/css-destruction.md",
  "skills/hyperframes-animation/transitions/css-dissolve.md",
  "skills/hyperframes-animation/transitions/css-distortion.md",
  "skills/hyperframes-animation/transitions/css-grid.md",
  "skills/hyperframes-animation/transitions/css-light.md",
  "skills/hyperframes-animation/transitions/css-mechanical.md",
  "skills/hyperframes-animation/transitions/css-other.md",
  "skills/hyperframes-animation/transitions/css-push.md",
  "skills/hyperframes-animation/transitions/css-radial.md",
  "skills/hyperframes-animation/transitions/css-scale.md",
  "skills/hyperframes-animation/transitions/overview.md",
  "skills/hyperframes-audio/SKILL.md",
  "skills/hyperframes-audio/references/attributes.md",
  "skills/hyperframes-audio/references/diagnosis.md",
  "skills/hyperframes-audio/references/fx-registry.md",
  "skills/hyperframes-audio/references/presets.md",
  "skills/hyperframes-audio/scripts/carve.mjs",
  "skills/hyperframes-audio/scripts/carve.test.mjs",
  "skills/hyperframes-audio/scripts/lib/main-module.mjs",
  "skills/hyperframes-core/SKILL.md",
  "skills/hyperframes-core/references/composition-patterns.md",
  "skills/hyperframes-core/references/creator-editing-recipes.md",
  "skills/hyperframes-core/references/data-attributes.md",
  "skills/hyperframes-core/references/determinism-rules.md",
  "skills/hyperframes-core/references/full-screen-motion.md",
  "skills/hyperframes-core/references/minimal-composition.md",
  "skills/hyperframes-core/references/sub-compositions.md",
  "skills/hyperframes-core/references/tailwind.md",
  "skills/hyperframes-core/references/tracks-and-clips.md",
  "skills/hyperframes-core/references/variables-and-media.md",
  "skills/hyperframes-creative/SKILL.md",
  "skills/hyperframes-creative/palettes/bold-energetic.md",
  "skills/hyperframes-creative/palettes/clean-corporate.md",
  "skills/hyperframes-creative/palettes/dark-premium.md",
  "skills/hyperframes-creative/palettes/jewel-rich.md",
  "skills/hyperframes-creative/palettes/monochrome.md",
  "skills/hyperframes-creative/palettes/nature-earth.md",
  "skills/hyperframes-creative/palettes/neon-electric.md",
  "skills/hyperframes-creative/palettes/pastel-soft.md",
  "skills/hyperframes-creative/palettes/warm-editorial.md",
  "skills/hyperframes-creative/references/audio-reactive.md",
  "skills/hyperframes-creative/references/beat-direction.md",
  "skills/hyperframes-creative/references/composition-patterns.md",
  "skills/hyperframes-creative/references/data-in-motion.md",
  "skills/hyperframes-creative/references/design-adherence.md",
  "skills/hyperframes-creative/references/design-picker.md",
  "skills/hyperframes-creative/references/design-spec.md",
  "skills/hyperframes-creative/references/house-style.md",
  "skills/hyperframes-creative/references/motion-principles.md",
  "skills/hyperframes-creative/references/narration.md",
  "skills/hyperframes-creative/references/prompt-expansion.md",
  "skills/hyperframes-creative/references/story-spine.md",
  "skills/hyperframes-creative/references/storyboard-recipe.md",
  "skills/hyperframes-creative/references/typography.md",
  "skills/hyperframes-creative/references/video-composition.md",
  "skills/hyperframes-creative/references/visual-styles.md",
  "skills/hyperframes-creative/scripts/contrast-report.mjs",
  "skills/hyperframes-creative/scripts/package-loader.mjs",
  "skills/hyperframes-creative/scripts/package-loader.test.mjs",
  "skills/hyperframes-creative/templates/design-picker.html",
  "skills/hyperframes-keyframes/SKILL.md",
  "skills/hyperframes-keyframes/agents/openai.yaml",
  "skills/hyperframes-keyframes/references/keyframe-patterns.md",
  "skills/hyperframes-studio/SKILL.md",
];

const RETIRED_ROUTING_FILES = [
  "skills/hyperframes/references/brief-contract.md",
  "skills/hyperframes/references/brief-format.md",
  "skills/hyperframes/references/capability-menu.md",
  "skills/hyperframes/references/frame-worker-core.md",
  "skills/hyperframes/references/intent-interview.md",
  "skills/hyperframes/references/pitch-round.md",
  "skills/hyperframes/references/production-loop.md",
  "skills/hyperframes/references/review-loop.md",
  "skills/hyperframes/references/route-briefs.md",
  "skills/hyperframes/references/routes/embedded-captions.md",
  "skills/hyperframes/references/routes/faceless-explainer.md",
  "skills/hyperframes/references/routes/general-video.md",
  "skills/hyperframes/references/routes/motion-graphics.md",
  "skills/hyperframes/references/routes/music-to-video.md",
  "skills/hyperframes/references/routes/pr-to-video.md",
  "skills/hyperframes/references/routes/product-launch-video.md",
  "skills/hyperframes/references/routes/remotion-to-hyperframes.md",
  "skills/hyperframes/references/routes/slideshow.md",
  "skills/hyperframes/references/routes/talking-head-recut.md",
  "skills/hyperframes/references/script-format.md",
  "skills/hyperframes/references/subagent-dispatch.md",
  "skills/hyperframes/references/workflow-catalog.md",
];

const REVERT_6754_REASON =
  "the revert of #6754 keeps the reverse-any-video skill out of main until web subscriptions are live; it re-lands with #6833";

const REVERT_6754_FILES = [
  "packages/cli/src/commands/billing.ts",
  "packages/cli/src/commands/diff.ts",
  "packages/cli/src/commands/measure.ts",
  "packages/cli/src/commands/measure/curve.ts",
  "packages/cli/src/commands/measure/cuts.ts",
  "packages/cli/src/commands/measure/energy.ts",
  "packages/cli/src/commands/measure/events.ts",
  "packages/cli/src/commands/measure/extract.ts",
  "packages/cli/src/commands/measure/face.ts",
  "packages/cli/src/commands/measure/frames.ts",
  "packages/cli/src/commands/measure/look.ts",
  "packages/cli/src/commands/measure/probe.ts",
  "packages/cli/src/commands/measure/sync.ts",
  "packages/cli/src/commands/media-use/generate.ts",
  "packages/cli/src/heygen/generate.test.ts",
  "packages/cli/src/heygen/generate.ts",
  "packages/cli/src/heygen/plan.test.ts",
  "packages/cli/src/heygen/plan.ts",
  "packages/cli/src/heygen/pricing.ts",
  "packages/cli/src/heygen/transcribe.test.ts",
  "packages/cli/src/heygen/transcribe.ts",
  "packages/cli/src/heygen/v3.test.ts",
  "packages/cli/src/heygen/v3.ts",
  "packages/cli/src/measure/command.ts",
  "packages/cli/src/measure/compare.test.ts",
  "packages/cli/src/measure/curve.test.ts",
  "packages/cli/src/measure/curve.ts",
  "packages/cli/src/measure/cuts.test.ts",
  "packages/cli/src/measure/cuts.ts",
  "packages/cli/src/measure/diff-people.test.ts",
  "packages/cli/src/measure/diff-segments.test.ts",
  "packages/cli/src/measure/diff.test-helpers.ts",
  "packages/cli/src/measure/diff.test.ts",
  "packages/cli/src/measure/diff.ts",
  "packages/cli/src/measure/drawn.test.ts",
  "packages/cli/src/measure/drawn.ts",
  "packages/cli/src/measure/energy.ts",
  "packages/cli/src/measure/events.test.ts",
  "packages/cli/src/measure/events.ts",
  "packages/cli/src/measure/face.test.ts",
  "packages/cli/src/measure/face.ts",
  "packages/cli/src/measure/faceVerdict.test.ts",
  "packages/cli/src/measure/look.ts",
  "packages/cli/src/measure/media.ts",
  "packages/cli/src/measure/opencv.ts",
  "packages/cli/src/measure/person.ts",
  "packages/cli/src/measure/segments.ts",
  "packages/cli/src/measure/sync.test.ts",
  "packages/cli/src/measure/sync.ts",
  "packages/cli/src/media-use/lib/index-gen.d.mts",
  "skills/media-use/references/heygen.md",
  "skills/reverse-any-video/SKILL.md",
  "skills/reverse-any-video/references/match.md",
  "skills/reverse-any-video/references/people.md",
  "skills/reverse-any-video/references/start.md",
];

const FALLOW_PRUNE_REASON =
  "fallow 3 reuses one audit snapshot per checkout and the hook prunes with `fallow audit-cache prune`, replacing this script";

export const ALLOWED_DELETIONS = new Map([
  // Prompt Guide as six topic pages
  [
    "docs/prompting/anatomy.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/audio-effects.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/code-blocks.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/generated-artwork.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/iterating.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/overlays-and-lower-thirds.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/rules-and-anti-patterns.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/runtimes-and-3d.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/specification-dial.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/storyboards.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/transitions.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/variables-and-templating.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/vfx-and-liquid-glass.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/visual-specs.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/vocabulary.mdx",
    "the Prompt Guide is six topic pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/rendering-and-output.mdx",
    "moved into the CLI rendering guide as 'Ask the agent for the right output'; the old URL 301s there (docs.json)",
  ],
  [
    "docs/guides/color-grading.mdx",
    "color grading is now the 'Fix and grade the color' section of the media effects guide; the old URL 301s there (docs.json)",
  ],
  // One troubleshooting page and start-page folds
  [
    "docs/guides/troubleshooting.mdx",
    "one Troubleshooting page for the whole site (help.mdx) holds this page section by section; the old URL 301s there",
  ],
  [
    "docs/studio/troubleshooting.mdx",
    "its sections are the browser editor part of the one Troubleshooting page (help.mdx); the old URL 301s there",
  ],
  [
    "docs/studio-app/troubleshooting.mdx",
    "its sections are the Studio app part of the one Troubleshooting page (help.mdx); update notes already live on the install page; the old URL 301s there",
  ],
  [
    "docs/guides/feedback.mdx",
    "its sections are the Share feedback part of the one Troubleshooting page (help.mdx); the old URL 301s there",
  ],
  [
    "docs/go-further.mdx",
    "its one point (agent for big changes, hands-on edits for small ones) is the Edit a video with the agent page; the old URL 301s there",
  ],
  [
    "docs/guides/choose-creation-path.mdx",
    "the quickstart is the three-door start page that answers the same question; the old URL 301s there",
  ],
  // Browser editor docs as six pages
  [
    "docs/studio/animation.mdx",
    "the browser editor docs are six pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/studio/audio-automation.mdx",
    "the browser editor docs are six pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/studio/audio-groups.mdx",
    "the browser editor docs are six pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/studio/captions.mdx",
    "the browser editor docs are six pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/studio/shortcuts.mdx",
    "the browser editor docs are six pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/studio/slideshows.mdx",
    "the browser editor docs are six pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/studio/source.mdx",
    "the browser editor docs are six pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/studio/variables.mdx",
    "the browser editor docs are six pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/studio/voiceover-carve.mdx",
    "the browser editor docs are six pages now; this page's content is a section of one of them, and the old URL 301s there (docs.json)",
  ],
  [
    "docs/public/images/studio-app/export.jpg",
    "the Studio app docs show Export as a recorded demo with its own poster; nothing links this still any more",
  ],
  [
    "docs/public/images/studio-app/project.jpg",
    "the project screen page is built from recorded clips and posters; nothing links this still any more",
  ],
  [
    "docs/prompting/captions-and-talking-heads.mdx",
    "each Make guide now holds these prompts as its 'Prompts that work' section; the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/code-and-prs.mdx",
    "each Make guide now holds these prompts as its 'Prompts that work' section; the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/explainers.mdx",
    "each Make guide now holds these prompts as its 'Prompts that work' section; the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/motion-graphics.mdx",
    "each Make guide now holds these prompts as its 'Prompts that work' section; the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/music-and-slideshows.mdx",
    "each Make guide now holds these prompts as its 'Prompts that work' section; the old URL 301s there (docs.json)",
  ],
  [
    "docs/prompting/product-launch.mdx",
    "each Make guide now holds these prompts as its 'Prompts that work' section; the old URL 301s there (docs.json)",
  ],
  [
    "packages/studio/src/components/renders/useRenderQueueMotionBlur.test.tsx",
    "Studio no longer sends previewMotionBlur with renders: blur picks its tier from the page, so the test of that field goes with it",
  ],
  [
    "packages/cli/src/beats/headlessAnalyzer.ts",
    "the TypeScript beat tracker replaces the Chrome analyzer; the beats command decodes with ffmpeg directly",
  ],
  [
    "packages/cli/scripts/build-beat-analyzer.mjs",
    "the TypeScript beat tracker needs no browser bundle; its build step and only consumer are removed together",
  ],
  ["packages/inspector/src/mcp.ts", INSPECTOR_TOOLS_REASON],
  ["packages/inspector/src/outputSchemas.ts", INSPECTOR_TOOLS_REASON],
  ["packages/inspector/src/tools.ts", INSPECTOR_TOOLS_REASON],
  ["packages/inspector/tests/outputSchemas.ts", INSPECTOR_TOOLS_REASON],
  [
    "packages/inspector/INSPECT-TIMELINE.md",
    "described the deleted MCP tool; the README's Timeline section covers POST /timeline",
  ],
  [
    "docs/public/catalog/vendor/BufferGeometryUtils.json",
    "bundled into three-modules.json so catalog scripts run under the docs host policy",
  ],
  [
    "docs/public/catalog/vendor/RoomEnvironment.json",
    "bundled into three-modules.json so catalog scripts run under the docs host policy",
  ],
  [
    "docs/public/catalog/vendor/three.core.min.json",
    "bundled into three-modules.json so catalog scripts run under the docs host policy",
  ],
  [
    "docs/public/catalog/vendor/three.module.min.json",
    "bundled into three-modules.json so catalog scripts run under the docs host policy",
  ],
  [
    "packages/core/scripts/rewrite-esm-extensions.ts",
    "moved to scripts/rewrite-relative-import-extensions.mjs as plain ESM so packages without tsx can use it; now also rewrites .d.ts",
  ],
  [
    "packages/studio/src/hooks/gsapTargetCache.ts",
    "its only caller was the deleted var-offset move writer; nothing imports isElementGsapTargeted",
  ],
  [
    "packages/studio/src/player/components/automationGestureKeys.ts",
    "automation-lane saves now persist once per gesture through the timeline save, so no caller needs a gesture undo key",
  ],
  [
    "packages/studio/src/player/components/automationGestureKeys.test.ts",
    "tests for the removed automation gesture undo keys",
  ],
  [
    "packages/studio/src/utils/editHistory.ts",
    "held only EditHistoryKind; recordEdit's kind was never sent to the project history, so it and every caller's copy go",
  ],
  [
    "packages/studio/src/utils/editHistoryStorage.ts",
    "Studio's undo moves onto the project history (studio-server); the browser IndexedDB history and its reducer are removed",
  ],
  [
    "packages/studio/src/utils/editHistoryStorage.test.ts",
    "tests for the removed IndexedDB history store",
  ],
  [
    "packages/studio/src/utils/editHistory.test.ts",
    "tests for the removed in-browser history reducer; merging and undo are tested in projectHistory.test.ts",
  ],
  [
    "packages/studio/src/hooks/usePersistentEditHistory.projectOwnership.test.tsx",
    "tests the removed per-project IndexedDB store; the hook now posts to the project's own history routes",
  ],
  [
    "packages/studio/src/components/nle/TimelinePane.test.ts",
    "its only subject, the expandedParentStart rebase wrappers, is dead code now removed",
  ],
  [
    "scripts/test-reachability-baseline.json",
    "Reachability now requires zero orphans and rejects baseline files.",
  ],
  [
    "packages/studio/src/player/hooks/useTimelineRowElements.ts",
    "D-834 removes the duplicate row-source hook; manifest elements are now the single timeline row owner",
  ],
  [
    "packages/studio/src/player/hooks/useTimelineRowElements.test.ts",
    "D-834 removes tests for the deleted duplicate row-source hook",
  ],
  [
    "packages/studio/src/components/StudioGlobalDragOverlay.tsx",
    "the full-screen drop-to-add box is replaced by a landing preview on the timeline; no remaining references",
  ],
  [
    "packages/studio/src/components/PanelTabButton.tsx",
    "replaced by the shared Tabs primitive in RightPanelTabs; no remaining references",
  ],
  [
    "packages/studio/postcss.config.js",
    "Tailwind v4 migration: postcss replaced by @tailwindcss/vite",
  ],
  [
    "packages/studio/tailwind.config.js",
    "Tailwind v4 migration: config moves into styles/studio.css via @theme",
  ],
  [
    "docs/snippets/catalog-overview-player.jsx",
    "#4051 removes the Catalog overview's only consumer of this snippet (replaced by the browse-grid mount); confirmed unreferenced repo-wide before deleting",
  ],
  [
    "packages/studio/src/hooks/useSdkSession.test.ts",
    "tests only shouldReloadSdkSession, a function with no production callers removed with the preview reload fix",
  ],
  [
    "docs/catalog/components/ai-generation-canvas.mdx",
    "owner-directed removal of the AI Generation Canvas catalog item and its generated documentation",
  ],
  [
    "docs/catalog/components/ai-prompt-flow.mdx",
    "owner-directed removal of the AI Prompt Flow catalog item and its generated documentation",
  ],
  [
    "docs/catalog/components/checkout-flow.mdx",
    "owner-directed removal of the Checkout Flow catalog item and its generated documentation",
  ],
  [
    "docs/public/catalog/components/ai-generation-canvas.json",
    "owner-directed removal of the AI Generation Canvas catalog item and its generated public payload",
  ],
  [
    "docs/public/catalog/components/ai-prompt-flow.json",
    "owner-directed removal of the AI Prompt Flow catalog item and its generated public payload",
  ],
  [
    "docs/public/catalog/components/checkout-flow.json",
    "owner-directed removal of the Checkout Flow catalog item and its generated public payload",
  ],
  [
    "registry/components/ai-generation-canvas/ai-generation-canvas.html",
    "owner-directed removal of the AI Generation Canvas catalog source component",
  ],
  [
    "registry/components/ai-generation-canvas/demo.html",
    "owner-directed removal of the AI Generation Canvas catalog preview source",
  ],
  [
    "registry/components/ai-generation-canvas/registry-item.json",
    "owner-directed removal of the AI Generation Canvas catalog registry entry",
  ],
  [
    "registry/components/ai-prompt-flow/ai-prompt-flow.html",
    "owner-directed removal of the AI Prompt Flow catalog source component",
  ],
  [
    "registry/components/ai-prompt-flow/demo.html",
    "owner-directed removal of the AI Prompt Flow catalog preview source",
  ],
  [
    "registry/components/ai-prompt-flow/registry-item.json",
    "owner-directed removal of the AI Prompt Flow catalog registry entry",
  ],
  [
    "registry/components/checkout-flow/checkout-flow.html",
    "owner-directed removal of the Checkout Flow catalog source component",
  ],
  [
    "registry/components/checkout-flow/demo.html",
    "owner-directed removal of the Checkout Flow catalog preview source",
  ],
  [
    "registry/components/checkout-flow/registry-item.json",
    "owner-directed removal of the Checkout Flow catalog registry entry",
  ],
  [
    "packages/studio/src/components/StudioFeedbackBar.tsx",
    "replaced by components/feedback/StudioFeedbackCard.tsx; too little shared content for git to pair as a rename",
  ],
  [
    "skills/embedded-captions/references/test-set.md",
    "#3219: orphaned in the shipped skill (zero inbound references across all 140 files) and its corpus lives only at ~/Downloads/heygen_relevant_videos/, so it was neither reachable nor runnable on any install",
  ],
  [
    "skills/embedded-captions/themes/PORTING.md",
    "#3219: same, zero inbound references; a theme-authoring procedure whose inputs (cap_fx3 demos, frame corpora, CONTRACT.md) are not distributed with the skill",
  ],
  [
    "packages/core/scripts/build-audio-fx-runtime.ts",
    "merged into build-inline-artifact.ts: this and build-position-edits-render.ts were a byte-for-byte clone differing only in five names, which fallow's duplication check kept re-flagging on every unrelated line shift",
  ],
  [
    "packages/core/scripts/build-position-edits-render.ts",
    "merged into build-inline-artifact.ts, same reason as build-audio-fx-runtime.ts above",
  ],
  [
    "packages/core/scripts/build-inline-artifact.ts",
    "a later branch in this stack (wa-20b2-lfo-fixes) independently deduped the same two build scripts a different way — buildInjectedArtifact.ts plus two thin per-target files — before this consolidation and that one had merged; this branch's tree keeps that shape instead, so build-inline-artifact.ts is the one that goes.",
  ],
  [
    "packages/studio/src/hooks/useAudioSoloBridge.ts",
    "#3453 removes the obsolete solo bridge after its last consumer leaves",
  ],
  [
    "packages/studio/src/hooks/useGroupLevel.ts",
    "#3454 deliberately removes the group level meter with the group volume strip",
  ],
  [
    "packages/studio/src/player/components/TimelineGroupBusStrip.test.tsx",
    "#3454 deliberately removes the group volume and level-meter strip and its tests",
  ],
  [
    "packages/studio/src/player/components/TimelineGroupBusStrip.tsx",
    "#3454 deliberately removes the group volume and level-meter strip",
  ],
  [
    "packages/studio/src/player/components/TimelineSoloButton.tsx",
    "#3454 deliberately removes track and group solo controls",
  ],
  [
    "packages/studio/src/player/store/audioSoloSlice.test.ts",
    "#3454 deliberately removes session solo state and its tests",
  ],
  [
    "packages/studio/src/player/store/audioSoloSlice.ts",
    "#3454 deliberately removes session solo state",
  ],
  [
    "packages/studio/src/player/store/groupLevels.ts",
    "#3454 deliberately removes group level-meter state",
  ],
  [
    "docs/public/catalog/components/texture-mask-text.json",
    "the item's directory exceeds the host budget and now falls back to its recorded video; the stale payload had no <base href> and dead relative asset references, so removing it is the fix, not the regression",
  ],
  [
    "packages/studio/src/player/hooks/useExpandedTimelineElements.ts",
    "the timeline shows top-level rows only, so the child-row expansion hook is replaced by useTimelineRowElements",
  ],
  [
    "packages/studio/src/player/hooks/useExpandedTimelineElements.test.ts",
    "tests for the removed child-row expansion hook",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/av_r1k1.mp4",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/av_r1k3.mp4",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/av_r1k4.mp4",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/av_r2k0.mp4",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/av_r2k2.mp4",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/bgm.m4a",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/fonts/eb-garamond-latin-400-normal.woff2",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/fonts/eb-garamond-latin-700-normal.woff2",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/fonts/inter-latin-400-normal.woff2",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/fonts/inter-latin-500-normal.woff2",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "registry/blocks/heygen-avatar-promo-card/assets/fonts/inter-latin-600-normal.woff2",
    "#4056 the avatar promo card hosts its video, audio and fonts on the CDN instead of the repo",
  ],
  [
    "docs/public/catalog/assets/0743c9b7b918b0d9.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/0ad78008621fe77d.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/1d083f9292fdd0f8.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/202dcdfded4c9ff5.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/44b382d4775c2bb8.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/5a88ad5abfd02f99.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/61facab3428ae59c.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/6fef5557664470a3.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/7254a2cfd76b60b5.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/bd3c8b0cb5fa618c.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/d0ff80e331a5ebdb.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/df3dc3536491ffca.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "docs/public/catalog/assets/e234267390ffd6ff.woff2",
    "#4056 regenerated catalog font files are content-hashed, so a re-hashed file replaces the old one",
  ],
  [
    "packages/studio/src/components/StudioLeftSidebar.tsx",
    "replaced by StudioLeftPanels.tsx, which mounts the left-zone panels as dock panels instead of a fixed sidebar",
  ],
  [
    "packages/studio/src/components/sidebar/LeftSidebar.tsx",
    "replaced by the dock-mounted CompositionsPanel/StudioLeftPanels; sidebar tab-switching is now the dock's own tab strip",
  ],
  [
    "packages/studio/src/components/sidebar/LeftSidebar.storage.test.ts",
    "tested the fixed-sidebar tab persistence removed with LeftSidebar.tsx; the dock persists its own layout",
  ],
  [
    "packages/studio/src/components/nle/TimelineResizeDivider.tsx",
    "the timeline's own resize divider; panel sizing is now the dock's sash",
  ],
  [
    "packages/studio/src/hooks/useInspectorSplitResize.ts",
    "resized the old fixed Layers/Design split pane, removed with the split-inspector layout",
  ],
  [
    "packages/studio/src/utils/fitPanels.ts",
    "computed fixed left/right panel widths for the old EditorShell layout; the dock sizes its own panels",
  ],
  ["packages/studio/src/utils/fitPanels.test.ts", "tests for fitPanels.ts, removed with it"],
  ...[
    "docs/studio/storyboard.mdx",
    "packages/studio-server/src/routes/storyboard.test.ts",
    "packages/studio-server/src/routes/storyboard.ts",
    "packages/studio/fixtures/storyboard-sample/README.md",
    "packages/studio/fixtures/storyboard-sample/SCRIPT.md",
    "packages/studio/fixtures/storyboard-sample/STORYBOARD.md",
    "packages/studio/fixtures/storyboard-sample/compositions/frames/01-hook.html",
    "packages/studio/fixtures/storyboard-sample/compositions/frames/02-problem.html",
    "packages/studio/fixtures/storyboard-sample/compositions/frames/03-feature.html",
    "packages/studio/fixtures/storyboard-sample/compositions/frames/04-proof.html",
    "packages/studio/fixtures/storyboard-sample/index.html",
    "packages/studio/src/components/storyboard/AgentChatMessageButton.test.tsx",
    "packages/studio/src/components/storyboard/AgentChatMessageButton.tsx",
    "packages/studio/src/components/storyboard/FramePoster.test.tsx",
    "packages/studio/src/components/storyboard/FramePoster.tsx",
    "packages/studio/src/components/storyboard/StoryboardDirection.tsx",
    "packages/studio/src/components/storyboard/StoryboardFrameFocus.tsx",
    "packages/studio/src/components/storyboard/StoryboardFrameTile.tsx",
    "packages/studio/src/components/storyboard/StoryboardGrid.tsx",
    "packages/studio/src/components/storyboard/StoryboardLoaded.tsx",
    "packages/studio/src/components/storyboard/StoryboardReviewGuide.tsx",
    "packages/studio/src/components/storyboard/StoryboardScriptPanel.tsx",
    "packages/studio/src/components/storyboard/StoryboardSourceEditor.tsx",
    "packages/studio/src/components/storyboard/StoryboardStatusLegend.tsx",
    "packages/studio/src/components/storyboard/StoryboardView.tsx",
    "packages/studio/src/components/storyboard/StoryboardViewModeGuard.test.tsx",
    "packages/studio/src/components/storyboard/frameComments.test.ts",
    "packages/studio/src/components/storyboard/frameComments.ts",
    "packages/studio/src/components/storyboard/frameStatus.ts",
    "packages/studio/src/components/storyboard/storyboardReviewStage.test.ts",
    "packages/studio/src/components/storyboard/storyboardReviewStage.ts",
    "packages/studio/src/components/storyboard/useFrameComments.ts",
    "packages/studio/src/contexts/ViewModeContext.tsx",
    "packages/studio/src/hooks/useProjectSignaturePoll.test.tsx",
    "packages/studio/src/hooks/useProjectSignaturePoll.ts",
    "packages/studio/src/hooks/useStoryboard.ts",
  ].map((path) => [path, STORYBOARD_VIEW_REASON]),
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-basic.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-clear-dark.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-clear-light.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-grass.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-homebrew.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-man-page.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-novel.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-ocean.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-red-sands.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-silver-aerogel.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-apple-terminal-solid-colors.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-dark-plus.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-flight.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-high-contrast-light.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-high-contrast.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-light-2026.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-light-modern.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-light-plus.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-monokai.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-solarized-light.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-visual-studio-dark.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/code-snippet-visual-studio-light.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/liquid-glass-context-menu.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/catalog/blocks/liquid-glass-media-controls.mdx",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-basic.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-clear-dark.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-clear-light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-grass.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-homebrew.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-man-page.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-novel.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-ocean.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-red-sands.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-silver-aerogel.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-apple-terminal-solid-colors.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-dark-plus.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-flight.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-high-contrast-light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-high-contrast.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-light-2026.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-light-modern.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-light-plus.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-monokai.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-solarized-light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-visual-studio-dark.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/code-snippet-visual-studio-light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/liquid-glass-context-menu.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/blocks/liquid-glass-media-controls.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-dark-plus/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-dark-plus/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-high-contrast-light/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-high-contrast-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-high-contrast/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-high-contrast/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-2026/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-2026/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-modern/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-modern/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-plus/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-light-plus/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-monokai/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-monokai/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-solarized-light/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-solarized-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-visual-studio-dark/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-visual-studio-dark/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-visual-studio-light/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "docs/public/catalog/items/code-snippet-visual-studio-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-basic/code-snippet-apple-terminal-basic.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-basic/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-clear-dark/code-snippet-apple-terminal-clear-dark.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-clear-dark/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-clear-light/code-snippet-apple-terminal-clear-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-clear-light/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-grass/code-snippet-apple-terminal-grass.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-grass/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-homebrew/code-snippet-apple-terminal-homebrew.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-homebrew/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-man-page/code-snippet-apple-terminal-man-page.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-man-page/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-novel/code-snippet-apple-terminal-novel.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-novel/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-ocean/code-snippet-apple-terminal-ocean.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-ocean/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-red-sands/code-snippet-apple-terminal-red-sands.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-red-sands/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-silver-aerogel/code-snippet-apple-terminal-silver-aerogel.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-silver-aerogel/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-solid-colors/code-snippet-apple-terminal-solid-colors.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-apple-terminal-solid-colors/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-dark-plus/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-dark-plus/code-snippet-dark-plus.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-dark-plus/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-flight/code-snippet-flight.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-flight/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast-light/code-snippet-high-contrast-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast-light/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast/code-snippet-high-contrast.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-high-contrast/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-2026/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-2026/code-snippet-light-2026.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-2026/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-modern/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-modern/code-snippet-light-modern.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-modern/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-plus/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-plus/code-snippet-light-plus.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-light-plus/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-monokai/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-monokai/code-snippet-monokai.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-monokai/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-solarized-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-solarized-light/code-snippet-solarized-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-solarized-light/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-dark/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-dark/code-snippet-visual-studio-dark.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-dark/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-light/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-light/code-snippet-visual-studio-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/code-snippet-visual-studio-light/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-context-menu/lib/liquid-glass.iife.js",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-context-menu/liquid-glass-context-menu.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-context-menu/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-media-controls/lib/liquid-glass.iife.js",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-media-controls/liquid-glass-media-controls.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/blocks/liquid-glass-media-controls/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/DESIGN.md",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/index.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/sfx/advance.mp3",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/sfx/back.mp3",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/sfx/branch-enter.mp3",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/airbnb-deck/sfx/fragment.mp3",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/motion-blur/index.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/slideshow-demo/index.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/startup-pitch/demo.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/startup-pitch/index.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/DESIGN.md",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/background.jpeg",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-sequence-runtime.js",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-sequence.css",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-theme-registry.js",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/2026-dark.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/2026-light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/LICENSE",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/dark_modern.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/dark_plus.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/dark_vs.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/hc_black.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/hc_light.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/light_modern.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/light_plus.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/light_vs.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/monokai-color-theme.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/assets/vscode-themes/solarized-light-color-theme.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/index.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/registry-item.json",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/dark-2026.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/dark-modern.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/dark-plus.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/high-contrast-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/high-contrast.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/light-2026.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/light-modern.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/light-plus.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/monokai.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/solarized-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/visual-studio-dark.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/render-entries/visual-studio-light.html",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/scripts/build-compositions.mjs",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  [
    "registry/examples/vscode-theme-visualizer/scripts/build-theme-registry.mjs",
    "removed in the 2026-09 low-use catalog cut, see the PR",
  ],
  ["registry/components/simulated-cursor/demo.html", SIMULATED_CURSOR_REASON],
  ["registry/components/simulated-cursor/registry-item.json", SIMULATED_CURSOR_REASON],
  ["registry/components/simulated-cursor/simulated-cursor.html", SIMULATED_CURSOR_REASON],
  ["docs/catalog/components/simulated-cursor.mdx", SIMULATED_CURSOR_REASON],
  ["docs/public/catalog/components/simulated-cursor.json", SIMULATED_CURSOR_REASON],
  ["docs/public/catalog/assets/2427868cae6e8cf3.woff2", CATALOG_FONT_REASON],
  ["docs/public/catalog/assets/36535127950d69fb.woff2", CATALOG_FONT_REASON],
  ["docs/public/catalog/assets/42e5ad0b3cee71d5.woff2", CATALOG_FONT_REASON],
  ["docs/public/catalog/assets/5905d90fd449470d.woff2", CATALOG_FONT_REASON],
  ["docs/public/catalog/assets/728492d30bf60f21.woff2", CATALOG_FONT_REASON],
  ["docs/public/catalog/assets/788a403350b85d98.woff2", CATALOG_FONT_REASON],
  ["docs/public/catalog/assets/95061b23401efc9b.woff2", CATALOG_FONT_REASON],
  ["docs/public/catalog/assets/ae40a5f8f9f604f4.woff2", CATALOG_FONT_REASON],
  ["docs/public/catalog/assets/b13fa08305318ea6.woff2", CATALOG_FONT_REASON],
  ["docs/public/catalog/assets/c356c27cca02fa3b.woff2", CATALOG_FONT_REASON],
  ["docs/public/catalog/assets/e3c9ceb1da81254f.woff2", CATALOG_FONT_REASON],
  ["docs/public/catalog/assets/e59d60b150022666.woff2", CATALOG_FONT_REASON],
  [
    "packages/studio-server/src/helpers/previewWatchIgnore.ts",
    "preview.watchIgnore is replaced by reloading only when a file the preview loaded changes",
  ],
  [
    "packages/studio-server/src/helpers/previewWatchIgnore.test.ts",
    "tests for the removed preview.watchIgnore helper",
  ],
  ["docs/images/preview-reload-evidence/after.webm", "evidence video no page referenced"],
  ["docs/images/preview-reload-evidence/before.webm", "evidence video no page referenced"],
  [
    "packages/studio-server/src/helpers/atomicFile.ts",
    "moved to @hyperframes/core/atomic-file (packages/core/src/atomicFile.ts) as the single atomic writer for core, sdk, cli and studio-server",
  ],
  [
    "packages/studio-server/src/helpers/atomicFile.test.ts",
    "its tests moved with it to packages/core/src/atomicFile.test.ts",
  ],
  ["docs/contracts/2026-10-01-timeline-filmstrip.html", DESIGN_NOTES_REASON],
  ["docs/contracts/2026-10-02-ghost-lane-membership.html", DESIGN_NOTES_REASON],
  ["docs/contracts/2026-10-02-thumbnail-document-lifetime.html", DESIGN_NOTES_REASON],
  ["docs/contracts/2026-10-05-transcribe-language-progress.html", DESIGN_NOTES_REASON],
  ["docs/plans/2026-09-26-image-thumbnails.md", DESIGN_NOTES_REASON],
  [
    "packages/engine/src/services/frameCapture-wslFullChrome.test.ts",
    "tests the WSL full-Chrome GPU fallback, replaced by the probe without WAYLAND_DISPLAY (frameCapture-wslWayland.test.ts)",
  ],
  [
    "packages/core/src/storyboard/transitionsContract.test.ts",
    "ran the retired workflows' transitions.mjs; the script went with them",
  ],
  [
    "packages/core/src/storyboard/vendoredParity.test.ts",
    "guarded the retired workflows' vendored storyboard parsers; no vendored copy remains",
  ],
  [
    "scripts/agent-plugin-captions.test.mjs",
    "exercised embedded-captions' bundled scripts, retired with the skill",
  ],
  [
    "scripts/generate-captured-font-copies.mjs",
    "copied captured-fonts.mjs between three retired workflow skills; nothing left to copy",
  ],
  [
    "skills/hyperframes/scripts/lib/frame-packets-core.mjs",
    "shared frame-packet builder for the retired workflow skills; no remaining importer",
  ],
  [
    "skills/media-use/audio/scripts/lib/host-audio.mjs",
    "host-audio merge used only by the retired workflow skills' audio adapters; no remaining importer",
  ],
  [
    "skills/media-use/audio/scripts/lib/host-audio.test.mjs",
    "tests for the removed host-audio module and the retired workflows' wording",
  ],
  ...RETIRED_WORKFLOW_FILES.map((path) => [path, RETIRED_WORKFLOW_REASON]),
  ...RETIRED_GUIDE_FILES.map((path) => [path, RETIRED_GUIDE_REASON]),
  ...RETIRED_ROUTING_FILES.map((path) => [path, RETIRED_ROUTING_REASON]),
  ...REVERT_6754_FILES.map((path) => [path, REVERT_6754_REASON]),
  [
    "packages/producer/src/services/audioExtractor.ts",
    "imported by nothing; its own ffmpeg spawn quoted stderr unredacted, outside ManagedChildProcess",
  ],
  ["scripts/prune-fallow-audit-caches.mjs", FALLOW_PRUNE_REASON],
  ["scripts/prune-fallow-audit-caches.test.mjs", FALLOW_PRUNE_REASON],
  [
    "packages/engine/src/services/frameCapture-releaseInjectedVideoMedia.browser.test.ts",
    "the revert of #5795 removes releaseInjectedVideoMedia, the only code this file tested",
  ],
  [
    ".github/workflows/lambda-ffmpeg.yml",
    "the ffmpeg build moves into lambda-arm64-image.yml, which also builds and smokes the image",
  ],
]);

export function parseBase(argv, fallback = "origin/main") {
  const index = argv.indexOf(BASE_FLAG);
  if (index === -1) return fallback;
  const value = argv[index + 1];
  if (!value || value.startsWith("-")) {
    throw new Error(`${BASE_FLAG} needs a ref, for example ${BASE_FLAG} origin/main`);
  }
  return value;
}

/**
 * Split a `--name-status` diff into deletions and renames.
 *
 * Git reports a rename as `R<score>\told\tnew`. Reading only the first column
 * would file that under "deleted", which is the false alarm this guards
 * against being noisy enough to ignore.
 */
// one branch per git status code
// fallow-ignore-next-line complexity
export function classify(nameStatus) {
  const deleted = [];
  const renamed = [];
  for (const line of nameStatus.split("\n")) {
    if (!line.trim()) continue;
    const [status, ...paths] = line.split("\t");
    if (status.startsWith("R")) renamed.push({ from: paths[0], to: paths[1] });
    else if (status === "D") deleted.push(paths[0]);
  }
  return { deleted, renamed };
}

// a script entry point
// fallow-ignore-next-line complexity
function main() {
  const base = parseBase(process.argv.slice(2));
  let diff;
  try {
    diff = execFileSync("git", ["diff", "--name-status", "-M", `${base}...HEAD`], {
      encoding: "utf8",
    });
  } catch (error) {
    // An unreachable base is not a pass. Reporting "no deletions" because the
    // ref was misspelled is the exact failure this exists to prevent.
    console.error(`cannot diff against ${base}: ${error.message.trim()}`);
    process.exit(2);
  }

  const { deleted: allDeleted, renamed } = classify(diff);
  const agreed = allDeleted.filter((path) => ALLOWED_DELETIONS.has(path));
  const deleted = allDeleted.filter((path) => !ALLOWED_DELETIONS.has(path));

  if (agreed.length > 0) {
    console.log(`${agreed.length} deletion(s) agreed in ALLOWED_DELETIONS:`);
    for (const path of agreed) console.log(`  ${path} — ${ALLOWED_DELETIONS.get(path)}`);
  }
  if (renamed.length > 0) {
    console.log(`${renamed.length} renamed (allowed):`);
    for (const { from, to } of renamed.slice(0, 10)) console.log(`  ${from} -> ${to}`);
    if (renamed.length > 10) console.log(`  … and ${renamed.length - 10} more`);
  }

  if (deleted.length === 0) {
    console.log(`No files from ${base} are deleted by this branch.`);
    return;
  }

  console.error(`This branch deletes ${deleted.length} files that exist on ${base}:`);
  for (const path of deleted.slice(0, 25)) console.error(`  ${path}`);
  if (deleted.length > 25) console.error(`  … and ${deleted.length - 25} more`);
  console.error("\nIf a deletion is intended, remove this check for that path deliberately.");
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) main();
