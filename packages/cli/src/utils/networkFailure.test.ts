import { describe, expect, it } from "vitest";
import { describeCauseChain, explainNetworkFailure, NetworkFailure } from "./networkFailure.js";

const URL_ = "https://api.heygen.com/v3/users/me";

function undiciFailure(cause: Error): TypeError {
  return new TypeError("fetch failed", { cause });
}

function errno(message: string, code: string): Error {
  return Object.assign(new Error(message), { code });
}

describe("explainNetworkFailure", () => {
  it("names the host, a lookup failure as offline, and the next step", () => {
    const error = explainNetworkFailure(
      undiciFailure(errno("getaddrinfo ENOTFOUND api.heygen.com", "ENOTFOUND")),
      URL_,
    );
    expect(error).toBeInstanceOf(NetworkFailure);
    expect((error as NetworkFailure).message).toBe(
      "Could not reach api.heygen.com: its address could not be looked up (DNS); this machine looks offline.",
    );
    expect((error as NetworkFailure).hint).toContain("internet connection");
  });

  it("tells a missing route, a timeout and a refusal apart", () => {
    const reason = (cause: Error) =>
      (explainNetworkFailure(undiciFailure(cause), URL_) as Error).message;
    expect(reason(errno("connect ENETUNREACH 1.2.3.4:443", "ENETUNREACH"))).toContain(
      "no network route",
    );
    expect(reason(errno("Connect Timeout Error", "UND_ERR_CONNECT_TIMEOUT"))).toContain(
      "did not answer in time",
    );
    expect(reason(errno("connect ECONNREFUSED 1.2.3.4:443", "ECONNREFUSED"))).toContain(
      "refused the connection",
    );
  });

  it("reads an AbortSignal timeout as no answer in time", () => {
    const timeout = new DOMException("The operation was aborted due to timeout", "TimeoutError");
    expect((explainNetworkFailure(timeout, URL_) as Error).message).toBe(
      "Could not reach api.heygen.com: it did not answer in time.",
    );
  });

  it("leaves an error that is not a transport failure alone", () => {
    const other = new Error("HeyGen API error (500)");
    expect(explainNetworkFailure(other, URL_)).toBe(other);
  });
});

describe("describeCauseChain", () => {
  it("surfaces the reason undici hides under cause", () => {
    // The reported failure. `fetch failed` alone describes every network
    // problem equally badly; the sentence that tells you what to do is one
    // level down, and it was being dropped.
    const err = new Error("fetch failed", {
      cause: new Error("self-signed certificate in certificate chain"),
    });

    expect(describeCauseChain(err)).toBe(
      "fetch failed (self-signed certificate in certificate chain)",
    );
  });

  it("includes an errno code when the message does not already carry it", () => {
    const inner = Object.assign(new Error("getaddrinfo ENOTFOUND example.invalid"), {
      code: "ENOTFOUND",
    });

    // The code is already in the text, so repeating it would be noise.
    expect(describeCauseChain(new Error("fetch failed", { cause: inner }))).toBe(
      "fetch failed (getaddrinfo ENOTFOUND example.invalid)",
    );
  });

  it("walks more than one level", () => {
    const deep = new Error("a", { cause: new Error("b", { cause: new Error("c") }) });

    expect(describeCauseChain(deep)).toBe("a (b; c)");
  });

  it("survives a cause cycle rather than hanging", () => {
    const a = new Error("a");
    const b = new Error("b", { cause: a });
    (a as { cause?: unknown }).cause = b;

    expect(describeCauseChain(a)).toBe("a (b)");
  });

  it("returns the plain message when there is no cause", () => {
    expect(describeCauseChain(new Error("HTTP 404"))).toBe("HTTP 404");
  });
});
