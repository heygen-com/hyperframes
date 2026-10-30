export type CheckProgressStage = "samples" | "craft" | "overlap" | "analyze";

export function logCheckProgress(stage: CheckProgressStage, done: number, total: number): void {
  console.error(`[hyperframes] check: ${stage} ${done}/${total}`);
}

export type CheckProgress = (stage: CheckProgressStage, done: number, total: number) => void;
