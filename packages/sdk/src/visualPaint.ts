/**
 * Shared visual-paint primitives for SDK hosts such as Studio.
 *
 * The parser itself lives in Core so the CLI can serialize it into its dependency-free
 * browser audit without depending on the SDK package. SDK remains the public home for
 * host-facing paint semantics.
 */
export { cssColorAlpha, isTransparentColor } from "@hyperframes/core/visual-paint";
