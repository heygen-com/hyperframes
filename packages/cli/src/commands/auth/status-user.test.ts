import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { writeStore } from "../../auth/store.js";

// Mock only AuthClient so the live /v3/users/me probe is controllable;
// keep the real store/resolver/user helpers so the test exercises the
// actual on-disk persisted-user-block surfacing.
//   - apiReject: throw ErrApi on getCurrentUser (simulates an API blip)
//   - user:      the live identity returned on success
const probeState = vi.hoisted(
  () =>
    ({ apiReject: false, user: { email: "live@example.com" } }) as {
      apiReject: boolean;
      user: Record<string, unknown>;
    },
);

vi.mock("../../auth/index.js", async (orig) => {
  const actual = await orig<typeof import("../../auth/index.js")>();
  class MockAuthClient {
    async getCurrentUser(): Promise<Record<string, unknown>> {
      if (probeState.apiReject) {
        const { ErrApi } = await import("../../auth/errors.js");
        throw ErrApi(503, "service unavailable");
      }
      return probeState.user;
    }
  }
  return { ...actual, AuthClient: MockAuthClient };
});

const ENV_KEYS = ["HEYGEN_API_KEY", "HYPERFRAMES_API_KEY", "HEYGEN_CONFIG_DIR"] as const;

describe("auth status — persisted user block surface", () => {
  let dir: string;
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};
  let stdout: string[];

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "hf-status-"));
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env["HEYGEN_CONFIG_DIR"] = dir;
    probeState.apiReject = false;
    probeState.user = { email: "live@example.com" };
    stdout = [];
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    vi.spyOn(console, "log").mockImplementation((...args: unknown[]) => {
      stdout.push(args.join(" "));
    });
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    for (const k of ENV_KEYS) {
      const v = saved[k];
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
    await fs.rm(dir, { recursive: true, force: true });
  });

  async function runStatus(asJson: boolean): Promise<number> {
    const cmd = (await import("./status.js")).default;
    try {
      await (cmd.run as (ctx: { args: Record<string, unknown> }) => Promise<void>)({
        args: { json: asJson },
      });
      return 0;
    } catch (err) {
      const m = /process\.exit:(\d+)/.exec((err as Error).message);
      if (m) return Number(m[1]);
      throw err;
    }
  }

  function lastJson(): Record<string, unknown> {
    return JSON.parse(stdout[stdout.length - 1] ?? "{}");
  }

  it("surfaces the persisted user block (with resolved display_name) for a file credential", async () => {
    await writeStore({
      api_key: "hg_x",
      user: { email: "jane@example.com", first_name: "Jane", last_name: "Doe", username: "jdoe" },
    });

    const code = await runStatus(true);
    expect(code).toBe(0);
    const payload = lastJson();
    expect(payload["source"]).toBe("file_json");
    expect(payload["persisted_user"]).toEqual({
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Doe",
      username: "jdoe",
      display_name: "jane@example.com",
    });
  });

  it("backwards-compat: a file credential with no user block reports persisted_user: null", async () => {
    await writeStore({ api_key: "hg_legacy" });

    const code = await runStatus(true);
    expect(code).toBe(0);
    const payload = lastJson();
    expect(payload["persisted_user"]).toBeNull();
    // The live `user` field (from the API probe) is unchanged / additive.
    expect(payload["user"]).toEqual({ email: "live@example.com" });
  });

  it("skips the persisted block for an env-sourced credential (could be a different key)", async () => {
    // Seed a file-side user block, then resolve via the env key — the
    // active credential is env, so the file block must NOT be surfaced.
    await writeStore({ api_key: "hg_file", user: { email: "file-user@example.com" } });
    process.env["HEYGEN_API_KEY"] = "hg_env_key";

    const code = await runStatus(true);
    expect(code).toBe(0);
    const payload = lastJson();
    expect(payload["source"]).toBe("env");
    expect(payload["persisted_user"]).toBeNull();
  });

  it("falls back to the cached identity in human output when the live probe fails", async () => {
    await writeStore({ api_key: "hg_x", user: { email: "cached@example.com" } });
    probeState.apiReject = true;

    const code = await runStatus(false);
    expect(code).toBe(1); // API failure → non-zero exit
    const text = stdout.join("\n");
    expect(text).toContain("API check failed");
    expect(text).toContain("cached@example.com");
    expect(text).toContain("cached");
  });
});
