/**
 * `hyperframes lambda policies role|user|validate` — IAM bootstrap.
 *
 * Emit the minimum permissions an adopter needs to deploy, invoke, and
 * tear down the Lambda render stack. Without this, the typical first
 * attempt at `hyperframes lambda deploy` is `User is not authorized to
 * perform iam:CreateRole on resource ...` and a 30-minute detour to
 * write the policy by hand.
 *
 * The action lists are derived from what {@link examples/aws-lambda/template.yaml}
 * needs to create, plus what `renderToLambda`/`getRenderProgress`
 * call against S3 + Step Functions at runtime. The lists are
 * deliberately union'd rather than scoped per-verb — the CLI today
 * runs every verb against the same credential, so anything narrower
 * just makes adopters debug "missing permission" errors per verb.
 *
 * `validate` reads an existing IAM policy doc and diffs it against the
 * required action set, printing what's missing. Useful in CI: emit
 * the doc with `policies user`, drift over time, then prove the
 * checked-in policy still covers the CLI's needs with `policies validate`.
 */

import { readFileSync } from "node:fs";
import { c } from "../../ui/colors.js";
import { normalizeErrorMessage } from "../../utils/errorMessage.js";

export type PoliciesVerb = "role" | "user" | "validate";

interface PolicyStatement {
  Effect: "Allow";
  Action: string[];
  Resource: string | string[];
}

interface PolicyDocument {
  Version: "2012-10-17";
  Statement: PolicyStatement[];
}

/**
 * Trust-policy shape consumed by `policies role`. Has a `Principal`
 * field (which generic `PolicyStatement` does not model) — keep it as
 * a separate type rather than polluting the action-policy shape.
 */
interface TrustPolicyStatement {
  Effect: "Allow";
  Principal: { Service: string };
  Action: "sts:AssumeRole";
}

interface TrustPolicyDocument {
  Version: "2012-10-17";
  Statement: TrustPolicyStatement[];
}

/**
 * Actions the CLI needs to deploy/invoke/destroy the stack. Keep this
 * sorted alphabetically inside each service so diffs stay readable.
 */
const REQUIRED_ACTIONS = {
  cloudformation: [
    "cloudformation:CreateChangeSet",
    "cloudformation:CreateStack",
    "cloudformation:DeleteChangeSet",
    "cloudformation:DeleteStack",
    "cloudformation:DescribeChangeSet",
    "cloudformation:DescribeStackEvents",
    "cloudformation:DescribeStackResource",
    "cloudformation:DescribeStackResources",
    "cloudformation:DescribeStacks",
    "cloudformation:ExecuteChangeSet",
    "cloudformation:GetTemplate",
    "cloudformation:GetTemplateSummary",
    "cloudformation:ListStacks",
    "cloudformation:UpdateStack",
    "cloudformation:ValidateTemplate",
  ],
  cloudwatchAlarms: [
    "cloudwatch:DeleteAlarms",
    "cloudwatch:DescribeAlarms",
    "cloudwatch:PutMetricAlarm",
  ],
  iam: [
    "iam:AttachRolePolicy",
    "iam:CreateRole",
    "iam:DeleteRole",
    "iam:DeleteRolePolicy",
    "iam:DetachRolePolicy",
    "iam:GetRole",
    "iam:GetRolePolicy",
    "iam:PassRole",
    "iam:PutRolePolicy",
    "iam:TagRole",
    "iam:UntagRole",
  ],
  lambda: [
    "lambda:AddPermission",
    "lambda:CreateFunction",
    "lambda:DeleteFunction",
    "lambda:GetFunction",
    "lambda:GetFunctionConfiguration",
    "lambda:InvokeFunction",
    "lambda:ListFunctions",
    "lambda:PutFunctionConcurrency",
    "lambda:RemovePermission",
    "lambda:TagResource",
    "lambda:UntagResource",
    "lambda:UpdateFunctionCode",
    "lambda:UpdateFunctionConfiguration",
  ],
  logs: [
    "logs:CreateLogGroup",
    "logs:DeleteLogGroup",
    "logs:DescribeLogGroups",
    "logs:PutRetentionPolicy",
    "logs:TagResource",
  ],
  s3Bucket: [
    "s3:CreateBucket",
    "s3:DeleteBucket",
    "s3:DeleteBucketPolicy",
    "s3:GetBucketLocation",
    "s3:GetBucketPolicy",
    "s3:GetBucketTagging",
    "s3:GetBucketVersioning",
    "s3:GetLifecycleConfiguration",
    "s3:ListAllMyBuckets",
    "s3:ListBucket",
    "s3:PutBucketPolicy",
    "s3:PutBucketTagging",
    "s3:PutBucketVersioning",
    "s3:PutLifecycleConfiguration",
    "s3:PutPublicAccessBlock",
  ],
  s3Object: ["s3:DeleteObject", "s3:GetObject", "s3:PutObject"],
  states: [
    "states:CreateStateMachine",
    "states:DeleteStateMachine",
    "states:DescribeExecution",
    "states:DescribeStateMachine",
    "states:GetExecutionHistory",
    "states:ListExecutions",
    "states:ListStateMachines",
    "states:StartExecution",
    "states:StopExecution",
    "states:TagResource",
    "states:UntagResource",
    "states:UpdateStateMachine",
  ],
};

/** All required actions flattened, deduped, sorted. */
export function allRequiredActions(): string[] {
  const set = new Set<string>();
  for (const group of Object.values(REQUIRED_ACTIONS)) {
    for (const action of group) set.add(action);
  }
  return [...set].sort();
}

/**
 * Emit a single, broad `Allow *` policy doc. Resource is `*` because the
 * CloudFormation stack creates a new function/state-machine/bucket on
 * every adopter's account; scoping by name requires the adopter to
 * have already deployed, which is exactly what they're trying to do.
 *
 * Adopters with stricter security postures should narrow the Resource
 * scope after the first successful deploy — the SAM template + CDK
 * construct both produce predictable ARN patterns.
 */
export function buildPolicyDocument(): PolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Action: allRequiredActions(),
        Resource: "*",
      },
    ],
  };
}

/**
 * Trust policy for a CloudFormation service role (used by `policies role`).
 * Lambda execution roles are out of scope here: the SAM template creates
 * its own scoped execution role, and emitting a `lambda.amazonaws.com`
 * trust paired with the full deploy-superset inline policy below would
 * be a confusingly-overscoped runtime role no human should attach.
 */
export function buildRoleTrustPolicy(): TrustPolicyDocument {
  return {
    Version: "2012-10-17",
    Statement: [
      {
        Effect: "Allow",
        Principal: { Service: "cloudformation.amazonaws.com" },
        Action: "sts:AssumeRole",
      },
    ],
  };
}

export interface PoliciesArgs {
  verb: PoliciesVerb;
  /** For `validate`: path to an IAM policy JSON file. */
  inputPath?: string;
  /** Print JSON only. Default true for `role`/`user` (output is JSON by definition); ignored for `validate`. */
  json: boolean;
}

export async function runPolicies(args: PoliciesArgs): Promise<void> {
  switch (args.verb) {
    case "user": {
      const doc = buildPolicyDocument();
      console.log(JSON.stringify(doc, null, 2));
      if (!args.json) {
        console.error(
          c.dim(
            "\n# Attach the above as an inline policy to the IAM user/role that runs `hyperframes lambda *`.\n# Scope `Resource` to your stack's ARNs after the first successful deploy.",
          ),
        );
      }
      return;
    }
    case "role": {
      const trust = buildRoleTrustPolicy();
      const inline = buildPolicyDocument();
      const wrapped = {
        TrustRelationship: trust,
        InlinePolicy: inline,
      };
      console.log(JSON.stringify(wrapped, null, 2));
      return;
    }
    case "validate": {
      if (!args.inputPath) {
        const msg =
          "[lambda policies validate] usage: hyperframes lambda policies validate <policy.json>";
        if (args.json) {
          console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
          process.exitCode = 1;
          return;
        }
        throw new Error(msg);
      }
      let result: ValidateResult;
      try {
        result = validatePolicy(args.inputPath);
      } catch (err) {
        const msg = normalizeErrorMessage(err);
        if (args.json) {
          console.log(JSON.stringify({ ok: false, error: msg }, null, 2));
          process.exitCode = 1;
          return;
        }
        console.error(c.error(`Failed to validate ${args.inputPath}: ${msg}`));
        process.exitCode = 1;
        return;
      }
      if (args.json) {
        console.log(JSON.stringify({ ok: result.missing.length === 0, ...result }, null, 2));
        if (result.missing.length > 0) process.exitCode = 1;
        return;
      }
      for (const warning of result.warnings) {
        console.warn(c.dim(`Warning: ${warning}`));
      }
      if (result.missing.length === 0) {
        console.log(c.success(`Policy covers all ${result.required.length} required actions.`));
        return;
      }
      console.log(c.error(`Policy is missing ${result.missing.length} required action(s):`));
      for (const action of result.missing) {
        console.log(`  • ${action}`);
      }
      console.log();
      console.log(
        c.dim("Run `hyperframes lambda policies user` to print the full required policy."),
      );
      process.exitCode = 1;
      return;
    }
  }
}

export interface ValidateResult {
  required: string[];
  granted: string[];
  missing: string[];
  /** Non-fatal warnings about policy shapes we couldn't fully evaluate. */
  warnings: string[];
}

/**
 * Parse an IAM policy doc + flatten its Allow statements into a set of
 * "granted" actions. Returns the difference vs {@link allRequiredActions}.
 *
 * Supports the common shapes: `Action` as a string or array; `Statement`
 * as a single object or an array; wildcards (`s3:*`, `s3:Get*`, `*`)
 * expand to match anything in the required list.
 *
 * Limitations surfaced as `warnings`:
 *   - `NotAction` / `NotResource` shapes — IAM grants the complement of
 *     the listed actions, but a sound check would need to model the
 *     full IAM action namespace. We flag the statement instead of
 *     producing a false negative.
 *   - Mid-string wildcards (`s3:Get*Object`, `?`) — supported by IAM,
 *     not by our matcher. We end-anchor only.
 */
export function validatePolicy(policyPath: string): ValidateResult {
  const raw = readFileSync(policyPath, "utf-8");
  const parsed = JSON.parse(raw) as { Statement?: unknown };
  const statements: Array<{
    Effect?: string;
    Action?: unknown;
    NotAction?: unknown;
    NotResource?: unknown;
  }> = Array.isArray(parsed.Statement)
    ? (parsed.Statement as {
        Effect?: string;
        Action?: unknown;
        NotAction?: unknown;
        NotResource?: unknown;
      }[])
    : parsed.Statement
      ? [
          parsed.Statement as {
            Effect?: string;
            Action?: unknown;
            NotAction?: unknown;
            NotResource?: unknown;
          },
        ]
      : [];

  const grantedPatterns: string[] = [];
  const warnings: string[] = [];
  for (const stmt of statements) {
    if (stmt.Effect !== "Allow") continue;
    if (stmt.NotAction !== undefined) {
      warnings.push(
        "Allow statement uses NotAction; the validator only checks positive Action grants, so this statement is being ignored. Convert to an explicit Action list to validate it.",
      );
      continue;
    }
    if (stmt.NotResource !== undefined) {
      warnings.push(
        "Allow statement uses NotResource; resource-scoping is not modelled by this validator. Treating the statement as fully granted on its Action set.",
      );
    }
    const actions = stmt.Action;
    if (typeof actions === "string") {
      grantedPatterns.push(actions);
    } else if (Array.isArray(actions)) {
      for (const a of actions) if (typeof a === "string") grantedPatterns.push(a);
    }
  }

  for (const pattern of grantedPatterns) {
    if (hasMidStringWildcard(pattern)) {
      warnings.push(
        `Action pattern ${JSON.stringify(pattern)} contains a mid-string wildcard the validator can't expand; only end-anchored wildcards (\`*\`, \`service:*\`, \`prefix*\`) are honoured.`,
      );
    }
  }

  const required = allRequiredActions();
  const granted: string[] = [];
  const missing: string[] = [];
  for (const action of required) {
    if (grantedPatterns.some((pattern) => actionMatches(pattern, action))) {
      granted.push(action);
    } else {
      missing.push(action);
    }
  }
  return { required, granted, missing, warnings };
}

function hasMidStringWildcard(pattern: string): boolean {
  // Wildcards we DO support: bare `*`, `service:*`, `prefix*` (single
  // trailing `*`). Anything else (mid-string `*` or `?`) is mid-string.
  if (pattern === "*") return false;
  if (pattern.endsWith(":*")) return false;
  if (pattern.endsWith("*") && !pattern.slice(0, -1).includes("*")) return false;
  return pattern.includes("*") || pattern.includes("?");
}

function actionMatches(pattern: string, action: string): boolean {
  if (pattern === "*") return true;
  if (pattern === action) return true;
  // `s3:*` matches `s3:GetObject` etc.
  if (pattern.endsWith(":*")) {
    const service = pattern.slice(0, -2);
    return action.startsWith(`${service}:`);
  }
  // Single trailing `*` wildcard ("s3:Get*").
  if (pattern.endsWith("*")) {
    return action.startsWith(pattern.slice(0, -1));
  }
  return false;
}
