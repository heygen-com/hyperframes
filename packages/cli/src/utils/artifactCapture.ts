import { HistoryBusyError, beginArtifactCapture } from "@hyperframes/studio-server/history";
import { withOwner } from "./historyOwner.js";

const SKIP_BUSY_HISTORY = { ownerWaitMs: 0 };

function unlessAnotherProcessKeepsTheHistory(error: unknown): void {
  if (!(error instanceof HistoryBusyError)) throw error;
}

export async function captureArtifactRevision(projectDir: string) {
  await withOwner(projectDir, (owner) => owner.checkpoint(), SKIP_BUSY_HISTORY).catch(
    unlessAnotherProcessKeepsTheHistory,
  );
  return beginArtifactCapture(projectDir);
}
