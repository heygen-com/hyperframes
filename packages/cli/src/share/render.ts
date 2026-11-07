import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { mkdir, writeFile, rename, rm } from "node:fs/promises";
import { join } from "node:path";
import { projectFingerprint, shareSourceFingerprint } from "@hyperframes/share";

export const shareContentFingerprint = shareSourceFingerprint;

export interface ShareRender {
  path: string;
  id: string;
  fingerprint: string;
  contentFingerprint?: string;
}

export function latestShareRender(dir: string): ShareRender | null {
  try {
    const value: unknown = JSON.parse(
      readFileSync(join(dir, ".hyperframes", "share-render.json"), "utf8"),
    );
    if (
      !value ||
      typeof value !== "object" ||
      !("path" in value) ||
      !("id" in value) ||
      !("fingerprint" in value)
    )
      return null;
    if (
      typeof value.path !== "string" ||
      typeof value.id !== "string" ||
      typeof value.fingerprint !== "string" ||
      !/^[a-f0-9-]{36}$/.test(value.id)
    )
      return null;
    const expected = join(realpathSync(dir), ".hyperframes", "share-renders", `${value.id}.mp4`);
    if (value.path !== expected || !existsSync(expected) || realpathSync(expected) !== expected)
      return null;
    const contentFingerprint =
      "contentFingerprint" in value && typeof value.contentFingerprint === "string"
        ? value.contentFingerprint
        : undefined;
    return {
      path: expected,
      id: value.id,
      fingerprint: value.fingerprint,
      ...(contentFingerprint && { contentFingerprint }),
    };
  } catch {
    return null;
  }
}

export async function prepareShareRender(dir: string): Promise<void> {
  const [before, content] = await Promise.all([
    projectFingerprint(dir),
    shareContentFingerprint(dir),
  ]);
  const previous = latestShareRender(dir);
  if (content && previous?.fingerprint === before && previous.contentFingerprint === content)
    return;
  const stateFolder = join(dir, ".hyperframes");
  if (existsSync(stateFolder) && realpathSync(stateFolder) !== stateFolder)
    throw new Error("Sharing state must stay inside this project, without symlinks.");
  await mkdir(stateFolder, { recursive: true });
  const folder = join(stateFolder, "share-renders");
  if (existsSync(folder) && realpathSync(folder) !== folder)
    throw new Error("Sharing state must stay inside this project, without symlinks.");
  await mkdir(folder, { recursive: true });
  if (realpathSync(folder) !== folder)
    throw new Error("Sharing state must stay inside this project, without symlinks.");
  const id = randomUUID();
  const output = join(folder, `${id}.mp4`);
  const [{ createRenderPlan }, { executeRenderPlan }, render] = await Promise.all([
    import("../commands/render/plan.js"),
    import("../commands/render/execute.js"),
    import("../commands/render.js"),
  ]);
  const target = join(stateFolder, "share-render.json");
  const temporary = `${target}.${id}.tmp`;
  try {
    const plan = createRenderPlan({ dir, output, format: "mp4", quiet: true, strict: true });
    await executeRenderPlan(plan, {
      renderLocal: (project, output, options, cancellation) =>
        render.renderLocal(
          project,
          output,
          { ...options, embedded: true, exitAfterComplete: false },
          cancellation,
        ),
      renderDocker: async () => {
        throw new Error("Share renders locally.");
      },
      checkResolution: render.checkRenderResolutionPreflight,
    });
    if (!existsSync(output))
      throw new Error("The render did not produce a video. Run hyperframes render to diagnose it.");
    const [after, afterContent] = await Promise.all([
      projectFingerprint(dir),
      shareContentFingerprint(dir),
    ]);
    if (after !== before || afterContent !== content)
      throw new Error(
        "The project changed while rendering. Share again to capture the current project.",
      );
    await writeFile(
      temporary,
      JSON.stringify({ id, path: output, fingerprint: before, contentFingerprint: content }),
    );
    await rename(temporary, target);
  } catch (error) {
    await Promise.allSettled([rm(output, { force: true }), rm(temporary, { force: true })]);
    throw error;
  }
}
