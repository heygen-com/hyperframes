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
      // SAM's --resolve-s3 managed bucket is encrypted; the deploy user must
      // be able to set/read that encryption or the first deploy rolls back.
      "s3:PutEncryptionConfiguration",
      "s3:GetEncryptionConfiguration",
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
  it("returns a sts:AssumeRole statement for the CloudFormation service principal", () => {
    const trust = buildRoleTrustPolicy();
    expect(trust.Statement[0]!.Action).toBe("sts:AssumeRole");
    expect(trust.Statement[0]!.Principal.Service).toBe("cloudformation.amazonaws.com");
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

  it("warns on NotAction shapes instead of producing a false negative", () => {
    const path = writePolicy({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", NotAction: ["iam:DeleteUser"], Resource: "*" }],
    } as unknown as Parameters<typeof writePolicy>[0]);
    const result = validatePolicy(path);
    expect(result.warnings.some((w) => /NotAction/.test(w))).toBe(true);
    // Without the warning, the validator would silently report everything
    // as missing. With it, the validator skips the statement and reports
    // honestly.
    expect(result.missing.length).toBeGreaterThan(0);
  });

  it("warns on NotResource shapes but still grants the listed actions", () => {
    const path = writePolicy({
      Version: "2012-10-17",
      Statement: [
        { Effect: "Allow", Action: ["*"], NotResource: ["arn:aws:s3:::secret-bucket/*"] },
      ],
    } as unknown as Parameters<typeof writePolicy>[0]);
    const result = validatePolicy(path);
    expect(result.warnings.some((w) => /NotResource/.test(w))).toBe(true);
    expect(result.missing).toEqual([]);
  });

  it("warns on mid-string wildcard patterns (`s3:Get*Object`)", () => {
    const path = writePolicy({
      Version: "2012-10-17",
      Statement: [{ Effect: "Allow", Action: ["s3:Get*Object"], Resource: "*" }],
    });
    const result = validatePolicy(path);
    expect(result.warnings.some((w) => /mid-string wildcard/.test(w))).toBe(true);
  });

  it("throws ENOENT for a missing file (caller decides UX)", () => {
    expect(() => validatePolicy(join(workdir, "does-not-exist.json"))).toThrow();
  });

  it("throws SyntaxError for malformed JSON (caller decides UX)", () => {
    const path = join(workdir, "bad.json");
    writeFileSync(path, "{ not json");
    expect(() => validatePolicy(path)).toThrow();
  });

  it("treats an absent Statement field as zero grants", () => {
    const path = writePolicy({ Version: "2012-10-17" } as unknown as Parameters<
      typeof writePolicy
    >[0]);
    const result = validatePolicy(path);
    expect(result.granted).toEqual([]);
    expect(result.missing).toEqual(allRequiredActions());
  });
});

function writePolicy(doc: { Version: string; Statement: unknown }): string {
  const path = join(workdir, "policy.json");
  writeFileSync(path, JSON.stringify(doc));
  return path;
}
