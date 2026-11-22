import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../../utils/commandResult.js";
import { writeStackOutputs } from "./state.js";

const ESC = String.fromCharCode(27);
const ODD = `od${ESC}[2Jd\x07`;
const SHOWN = "od\\x1b[2Jd\\x07";

const sdk = vi.hoisted(() => ({
  getRenderProgress: vi.fn(),
  renderToLambda: vi.fn(),
  deploySite: vi.fn(),
  assertStackReadsSites: vi.fn(async () => {}),
  parseStateMachineArn: () => ({ account: "123456789012" }),
  siteHandleFromId: (bucketName: string, siteId: string) => ({
    siteId,
    projectS3Uri: `s3://${bucketName}/sites/${siteId}`,
    bytes: 0,
    uploaded: false,
    uploadedAt: "",
  }),
}));
vi.mock("@hyperframes/aws-lambda/sdk", () => sdk);

const { default: lambdaCommand } = await import("../lambda.js");

const STACK = "demo";
const lines: string[] = [];
let cwd: string;
let previousCwd: string;

const printed = (): string => lines.join("\n").replace(new RegExp(`${ESC}\\[[0-9;]*m`, "g"), "");

function expectNoControlCharacters(): void {
  expect(printed()).not.toContain(ESC);
  expect(printed()).not.toContain("\x07");
}

function run(args: Record<string, unknown>): Promise<unknown> {
  return Promise.resolve(
    lambdaCommand.run?.({
      args: { "stack-name": STACK, ...args },
      rawArgs: [],
      cmd: lambdaCommand,
    } as never),
  );
}

function progress(over: Record<string, unknown>): Record<string, unknown> {
  return {
    status: "SUCCEEDED",
    overallProgress: 1,
    framesRendered: 30,
    totalFrames: 30,
    lambdasInvoked: 2,
    costs: { displayCost: "$0.01", breakdown: { lambdaUsd: 0.01, stepFunctionsUsd: 0 } },
    outputFile: null,
    errors: [],
    warnings: [],
    fatalErrorEncountered: false,
    ...over,
  };
}

beforeEach(() => {
  lines.length = 0;
  cwd = mkdtempSync(join(tmpdir(), "hf-lambda-output-"));
  previousCwd = process.cwd();
  process.chdir(cwd);
  writeStackOutputs({
    stackName: STACK,
    region: "us-east-1",
    bucketName: "demo-bucket",
    stateMachineArn: "arn:aws:states:us-east-1:123456789012:stateMachine:hf",
    functionName: "hf-render",
    lambdaMemoryMb: 10240,
    deployedAt: "2026-01-01T00:00:00Z",
  });
  for (const method of ["log", "error", "warn"] as const)
    vi.spyOn(console, method).mockImplementation((...args: unknown[]) => {
      lines.push(args.join(" "));
    });
  for (const fake of [sdk.getRenderProgress, sdk.renderToLambda, sdk.deploySite]) fake.mockReset();
});

afterEach(() => {
  consumeCommandResult();
  vi.restoreAllMocks();
  process.chdir(previousCwd);
  rmSync(cwd, { recursive: true, force: true });
});

describe("lambda output for people", () => {
  // fails without the fix: the status, warning, output address and failure rows are printed as they arrived.
  it("progress shows control characters in a reply as text", async () => {
    sdk.getRenderProgress.mockResolvedValue(
      progress({
        status: `FAIL${ODD}`,
        warnings: [`slow ${ODD}`],
        outputFile: { s3Uri: `s3://demo-bucket/${ODD}.mp4`, bytes: 1 },
        errors: [{ state: `Render${ODD}`, error: `Err${ODD}`, cause: `why ${ODD}\nmore` }],
        fatalErrorEncountered: true,
      }),
    );
    await run({ subcommand: "progress", target: "render-1" });
    expect(printed()).toContain(`slow ${SHOWN}`);
    expect(printed()).toContain(`FAIL${SHOWN}`);
    expect(printed()).toContain(`s3://demo-bucket/${SHOWN}.mp4`);
    expect(printed()).toContain(`Render${SHOWN}: Err${SHOWN} — why ${SHOWN}\nmore`);
    expectNoControlCharacters();
    expect(consumeCommandResult()?.exitCode).toBe(1);
  });

  // fails without the fix: the notice, the started render's rows and the finished output are printed as they arrived.
  it("render --wait shows control characters in a notice and in the replies as text", async () => {
    sdk.renderToLambda.mockImplementation(async (options: { onNotice?: (m: string) => void }) => {
      options.onNotice?.(`left out ${ODD}`);
      return {
        renderId: `id-${ODD}`,
        executionArn: `arn-${ODD}`,
        outputS3Uri: `s3://out/${ODD}`,
        projectS3Uri: `s3://site/${ODD}`,
      };
    });
    sdk.getRenderProgress.mockResolvedValue(
      progress({ warnings: [`slow ${ODD}`], outputFile: { s3Uri: `s3://done/${ODD}`, bytes: 9 } }),
    );
    await run({
      subcommand: "render",
      target: join(cwd, "project"),
      width: "1920",
      height: "1080",
      fps: "30",
      wait: true,
    });
    for (const shown of [
      "left out ",
      "id-",
      "arn-",
      "s3://out/",
      "s3://site/",
      "slow ",
      "s3://done/",
    ])
      expect(printed()).toContain(`${shown}${SHOWN}`);
    expectNoControlCharacters();
  });

  // fails without the fix: the ending status and the failure rows are printed as they arrived.
  it("render --wait shows control characters in a failed render's rows as text", async () => {
    sdk.renderToLambda.mockResolvedValue({
      renderId: "id",
      executionArn: "arn",
      outputS3Uri: "s3://out",
      projectS3Uri: "s3://site",
    });
    sdk.getRenderProgress.mockResolvedValue(
      progress({
        status: `ABORT${ODD}`,
        errors: [{ state: `Chunk${ODD}`, error: `Err${ODD}`, cause: `why ${ODD}` }],
      }),
    );
    await run({
      subcommand: "render",
      target: join(cwd, "project"),
      width: "1920",
      height: "1080",
      fps: "30",
      wait: true,
    });
    expect(printed()).toContain(`[ABORT${SHOWN}]`);
    expect(printed()).toContain(`Render ended with status ABORT${SHOWN}.`);
    expect(printed()).toContain(`Chunk${SHOWN}: Err${SHOWN} — why ${SHOWN}`);
    expectNoControlCharacters();
    expect(consumeCommandResult()?.exitCode).toBe(1);
  });

  // fails without the fix: the poll hint repeats the render id as it arrived.
  it("render shows control characters in the poll hint as text", async () => {
    sdk.renderToLambda.mockResolvedValue({
      renderId: `id-${ODD}`,
      executionArn: "arn",
      outputS3Uri: "s3://out",
      projectS3Uri: "s3://site",
    });
    await run({
      subcommand: "render",
      target: join(cwd, "project"),
      width: "1920",
      height: "1080",
      fps: "30",
    });
    expect(printed()).toContain(`hyperframes lambda progress id-${SHOWN}`);
    expectNoControlCharacters();
  });

  // fails without the fix: the notice, the site rows and the render hint are printed as they arrived.
  it("sites create shows control characters in a notice, the reply and the hint as text", async () => {
    sdk.deploySite.mockImplementation(async (options: { onNotice?: (m: string) => void }) => {
      options.onNotice?.(`left out ${ODD}`);
      return {
        siteId: `site-${ODD}`,
        projectS3Uri: `s3://site/${ODD}`,
        bytes: 3,
        uploaded: true,
        uploadedAt: `then ${ODD}`,
      };
    });
    await run({ subcommand: "sites", target: "create", extra: `proj${ODD}` });
    for (const shown of ["left out ", "site-", "s3://site/", "then ", "lambda render proj"])
      expect(printed()).toContain(`${shown}${SHOWN}`);
    expect(printed()).toContain(`--site-id=site-${SHOWN} --stack-name=${STACK}`);
    expectNoControlCharacters();
  });

  // fails without the fix: the notice, the site id and each row's key, address or reason are printed as they arrived.
  it("render-batch shows control characters in a notice and in each row as text", async () => {
    const batch = join(cwd, "batch.jsonl");
    writeFileSync(
      batch,
      [`key-a-${ODD}`, `key-b-${ODD}`].map((outputKey) => JSON.stringify({ outputKey })).join("\n"),
    );
    sdk.deploySite.mockImplementation(async (options: { onNotice?: (m: string) => void }) => {
      options.onNotice?.(`left out ${ODD}`);
      return { siteId: `site-${ODD}`, projectS3Uri: "s3://site", bytes: 3, uploaded: true };
    });
    sdk.renderToLambda.mockImplementation(async (options: { outputKey: string }) => {
      if (options.outputKey.startsWith("key-b")) throw new Error(`refused ${ODD}\nsecond line`);
      return { executionArn: `arn-${ODD}` };
    });
    await run({
      subcommand: "render-batch",
      target: join(cwd, "project"),
      batch,
      width: "1920",
      height: "1080",
      fps: "30",
      "max-concurrent": "1",
    });
    for (const shown of ["left out ", "batch: site-", "key-a-", "key-b-", "arn-"])
      expect(printed()).toContain(`${shown}${SHOWN}`);
    expect(printed()).toContain(`refused ${SHOWN}\nsecond line`);
    expectNoControlCharacters();
    expect(consumeCommandResult()?.exitCode).toBe(1);
  });

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

  // fails without the fix: the stack name is repeated as it was typed, in the path and in the hint.
  it("shows control characters in a missing stack's name as text", async () => {
    await expect(
      run({ subcommand: "progress", target: "render-1", "stack-name": `st${ODD}ack` }),
    ).rejects.toThrow();
    expect(printed()).toContain(`no stack state for "st${SHOWN}ack"`);
    expect(printed()).toContain(`--stack-name=st${SHOWN}ack`);
    expect(printed()).toContain(`Known stacks here: ${STACK}.`);
    expectNoControlCharacters();
  });
});
