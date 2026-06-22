export type StudioFeatureFlagEnv = Record<string, boolean | string | undefined>;

const STUDIO_PREVIEW_MANUAL_DRAGGING_ENV = "VITE_STUDIO_ENABLE_PREVIEW_MANUAL_DRAGGING";
const STUDIO_INSPECTOR_PANELS_ENV = "VITE_STUDIO_ENABLE_INSPECTOR_PANELS";
const TRUTHY_ENV_VALUES = new Set(["1", "true", "yes", "on", "enabled"]);
const FALSY_ENV_VALUES = new Set(["0", "false", "no", "off", "disabled"]);

export function resolveStudioBooleanEnvFlag(
  env: StudioFeatureFlagEnv,
  names: string[],
  fallback: boolean,
): boolean {
  for (const name of names) {
    const value = env[name];
    if (typeof value === "boolean") return value;
    if (typeof value !== "string") continue;

    const normalized = value.trim().toLowerCase();
    if (!normalized) continue;
    if (TRUTHY_ENV_VALUES.has(normalized)) return true;
    if (FALSY_ENV_VALUES.has(normalized)) return false;
  }

  return fallback;
}

// `import.meta.env` is a Vite-only extension. In non-Vite ESM hosts
// (Next.js / Turbopack, Node, jest in some configs) it's undefined,
// and downstream `env[name]` reads would crash. Fall back to `{}` so
// every flag resolves to its declared default outside Vite. Direct
// property access keeps Vite's compile-time transform happy.
//
// When the studio is served as a pre-built SPA by the embedded Hono server,
// `import.meta.env` values were baked at build time. The server injects
// `window.__HF_STUDIO_ENV__` with any `VITE_STUDIO_*` env vars from the
// user's shell, so runtime overrides take precedence over baked defaults.
const runtimeEnv =
  typeof window !== "undefined"
    ? ((window as Window & { __HF_STUDIO_ENV__?: StudioFeatureFlagEnv }).__HF_STUDIO_ENV__ ?? {})
    : {};
const env = { ...(import.meta.env ?? {}), ...runtimeEnv } as StudioFeatureFlagEnv;

export const STUDIO_PREVIEW_MANUAL_EDITING_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  [STUDIO_PREVIEW_MANUAL_DRAGGING_ENV, "VITE_STUDIO_PREVIEW_MANUAL_EDITING_ENABLED"],
  true,
);

export const STUDIO_INSPECTOR_PANELS_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  [STUDIO_INSPECTOR_PANELS_ENV, "VITE_STUDIO_INSPECTOR_PANELS_ENABLED"],
  true,
);

export const STUDIO_BLOCKS_PANEL_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  ["VITE_STUDIO_ENABLE_BLOCKS_PANEL", "VITE_STUDIO_BLOCKS_PANEL_ENABLED"],
  true,
);

export const STUDIO_GSAP_PANEL_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  ["VITE_STUDIO_ENABLE_GSAP_PANEL", "VITE_STUDIO_GSAP_PANEL_ENABLED"],
  true,
);

export const STUDIO_COLOR_GRADING_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  ["VITE_STUDIO_ENABLE_COLOR_GRADING", "VITE_STUDIO_COLOR_GRADING_ENABLED"],
  false,
);

export const STUDIO_KEYFRAMES_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  ["VITE_STUDIO_ENABLE_KEYFRAMES", "VITE_STUDIO_KEYFRAMES_ENABLED"],
  true,
);

export const STUDIO_RAZOR_TOOL_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  ["VITE_STUDIO_ENABLE_RAZOR_TOOL", "VITE_STUDIO_RAZOR_TOOL_ENABLED"],
  true,
);

// Storyboard view: a top-level, toggleable view that renders STORYBOARD.md as a
// contact sheet of live HTML frame tiles, replacing the timeline/preview stage.
// Opt-in / off by default until the experience is ready for broad exposure.
//   VITE_STUDIO_ENABLE_STORYBOARD=1 npx hyperframes preview
export const STUDIO_STORYBOARD_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  ["VITE_STUDIO_ENABLE_STORYBOARD", "VITE_STUDIO_STORYBOARD_ENABLED"],
  false,
);

export const STUDIO_PREVIEW_SELECTION_ENABLED = STUDIO_INSPECTOR_PANELS_ENABLED;

// Stage 7 Step 3c: SDK cutover — routes inline-style ops through SDK dispatch
// instead of the server patch-element API. Default false; enable via
// VITE_STUDIO_SDK_CUTOVER_ENABLED=true. Requires SDK session to be open.
export const STUDIO_SDK_CUTOVER_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  ["VITE_STUDIO_SDK_CUTOVER_ENABLED"],
  false,
);

// Resolver-parity tripwire (telemetry-only, decoupled from cutover).
// Runs the SDK resolver alongside any edit and emits sdk_resolver_shadow on
// divergence. Default true; disable via VITE_STUDIO_SDK_RESOLVER_SHADOW_ENABLED=false.
// Soak gate: retire once zero element_not_found divergences over a clean window.
export const STUDIO_SDK_RESOLVER_SHADOW_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  ["VITE_STUDIO_SDK_RESOLVER_SHADOW_ENABLED"],
  true,
);

export const STUDIO_MANUAL_EDITING_DISABLED_TITLE = "Manual editing is temporarily disabled";
