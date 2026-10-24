import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const root = vi.hoisted(() => ({ value: undefined as string | undefined }));
vi.mock("./repoRoot.js", () => ({ repoRoot: () => root.value }));
vi.mock("@hyperframes/aws-lambda/sdk", () => ({ prebuiltHandler: () => undefined }));
vi.mock("./sam.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./sam.js")>()),
  samDeploy: vi.fn(),
  fetchStackOutputs: vi.fn(() => ({ bucketName: "b", functionName: "f", stateMachineArn: "s" })),
}));
const written = vi.hoisted(() => [] as Record<string, unknown>[]);
vi.mock("./state.js", () => ({
  DEFAULT_STACK_NAME: "hf",
  readStackOutputs: () => null,
  writeStackOutputs: (outputs: Record<string, unknown>) => written.push(outputs) && "state.json",
}));
vi.mock("./videoImage.js", () => ({
  pushVideoImage: vi.fn(async () => ({ imageUri: "repo@sha256:a", repositoryName: "hf-video" })),
}));

const { runDeploy } = await import("./deploy.js");
const { samDeploy } = await import("./sam.js");
const { pushVideoImage } = await import("./videoImage.js");

let dir: string | undefined;
let quiet: { mockRestore(): void };

beforeEach(() => {
  vi.mocked(samDeploy).mockClear();
  vi.mocked(pushVideoImage).mockClear();
  written.length = 0;
  quiet = vi.spyOn(console, "log").mockImplementation(() => {});
});

afterEach(() => {
  quiet.mockRestore();
  root.value = undefined;
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = undefined;
});

describe("runDeploy", () => {
  it("outside a checkout with no pinned handler, fails with the one message before running SAM", async () => {
    await expect(runDeploy()).rejects.toThrow(
      /no prebuilt Lambda handler is available[\s\S]*Docs:/,
    );
    expect(samDeploy).not.toHaveBeenCalled();
  });

  it("outside a checkout, refuses a Chrome source the prebuilt handler does not bundle", async () => {
    await expect(
      runDeploy({ videoArch: "x86_64", chromeSource: "chrome-headless-shell" }),
    ).rejects.toThrow(/needs a hyperframes checkout/);
    expect(samDeploy).not.toHaveBeenCalled();
  });

  it("with --video-arch x86_64, deploys the checkout's template with no video function", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-deploy-checkout-"));
    const samDir = join(dir, "examples", "aws-lambda");
    mkdirSync(samDir, { recursive: true });
    writeFileSync(join(samDir, "template.yaml"), "Resources: {}\n");
    mkdirSync(join(dir, "packages", "aws-lambda", "dist"), { recursive: true });
    writeFileSync(join(dir, "packages", "aws-lambda", "dist", "handler.zip"), "zip");
    root.value = dir;

    await runDeploy({ skipBuild: true, videoArch: "x86_64" });
    expect(vi.mocked(samDeploy).mock.calls[0]?.[0]).toMatchObject({ samDir });
    expect(vi.mocked(samDeploy).mock.calls[0]?.[0].videoImageUri).toBeUndefined();
    expect(pushVideoImage).not.toHaveBeenCalled();
  });

  it("by default, deploys the pushed arm64 image and records its repository", async () => {
    dir = mkdtempSync(join(tmpdir(), "hf-deploy-arm64-"));
    mkdirSync(join(dir, "examples", "aws-lambda"), { recursive: true });
    writeFileSync(join(dir, "examples", "aws-lambda", "template.yaml"), "Resources: {}\n");
    mkdirSync(join(dir, "packages", "aws-lambda", "dist"), { recursive: true });
    writeFileSync(join(dir, "packages", "aws-lambda", "dist", "handler.zip"), "zip");
    root.value = dir;

    await runDeploy({ skipBuild: true, stackName: "hf" });
    expect(vi.mocked(pushVideoImage).mock.calls[0]?.[0]).toMatchObject({ inCheckout: true });
    expect(vi.mocked(samDeploy).mock.calls[0]?.[0].videoImageUri).toBe("repo@sha256:a");
    expect(written[0]).toMatchObject({ videoRepository: "hf-video" });
  });

  it.each([undefined, "arm64" as const])(
    "refuses arm64 (--video-arch %s) with a Chrome source the video image does not bundle, naming x86_64",
    async (videoArch) => {
      await expect(runDeploy({ videoArch, chromeSource: "chrome-headless-shell" })).rejects.toThrow(
        /sparticuz Chrome only[\s\S]*--video-arch x86_64/,
      );
      expect(pushVideoImage).not.toHaveBeenCalled();
    },
  );
});
