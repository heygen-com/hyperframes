/**
 * `renderToCloudRun` unit tests — argument assembly, required-field
 * validation, and the CreateExecution call over a fake ExecutionsClient.
 */

import { describe, expect, it } from "bun:test";
import type { SerializableDistributedRenderConfig } from "../events.js";
import { type ExecutionsClientLike, renderToCloudRun } from "./renderToCloudRun.js";
import type { SiteHandle } from "./deploySite.js";

const config = {
  fps: 30,
  width: 1920,
  height: 1080,
  format: "mp4",
} as SerializableDistributedRenderConfig;

const site: SiteHandle = {
  siteId: "abc",
  bucketName: "b",
  projectGcsUri: "gs://b/sites/abc/project.tar.gz",
  bytes: 100,
  uploadedAt: "2026-06-06T00:00:00Z",
  uploaded: true,
};

class FakeExecutions implements ExecutionsClientLike {
  lastArgument: string | null = null;
  lastParent: string | null = null;

  workflowPath(project: string, location: string, workflow: string): string {
    return `projects/${project}/locations/${location}/workflows/${workflow}`;
  }

  async createExecution(req: {
    parent: string;
    execution: { argument: string };
  }): Promise<[{ name?: string | null; state?: string | null }]> {
    this.lastParent = req.parent;
    this.lastArgument = req.execution.argument;
    return [{ name: `${req.parent}/executions/exec-123`, state: "ACTIVE" }];
  }
}

function opts(executions: ExecutionsClientLike) {
  return {
    siteHandle: site,
    config,
    bucketName: "b",
    projectId: "proj",
    location: "us-central1",
    workflowId: "hyperframes-render",
    serviceUrl: "https://render-abc.run.app",
    renderId: "hf-render-fixed",
    executions,
  };
}

describe("renderToCloudRun", () => {
  it("starts an execution and returns a handle", async () => {
    const fake = new FakeExecutions();
    const handle = await renderToCloudRun(opts(fake));
    expect(handle.renderId).toBe("hf-render-fixed");
    expect(handle.executionName).toBe(
      "projects/proj/locations/us-central1/workflows/hyperframes-render/executions/exec-123",
    );
    expect(handle.outputGcsUri).toBe("gs://b/renders/hf-render-fixed/output.mp4");
    expect(handle.projectGcsUri).toBe("gs://b/sites/abc/project.tar.gz");
  });

  it("builds the workflow argument the YAML expects", async () => {
    const fake = new FakeExecutions();
    await renderToCloudRun(opts(fake));
    const arg = JSON.parse(fake.lastArgument ?? "{}");
    expect(arg.RenderId).toBe("hf-render-fixed");
    expect(arg.ProjectGcsUri).toBe("gs://b/sites/abc/project.tar.gz");
    expect(arg.PlanOutputGcsPrefix).toBe("gs://b/renders/hf-render-fixed/");
    expect(arg.OutputGcsUri).toBe("gs://b/renders/hf-render-fixed/output.mp4");
    expect(arg.ServiceUrl).toBe("https://render-abc.run.app");
    expect(arg.Config.format).toBe("mp4");
    expect(fake.lastParent).toBe(
      "projects/proj/locations/us-central1/workflows/hyperframes-render",
    );
  });

  it("derives the output extension from the format", async () => {
    const fake = new FakeExecutions();
    const handle = await renderToCloudRun({
      ...opts(fake),
      config: { ...config, format: "webm" } as SerializableDistributedRenderConfig,
    });
    expect(handle.outputGcsUri).toBe("gs://b/renders/hf-render-fixed/output.webm");
  });

  it("requires serviceUrl", async () => {
    const fake = new FakeExecutions();
    await expect(renderToCloudRun({ ...opts(fake), serviceUrl: "" })).rejects.toThrow(
      /serviceUrl is required/,
    );
  });

  it("requires a siteHandle or projectDir", async () => {
    const fake = new FakeExecutions();
    const { siteHandle, ...rest } = opts(fake);
    void siteHandle;
    await expect(renderToCloudRun(rest)).rejects.toThrow(/siteHandle or projectDir/);
  });

  it("validates the config before any GCP call", async () => {
    const fake = new FakeExecutions();
    await expect(
      renderToCloudRun({ ...opts(fake), config: { ...config, fps: 25 } as never }),
    ).rejects.toThrow(/config\.fps/);
    expect(fake.lastArgument).toBeNull();
  });

  it("rejects a renderId that could escape the GCS key prefix", async () => {
    const fake = new FakeExecutions();
    await expect(renderToCloudRun({ ...opts(fake), renderId: "../escape" })).rejects.toThrow(
      /renderId must match/,
    );
    await expect(renderToCloudRun({ ...opts(fake), renderId: "has/slash" })).rejects.toThrow(
      /renderId must match/,
    );
    expect(fake.lastArgument).toBeNull();
  });
});
