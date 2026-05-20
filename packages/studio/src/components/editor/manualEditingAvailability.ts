export type StudioFeatureFlagEnv = Record<string, boolean | string | undefined>;

const STUDIO_PREVIEW_MANUAL_DRAGGING_ENV = "VITE_STUDIO_ENABLE_PREVIEW_MANUAL_DRAGGING";
const STUDIO_INSPECTOR_PANELS_ENV = "VITE_STUDIO_ENABLE_INSPECTOR_PANELS";
const STUDIO_MOTION_PANEL_ENV = "VITE_STUDIO_ENABLE_MOTION_PANEL";
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
const env = (import.meta.env ?? {}) as StudioFeatureFlagEnv;

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

export const STUDIO_MOTION_PANEL_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  [STUDIO_MOTION_PANEL_ENV, "VITE_STUDIO_MOTION_PANEL_ENABLED"],
  false,
);

export const STUDIO_BLOCKS_PANEL_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  ["VITE_STUDIO_ENABLE_BLOCKS_PANEL", "VITE_STUDIO_BLOCKS_PANEL_ENABLED"],
  false,
);

export const STUDIO_PREVIEW_SELECTION_ENABLED = STUDIO_INSPECTOR_PANELS_ENABLED;

export const STUDIO_MANUAL_EDITING_DISABLED_TITLE = "Manual editing is temporarily disabled";
