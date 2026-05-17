/**
 * Contract tests for {@link HyperframesRenderStack}.
 *
 * The snapshot test (in this directory's sibling `.snapshot.test.ts`)
 * guards the full CloudFormation shape. The contract tests below pin
 * the few properties whose drift would cause a real production
 * regression — wrong Lambda runtime, lost reserved-concurrency knob,
 * missing alarms — so we get a high-signal failure independent of
 * the snapshot.
 */

import { beforeAll, describe, it } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { App, Stack } from "aws-cdk-lib";
import { Template } from "aws-cdk-lib/assertions";
import { HyperframesRenderStack } from "./HyperframesRenderStack.js";

// CDK synth is slow on cold start (~5-8s on the slowest CI runner). The
// default bun:test 5s timeout trips the first `it()` that calls it. Cache
// the default-args synth in `beforeAll` so each test is pure assertions.
// Tests that need non-default props still synth on demand and bump their
// own per-test timeout.
let DEFAULT_TEMPLATE: Template;

function synthFixture(): Template {
  const zipDir = mkdtempSync(join(tmpdir(), "hf-cdk-test-"));
  const zipPath = join(zipDir, "handler.zip");
  writeFileSync(zipPath, "fake zip bytes");
  const app = new App();
  const stack = new Stack(app, "TestStack");
  new HyperframesRenderStack(stack, "Render", { handlerZipPath: zipPath });
  return Template.fromStack(stack);
}

describe("HyperframesRenderStack — contract", () => {
  beforeAll(() => {
    DEFAULT_TEMPLATE = synthFixture();
  }, 30000);

  it("provisions exactly one Lambda function on the Node.js 22 runtime, x86_64, 10 GiB /tmp", () => {
    const t = DEFAULT_TEMPLATE;
    t.resourceCountIs("AWS::Lambda::Function", 1);
    t.hasResourceProperties("AWS::Lambda::Function", {
      Runtime: "nodejs22.x",
      Architectures: ["x86_64"],
      EphemeralStorage: { Size: 10240 },
      MemorySize: 10240,
      Handler: "handler.handler",
    });
  });

  it("provisions exactly one Step Functions state machine of type STANDARD with tracing on", () => {
    const t = DEFAULT_TEMPLATE;
    t.resourceCountIs("AWS::StepFunctions::StateMachine", 1);
    t.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineType: "STANDARD",
      TracingConfiguration: { Enabled: true },
    });
  });

  it("provisions exactly one S3 bucket with PublicAccessBlockConfiguration and a 7-day intermediates lifecycle", () => {
    const t = DEFAULT_TEMPLATE;
    t.resourceCountIs("AWS::S3::Bucket", 1);
    t.hasResourceProperties("AWS::S3::Bucket", {
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true,
        BlockPublicPolicy: true,
        IgnorePublicAcls: true,
        RestrictPublicBuckets: true,
      },
      LifecycleConfiguration: {
        Rules: [
          {
            Id: "ExpireIntermediates",
            Status: "Enabled",
            Prefix: "renders/",
            ExpirationInDays: 7,
          },
        ],
      },
    });
  });

  it("provisions the three CloudWatch alarms (runaway invocations, Lambda Errors, SFN ExecutionsFailed)", () => {
    const t = DEFAULT_TEMPLATE;
    t.resourceCountIs("AWS::CloudWatch::Alarm", 3);
    t.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Invocations",
      Period: 3600,
      Threshold: 1000,
    });
    t.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "Errors",
      Threshold: 1,
    });
    t.hasResourceProperties("AWS::CloudWatch::Alarm", {
      MetricName: "ExecutionsFailed",
      Threshold: 1,
    });
  });

  // These two synth fresh stacks (non-default props), so they pay the
  // synth cost individually. Bump per-test timeout so a slow CI runner
  // doesn't trip the default 5s.
  it("honours reservedConcurrency when supplied", () => {
    const zipDir = mkdtempSync(join(tmpdir(), "hf-cdk-test-"));
    writeFileSync(join(zipDir, "handler.zip"), "fake");
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new HyperframesRenderStack(stack, "Render", {
      handlerZipPath: join(zipDir, "handler.zip"),
      reservedConcurrency: 4,
    });
    const t = Template.fromStack(stack);
    t.hasResourceProperties("AWS::Lambda::Function", {
      ReservedConcurrentExecutions: 4,
    });
  }, 30000);

  it("uses the projectName prefix on function + state-machine names", () => {
    const zipDir = mkdtempSync(join(tmpdir(), "hf-cdk-test-"));
    writeFileSync(join(zipDir, "handler.zip"), "fake");
    const app = new App();
    const stack = new Stack(app, "TestStack");
    new HyperframesRenderStack(stack, "Render", {
      handlerZipPath: join(zipDir, "handler.zip"),
      projectName: "demo",
    });
    const t = Template.fromStack(stack);
    t.hasResourceProperties("AWS::Lambda::Function", { FunctionName: "demo-render" });
    t.hasResourceProperties("AWS::StepFunctions::StateMachine", {
      StateMachineName: "demo-render",
    });
  }, 30000);
});
