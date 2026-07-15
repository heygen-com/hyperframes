/**
 * Re-export of the VST host sidecar lifecycle, relocated to
 * `packages/studio-server/src/vstSidecar.ts` so both the CLI's embedded
 * studio server and the Studio Vite dev server can import it without
 * duplicating the resolver + spawn logic (studio-server has no dependency
 * that module doesn't already need — only `node:child_process`/`node:fs`/
 * `node:path` — and the CLI already depends on `@hyperframes/studio-server`,
 * so this direction adds no new dependency edge).
 *
 * Kept as a thin re-export (rather than updating every CLI import site) so
 * `hyperframes preview`'s existing `import { stopVstSidecar } from
 * "../vst/sidecar.js"` continues to work unchanged.
 */
export * from "@hyperframes/studio-server/vst-sidecar";
