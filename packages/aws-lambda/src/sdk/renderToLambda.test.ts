import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SFNClient } from "@aws-sdk/client-sfn";
import type { SerializableDistributedRenderConfig } from "../events.js";
import { SITE_MANIFEST_INVALID } from "../siteManifest.js";
import { asS3Client, FakeS3 } from "./__fixtures__/fakeS3.js";
import { deploySite, type SiteHandle, siteHandleFromId } from "./deploySite.js";
import { renderToLambda } from "./renderToLambda.js";
import { InvalidConfigError } from "./validateConfig.js";

interface CapturedStart {
  stateMachineArn: string;
  name: string;
  input: unknown;
}

const CURRENT_DEFINITION = JSON.stringify({
  States: { PlanV2: { Retry: [{ ErrorEquals: [SITE_MANIFEST_INVALID], MaxAttempts: 0 }] } },
});

class FakeSFN {
  starts: CapturedStart[] = [];
  definition = CURRENT_DEFINITION;
  async send(command: unknown): Promise<unknown> {
    const cmdName = (command as { constructor: { name: string } }).constructor.name;
    if (cmdName === "DescribeStateMachineCommand") return { definition: this.definition };
    if (cmdName === "StartExecutionCommand") {
      const input = (command as { input: { stateMachineArn: string; name: string; input: string } })
        .input;
      this.starts.push({
        stateMachineArn: input.stateMachineArn,
        name: input.name,
        input: JSON.parse(input.input),
      });
      return {
        executionArn: `arn:aws:states:us-east-1:1234:execution:hf:${input.name}`,
        startDate: new Date(),
      };
    }
    throw new Error(`FakeSFN: unexpected command ${cmdName}`);
  }
}

function asSFNClient(fake: { send(command: unknown): Promise<unknown> }): SFNClient {
  return fake as unknown as SFNClient;
}

const baseConfig: SerializableDistributedRenderConfig = {
  fps: 30,
  width: 1280,
  height: 720,
  format: "mp4",
};

let projectDir: string;

beforeEach(() => {
  projectDir = mkdtempSync(join(tmpdir(), "hf-render-test-"));
  writeFileSync(join(projectDir, "index.html"), "<html></html>");
});

afterEach(() => {
  rmSync(projectDir, { recursive: true, force: true });
});

describe("renderToLambda", () => {
  it("returns a handle and starts a state-machine execution with the right input", async () => {
    const sfn = new FakeSFN();
    const s3 = new FakeS3();
    const handle = await renderToLambda({
      projectDir,
      bucketName: "test-bucket",
      stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
      config: baseConfig,
      executionName: "smoke-1",
      sfn: asSFNClient(sfn),
      s3: asS3Client(s3),
    });

    expect(handle.renderId).toBe("smoke-1");
    expect(handle.executionArn).toContain("smoke-1");
    expect(handle.bucketName).toBe("test-bucket");
    expect(handle.outputS3Uri).toBe("s3://test-bucket/renders/smoke-1/output.mp4");
    expect(handle.projectS3Uri).toMatch(/^s3:\/\/test-bucket\/sites\/[0-9a-f]{16}\/files\.json$/);
    expect(Object.keys(handle)).toEqual([
      "renderId",
      "executionArn",
      "bucketName",
      "stateMachineArn",
      "outputS3Uri",
      "projectS3Uri",
      "startedAt",
    ]);

    expect(sfn.starts).toHaveLength(1);
    const start = sfn.starts[0]!;
    expect(start.name).toBe("smoke-1");
    expect(start.stateMachineArn).toBe("arn:aws:states:us-east-1:1234:stateMachine:hf");
    expect(start.input).toEqual({
      ProjectS3Uri: handle.projectS3Uri,
      PlanOutputS3Prefix: "s3://test-bucket/renders/smoke-1/",
      OutputS3Uri: "s3://test-bucket/renders/smoke-1/output.mp4",
      Config: baseConfig,
      PlanProtocol: "v2",
    });
  });

  it("preserves explicit plan protocol v1 compatibility", async () => {
    const sfn = new FakeSFN();
    const s3 = new FakeS3();
    const handle = await renderToLambda({
      projectDir,
      bucketName: "test-bucket",
      stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
      config: baseConfig,
      executionName: "smoke-v1",
      planProtocol: "v1",
      sfn: asSFNClient(sfn),
      s3: asS3Client(s3),
    });

    expect(sfn.starts[0]?.input).toEqual({
      ProjectS3Uri: handle.projectS3Uri,
      PlanOutputS3Prefix: "s3://test-bucket/renders/smoke-v1/",
      OutputS3Uri: "s3://test-bucket/renders/smoke-v1/output.mp4",
      Config: baseConfig,
      PlanProtocol: "v1",
    });
  });

  it("derives the file extension from config.format", async () => {
    const sfn = new FakeSFN();
    const s3 = new FakeS3();
    const handle = await renderToLambda({
      projectDir,
      bucketName: "test-bucket",
      stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
      config: { ...baseConfig, format: "mov" },
      executionName: "smoke-mov",
      sfn: asSFNClient(sfn),
      s3: asS3Client(s3),
    });
    expect(handle.outputS3Uri).toBe("s3://test-bucket/renders/smoke-mov/output.mov");
  });

  it("reuses a supplied siteHandle (no deploy)", async () => {
    const sfn = new FakeSFN();
    const s3 = new FakeS3();
    const prebuilt: SiteHandle = {
      siteId: "prebaked",
      bucketName: "test-bucket",
      projectS3Uri: "s3://test-bucket/sites/prebaked/project.tar.gz",
      bytes: 4096,
      uploadedAt: "2026-05-16T00:00:00Z",
      uploaded: true,
    };
    const handle = await renderToLambda({
      siteHandle: prebuilt,
      bucketName: "test-bucket",
      stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
      config: baseConfig,
      executionName: "smoke-reuse",
      sfn: asSFNClient(sfn),
      s3: asS3Client(s3),
    });
    expect(handle.projectS3Uri).toBe(prebuilt.projectS3Uri);
    // No HEAD/PUT means s3.existing stayed empty.
    expect(s3.existing.size).toBe(0);
  });

  it("refuses a stack deployed before files.json sites before uploading or starting", async () => {
    const sfn = new FakeSFN();
    sfn.definition = JSON.stringify({ States: { PlanV2: { Retry: [] } } });
    const s3 = new FakeS3();
    await expect(
      renderToLambda({
        projectDir,
        bucketName: "test-bucket",
        stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
        config: baseConfig,
        sfn: asSFNClient(sfn),
        s3: asS3Client(s3),
      }),
    ).rejects.toMatchObject({
      name: "STACK_TOO_OLD",
      message: expect.stringContaining("hyperframes lambda deploy"),
    });
    expect(s3.ops).toHaveLength(0);
    expect(sfn.starts).toHaveLength(0);
  });

  describe("with a site id from before files.json", () => {
    const renderSite = (s3: FakeS3, sfn: FakeSFN, siteId: string) =>
      renderToLambda({
        siteHandle: siteHandleFromId("test-bucket", siteId),
        bucketName: "test-bucket",
        stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
        config: baseConfig,
        sfn: asSFNClient(sfn),
        s3: asS3Client(s3),
      });

    it("renders its project.tar.gz", async () => {
      const s3 = new FakeS3();
      const sfn = new FakeSFN();
      s3.existing.add("test-bucket/sites/oldsite/project.tar.gz");
      const handle = await renderSite(s3, sfn, "oldsite");
      expect(handle.projectS3Uri).toBe("s3://test-bucket/sites/oldsite/project.tar.gz");
      expect(sfn.starts[0]?.input).toMatchObject({ ProjectS3Uri: handle.projectS3Uri });
    });

    it("names both keys and the fix when neither exists, before starting", async () => {
      const s3 = new FakeS3();
      const sfn = new FakeSFN();
      await expect(renderSite(s3, sfn, "gone")).rejects.toMatchObject({
        name: "SITE_NOT_FOUND",
        message: expect.stringMatching(
          /sites\/gone\/files\.json.*sites\/gone\/project\.tar\.gz.*sites create/,
        ),
      });
      expect(sfn.starts).toHaveLength(0);
    });
  });

  describe("with a site whose files expired from the content store", () => {
    async function deployThenExpire(s3: FakeS3): Promise<{ site: SiteHandle; expiredKey: string }> {
      const site = await deploySite({ projectDir, bucketName: "test-bucket", s3: asS3Client(s3) });
      const expiredKey = [...s3.existing].find((id) => id.includes("/cas/sha256/"))!;
      s3.existing.delete(expiredKey);
      s3.ops.length = 0;
      return { site, expiredKey };
    }
    const renderWith = (s3: FakeS3, sfn: FakeSFN, site: SiteHandle, dir?: string) =>
      renderToLambda({
        siteHandle: site,
        projectDir: dir,
        bucketName: "test-bucket",
        stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
        config: baseConfig,
        sfn: asSFNClient(sfn),
        s3: asS3Client(s3),
      });

    it("re-uploads the expired file from the project dir, then renders", async () => {
      const s3 = new FakeS3();
      const sfn = new FakeSFN();
      const { site, expiredKey } = await deployThenExpire(s3);
      await renderWith(s3, sfn, site, projectDir);
      expect(
        s3.ops.filter((op) => op.kind === "put").map((op) => `${op.bucket}/${op.key}`),
      ).toEqual([expiredKey]);
      expect(sfn.starts).toHaveLength(1);
    });

    it("refuses when the project dir's copy differs or is gone, uploading nothing", async () => {
      const s3 = new FakeS3();
      const sfn = new FakeSFN();
      const { site } = await deployThenExpire(s3);
      writeFileSync(join(projectDir, "index.html"), "<html>edited</html>");
      await expect(renderWith(s3, sfn, site, projectDir)).rejects.toMatchObject({
        name: "SITE_FILES_MISSING",
      });
      rmSync(join(projectDir, "index.html"));
      await expect(renderWith(s3, sfn, site, projectDir)).rejects.toMatchObject({
        name: "SITE_FILES_MISSING",
      });
      expect(s3.ops.filter((op) => op.kind === "put")).toHaveLength(0);
      expect(sfn.starts).toHaveLength(0);
    });

    it("without a project dir, refuses with the missing-file count before starting", async () => {
      const s3 = new FakeS3();
      const sfn = new FakeSFN();
      const { site } = await deployThenExpire(s3);
      await expect(renderWith(s3, sfn, site)).rejects.toMatchObject({
        name: "SITE_FILES_MISSING",
        message: expect.stringContaining("1 of 1 files"),
      });
      expect(sfn.starts).toHaveLength(0);
    });
  });

  it("rejects invalid configs synchronously before any AWS call", async () => {
    const sfn = new FakeSFN();
    const s3 = new FakeS3();
    try {
      await renderToLambda({
        projectDir,
        bucketName: "test-bucket",
        stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
        config: { ...baseConfig, fps: 50 as never },
        sfn: asSFNClient(sfn),
        s3: asS3Client(s3),
      });
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(InvalidConfigError);
    }
    expect(sfn.starts).toHaveLength(0);
  });

  it("requires either siteHandle or projectDir", async () => {
    const sfn = new FakeSFN();
    const s3 = new FakeS3();
    await expect(
      renderToLambda({
        bucketName: "test-bucket",
        stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
        config: baseConfig,
        sfn: asSFNClient(sfn),
        s3: asS3Client(s3),
      }),
    ).rejects.toThrow(/either siteHandle or projectDir/);
  });

  it("auto-generates an executionName when omitted", async () => {
    const sfn = new FakeSFN();
    const s3 = new FakeS3();
    const handle = await renderToLambda({
      projectDir,
      bucketName: "test-bucket",
      stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
      config: baseConfig,
      sfn: asSFNClient(sfn),
      s3: asS3Client(s3),
    });
    expect(handle.renderId).toMatch(/^hf-render-[0-9a-f-]{36}$/);
  });

  it("threads variables through the Step Functions execution input", async () => {
    const sfn = new FakeSFN();
    const s3 = new FakeS3();
    const variables = { title: "Hello Alice", accent: "#ff0000" };
    await renderToLambda({
      projectDir,
      bucketName: "test-bucket",
      stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
      config: { ...baseConfig, variables },
      executionName: "smoke-variables",
      sfn: asSFNClient(sfn),
      s3: asS3Client(s3),
    });
    expect(sfn.starts).toHaveLength(1);
    const start = sfn.starts[0]!;
    // The execution input carries the variables under Config.variables —
    // the Step Functions state machine forwards `Config` verbatim into the
    // PlanEvent's `Config` field, where the handler spreads it into the
    // producer's DistributedRenderConfig.
    const input = start.input as { Config: { variables?: Record<string, unknown> } };
    expect(input.Config.variables).toEqual(variables);
  });

  it("rejects a config whose variables blob would push the execution input over 256 KiB", async () => {
    const sfn = new FakeSFN();
    const s3 = new FakeS3();
    const huge = "x".repeat(260 * 1024);
    await expect(
      renderToLambda({
        projectDir,
        bucketName: "test-bucket",
        stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
        config: { ...baseConfig, variables: { blob: huge } },
        executionName: "smoke-too-big",
        sfn: asSFNClient(sfn),
        s3: asS3Client(s3),
      }),
    ).rejects.toThrow(/256.*KiB|templates-on-lambda/);
    // The reject must happen BEFORE StartExecution — uncaught oversize input
    // surfaces as States.DataLimitExceeded 50ms in, far from this call site.
    expect(sfn.starts).toHaveLength(0);
  });

  it("rejects a config whose variables contain non-JSON-safe values", async () => {
    const sfn = new FakeSFN();
    const s3 = new FakeS3();
    await expect(
      renderToLambda({
        projectDir,
        bucketName: "test-bucket",
        stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
        config: {
          ...baseConfig,
          // BigInt would throw at JSON.stringify time; catch it at the validator
          // boundary with a typed error instead.
          variables: { count: 9_007_199_254_740_993n } as unknown as Record<string, unknown>,
        },
        executionName: "smoke-bigint",
        sfn: asSFNClient(sfn),
        s3: asS3Client(s3),
      }),
    ).rejects.toThrow(InvalidConfigError);
    expect(sfn.starts).toHaveLength(0);
  });

  it("has a troubleshooting entry for every error it raises before starting", () => {
    const docs = readFileSync(
      new URL("../../../../docs/deploy/aws-lambda.mdx", import.meta.url),
      "utf8",
    );
    for (const name of ["STACK_TOO_OLD", "SITE_FILES_MISSING", "SITE_NOT_FOUND"]) {
      expect({ name, documented: new RegExp(`^### .*\`${name}\``, "m").test(docs) }).toEqual({
        name,
        documented: true,
      });
    }
  });

  it("propagates a missing executionArn as an error", async () => {
    const sfn = {
      async send(_cmd: unknown): Promise<unknown> {
        return { executionArn: undefined, definition: CURRENT_DEFINITION };
      },
    };
    const s3 = new FakeS3();
    await expect(
      renderToLambda({
        projectDir,
        bucketName: "test-bucket",
        stateMachineArn: "arn:aws:states:us-east-1:1234:stateMachine:hf",
        config: baseConfig,
        sfn: asSFNClient(sfn),
        s3: asS3Client(s3),
      }),
    ).rejects.toThrow(/no executionArn/);
  });
});
