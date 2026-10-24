import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
const mocks = vi.hoisted(() => ({ resolve4: vi.fn(), request: vi.fn(), execFile: vi.fn() }));
vi.mock("node:child_process", () => ({ execFile: mocks.execFile }));
vi.mock("node:fs/promises", () => ({ readFile: async () => "" }));
vi.mock("node:dns", () => ({
  promises: {
    Resolver: class {
      resolve4 = mocks.resolve4;
      cancel() {}
    },
  },
}));
vi.mock("node:http", () => ({ request: mocks.request }));
vi.mock("node:https", () => ({ request: mocks.request }));
import {
  isPublicIPv4,
  publicRequest,
  resolvePublicAddress,
  systemLookupInKillableChild,
} from "./publicNetwork.js";

/** A lookup child that has not exited; the exit hook kills every one still live. */
function liveChild() {
  return Object.assign(new EventEmitter(), { kill: vi.fn() });
}

/** The system lookup child prints `stdout`, or fails with `stderr`. */
function systemLookupPrints(stdout: string, stderr = "") {
  mocks.execFile.mockImplementation((_file, _args, _options, callback) => {
    callback(stdout ? null : new Error("Command failed"), stdout, stderr);
    return liveChild();
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  systemLookupPrints("", "ENOTFOUND");
});
describe("public address policy", () => {
  it.each([
    "127.0.0.1",
    "10.0.0.1",
    "172.16.0.1",
    "192.168.0.1",
    "169.254.169.254",
    "100.64.0.1",
    "0.1.2.3",
    "192.0.0.9",
    "192.0.2.1",
    "198.18.0.1",
    "198.51.100.1",
    "203.0.113.1",
    "224.0.0.1",
    "240.0.0.1",
    "::1",
    "::ffff:8.8.8.8",
    "8.8.8.999",
  ])("rejects %s", (ip) => expect(isPublicIPv4(ip)).toBe(false));
  it("accepts public literals without DNS", async () => {
    await expect(resolvePublicAddress("8.8.8.8")).resolves.toBe("8.8.8.8");
    expect(mocks.resolve4).not.toHaveBeenCalled();
  });
  it.each([
    "localhost",
    "localhost.",
    "foo.localhost",
    "router.local",
    "metadata.google.internal",
    "[::1]",
  ])("blocks alias/literal %s before DNS", async (host) => {
    await expect(resolvePublicAddress(host)).rejects.toThrow();
    expect(mocks.resolve4).not.toHaveBeenCalled();
  });
  it("rejects mixed DNS before opening a socket", async () => {
    mocks.resolve4.mockResolvedValue(["8.8.8.8", "127.0.0.1"]);
    await expect(publicRequest("http://example.com/")).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
  it.each([{ answers: [] }, { answers: ["::ffff:8.8.8.8"] }])(
    "rejects empty or malformed DNS",
    async ({ answers }) => {
      mocks.resolve4.mockResolvedValue(answers);
      await expect(resolvePublicAddress("example.com")).rejects.toThrow();
    },
  );
  it("fails when neither DNS nor the system lookup answers", async () => {
    mocks.resolve4.mockRejectedValue(new Error("queryA ENOTFOUND"));
    await expect(resolvePublicAddress("example.com")).rejects.toThrow(
      "Capture DNS failed: ENOTFOUND",
    );
  });
  it("checks a system answer like a DNS one, and asks the system once per host", async () => {
    mocks.resolve4.mockRejectedValue(new Error("queryA ENOTFOUND"));
    systemLookupPrints('["127.0.0.1"]');
    await expect(resolvePublicAddress("hosts-file.example.org")).rejects.toThrow(/non-public/);
    systemLookupPrints('["8.8.8.8"]');
    await expect(resolvePublicAddress("cached.example.org")).resolves.toBe("8.8.8.8");
    await expect(resolvePublicAddress("cached.example.org")).resolves.toBe("8.8.8.8");
    expect(mocks.execFile).toHaveBeenCalledTimes(2);
  });
  it("holds a later caller to its own deadline when it joins a system lookup already running", async () => {
    vi.useFakeTimers();
    try {
      mocks.resolve4.mockRejectedValue(new Error("queryA ENOTFOUND"));
      mocks.execFile.mockImplementation(() => liveChild());
      const first = resolvePublicAddress("slow.example.org").catch((error: Error) => error.message);
      await vi.advanceTimersByTimeAsync(9_000);
      const second = resolvePublicAddress("slow.example.org").catch(
        (error: Error) => error.message,
      );
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await first).toBe("Capture DNS timed out");
      await vi.advanceTimersByTimeAsync(8_000);
      expect(await Promise.race([second, "still waiting"])).toBe("still waiting");
      await vi.advanceTimersByTimeAsync(1_000);
      expect(await second).toBe("Capture DNS timed out");
      expect(mocks.execFile).toHaveBeenCalledOnce();
      expect(mocks.resolve4).toHaveBeenCalledOnce();
    } finally {
      vi.useRealTimers();
    }
  });
  it("never starts the system lookup when DNS answers", async () => {
    mocks.resolve4.mockResolvedValue(["8.8.8.8"]);
    await expect(resolvePublicAddress("example.org")).resolves.toBe("8.8.8.8");
    expect(mocks.execFile).not.toHaveBeenCalled();
  });
});

function fakeRequest() {
  const req = Object.assign(new EventEmitter(), {
    end: vi.fn(),
    destroy: vi.fn(),
    setTimeout: vi.fn(),
  });
  mocks.request.mockImplementation((_options, callback) => {
    req.end.mockImplementation(() => {
      const incoming = Object.assign(new PassThrough(), {
        statusCode: 302,
        statusMessage: "Found",
        headers: { location: "http://127.0.0.1/" },
      });
      callback(incoming);
      incoming.end("redirect");
    });
    return req;
  });
  return req;
}
describe("pinned request", () => {
  it("dials the checked numeric IP only, preserving TLS identity and manual redirects", async () => {
    mocks.resolve4.mockResolvedValueOnce(["8.8.8.8"]).mockResolvedValue(["127.0.0.1"]);
    fakeRequest();
    const response = await publicRequest("https://example.com:8443/path?q=1", {
      headers: { host: "evil.test", "accept-encoding": "gzip" },
    });
    expect(mocks.resolve4).toHaveBeenCalledTimes(1);
    expect(mocks.request).toHaveBeenCalledTimes(1);
    expect(mocks.request.mock.calls[0]?.[0]).toMatchObject({
      hostname: "8.8.8.8",
      servername: "example.com",
      rejectUnauthorized: true,
      port: "8443",
      path: "/path?q=1",
      agent: false,
      headers: { host: "example.com:8443", "accept-encoding": "identity" },
    });
    expect(response.status).toBe(302);
    expect(await response.text()).toBe("redirect");
  });
  it.each(["file:///tmp/a", "http://user:secret@example.com"])(
    "rejects unsafe URL %s",
    async (url) => {
      await expect(publicRequest(url)).rejects.toThrow();
      expect(mocks.request).not.toHaveBeenCalled();
    },
  );
  it("does not dial after abort during DNS", async () => {
    const controller = new AbortController();
    mocks.resolve4.mockImplementation(async () => {
      controller.abort();
      return ["8.8.8.8"];
    });
    await expect(
      publicRequest("https://example.com", { signal: controller.signal }),
    ).rejects.toThrow();
    expect(mocks.request).not.toHaveBeenCalled();
  });
});

describe("transport lifecycle", () => {
  it("cancels the upstream stream and socket when the body is cancelled", async () => {
    mocks.resolve4.mockResolvedValue(["8.8.8.8"]);
    const incoming = Object.assign(new PassThrough(), { statusCode: 200, headers: {} });
    const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
    mocks.request.mockImplementation((_options, callback) => {
      req.end.mockImplementation(() => callback(incoming));
      return req;
    });
    const response = await publicRequest("https://example.com");
    await response.body?.cancel();
    expect(incoming.destroyed).toBe(true);
    expect(req.destroy).toHaveBeenCalled();
    // Socket teardown may race already queued terminal/data notifications.
    expect(() => {
      incoming.emit("aborted");
      incoming.emit("error", new Error("late socket error"));
      incoming.emit("data", Buffer.from("late bytes"));
      incoming.emit("end");
    }).not.toThrow();
  });
  it("fails unsupported compressed responses instead of returning corrupted asset bytes", async () => {
    mocks.resolve4.mockResolvedValue(["8.8.8.8"]);
    const incoming = Object.assign(new PassThrough(), {
      statusCode: 200,
      headers: { "content-encoding": "gzip" },
    });
    const req = Object.assign(new EventEmitter(), { end: vi.fn(), destroy: vi.fn() });
    mocks.request.mockImplementation((_options, callback) => {
      req.end.mockImplementation(() => callback(incoming));
      return req;
    });
    await expect(publicRequest("https://example.com")).rejects.toThrow("content encoding");
    expect(incoming.destroyed).toBe(true);
  });
});

describe("system lookup children", () => {
  it("kills every lookup still live when the process exits", () => {
    const child = liveChild();
    mocks.execFile.mockImplementation(() => child);
    void systemLookupInKillableChild("live.example.org", 60_000).catch(() => {});
    const exitHooks = process.listeners("exit").filter((hook) => hook.name === "killLiveLookups");
    expect(exitHooks).toHaveLength(1);
    // Earlier tests' children are still live too, so this also fails if any fake lacks kill().
    for (const hook of exitHooks) hook(0);
    expect(child.kill).toHaveBeenCalledWith("SIGKILL");
  });
});
