import { join } from "node:path";
import { PlanV2IntegrityError } from "./planV2Errors.js";

const SHA256_PATTERN = /^[0-9a-f]{64}$/;

export function assertPlanV2Sha256(value: unknown, field: string): string {
  if (typeof value !== "string" || !SHA256_PATTERN.test(value)) {
    throw new PlanV2IntegrityError(`${field} must be a lowercase sha256 digest`);
  }
  return value;
}

export function planV2BlobPath(root: string, sha256: string): string {
  const digest = assertPlanV2Sha256(sha256, "artifact sha256");
  return join(root, "artifacts", "sha256", digest.slice(0, 2), digest);
}
