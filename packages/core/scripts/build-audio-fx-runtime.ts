/** Build the injectable audio-FX runtime artifact from the canonical runtime. */

import { buildInjectedArtifact } from "./buildInjectedArtifact.js";

buildInjectedArtifact({
  scriptUrl: import.meta.url,
  entry: "stubs/audio-fx-runtime-entry.ts",
  out: "audio-fx-runtime-inline.ts",
  constName: "AUDIO_FX_RUNTIME_IIFE",
  fnName: "getAudioFxRuntimeScript",
  what: "audio-FX runtime IIFE",
  event: "audio_fx_runtime_generated",
});
