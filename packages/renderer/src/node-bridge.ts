/**
 * @hyperframes/renderer — Public API
 *
 * Drop-in high-performance renderer for HyperFrames compositions.
 * Uses pipelined CDP with pipe transport for fast frame capture
 * and streams directly to FFmpeg for concurrent encoding.
 */

export { turboRender, type TurboRenderOptions, type TurboRenderResult } from "./turbo-renderer.js";
