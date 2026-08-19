// Preview full-reload diagnostics — grep [hf-reload]. Off by default; opt in per
// session with `localStorage.setItem("hf-reload-debug", "1")` (then reload).
//
// A full reload blanks the stage for ~100-300ms, so any reload the user did not
// ask for reads as a flash. These lines answer the only question that matters
// when one appears: who asked for it, and why the write that triggered it was
// not recognised as Studio's own.
import { makeStudioDebugLogger } from "./studioDebug";

export const logReload = makeStudioDebugLogger("reload");
