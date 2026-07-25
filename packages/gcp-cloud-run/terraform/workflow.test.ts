import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "bun:test";
import { parse } from "yaml";

type Step = Record<string, unknown>;

const source = readFileSync(join(import.meta.dir, "workflow.yaml"), "utf-8");
// Cloud Workflows expressions are valid to Google's parser but `${...}`
// inside YAML flow collections is not valid generic YAML. Quote expressions
// for structural parsing while preserving their text for contract assertions.
const parseableSource = source.replace(/\$\{([^}]*)\}/g, (_match, expression: string) =>
  JSON.stringify(`\${${expression}}`),
);
const workflow = parse(parseableSource) as {
  main: {
    steps: Step[];
  };
  retryable: {
    steps: Step[];
  };
};

function namedStep(name: string, steps = workflow.main.steps): Record<string, unknown> {
  for (const step of steps) {
    if (name in step) return step[name] as Record<string, unknown>;
  }
  throw new Error(`missing workflow step ${name}`);
}

function requestBody(stepName: string): Record<string, unknown> {
  const step = namedStep(stepName);
  const attempt = step.try as {
    args: {
      body: Record<string, unknown>;
    };
  };
  return attempt.args.body;
}

function requestAuth(stepName: string): Record<string, unknown> {
  const step = namedStep(stepName);
  const attempt = step.try as {
    args: {
      auth: Record<string, unknown>;
    };
  };
  return attempt.args.auth;
}

function chunkRequestBody(stepName: string): Record<string, unknown> {
  const renderChunks = namedStep("renderChunks");
  const parallel = renderChunks.parallel as {
    for: {
      steps: Step[];
    };
  };
  const step = namedStep(stepName, parallel.for.steps);
  const attempt = step.try as {
    args: {
      body: Record<string, unknown>;
    };
  };
  return attempt.args.body;
}

describe("Cloud Workflows plan protocol routing", () => {
  it("pins OIDC tokens to the Cloud Run root and retries IAM propagation", () => {
    for (const stepName of ["planV1", "planV2", "assembleV1", "assembleV2"]) {
      expect(requestAuth(stepName)).toEqual({
        type: "OIDC",
        audience: "${serviceUrl}",
      });
    }
    expect(JSON.stringify(workflow.retryable)).toContain("e.code == 403");
    expect(source.match(/max_retries: 6/g)).toHaveLength(2);
    expect(source.match(/max_retries: 4/g)).toHaveLength(4);
  });

  it("keeps v1 as the default and rejects unknown protocols before plan", () => {
    expect(source).toContain('default(map.get(args, "PlanProtocol"), "v1")');
    expect(namedStep("selectPlanProtocol")).toMatchObject({
      next: "unsupportedPlanProtocol",
    });
    expect(namedStep("unsupportedPlanProtocol")).toMatchObject({
      raise: {
        code: "PLAN_PROTOCOL_UNSUPPORTED",
      },
    });
  });

  it("uses disjoint v1 and v2 plan request/response contracts", () => {
    expect(requestBody("planV1")).toMatchObject({
      Action: "plan",
      PlanProtocol: "v1",
    });
    expect(requestBody("planV2")).toMatchObject({
      Action: "plan",
      PlanProtocol: "v2",
    });
    const validation = JSON.stringify(namedStep("validatePlanResult"));
    expect(validation).toContain("PlanGcsUri");
    expect(validation).toContain("PlanV2ManifestGcsUri");
    expect(validation).toContain("PlanV2ArtifactGcsPrefix");
    expect(source).toContain('not("PlanGcsUri" in planResult)');
    expect(source).toContain(
      '(not("PlanProtocol" in planResult) or planResult.PlanProtocol == "v1")',
    );
  });

  it("never mixes v1 and v2 chunk locators", () => {
    const v1 = chunkRequestBody("renderOneChunkV1");
    expect(v1).toMatchObject({
      Action: "renderChunk",
      PlanProtocol: "v1",
    });
    expect(v1).toHaveProperty("PlanGcsUri");
    expect(v1).not.toHaveProperty("PlanV2ManifestGcsUri");
    expect(v1).not.toHaveProperty("PlanV2ArtifactGcsPrefix");

    const v2 = chunkRequestBody("renderOneChunkV2");
    expect(v2).toMatchObject({
      Action: "renderChunk",
      PlanProtocol: "v2",
    });
    expect(v2).not.toHaveProperty("PlanGcsUri");
    expect(v2).toHaveProperty("PlanV2ManifestGcsUri");
    expect(v2).toHaveProperty("PlanV2ArtifactGcsPrefix");
    expect(v2).toHaveProperty("PlanHash");
  });

  it("never mixes v1 and v2 assembler locators", () => {
    const v1 = requestBody("assembleV1");
    expect(v1).toHaveProperty("PlanGcsUri");
    expect(v1).not.toHaveProperty("PlanV2ManifestGcsUri");
    expect(v1).not.toHaveProperty("PlanV2ArtifactGcsPrefix");

    const v2 = requestBody("assembleV2");
    expect(v2).not.toHaveProperty("PlanGcsUri");
    expect(v2).toHaveProperty("PlanV2ManifestGcsUri");
    expect(v2).toHaveProperty("PlanV2ArtifactGcsPrefix");
    expect(v2).toHaveProperty("PlanHash");
    expect(v2).toMatchObject({
      PlanProtocol: "v2",
      AudioGcsUri: null,
    });
  });
});
