import { afterEach, describe, expect, it, vi } from "vitest";
import {
  lifecycleFailurePayload,
  lifecyclePayload,
  writeLifecycleJson,
  type PreviewLifecycleSession,
} from "./previewLifecycleOutput.js";

const session: PreviewLifecycleSession = {
  state: "started",
  mode: "background",
  projectName: "demo",
  projectDir: "/tmp/demo",
  host: "127.0.0.1",
  port: 3002,
  pid: 42,
  serverUrl: "http://127.0.0.1:3002",
  studioUrl: "http://127.0.0.1:3002/#project/demo",
  ready: true,
  logPath: "/tmp/demo.log",
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("preview lifecycle JSON", () => {
  it("versions a managed start result", () => {
    expect(lifecyclePayload("start", session)).toEqual({
      schemaVersion: 1,
      operation: "start",
      ok: true,
      result: session,
    });
  });

  it.each([
    ["status", { state: "not-running", projectDir: "/tmp/demo" }],
    ["stop", { state: "stopped", projectDir: "/tmp/demo" }],
    ["list", { state: "listed", sessions: [session] }],
    ["kill-all", { state: "killed-all", stopped: 1 }],
  ] as const)("versions the %s result", (operation, result) => {
    expect(lifecyclePayload(operation, result)).toMatchObject({
      schemaVersion: 1,
      operation,
      ok: true,
      result,
    });
  });

  it("writes exactly one parseable JSON document", () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    writeLifecycleJson(lifecyclePayload("start", { ...session, pid: null, state: "reused" }));

    expect(log).toHaveBeenCalledOnce();
    const [line] = log.mock.calls[0] as [string];
    expect(JSON.parse(line)).toEqual({
      schemaVersion: 1,
      operation: "start",
      ok: true,
      result: { ...session, pid: null, state: "reused" },
    });
  });

  it("versions lifecycle failures with a stable code", () => {
    expect(
      lifecycleFailurePayload(
        "start",
        "conflicting-lifecycle-flags",
        "--background and --foreground cannot be used together",
      ),
    ).toEqual({
      schemaVersion: 1,
      operation: "start",
      ok: false,
      error: {
        code: "conflicting-lifecycle-flags",
        message: "--background and --foreground cannot be used together",
      },
    });
  });
});
