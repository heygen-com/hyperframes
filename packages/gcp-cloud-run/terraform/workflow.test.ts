import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse } from "yaml";

type Step = Record<string, unknown>;

const source = readFileSync(join(import.meta.dir, "workflow.yaml"), "utf-8");
const parseableSource = source.replace(/\$\{([^}]*)\}/g, (_match, expression: string) =>
  JSON.stringify(`\${${expression}}`),
);
const workflow = parse(parseableSource) as {
  main: { steps: Step[] };
  retryable: { steps: Step[] };
};

function namedStep(name: string, steps = workflow.main.steps): Record<string, unknown> {
  for (const step of steps) {
    if (name in step) return step[name] as Record<string, unknown>;
  }
  throw new Error(`missing workflow step ${name}`);
}

function requestBody(stepName: "plan" | "assemble"): Record<string, unknown> {
  return (namedStep(stepName).try as { args: { body: Record<string, unknown> } }).args.body;
}

function chunkRequestBody(): Record<string, unknown> {
  const renderChunks = namedStep("renderChunks").parallel as { for: { steps: Step[] } };
  const render = namedStep("renderOneChunk", renderChunks.for.steps);
  return (render.try as { args: { body: Record<string, unknown> } }).args.body;
}

describe("Cloud Workflows Plan v2 orchestration", () => {
  it("uses Plan v2 for every distributed action", () => {
    for (const body of [requestBody("plan"), chunkRequestBody(), requestBody("assemble")]) {
      expect(body.PlanProtocol).toBe("v2");
      expect(body).not.toHaveProperty("PlanGcsUri");
    }
    expect(chunkRequestBody()).toHaveProperty("PlanV2ManifestGcsUri");
    expect(chunkRequestBody()).toHaveProperty("PlanV2ArtifactGcsPrefix");
    expect(requestBody("assemble")).toMatchObject({ AudioGcsUri: null });
    expect(source).not.toContain("PlanProtocol: v1");
  });

  it("validates the v2 plan response before fan-out", () => {
    const validation = JSON.stringify(namedStep("validatePlanResult"));
    expect(validation).toContain("PlanV2ManifestGcsUri");
    expect(validation).toContain("PlanV2ArtifactGcsPrefix");
    expect(validation).toContain("PlanGcsUri");
    expect(validation).toContain("chunkCount > 0");
    expect(namedStep("invalidPlanResult")).toMatchObject({
      raise: { code: "PLAN_RESULT_INVALID" },
    });
  });

  it("pins OIDC tokens to the service and retries transient failures", () => {
    expect(source.match(/audience: \$\{serviceUrl\}/g)).toHaveLength(3);
    expect(JSON.stringify(workflow.retryable)).toContain("e.code == 403");
    expect(source.match(/max_retries: 6/g)).toHaveLength(1);
    expect(source.match(/max_retries: 4/g)).toHaveLength(2);
  });
});
