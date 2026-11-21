export const REFUSAL_REASONS = [
  "not_kept",
  "in_the_way",
  "starting_copy_saving",
  "removes_every_file",
] as const;
export type RefusalReason = (typeof REFUSAL_REASONS)[number];

/** History said no and changed nothing: the person can act on `message`; `reason` is for code. */
export class HistoryRefusedError extends Error {
  constructor(
    readonly reason: RefusalReason,
    message: string,
  ) {
    super(message);
    this.name = "HistoryRefusedError";
  }
}

export const inTheWay = (at: string) =>
  new HistoryRefusedError("in_the_way", `${at} is in the way; move or delete it, then try again.`);

export const notKept = (message: string) => new HistoryRefusedError("not_kept", message);
