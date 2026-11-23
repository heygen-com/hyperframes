import { describe, expect, it } from "bun:test";
import {
  DescribeExecutionCommand,
  GetExecutionHistoryCommand,
  type HistoryEvent,
  type SFNClient,
} from "@aws-sdk/client-sfn";
import { computeRenderCost } from "./costAccounting.js";
import { createProgressSfnClient, getRenderProgress } from "./getRenderProgress.js";

interface DescribeShape {
  status?: string;
  startDate?: Date;
  stopDate?: Date;
}

interface FakeInput {
  executionArn?: string;
  mapRunArn?: string;
  statusFilter?: string;
  nextToken?: string;
}

interface FakeChild {
  status: string;
  history: HistoryEvent[];
}

class FakeSFN {
  describe: DescribeShape = {};
  // Pages of history events; FakeSFN walks them in order, paginating with `nextToken`.
  historyPages: HistoryEvent[][] = [];
  // Distributed Map: map run ARN -> item counts and child executions (child ARN -> status + history).
  mapRunCounts: Record<string, Record<string, number>> = {};
  mapRunChildren: Record<string, Record<string, FakeChild>> = {};
  calls: string[] = [];
  // Command name -> error name the command throws, as the SDK names service errors.
  failures: Record<string, string> = {};
  async send(command: unknown): Promise<unknown> {
    const { constructor, input } = command as { constructor: { name: string }; input: FakeInput };
    this.calls.push(constructor.name);
    const failure = this.failures[constructor.name];
    if (failure)
      throw Object.assign(new Error(`${failure} from ${constructor.name}`), { name: failure });
    if (constructor.name === "DescribeExecutionCommand") return this.describeResult();
    if (constructor.name === "DescribeMapRunCommand") {
      return { itemCounts: this.mapRunCounts[input.mapRunArn ?? ""] };
    }
    if (constructor.name === "ListExecutionsCommand") return this.listResult(input);
    if (constructor.name === "GetExecutionHistoryCommand") return this.historyResult(input);
    throw new Error(`FakeSFN: unexpected command ${constructor.name}`);
  }
  private describeResult(): unknown {
    return {
      status: this.describe.status ?? "RUNNING",
      startDate: this.describe.startDate ?? new Date("2026-05-16T00:00:00Z"),
      stopDate: this.describe.stopDate,
    };
  }
  private listResult({ mapRunArn = "", statusFilter }: FakeInput): unknown {
    const children = Object.entries(this.mapRunChildren[mapRunArn] ?? {});
    const matching = children.filter(([, c]) => !statusFilter || c.status === statusFilter);
    return { executions: matching.map(([executionArn]) => ({ executionArn })) };
  }
  private historyResult({ executionArn = "", nextToken }: FakeInput): unknown {
    const child = Object.values(this.mapRunChildren)
      .map((children) => children[executionArn])
      .find(Boolean);
    return historyPage(child ? [child.history] : this.historyPages, Number(nextToken ?? 0));
  }
}

function historyPage(pages: HistoryEvent[][], idx: number): unknown {
  const nextToken = idx + 1 < pages.length ? String(idx + 1) : undefined;
  return { events: pages[idx] ?? [], nextToken };
}

function lambdaSucceeded(payload: unknown): HistoryEvent {
  return {
    type: "LambdaFunctionSucceeded",
    id: 1,
    timestamp: new Date(),
    lambdaFunctionSucceededEventDetails: { output: JSON.stringify(payload) },
  } as HistoryEvent;
}

function stateEntered(name: string): HistoryEvent {
  return {
    type: "TaskStateEntered",
    id: 1,
    timestamp: new Date(),
    stateEnteredEventDetails: { name },
  } as HistoryEvent;
}

function stateExited(name: string, output?: unknown): HistoryEvent {
  return {
    type: "TaskStateExited",
    id: 1,
    timestamp: new Date(),
    stateExitedEventDetails: {
      name,
      output: output === undefined ? undefined : JSON.stringify(output),
    },
  } as HistoryEvent;
}

// Optimized `lambda:invoke` integration's wire shape: Task* events with
// the handler payload at `.Payload`. Helpers below fabricate these so
// tests cover the same events a real CDK-deployed render produces.
function taskScheduled(): HistoryEvent {
  return {
    type: "TaskScheduled",
    id: 1,
    timestamp: new Date(),
    taskScheduledEventDetails: {
      resource: "invoke",
      resourceType: "lambda",
      region: "us-east-1",
      parameters: "{}",
    },
  } as HistoryEvent;
}

function taskSucceeded(payload: unknown): HistoryEvent {
  return {
    type: "TaskSucceeded",
    id: 1,
    timestamp: new Date(),
    taskSucceededEventDetails: {
      resource: "invoke",
      resourceType: "lambda",
      output: JSON.stringify({
        ExecutedVersion: "$LATEST",
        Payload: payload,
        StatusCode: 200,
      }),
    },
  } as HistoryEvent;
}

function taskFailed(error: string, cause: string): HistoryEvent {
  return {
    type: "TaskFailed",
    id: 1,
    timestamp: new Date(),
    taskFailedEventDetails: {
      resource: "invoke",
      resourceType: "lambda",
      error,
      cause,
    },
  } as HistoryEvent;
}

describe("getRenderProgress", () => {
  it("reports 0 progress before Plan completes", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [[]];
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.status).toBe("RUNNING");
    expect(progress.overallProgress).toBe(0);
    expect(progress.totalFrames).toBeNull();
    expect(progress.framesRendered).toBe(0);
  });

  it("reports 0.1 once Plan completes (totalFrames known, no chunks done)", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [
      [
        lambdaSucceeded({
          Action: "plan",
          TotalFrames: 240,
          DurationMs: 1_000,
        }),
      ],
    ];
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.totalFrames).toBe(240);
    expect(progress.overallProgress).toBeCloseTo(0.1, 6);
    expect(progress.framesRendered).toBe(0);
  });

  it("advances chunk progress proportionally", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [
      [
        stateEntered("Plan"),
        lambdaSucceeded({ Action: "plan", TotalFrames: 100, DurationMs: 1_000 }),
        stateEntered("RenderChunk"),
        lambdaSucceeded({ Action: "renderChunk", FramesEncoded: 50, DurationMs: 2_000 }),
      ],
    ];
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    // 0.1 + 0.8 × 0.5 = 0.5
    expect(progress.overallProgress).toBeCloseTo(0.5, 6);
    expect(progress.framesRendered).toBe(50);
  });

  it("does not double-count Assemble's FramesEncoded toward framesRendered", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [
      [
        stateEntered("Plan"),
        lambdaSucceeded({ Action: "plan", TotalFrames: 100, DurationMs: 1_000 }),
        stateEntered("RenderChunk"),
        lambdaSucceeded({ Action: "renderChunk", FramesEncoded: 100, DurationMs: 2_000 }),
        stateEntered("Assemble"),
        lambdaSucceeded({
          Action: "assemble",
          FramesEncoded: 100,
          FileSize: 9_000_000,
          OutputS3Uri: "s3://b/k.mp4",
          DurationMs: 1_500,
        }),
        stateExited("Assemble", {
          Output: { OutputS3Uri: "s3://b/k.mp4", FileSize: 9_000_000, FramesEncoded: 100 },
        }),
      ],
    ];
    sfn.describe.status = "SUCCEEDED";
    sfn.describe.stopDate = new Date("2026-05-16T00:05:00Z");
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.framesRendered).toBe(100);
    expect(progress.overallProgress).toBe(1);
    expect(progress.outputFile).toEqual({ s3Uri: "s3://b/k.mp4", bytes: 9_000_000 });
    expect(progress.endedAt).not.toBeNull();
  });

  it("recognizes v2 chunk and assemble state names", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [
      [
        stateEntered("PlanV2"),
        lambdaSucceeded({ Action: "plan", TotalFrames: 30 }),
        stateEntered("RenderChunkV2"),
        lambdaSucceeded({ Action: "renderChunk", FramesEncoded: 30 }),
        stateEntered("AssembleV2"),
        lambdaSucceeded({ Action: "assemble", FramesEncoded: 30 }),
        stateExited("AssembleV2", {
          Output: { OutputS3Uri: "s3://b/v2.mp4", FileSize: 321 },
        }),
      ],
    ];
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.framesRendered).toBe(30);
    expect(progress.overallProgress).toBe(1);
    expect(progress.outputFile).toEqual({ s3Uri: "s3://b/v2.mp4", bytes: 321 });
  });

  it("computes cost from observed billed duration", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [[lambdaSucceeded({ Action: "plan", TotalFrames: 30, DurationMs: 6_000 })]];
    const progress = await getRenderProgress({
      executionArn: "arn",
      defaultMemorySizeMb: 10_240,
      sfn: sfn as unknown as SFNClient,
    });
    // 1 transition event + 1 invocation × 60 GB-s × $0.0000166667 ≈ $0.001
    expect(progress.costs.breakdown.lambdaUsd).toBeCloseTo(0.001, 4);
  });

  it("prices the plan and chunk invocations at the video function's architecture", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [
      [
        stateEntered("Plan"),
        taskSucceeded({ Action: "plan", TotalFrames: 30, DurationMs: 100_000 }),
        stateEntered("RenderChunk"),
        taskSucceeded({ Action: "renderChunk", FramesEncoded: 30, DurationMs: 4_000 }),
        stateEntered("Assemble"),
        taskSucceeded({ Action: "assemble", DurationMs: 2_000 }),
      ],
    ];
    const progress = await getRenderProgress({
      executionArn: "arn",
      defaultMemorySizeMb: 10_240,
      videoArchitecture: "arm64",
      sfn: sfn as unknown as SFNClient,
    });
    const billed = (ms: number) => ({
      billedDurationMs: ms,
      memorySizeMb: 10_240,
      estimated: false,
    });
    const arm64 = (ms: number) => ({ ...billed(ms), architecture: "arm64" as const });
    const expected = [arm64(100_000), arm64(4_000), billed(2_000)];
    expect(progress.costs.breakdown.lambdaUsd).toBe(
      computeRenderCost(expected, 0).breakdown.lambdaUsd,
    );
  });

  it("captures Lambda failures with the enclosing state name", async () => {
    const sfn = new FakeSFN();
    const failed: HistoryEvent = {
      type: "LambdaFunctionFailed",
      id: 2,
      timestamp: new Date(),
      lambdaFunctionFailedEventDetails: {
        error: "PLAN_HASH_MISMATCH",
        cause: "bad plan",
      },
    } as HistoryEvent;
    sfn.historyPages = [[stateEntered("RenderChunk"), failed]];
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.errors).toEqual([
      { state: "RenderChunk", error: "PLAN_HASH_MISMATCH", cause: "bad plan" },
    ]);
  });

  it("marks fatalErrorEncountered when execution ends FAILED", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [[]];
    sfn.describe.status = "FAILED";
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.fatalErrorEncountered).toBe(true);
  });

  it("paginates the history", async () => {
    const sfn = new FakeSFN();
    sfn.historyPages = [
      [
        stateEntered("Plan"),
        lambdaSucceeded({ Action: "plan", TotalFrames: 4, DurationMs: 1_000 }),
      ],
      [
        stateEntered("RenderChunk"),
        lambdaSucceeded({ Action: "renderChunk", FramesEncoded: 4, DurationMs: 2_000 }),
      ],
    ];
    sfn.describe.status = "SUCCEEDED";
    const progress = await getRenderProgress({
      executionArn: "arn",
      sfn: sfn as unknown as SFNClient,
    });
    expect(progress.framesRendered).toBe(4);
    expect(progress.totalFrames).toBe(4);
    expect(progress.overallProgress).toBe(1);
  });

  describe("Distributed Map chunks", () => {
    const mapRunArn = "arn:aws:states:us-east-2:0:mapRun:hf-render/RenderChunksV2:run";
    const CHUNKS = 225;

    function parentUntilMapRun(totalFrames: number): HistoryEvent[] {
      return [
        stateEntered("PlanV2"),
        taskScheduled(),
        taskSucceeded({ TotalFrames: totalFrames, DurationMs: 1000 }),
        {
          type: "MapStateEntered",
          id: 1,
          timestamp: new Date(),
          stateEnteredEventDetails: { name: "RenderChunksV2" },
        } as HistoryEvent,
        {
          type: "MapRunStarted",
          id: 1,
          timestamp: new Date(),
          mapRunStartedEventDetails: { mapRunArn },
        } as HistoryEvent,
      ];
    }

    function chunkChild(status: string, last: HistoryEvent): FakeChild {
      return { status, history: [stateEntered("RenderChunkV2"), taskScheduled(), last] };
    }

    // Children with real histories, so a per-child reader would find (and pay for) all of them.
    function fakeWithChildren(statuses: string[]): FakeSFN {
      const sfn = new FakeSFN();
      sfn.historyPages = [parentUntilMapRun(3600)];
      sfn.mapRunChildren[mapRunArn] = Object.fromEntries(
        statuses.map((status, i) => [
          `child-${i}`,
          status === "FAILED"
            ? chunkChild(status, taskFailed("PLAN_HASH_MISMATCH", `chunk ${i} hash drift`))
            : chunkChild(status, taskSucceeded({ FramesEncoded: 16, DurationMs: 4000 })),
        ]),
      );
      return sfn;
    }

    it("polls 225 running chunks with a constant number of calls", async () => {
      const statuses = Array.from({ length: CHUNKS }, (_, i) =>
        i < 125 ? "SUCCEEDED" : "RUNNING",
      );
      const sfn = fakeWithChildren(statuses);
      sfn.mapRunCounts[mapRunArn] = { total: CHUNKS, pending: 0, running: 100, succeeded: 125 };
      const p = await getRenderProgress({
        executionArn: "arn:x",
        sfn: sfn as unknown as SFNClient,
      });
      expect(sfn.calls).toEqual([
        "DescribeExecutionCommand",
        "GetExecutionHistoryCommand",
        "DescribeMapRunCommand",
      ]);
      expect(p.framesRendered).toBe(Math.floor((3600 * 125) / CHUNKS));
      expect(p.overallProgress).toBeCloseTo(0.1 + 0.8 * (125 / CHUNKS), 5);
      expect(p.lambdasInvoked).toBe(1 + CHUNKS);
      expect(p.errors).toEqual([]);
    });

    // Callers on the policy from before the Distributed Map lack states:DescribeMapRun.
    it("falls back to the parent snapshot with a hint when DescribeMapRun is denied", async () => {
      const sfn = fakeWithChildren(["SUCCEEDED", "RUNNING"]);
      sfn.failures.DescribeMapRunCommand = "AccessDeniedException";
      const p = await getRenderProgress({
        executionArn: "arn:x",
        sfn: sfn as unknown as SFNClient,
      });
      expect(p.status).toBe("RUNNING");
      expect(p.totalFrames).toBe(3600);
      expect(p.overallProgress).toBeCloseTo(0.1, 5);
      expect(p.warnings).toEqual([expect.stringContaining("hyperframes lambda policies user")]);
    });

    it("still throws other map-run read errors", async () => {
      const sfn = fakeWithChildren(["RUNNING"]);
      sfn.failures.DescribeMapRunCommand = "InternalServerError";
      await expect(
        getRenderProgress({ executionArn: "arn:x", sfn: sfn as unknown as SFNClient }),
      ).rejects.toThrow("InternalServerError");
    });

    it("reads exact chunk frames and cost from the Map output once it exits", async () => {
      const sfn = new FakeSFN();
      const chunks = Array.from({ length: CHUNKS }, (_, i) => ({
        ChunkIndex: i,
        FramesEncoded: 16,
        DurationMs: 4000,
      }));
      sfn.historyPages = [
        [
          ...parentUntilMapRun(3600),
          {
            type: "MapStateExited",
            id: 1,
            timestamp: new Date(),
            stateExitedEventDetails: {
              name: "RenderChunksV2",
              output: JSON.stringify({ Chunks: chunks }),
            },
          } as HistoryEvent,
        ],
      ];
      const p = await getRenderProgress({
        executionArn: "arn:x",
        sfn: sfn as unknown as SFNClient,
      });
      expect(sfn.calls).toEqual(["DescribeExecutionCommand", "GetExecutionHistoryCommand"]);
      expect(p.framesRendered).toBe(3600);
      expect(p.lambdasInvoked).toBe(1 + CHUNKS);
      const billed = [1000, ...chunks.map((c) => c.DurationMs)].map((billedDurationMs) => ({
        billedDurationMs,
        memorySizeMb: 10240,
        estimated: false,
      }));
      expect(p.costs.breakdown.lambdaUsd).toBe(computeRenderCost(billed, 0).breakdown.lambdaUsd);
    });

    it("prices the plan and chunks at the arm64 rate when an arm64 video function runs them", async () => {
      const sfn = new FakeSFN();
      const chunks = Array.from({ length: CHUNKS }, (_, i) => ({
        ChunkIndex: i,
        FramesEncoded: 16,
        DurationMs: 4000,
      }));
      sfn.historyPages = [
        [
          ...parentUntilMapRun(3600),
          {
            type: "MapStateExited",
            id: 1,
            timestamp: new Date(),
            stateExitedEventDetails: {
              name: "RenderChunksV2",
              output: JSON.stringify({ Chunks: chunks }),
            },
          } as HistoryEvent,
        ],
      ];
      const p = await getRenderProgress({
        executionArn: "arn:x",
        videoArchitecture: "arm64",
        sfn: sfn as unknown as SFNClient,
      });
      const plan = { billedDurationMs: 1000, memorySizeMb: 10240, estimated: false };
      const chunk = { billedDurationMs: 4000, memorySizeMb: 10240, estimated: false };
      const onArm = (inv: typeof plan) => ({ ...inv, architecture: "arm64" as const });
      const arm64 = [onArm(plan), ...chunks.map(() => onArm(chunk))];
      const allX86 = [plan, ...chunks.map(() => chunk)];
      expect(p.costs.breakdown.lambdaUsd).toBe(computeRenderCost(arm64, 0).breakdown.lambdaUsd);
      expect(p.costs.breakdown.lambdaUsd).toBeLessThan(
        computeRenderCost(allX86, 0).breakdown.lambdaUsd,
      );
    });

    it("surfaces a failed chunk's own error, reading only failed children", async () => {
      const statuses = Array.from({ length: CHUNKS }, (_, i) =>
        i === 7 ? "FAILED" : i < 100 ? "SUCCEEDED" : "ABORTED",
      );
      const sfn = fakeWithChildren(statuses);
      sfn.mapRunCounts[mapRunArn] = { total: CHUNKS, succeeded: 99, failed: 1, aborted: 125 };
      const p = await getRenderProgress({
        executionArn: "arn:x",
        sfn: sfn as unknown as SFNClient,
      });
      expect(p.errors).toEqual([
        { state: "RenderChunkV2", error: "PLAN_HASH_MISMATCH", cause: "chunk 7 hash drift" },
      ]);
      expect(sfn.calls).toHaveLength(5);
    });
  });

  it("backs off on ThrottlingException and still returns progress", async () => {
    let throttlesLeft = 3;
    const targets: string[] = [];
    const json = (statusCode: number, body: unknown) => ({
      response: {
        statusCode,
        headers: { "content-type": "application/x-amz-json-1.0" },
        body: new TextEncoder().encode(JSON.stringify(body)),
      },
    });
    const sfn = createProgressSfnClient({
      region: "us-east-2",
      credentials: { accessKeyId: "a", secretAccessKey: "b" },
      requestHandler: {
        async handle(req: { headers: Record<string, string> }) {
          targets.push(req.headers["x-amz-target"] ?? "");
          if (throttlesLeft-- > 0) {
            return json(400, { __type: "ThrottlingException", message: "Rate exceeded" });
          }
          if (req.headers["x-amz-target"]?.endsWith("DescribeExecution")) {
            return json(200, { status: "RUNNING", startDate: 1_760_000_000 });
          }
          return json(200, { events: [] });
        },
      },
    });
    const p = await getRenderProgress({ executionArn: "arn:x", sfn });
    expect(p.status).toBe("RUNNING");
    expect(targets).toHaveLength(5);
  }, 20_000);

  it("requires executionArn", async () => {
    await expect(getRenderProgress({ executionArn: "" })).rejects.toThrow(/executionArn/);
  });

  describe("optimized lambda:invoke integration", () => {
    it("counts a single TaskSucceeded as one Lambda invocation", async () => {
      const sfn = new FakeSFN();
      sfn.historyPages = [
        [
          stateEntered("Plan"),
          taskScheduled(),
          taskSucceeded({ Action: "plan", TotalFrames: 240, DurationMs: 1_000 }),
        ],
      ];
      const progress = await getRenderProgress({
        executionArn: "arn",
        defaultMemorySizeMb: 10_240,
        sfn: sfn as unknown as SFNClient,
      });
      expect(progress.lambdasInvoked).toBe(1);
      expect(progress.totalFrames).toBe(240);
      // computeRenderCost rounds to 4 decimals; precision=4 not 6.
      expect(progress.costs.breakdown.lambdaUsd).toBeCloseTo(0.0002, 4);
      expect(progress.costs.breakdown.lambdaUsd).toBeGreaterThan(0);
    });

    it("attributes RenderChunk FramesEncoded but ignores Plan/Assemble FramesEncoded", async () => {
      const sfn = new FakeSFN();
      sfn.historyPages = [
        [
          stateEntered("Plan"),
          taskScheduled(),
          taskSucceeded({ Action: "plan", TotalFrames: 100, DurationMs: 1_000 }),
          stateEntered("RenderChunk"),
          taskScheduled(),
          taskSucceeded({ Action: "renderChunk", FramesEncoded: 50, DurationMs: 2_000 }),
          stateEntered("Assemble"),
          taskScheduled(),
          taskSucceeded({
            Action: "assemble",
            FramesEncoded: 100, // would double-count if Assemble's count bled in
            FileSize: 9_000_000,
            OutputS3Uri: "s3://b/k.mp4",
            DurationMs: 1_500,
          }),
        ],
      ];
      const progress = await getRenderProgress({
        executionArn: "arn",
        sfn: sfn as unknown as SFNClient,
      });
      expect(progress.framesRendered).toBe(50);
      expect(progress.lambdasInvoked).toBe(3);
    });

    it("captures TaskFailed errors with the enclosing state name", async () => {
      const sfn = new FakeSFN();
      sfn.historyPages = [
        [
          stateEntered("RenderChunk"),
          taskScheduled(),
          taskFailed("Sandbox.Timedout", "Task timed out after 900.00 seconds"),
        ],
      ];
      const progress = await getRenderProgress({
        executionArn: "arn",
        sfn: sfn as unknown as SFNClient,
      });
      expect(progress.errors).toEqual([
        {
          state: "RenderChunk",
          error: "Sandbox.Timedout",
          cause: "Task timed out after 900.00 seconds",
        },
      ]);
    });

    it("sums billed seconds across plan + chunks + assemble", async () => {
      const sfn = new FakeSFN();
      const renderChunkSucceeded = (frames: number, ms: number) => [
        stateEntered("RenderChunk"),
        taskScheduled(),
        taskSucceeded({ Action: "renderChunk", FramesEncoded: frames, DurationMs: ms }),
      ];
      // 1 plan + 16 chunks @ 217s + 1 assemble = 3492.7s billed.
      sfn.historyPages = [
        [
          stateEntered("Plan"),
          taskScheduled(),
          taskSucceeded({ Action: "plan", TotalFrames: 1349, DurationMs: 13_000 }),
          ...Array.from({ length: 16 }, () => renderChunkSucceeded(84, 217_000)).flat(),
          stateEntered("Assemble"),
          taskScheduled(),
          taskSucceeded({
            Action: "assemble",
            FileSize: 81_000_000,
            OutputS3Uri: "s3://b/k.mp4",
            DurationMs: 7_700,
          }),
        ],
      ];
      sfn.describe.status = "SUCCEEDED";
      const progress = await getRenderProgress({
        executionArn: "arn",
        defaultMemorySizeMb: 10_240,
        sfn: sfn as unknown as SFNClient,
      });
      // 3492.7s × 10GB × $0.0000166667/GB-s ≈ $0.582.
      expect(progress.costs.breakdown.lambdaUsd).toBeCloseTo(0.582, 2);
      expect(progress.framesRendered).toBe(84 * 16);
      expect(progress.lambdasInvoked).toBe(18);
    });
  });
});

void DescribeExecutionCommand;
void GetExecutionHistoryCommand;
