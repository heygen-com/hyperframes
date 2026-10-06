/** Build the SVG selector alias installer that compiled scene scripts carry. */

import { buildInjectedArtifact } from "./buildInjectedArtifact.js";

buildInjectedArtifact({
  scriptUrl: import.meta.url,
  entry: "stubs/svg-selector-aliases-entry.ts",
  out: "svg-selector-aliases-inline.ts",
  constName: "SVG_SELECTOR_ALIASES_IIFE",
  fnName: "getSvgSelectorAliasesScript",
  what: "SVG selector alias installer IIFE",
  event: "svg_selector_aliases_generated",
});
