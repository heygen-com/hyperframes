import { describe, expect, it } from "vitest";
import { NO_SANDBOX_ARGS } from "../../core/src/chromeSandbox";
import { inspectorChromeArgs } from "./service";

describe("the inspector's Chrome", () => {
  it("drops the sandbox where the host can't give one, so it starts as root or in a container", () => {
    expect(inspectorChromeArgs(["--proxy-server=x"], false)).toEqual(
      expect.arrayContaining([...NO_SANDBOX_ARGS, "--proxy-server=x"]),
    );
  });

  it("keeps the sandbox where the host allows it", () => {
    const args = inspectorChromeArgs([], true);
    for (const flag of NO_SANDBOX_ARGS) expect(args).not.toContain(flag);
  });
});
