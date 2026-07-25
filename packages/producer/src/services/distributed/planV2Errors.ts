export const PLAN_V2_INTEGRITY_UNRECOVERABLE = "PLAN_V2_INTEGRITY_UNRECOVERABLE" as const;

/**
 * A deterministic plan-v2 validation or integrity failure. Distributed
 * adapters classify both the class name and code as terminal so immutable
 * corruption does not consume the retry budget.
 */
export class PlanV2IntegrityError extends Error {
  // Public adapters inspect this typed code even though OSS producer does not.
  // fallow-ignore-next-line unused-class-member
  readonly code: typeof PLAN_V2_INTEGRITY_UNRECOVERABLE = PLAN_V2_INTEGRITY_UNRECOVERABLE;

  constructor(message: string) {
    super(`[planV2] ${message}`);
    this.name = "PlanV2IntegrityError";
  }
}
