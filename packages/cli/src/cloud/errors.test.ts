import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// errorBox writes to the console; mock it so we can assert which title /
// message / third line the cascade picked without matching ANSI output.
vi.mock("../ui/format.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../ui/format.js")>()),
  errorBox: vi.fn(),
}));

import { errorBox } from "../ui/format.js";
import { HyperframesApiError } from "./_gen/client.js";
import { reportApiError } from "./errors.js";

describe("cloud/errors reportApiError", () => {
  // process.exit has signature `(code?) => never` which doesn't unify with
  // vi.spyOn's inference; cast through `unknown` like cloud/parsing.test.ts.
  let exitSpy: { mockRestore: () => void } & { mock: { calls: unknown[][] } };

  beforeEach(() => {
    exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
      throw new Error("process.exit called");
    }) as unknown as (code?: string | number | null) => never) as unknown as typeof exitSpy;
    vi.mocked(errorBox).mockClear();
  });

  afterEach(() => {
    exitSpy.mockRestore();
  });

  it("short-circuits a 404 to a Not found box when notFound is provided", () => {
    const err = new HyperframesApiError({ status: 404, message: "missing" });
    expect(() =>
      reportApiError("Get failed", err, { notFound: "render hfr_x no longer exists" }),
    ).toThrow("process.exit called");
    expect(errorBox).toHaveBeenCalledWith("Not found", "render hfr_x no longer exists");
    expect(exitSpy).toHaveBeenCalledWith(1);
  });

  it("uses the code-specific hint when the error code is known", () => {
    const err = new HyperframesApiError({
      status: 429,
      message: "slow down",
      code: "rate_limit_exceeded",
    });
    expect(() => reportApiError("Submit failed", err)).toThrow("process.exit called");
    expect(errorBox).toHaveBeenCalledWith(
      "Submit failed (HTTP 429)",
      "slow down",
      "Retry after the duration in the Retry-After header.",
    );
  });

  it("points oversized projects to dry-run and .hyperframesignore", () => {
    const err = new HyperframesApiError({
      status: 413,
      message: "project too large",
      code: "hyperframes_project_too_large",
    });
    expect(() => reportApiError("Upload failed", err)).toThrow("process.exit called");
    expect(errorBox).toHaveBeenCalledWith(
      "Upload failed (HTTP 413)",
      "project too large",
      "The zip exceeded the 200 MB limit. Run `hyperframes cloud render --dry-run`, then add only verified-unneeded paths to `.hyperframesignore` or pre-host required large media.",
    );
  });

  it("prefers the code-specific hint over a caller suggestion", () => {
    const err = new HyperframesApiError({
      status: 400,
      message: "bad param",
      code: "invalid_parameter",
    });
    expect(() => reportApiError("Submit failed", err, { suggestion: "see --help" })).toThrow(
      "process.exit called",
    );
    expect(errorBox).toHaveBeenCalledWith(
      "Submit failed (HTTP 400)",
      "bad param",
      "Check the listed parameter against `hyperframes cloud render --help` for the accepted values.",
    );
  });

  it("falls back to the caller suggestion when the code has no hint", () => {
    const err = new HyperframesApiError({
      status: 500,
      message: "boom",
      code: "some_unmapped_code",
    });
    expect(() => reportApiError("List failed", err, { suggestion: "retry shortly" })).toThrow(
      "process.exit called",
    );
    expect(errorBox).toHaveBeenCalledWith("List failed (HTTP 500)", "boom", "retry shortly");
  });

  it("falls back to a bare code label when there is no hint and no suggestion", () => {
    const err = new HyperframesApiError({
      status: 500,
      message: "boom",
      code: "some_unmapped_code",
    });
    expect(() => reportApiError("List failed", err)).toThrow("process.exit called");
    expect(errorBox).toHaveBeenCalledWith(
      "List failed (HTTP 500)",
      "boom",
      "code: some_unmapped_code",
    );
  });

  it("omits the third line when there is no code, hint, or suggestion", () => {
    const err = new HyperframesApiError({ status: 503, message: "unavailable" });
    expect(() => reportApiError("Get failed", err)).toThrow("process.exit called");
    expect(errorBox).toHaveBeenCalledWith("Get failed (HTTP 503)", "unavailable");
  });

  it("merges extraHints on top of the built-in table", () => {
    const err = new HyperframesApiError({ status: 418, message: "teapot", code: "custom_code" });
    expect(() =>
      reportApiError("Brew failed", err, { extraHints: { custom_code: "use coffee instead" } }),
    ).toThrow("process.exit called");
    expect(errorBox).toHaveBeenCalledWith("Brew failed (HTTP 418)", "teapot", "use coffee instead");
  });

  it("lets an extraHints entry override a built-in hint", () => {
    const err = new HyperframesApiError({
      status: 429,
      message: "slow down",
      code: "rate_limit_exceeded",
    });
    expect(() =>
      reportApiError("Submit failed", err, {
        extraHints: { rate_limit_exceeded: "custom backoff guidance" },
      }),
    ).toThrow("process.exit called");
    expect(errorBox).toHaveBeenCalledWith(
      "Submit failed (HTTP 429)",
      "slow down",
      "custom backoff guidance",
    );
  });

  it("reports a plain Error with the stage title and suggestion", () => {
    expect(() =>
      reportApiError("Upload failed", new Error("disk full"), { suggestion: "free up space" }),
    ).toThrow("process.exit called");
    expect(errorBox).toHaveBeenCalledWith("Upload failed", "disk full", "free up space");
  });

  it("stringifies a non-Error thrown value", () => {
    expect(() => reportApiError("Weird failure", "just a string")).toThrow("process.exit called");
    expect(errorBox).toHaveBeenCalledWith("Weird failure", "just a string", undefined);
  });
});
