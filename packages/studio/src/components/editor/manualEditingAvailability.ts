export type StudioFeatureFlagEnv = Record<string, boolean | string | undefined>;

export const STUDIO_PREVIEW_MANUAL_DRAGGING_ENV = "VITE_STUDIO_ENABLE_PREVIEW_MANUAL_DRAGGING";
export const STUDIO_INSPECTOR_PANELS_ENV = "VITE_STUDIO_ENABLE_INSPECTOR_PANELS";
export const STUDIO_MOTION_PANEL_ENV = "VITE_STUDIO_ENABLE_MOTION_PANEL";
export const STUDIO_TIMELINE_LAYER_INSPECTOR_ENV = "VITE_STUDIO_ENABLE_TIMELINE_LAYER_INSPECTOR";

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

const env = import.meta.env as StudioFeatureFlagEnv;

export const STUDIO_PREVIEW_MANUAL_EDITING_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  [STUDIO_PREVIEW_MANUAL_DRAGGING_ENV, "VITE_STUDIO_PREVIEW_MANUAL_EDITING_ENABLED"],
  false,
);

export const STUDIO_INSPECTOR_PANELS_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  [STUDIO_INSPECTOR_PANELS_ENV, "VITE_STUDIO_INSPECTOR_PANELS_ENABLED"],
  true,
);

export const STUDIO_MOTION_PANEL_ENABLED = resolveStudioBooleanEnvFlag(
  env,
  [STUDIO_MOTION_PANEL_ENV, "VITE_STUDIO_MOTION_PANEL_ENABLED"],
  true,
);

export const STUDIO_TIMELINE_LAYER_INSPECTOR_ENABLED =
  STUDIO_INSPECTOR_PANELS_ENABLED &&
  resolveStudioBooleanEnvFlag(
    env,
    [STUDIO_TIMELINE_LAYER_INSPECTOR_ENV, "VITE_STUDIO_TIMELINE_LAYER_INSPECTOR_ENABLED"],
    true,
  );

export const STUDIO_MANUAL_EDITING_ENABLED = STUDIO_PREVIEW_MANUAL_EDITING_ENABLED;

export const STUDIO_MANUAL_EDITING_DISABLED_TITLE = "Manual editing is temporarily disabled";
