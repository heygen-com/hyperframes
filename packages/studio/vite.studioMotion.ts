import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createStudioManualEditsRenderBodyScript,
  type StudioManualEditsRenderScriptOptions,
} from "../core/src/studio-api/helpers/manualEditsRenderScript";
import {
  createStudioMotionRenderBodyScript,
  STUDIO_MOTION_PATH,
} from "../core/src/studio-api/helpers/studioMotionRenderScript";

const STUDIO_MANUAL_EDITS_PATH = ".hyperframes/studio-manual-edits.json";

function readManifestContent(projectDir: string, manifestPath: string): string {
  const resolvedPath = join(projectDir, manifestPath);
  if (!existsSync(resolvedPath)) return "";
  try {
    return readFileSync(resolvedPath, "utf-8");
  } catch {
    return "";
  }
}

export function readStudioDevManualEditManifestContent(projectDir: string): string {
  return readManifestContent(projectDir, STUDIO_MANUAL_EDITS_PATH);
}

export function readStudioDevMotionManifestContent(projectDir: string): string {
  return readManifestContent(projectDir, STUDIO_MOTION_PATH);
}

export function createStudioDevRenderBodyScripts(
  projectDir: string,
  options: StudioManualEditsRenderScriptOptions = {},
): string[] {
  const manualEditsRenderScript = createStudioManualEditsRenderBodyScript(
    readStudioDevManualEditManifestContent(projectDir),
    options,
  );
  const motionRenderScript = createStudioMotionRenderBodyScript(
    readStudioDevMotionManifestContent(projectDir),
    options,
  );
  return [manualEditsRenderScript, motionRenderScript].filter(
    (script): script is string => typeof script === "string",
  );
}
