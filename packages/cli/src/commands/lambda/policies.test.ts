import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  allRequiredActions,
  buildPolicyDocument,
  buildRoleTrustPolicy,
  validatePolicy,
} from "./policies.js";

let workdir: string;

beforeEach(() => {
  workdir = mkdtempSync(join(tmpdir(), "hf-lambda-policies-test-"));
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("policies — required actions", () => {
  it("flattens, dedupes, and sorts required actions", () => {
    const actions = allRequiredActions();
    // Sorted alphabetically.
    expect([...actions].sort()).toEqual(actions);
    // No dupes.
    expect(new Set(actions).size).toBe(actions.length);
    // Covers the obvious touchpoints.
    for (const must of [
      "cloudformation:CreateStack",
      "lambda:CreateFunction",
      "states:StartExecution",
      "s3:PutObject",
      "iam:CreateRole",
      "logs:CreateLogGroup",
      "cloudwatch:PutMetricAlarm",
    ]) {
      expect(actions).toContain(must);
    }
  });
});

describe("policies — buildPolicyDocument", () => {
  it("emits a single Allow statement over all required actions", () => {
    const doc = buildPolicyDocument();
    expect(doc.Version).toBe("2012-10-17");
    expect(doc.Statement).toHaveLength(1);
    const stmt = doc.Statement[0]!;
    expect(stmt.Effect).toBe("Allow");
    expect(stmt.Resource).toBe("*");
    expect(stmt.Action).toEqual(allRequiredActions());
  });
});

describe("policies — buildRoleTrustPolicy", () => {
  it("returns a sts:AssumeRole statement scoped to the requested service", () => {
    const trust = buildRoleTrustPolicy("cloudformation") as {
      Statement: { Action: string; Principal: { Service: string } }[];
    };
    expect(trust.Statement[0]!.Action).toBe("sts:AssumeRole");
    expect(trust.Statement[0]!.Principal.Service).toBe("cloudformation.amazonaws.com");
    const lambdaTrust = buildRoleTrustPolicy("lambda") as {
      Statement: { Principal: { Service: string } }[];
    };
    expect(lambdaTrust.Statement[0]!.Principal.Service).toBe("lambda.amazonaws.com");
  });
});

describe("policies — validatePolicy", () => {
  it("returns missing=[] for a policy with the full required set", () => {
    const path = writePolicy({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: allRequiredActions(),
          Resource: "*",
        },
      ],
    });
    const result = validatePolicy(path);
    expect(result.missing).toEqual([]);
    expect(result.granted).toEqual(allRequiredActions());
  });

  it("reports specific missing actions", () => {
    const path = writePolicy({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:GetObject", "states:StartExecution"],
          Resource: "*",
        },
      ],
    });
    const result = validatePolicy(path);
    expect(result.missing).toContain("cloudformation:CreateStack");
    expect(result.missing).toContain("lambda:CreateFunction");
    expect(result.granted).toContain("s3:GetObject");
    expect(result.granted).toContain("states:StartExecution");
  });

  it("expands service wildcards (s3:*)", () => {
    const path = writePolicy({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:*"],
          Resource: "*",
        },
      ],
    });
    const result = validatePolicy(path);
    // Every s3:* action in the required set is satisfied.
    for (const action of result.required.filter((a) => a.startsWith("s3:"))) {
      expect(result.granted).toContain(action);
    }
    // But lambda:* etc. are still missing.
    expect(result.missing).toContain("lambda:CreateFunction");
  });

  it("expands prefix wildcards (s3:Get*)", () => {
    const path = writePolicy({
      Version: "2012-10-17",
      Statement: [
        {
          Effect: "Allow",
          Action: ["s3:Get*"],
          Resource: "*",
        },
      ],
    });
    const result = validatePolicy(path);
    expect(result.granted).toContain("s3:GetObject");
    expect(result.granted).toContain("s3:GetBucketLocation");
    expect(result.missing).toContain("s3:PutObject");
  });

  it("expands the bare * wildcard", () => {
    const path = writePolicy({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: ["*"], Resource: "*" }],
    });
    const result = validatePolicy(path);
    expect(result.missing).toEqual([]);
  });

  it("accepts a single Statement object (not just an array)", () => {
    const path = writePolicy({
      Version: "2012-10-17",
      Statement: { Effect: "Allow", Action: ["*"], Resource: "*" },
    } as unknown as Parameters<typeof writePolicy>[0]);
    const result = validatePolicy(path);
    expect(result.missing).toEqual([]);
  });

  it("ignores Deny statements", () => {
    const path = writePolicy({
      Version: "2012-10-17",
      Statement: [
        { Effect: "Allow", Action: ["*"], Resource: "*" },
        { Effect: "Deny", Action: ["s3:DeleteBucket"], Resource: "*" },
      ],
    });
    const result = validatePolicy(path);
    // The Deny doesn't affect our static "granted" set — that's intentional.
    // IAM policy evaluation order is out of scope; we only confirm the
    // Allow set covers required actions.
    expect(result.missing).toEqual([]);
  });
});

function writePolicy(doc: { Version: string; Statement: unknown }): string {
  const path = join(workdir, "policy.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
}
