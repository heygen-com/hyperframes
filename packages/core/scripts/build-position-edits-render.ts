/** Build the injectable position-edits render artifact from the canonical runtime. */

import { buildInjectedArtifact } from "./buildInjectedArtifact.js";

buildInjectedArtifact({
  scriptUrl: import.meta.url,
  entry: "stubs/position-edits-render-entry.ts",
  out: "position-edits-render-inline.ts",
  constName: "POSITION_EDITS_RENDER_IIFE",
  fnName: "getPositionEditsRenderScript",
  what: "position-edits render IIFE",
  event: "position_edits_render_generated",
});
