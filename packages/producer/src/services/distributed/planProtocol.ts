/**
 * Compatibility contract for the on-disk distributed render plan.
 *
 * A missing descriptor means the original v1 plan layout. This preserves
 * replay compatibility with plan directories produced before the descriptor
 * existed. Once a descriptor is present it must be complete and recognized:
 * silently guessing across a partially-written or newer layout could render
 * incorrect pixels or make assemble consume the wrong artifacts.
 */

export const PLAN_SCHEMA_VERSION = 1 as const;
export const PLAN_ARTIFACT_LAYOUT = "plan-dir-v1" as const;
export const PLAN_HASH_SCHEMA = "hyperframes-plan-hash-v1" as const;
export const PLAN_V2_SCHEMA_VERSION = 2 as const;
export const PLAN_V2_ARTIFACT_LAYOUT = "content-addressed-plan-v2" as const;
export const PLAN_V2_HASH_SCHEMA = "hyperframes-plan-manifest-hash-v2" as const;
export const PLAN_PROTOCOL_UNSUPPORTED = "PLAN_PROTOCOL_UNSUPPORTED" as const;

export interface PlanProtocolDescriptor {
  readonly schemaVersion: number;
  readonly artifactLayout: string;
  readonly hashSchema: string;
}

export interface PlanProtocolV1Descriptor extends PlanProtocolDescriptor {
  readonly schemaVersion: typeof PLAN_SCHEMA_VERSION;
  readonly artifactLayout: typeof PLAN_ARTIFACT_LAYOUT;
  readonly hashSchema: typeof PLAN_HASH_SCHEMA;
}

export interface PlanProtocolV2Descriptor extends PlanProtocolDescriptor {
  readonly schemaVersion: typeof PLAN_V2_SCHEMA_VERSION;
  readonly artifactLayout: typeof PLAN_V2_ARTIFACT_LAYOUT;
  readonly hashSchema: typeof PLAN_V2_HASH_SCHEMA;
}

export type SupportedPlanProtocolDescriptor = PlanProtocolV1Descriptor | PlanProtocolV2Descriptor;

/** Descriptor for the legacy v1 execution-directory transport. */
export const PLAN_PROTOCOL_V1: Readonly<PlanProtocolV1Descriptor> = Object.freeze({
  schemaVersion: PLAN_SCHEMA_VERSION,
  artifactLayout: PLAN_ARTIFACT_LAYOUT,
  hashSchema: PLAN_HASH_SCHEMA,
});

/**
 * Descriptor written by the legacy v1 planner and accepted by v1 workers.
 *
 * @deprecated Use {@link PLAN_PROTOCOL_V1}. Kept as an identity-preserving
 * alias for existing integrations.
 */
export const CURRENT_PLAN_PROTOCOL: Readonly<PlanProtocolV1Descriptor> = PLAN_PROTOCOL_V1;

/** Explicit opt-in descriptor for the content-addressed v2 transport layout. */
export const PLAN_PROTOCOL_V2: Readonly<PlanProtocolV2Descriptor> = Object.freeze({
  schemaVersion: PLAN_V2_SCHEMA_VERSION,
  artifactLayout: PLAN_V2_ARTIFACT_LAYOUT,
  hashSchema: PLAN_V2_HASH_SCHEMA,
});

export interface PlanProtocolConsumerCapabilities {
  readonly accepts: readonly Readonly<PlanProtocolDescriptor>[];
  readonly acceptsLegacyV1WithoutDescriptor: boolean;
}

export interface DistributedRenderCapabilities {
  readonly roles: Readonly<{
    planner: Readonly<{
      produces: readonly Readonly<PlanProtocolDescriptor>[];
    }>;
    chunk: Readonly<PlanProtocolConsumerCapabilities>;
    assembler: Readonly<PlanProtocolConsumerCapabilities>;
  }>;
}

/** Serializable capability payload for fleet rollout and worker handshakes. */
export const DISTRIBUTED_RENDER_CAPABILITIES: Readonly<DistributedRenderCapabilities> =
  Object.freeze({
    roles: Object.freeze({
      planner: Object.freeze({
        produces: Object.freeze([PLAN_PROTOCOL_V1, PLAN_PROTOCOL_V2]),
      }),
      chunk: Object.freeze({
        accepts: Object.freeze([PLAN_PROTOCOL_V1, PLAN_PROTOCOL_V2]),
        acceptsLegacyV1WithoutDescriptor: true,
      }),
      assembler: Object.freeze({
        accepts: Object.freeze([PLAN_PROTOCOL_V1, PLAN_PROTOCOL_V2]),
        acceptsLegacyV1WithoutDescriptor: true,
      }),
    }),
  });

export function getDistributedRenderCapabilities(): Readonly<DistributedRenderCapabilities> {
  return DISTRIBUTED_RENDER_CAPABILITIES;
}

/** Typed, deterministic compatibility failure. Retrying on the same worker cannot heal it. */
export class PlanProtocolUnsupportedError extends Error {
  // Public adapters inspect this typed code even though OSS producer does not.
  // fallow-ignore-next-line unused-class-member
  readonly code: typeof PLAN_PROTOCOL_UNSUPPORTED = PLAN_PROTOCOL_UNSUPPORTED;

  constructor(reason: string) {
    super(`[planProtocol] ${reason} (${PLAN_PROTOCOL_UNSUPPORTED})`);
    this.name = "PlanProtocolUnsupportedError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function protocolMatches(
  descriptor: Record<string, unknown>,
  expected: SupportedPlanProtocolDescriptor,
): boolean {
  return (
    descriptor.schemaVersion === expected.schemaVersion &&
    descriptor.artifactLayout === expected.artifactLayout &&
    descriptor.hashSchema === expected.hashSchema
  );
}

function capabilitiesAccept(
  capabilities: Readonly<PlanProtocolConsumerCapabilities>,
  protocol: Readonly<PlanProtocolDescriptor>,
): boolean {
  return capabilities.accepts.some(
    (accepted) =>
      accepted.schemaVersion === protocol.schemaVersion &&
      accepted.artifactLayout === protocol.artifactLayout &&
      accepted.hashSchema === protocol.hashSchema,
  );
}

/**
 * Read and validate the plan protocol before a worker consumes other plan
 * artifacts. Unknown fields on a recognized v1 descriptor are intentionally
 * ignored so optional metadata can be added without a lockstep fleet deploy.
 */
export function readPlanProtocol(
  planJson: unknown,
  capabilities: Readonly<PlanProtocolConsumerCapabilities> = DISTRIBUTED_RENDER_CAPABILITIES.roles
    .chunk,
): Readonly<SupportedPlanProtocolDescriptor> {
  if (!isRecord(planJson)) {
    throw new PlanProtocolUnsupportedError("plan.json must contain a JSON object");
  }

  if (!Object.prototype.hasOwnProperty.call(planJson, "protocol")) {
    if (
      !capabilities.acceptsLegacyV1WithoutDescriptor ||
      !capabilitiesAccept(capabilities, PLAN_PROTOCOL_V1)
    ) {
      throw new PlanProtocolUnsupportedError(
        "legacy v1 plan without a protocol descriptor is not accepted by this worker",
      );
    }
    return PLAN_PROTOCOL_V1;
  }

  const descriptor = planJson.protocol;
  if (!isRecord(descriptor)) {
    throw new PlanProtocolUnsupportedError("plan.json protocol descriptor must be an object");
  }

  for (const field of ["schemaVersion", "artifactLayout", "hashSchema"] as const) {
    if (!Object.prototype.hasOwnProperty.call(descriptor, field)) {
      throw new PlanProtocolUnsupportedError(`plan.json protocol descriptor is missing ${field}`);
    }
  }

  const protocol = protocolMatches(descriptor, PLAN_PROTOCOL_V1)
    ? PLAN_PROTOCOL_V1
    : protocolMatches(descriptor, PLAN_PROTOCOL_V2)
      ? PLAN_PROTOCOL_V2
      : null;
  if (protocol === null || !capabilitiesAccept(capabilities, protocol)) {
    throw new PlanProtocolUnsupportedError("unsupported plan.json protocol descriptor");
  }
  return protocol;
}

/**
 * Validate that a directory is directly consumable by the legacy execution
 * functions. A v2 transport must be materialized first; rejecting it here
 * prevents readers from probing paths that have different meanings in v2.
 */
export function readPlanProtocolV1(
  planJson: unknown,
  capabilities: Readonly<PlanProtocolConsumerCapabilities> = DISTRIBUTED_RENDER_CAPABILITIES.roles
    .chunk,
): Readonly<PlanProtocolV1Descriptor> {
  const protocol = readPlanProtocol(planJson, capabilities);
  if (protocol !== PLAN_PROTOCOL_V1) {
    throw new PlanProtocolUnsupportedError(
      "content-addressed v2 plan must be materialized before v1 layout access",
    );
  }
  return PLAN_PROTOCOL_V1;
}
