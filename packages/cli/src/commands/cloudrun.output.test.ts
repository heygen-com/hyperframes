import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

const adapter = vi.hoisted(() => ({
  getRenderProgress: vi.fn(),
  renderToCloudRun: vi.fn(),
  deploySite: vi.fn(),
  getTerraformModuleDir: vi.fn(),
  spawnSync: vi.fn(),
}));
vi.mock("@hyperframes/gcp-cloud-run/sdk", () => ({
  getRenderProgress: adapter.getRenderProgress,
  renderToCloudRun: adapter.renderToCloudRun,
  deploySite: adapter.deploySite,
}));
vi.mock("@hyperframes/gcp-cloud-run/terraform", () => ({
  getTerraformModuleDir: adapter.getTerraformModuleDir,
}));
vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawnSync: adapter.spawnSync,
}));

const { default: cloudrunCommand } = await import("./cloudrun.js");

const lines: string[] = [];
let work: string;

const printed = (): string => lines.join("\n").replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

function expectNoControlCharacters(): void {
  expect(printed()).not.toContain(ESC);
  expect(printed()).not.toContain("\x07");
}

function run(args: Record<string, unknown>): Promise<unknown> {
  return Promise.resolve(
    cloudrunCommand.run?.({ args, rawArgs: [], cmd: cloudrunCommand } as never),
  );
}

function progress(over: Record<string, unknown>): Record<string, unknown> {
  return {
    status: "succeeded",
    overallProgress: 1,
    framesRendered: 30,
    totalFrames: 30,
    costs: { displayCost: "$0.01" },
    outputFile: null,
    errors: [],
    ...over,
  };
}

const size = { width: "1920", height: "1080", fps: "30" };

beforeEach(() => {
  lines.length = 0;
  work = mkdtempSync(join(tmpdir(), "hf-cloudrun-output-"));
  vi.stubEnv("HYPERFRAMES_CONFIG_DIR", join(work, "config"));
  mkdirSync(join(work, "config"));
  writeFileSync(
    join(work, "config", "cloudrun-state.json"),
    JSON.stringify({
      projectId: "demo",
      region: "us-central1",
      bucketName: "demo-bucket",
      serviceUrl: "https://demo.example",
      workflowId: "demo-workflow",
    }),
  );
  for (const method of ["log", "error", "warn"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
  vi.spyOn(process.stdout, "write").mockImplementation((chunk: unknown) => {
    lines.push(String(chunk));
    return true;
  });
  for (const fake of Object.values(adapter)) fake.mockReset();
});

afterEach(() => {
  consumeCommandResult();
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  rmSync(work, { recursive: true, force: true });
});

describe("cloudrun output for people", () => {
  // fails without the fix: the subcommand is repeated as it was typed.
  it("shows control characters in an unknown subcommand as text", async () => {
    await expect(run({ subcommand: `ren${ODD}der` })).rejects.toThrow();
    expect(printed()).toContain(`Unknown subcommand: ren${SHOWN}der`);
    expectNoControlCharacters();
  });

  // fails without the fix: the verb is repeated as it was typed.
  it("shows control characters in an unknown sites verb as text", async () => {
    await expect(run({ subcommand: "sites", target: `cre${ODD}ate` })).rejects.toThrow();
    expect(printed()).toContain(`unknown verb "cre${SHOWN}ate"`);
    expectNoControlCharacters();
  });

  // fails without the fix: the notice and the site rows are printed as they arrived.
  it("sites create shows control characters in a notice and the reply as text", async () => {
    adapter.deploySite.mockImplementation(async (options: { onNotice?: (m: string) => void }) => {
      options.onNotice?.(`left out ${ODD}\nsecond line`);
      return { siteId: `site-${ODD}`, projectGcsUri: `gs://site/${ODD}`, bytes: 3, uploaded: true };
    });
    await run({ subcommand: "sites", target: "create", extra: join(work, "project") });
    expect(printed()).toContain(`left out ${SHOWN}\nsecond line`);
    expect(printed()).toContain(`site=site-${SHOWN} (3 bytes)`);
    expect(printed()).toContain(`gs://site/${SHOWN}`);
    expectNoControlCharacters();
  });

  // fails without the fix: the notice and the started render's rows are printed as they arrived.
  it("render shows control characters in a notice and the started render as text", async () => {
    adapter.renderToCloudRun.mockImplementation(
      async (options: { onNotice?: (m: string) => void }) => {
        options.onNotice?.(`left out ${ODD}`);
        return {
          renderId: `id-${ODD}`,
          outputGcsUri: `gs://out/${ODD}`,
          executionName: `exec-${ODD}`,
        };
      },
    );
    await run({ subcommand: "render", target: join(work, "project"), ...size });
    for (const shown of ["left out ", "renderId=id-", "gs://out/", "cloudrun progress exec-"])
      expect(printed()).toContain(`${shown}${SHOWN}`);
    expectNoControlCharacters();
  });

  // fails without the fix: the status while waiting, the output address and the cost are printed as they arrived.
  it("render --wait shows control characters in the status and the finished output as text", async () => {
    adapter.renderToCloudRun.mockResolvedValue({
      renderId: "id",
      outputGcsUri: "gs://out",
      executionName: "exec",
    });
    adapter.getRenderProgress
      .mockResolvedValueOnce(progress({ status: "running" }))
      .mockResolvedValueOnce(
        progress({
          status: "succeeded",
          outputFile: { gcsUri: `gs://done/${ODD}` },
          costs: { displayCost: `$1 ${ODD}` },
        }),
      );
    await run({
      subcommand: "render",
      target: join(work, "project"),
      ...size,
      wait: true,
      "wait-interval-ms": "1",
    });
    expect(printed()).toContain(`gs://done/${SHOWN} ($1 ${SHOWN})`);
    expectNoControlCharacters();

    lines.length = 0;
    adapter.getRenderProgress
      .mockResolvedValueOnce(progress({ status: "running" }))
      .mockResolvedValueOnce(
        progress({
          status: `lost${ODD}`,
          errors: [{ state: `Chunk${ODD}`, cause: `why ${ODD}\nmore` }],
        }),
      );
    await expect(
      run({
        subcommand: "render",
        target: join(work, "project"),
        ...size,
        wait: true,
        "wait-interval-ms": "1",
      }),
    ).rejects.toThrow("Command failed");
    expect(printed()).toContain(`status=lost${SHOWN} `);
    expect(printed()).toContain(`✗ render lost${SHOWN}`);
    expect(printed()).toContain(`Chunk${SHOWN}: why ${SHOWN}\nmore`);
    expectNoControlCharacters();
  });

  // fails without the fix: the status, output address, cost and failure rows are printed as they arrived.
  it("progress shows control characters in a reply as text", async () => {
    adapter.getRenderProgress.mockResolvedValue(
      progress({
        status: `fail${ODD}`,
        outputFile: { gcsUri: `gs://done/${ODD}` },
        costs: { displayCost: `$1 ${ODD}` },
        errors: [{ state: `Render${ODD}`, cause: `why ${ODD}\nmore` }],
      }),
    );
    await run({ subcommand: "progress", target: "exec-1" });
    expect(printed()).toContain(`status=fail${SHOWN} progress=100%`);
    expect(printed()).toContain(`output=gs://done/${SHOWN}`);
    expect(printed()).toContain(`cost=$1 ${SHOWN}`);
    expect(printed()).toContain(`error Render${SHOWN}: why ${SHOWN}\nmore`);
    expectNoControlCharacters();
  });

  // fails without the fix: the batch path is repeated as it was typed.
  it("render-batch shows control characters in a missing batch path as text", async () => {
    await expect(
      run({ subcommand: "render-batch", target: "project", batch: `no${ODD}.jsonl`, ...size }),
    ).rejects.toThrow();
    expect(printed()).toContain(`batch file not found: no${SHOWN}.jsonl`);
    expectNoControlCharacters();
  });

  // fails without the fix: the notice and each failed row's key and reason are printed as they arrived.
  it("render-batch shows control characters in a notice and a failed row as text", async () => {
    const batch = join(work, "batch.jsonl");
    writeFileSync(batch, JSON.stringify({ outputKey: `key-${ODD}` }));
    adapter.deploySite.mockImplementation(async (options: { onNotice?: (m: string) => void }) => {
      options.onNotice?.(`left out ${ODD}`);
      return { siteId: "site", projectGcsUri: "gs://site", bytes: 3, uploaded: true };
    });
    adapter.renderToCloudRun.mockRejectedValue(new Error(`refused ${ODD}\nsecond line`));
    await expect(
      run({ subcommand: "render-batch", target: join(work, "project"), batch, ...size }),
    ).rejects.toThrow("Command failed");
    expect(printed()).toContain(`left out ${SHOWN}`);
    expect(printed()).toContain(`✗ key-${SHOWN}: refused ${SHOWN}\nsecond line`);
    expectNoControlCharacters();
  });

  // fails without the fix: the project, the image built from it and the stack's outputs are printed as they arrived.
  it("deploy shows control characters in the project, the image and the outputs as text", async () => {
    const terraformDir = join(work, "repo", "packages", "gcp-cloud-run", "terraform");
    mkdirSync(terraformDir, { recursive: true });
    writeFileSync(join(work, "repo", "packages", "gcp-cloud-run", "Dockerfile"), "");
    adapter.getTerraformModuleDir.mockReturnValue(terraformDir);
    adapter.spawnSync.mockReturnValue({ status: 0, stdout: `out-${ODD}`, stderr: "" });
    await run({ subcommand: "deploy", project: `proj${ODD}` });
    expect(printed()).toContain(`Enabling required APIs on proj${SHOWN}`);
    expect(printed()).toContain(`us-central1-docker.pkg.dev/proj${SHOWN}/hyperframes/`);
    expect(printed()).toContain(`bucket=out-${SHOWN} workflow=out-${SHOWN}`);
    expect(printed()).toContain(`service=out-${SHOWN}`);
    expectNoControlCharacters();
  });
});
