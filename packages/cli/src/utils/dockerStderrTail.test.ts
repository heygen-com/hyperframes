import { describe, expect, it } from "vitest";
import { createStderrTail, DockerRenderExitError } from "./dockerStderrTail.js";

describe("dockerStderrTail", () => {
  it("keeps only a bounded tail of stderr", () => {
    const tail = createStderrTail();
    tail.push("a".repeat(5000));
    tail.push("END");
    expect(tail.tail().length).toBeLessThanOrEqual(2000);
    expect(tail.tail().endsWith("END")).toBe(true);
  });

  it("prefers the last error-looking line over trailing noise", () => {
    const text = "starting\nError: Page crashed\nstack frame\n";
    expect(new DockerRenderExitError(1, text).message).toBe(
      "Docker render exited with code 1: Error: Page crashed",
    );
  });

  it("falls back to the last non-empty line", () => {
    expect(new DockerRenderExitError(1, "one\ntwo\n\n").message).toBe(
      "Docker render exited with code 1: two",
    );
  });

  it("skips stack frames, splits carriage-return progress, and caps a long line", () => {
    const msg = (tail: string) => new DockerRenderExitError(1, tail).message;
    expect(msg("Error: Page crashed\n  at CaptureFailure.run (x.js:1)")).toBe(
      "Docker render exited with code 1: Error: Page crashed",
    );
    expect(msg("10%\r50%\rfailed to launch")).toBe(
      "Docker render exited with code 1: failed to launch",
    );
    expect(msg(`error ${"x".repeat(500)}`).length).toBeLessThan(200);
  });

  it("names the exit code and the cause in the failure message", () => {
    const error = new DockerRenderExitError(137, "frame 10\nKilled");
    expect(error.message).toBe("Docker render exited with code 137: Killed");
    expect(new DockerRenderExitError(1, "").message).toBe("Docker render exited with code 1");
  });
});
