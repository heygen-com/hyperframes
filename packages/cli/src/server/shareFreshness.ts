import { fileSha256Base64, versionOnPage } from "@hyperframes/share";
import type { ShareState } from "../share/service.js";
import { latestShareRender, shareContentFingerprint } from "../share/render.js";
import { presentShare } from "./sharePresentation.js";

const dependencies = {
  render: latestShareRender,
  fingerprint: shareContentFingerprint,
  uploaded: versionOnPage,
  checksum: fileSha256Base64,
};

export async function presentPortableShare(
  projectDir: string,
  state: ShareState,
  deps = dependencies,
) {
  const result = presentShare(state);
  try {
    const render = deps.render(projectDir);
    if (!render?.contentFingerprint) return result;
    const last = await deps.uploaded(projectDir);
    if (!matchesUpload(state, last)) return result;
    if ((await deps.checksum(render.path)) !== last.checksum) return result;
    const current = await deps.fingerprint(projectDir);
    // Equal video bytes do not prove equal source inputs (for example metadata-only edits).
    // Until exports persist the portable digest, only report known changes, never "clean".
    result.changed = current && current !== render.contentFingerprint ? true : null;
  } catch {
    // Missing local artifacts cannot establish freshness of the published video.
  }
  return result;
}

function matchesUpload(
  state: ShareState,
  last: Awaited<ReturnType<typeof versionOnPage>>,
): last is NonNullable<typeof last> {
  return Boolean(
    last?.checksum &&
    last.projectId === state.share?.projectId &&
    last.exportedAt === state.version.last?.exportedAt,
  );
}
