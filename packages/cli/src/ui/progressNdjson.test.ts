import { describe, expect, it } from "vitest";

import {
  ProgressNdjsonWriter,
  createNdjsonSink,
  parseProgressFormat,
  redirectConsoleStdoutToStderr,
  type NdjsonRenderJobView,
} from "./progressNdjson.js";

const FIXED_NOW = () => new Date("2026-09-08T00:00:00.000Z");

function collectingWriter(row?: number): { writer: ProgressNdjsonWriter; lines: string[] } {
  const lines: string[] = [];
  const writer = new ProgressNdjsonWriter({
    sink: (line) => {
      lines.push(line);
    },
    row,
    now: FIXED_NOW,
  });
  return { writer, lines };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function parseEvents(lines: string[]): Record<string, unknown>[] {
  return lines.map((line) => {
    expect(line.endsWith("\n")).toBe(true);
    const parsed: unknown = JSON.parse(line);
    if (!isRecord(parsed)) throw new Error(`NDJSON line is not an object: ${line}`);
    return parsed;
  });
}

function firstEvent(lines: string[]): Record<string, unknown> {
  const [event] = parseEvents(lines);
  if (!event) throw new Error("expected at least one NDJSON event");
  return event;
}

function job(overrides: Partial<NdjsonRenderJobView> = {}): NdjsonRenderJobView {
  return {
    status: "rendering",
    progress: 42,
    currentStage: "Capturing frames",
    framesRendered: 120,
    totalFrames: 300,
    ...overrides,
  };
}

describe("parseProgressFormat", () => {
  it("accepts the three documented formats", () => {
    expect(parseProgressFormat("tty")).toBe("tty");
    expect(parseProgressFormat("ndjson")).toBe("ndjson");
    expect(parseProgressFormat("none")).toBe("none");
  });

  it("rejects anything else", () => {
    expect(parseProgressFormat("json")).toBeUndefined();
    expect(parseProgressFormat("")).toBeUndefined();
    expect(parseProgressFormat("NDJSON")).toBeUndefined();
  });
});

describe("ProgressNdjsonWriter", () => {
  it("emits one newline-terminated render.progress object per tick", () => {
    const { writer, lines } = collectingWriter();

    writer.publish(job(), "Capturing frames");

    const event = firstEvent(lines);
    expect(event).toEqual({
      type: "render.progress",
      ts: "2026-09-08T00:00:00.000Z",
      progress: 0.42,
      status: "rendering",
      stage: "Capturing frames",
      message: "Capturing frames",
      framesRendered: 120,
      totalFrames: 300,
      failedStage: null,
    });
  });

  it("preserves publish order across ticks", () => {
    const { writer, lines } = collectingWriter();

    writer.publish(job({ status: "preprocessing", progress: 5 }), "Compiling");
    writer.publish(job({ progress: 50 }), "Capturing frames");
    writer.publish(job({ status: "encoding", progress: 90 }), "Encoding");

    const events = parseEvents(lines);
    expect(events.map((event) => event.progress)).toEqual([0.05, 0.5, 0.9]);
    expect(events.map((event) => event.status)).toEqual(["preprocessing", "rendering", "encoding"]);
  });

  it("maps a terminal complete tick to render.completed", () => {
    const { writer, lines } = collectingWriter();

    writer.publish(
      job({ status: "complete", progress: 100, framesRendered: 300 }),
      "Render complete",
    );

    const event = firstEvent(lines);
    expect(event.type).toBe("render.completed");
    expect(event.progress).toBe(1);
    expect(event.framesRendered).toBe(300);
  });

  it("maps a terminal failed tick to render.failed with the producer failure contract", () => {
    const { writer, lines } = collectingWriter();

    writer.publish(
      job({
        status: "failed",
        progress: 61,
        error: "Chrome crashed",
        failedStage: "Capturing frames",
        errorDetails: { message: "Chrome crashed", elapsedMs: 1234, freeMemoryMB: 900 },
      }),
      "Failed: Chrome crashed",
    );

    const event = firstEvent(lines);
    expect(event).toMatchObject({
      type: "render.failed",
      status: "failed",
      progress: 0.61,
      error: "Chrome crashed",
      failedStage: "Capturing frames",
      errorDetails: { message: "Chrome crashed", elapsedMs: 1234, freeMemoryMB: 900 },
    });
  });

  it("emits render.failed even when no job ever existed", () => {
    const { writer, lines } = collectingWriter();

    writer.failed("Chrome not found");

    const event = firstEvent(lines);
    expect(event).toMatchObject({
      type: "render.failed",
      progress: 0,
      stage: "pipeline",
      error: "Chrome not found",
      failedStage: null,
      errorDetails: null,
    });
  });

  it("emits exactly one terminal event per writer", () => {
    const { writer, lines } = collectingWriter();

    writer.publish(job({ status: "failed", error: "boom", failedStage: "Encoding" }), "Failed");
    writer.completed(job());
    writer.failed("boom again");
    writer.publish(job(), "late tick");

    const events = parseEvents(lines);
    expect(events).toHaveLength(1);
    expect(events[0]?.type).toBe("render.failed");
  });

  it("does not emit events after the completed terminal event", () => {
    const { writer, lines } = collectingWriter();

    writer.publish(job(), "Capturing frames");
    writer.completed(job({ framesRendered: 300 }));
    writer.publish(job(), "stray teardown tick");
    writer.completed(job());

    const events = parseEvents(lines);
    expect(events.map((event) => event.type)).toEqual(["render.progress", "render.completed"]);
  });

  it("latches after a cancelled tick", () => {
    const { writer, lines } = collectingWriter();

    writer.publish(job({ status: "cancelled" }), "Cancelled");
    writer.publish(job(), "stray tick");

    const events = parseEvents(lines);
    expect(events).toHaveLength(1);
    expect(events[0]?.status).toBe("cancelled");
  });

  it("stamps the batch row index on every event", () => {
    const { writer, lines } = collectingWriter(7);

    writer.publish(job(), "Capturing frames");
    writer.completed(job());

    const events = parseEvents(lines);
    expect(events.map((event) => event.row)).toEqual([7, 7]);
  });

  it("omits the row field outside batch renders", () => {
    const { writer, lines } = collectingWriter();

    writer.publish(job(), "Capturing frames");

    const event = firstEvent(lines);
    expect("row" in event).toBe(false);
  });

  it("clamps out-of-range progress into the 0-1 fraction", () => {
    const { writer, lines } = collectingWriter();

    writer.publish(job({ progress: -5 }), "warming up");
    writer.publish(job({ progress: 250 }), "overshoot");

    const events = parseEvents(lines);
    expect(events.map((event) => event.progress)).toEqual([0, 1]);
  });

  it("defaults missing frame counters to zero", () => {
    const { writer, lines } = collectingWriter();

    writer.publish(job({ framesRendered: undefined, totalFrames: undefined }), "starting");

    const event = firstEvent(lines);
    expect(event.framesRendered).toBe(0);
    expect(event.totalFrames).toBe(0);
  });

  it("disables the stream instead of throwing when the sink breaks", () => {
    const lines: string[] = [];
    let calls = 0;
    const writer = new ProgressNdjsonWriter({
      sink: (line) => {
        calls++;
        if (calls > 1) throw new Error("EPIPE");
        lines.push(line);
      },
      now: FIXED_NOW,
    });

    writer.publish(job(), "tick 1");
    expect(() => writer.publish(job(), "tick 2")).not.toThrow();
    writer.publish(job(), "tick 3");

    expect(lines).toHaveLength(1);
    expect(calls).toBe(2);
  });
});

describe("redirectConsoleStdoutToStderr", () => {
  it("reroutes the stdout-bound console channels to console.error", () => {
    const calls: unknown[][] = [];
    const fake = {
      log: (..._args: unknown[]) => {},
      info: (..._args: unknown[]) => {},
      debug: (..._args: unknown[]) => {},
      error: (...args: unknown[]) => {
        calls.push(args);
      },
    };

    redirectConsoleStdoutToStderr(fake);
    fake.log("[BrowserManager] Browser launched");
    fake.info("info line");
    fake.debug("debug line");

    expect(calls).toEqual([["[BrowserManager] Browser launched"], ["info line"], ["debug line"]]);
  });
});

describe("createNdjsonSink", () => {
  it("writes to stdout when no fd is given", () => {
    const originalWrite = process.stdout.write.bind(process.stdout);
    let output = "";
    process.stdout.write = ((chunk: string | Uint8Array) => {
      output += String(chunk);
      return true;
    }) as typeof process.stdout.write;
    try {
      createNdjsonSink()('{"type":"render.progress"}\n');
    } finally {
      process.stdout.write = originalWrite;
    }
    expect(output).toBe('{"type":"render.progress"}\n');
  });
});
