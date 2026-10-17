import { beginArtifactCapture } from "@hyperframes/studio-server/history";
import { withOwner } from "./historyOwner.js";

const SKIP_BUSY_HISTORY = { ownerWaitMs: 0 };

export async function captureArtifactRevision(projectDir: string) {
  return withOwner(
    projectDir,
    async (owner) => {
      await owner.checkpoint();
      return beginArtifactCapture(projectDir);
    },
    SKIP_BUSY_HISTORY,
  );
}
