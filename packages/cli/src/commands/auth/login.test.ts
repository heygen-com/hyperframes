import { promises as fs } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStore, writeStore } from "../../auth/store.js";

// Mock only AuthClient — keep the real store/resolver so the test
// exercises the actual on-disk rollback / persistence behavior.
// `verifyState` controls what `getCurrentUser` returns per test:
//   - reject: throw ErrUnauthenticated (invalid key path)
//   - user:   the /v3/users/me identity returned on success
const verifyState = vi.hoisted(
  () =>
    ({ reject: false, user: { email: "alice@example.com" } }) as {
      reject: boolean;
      user: Record<string, unknown>;
    },
);

vi.mock("../../auth/index.js", async (orig) => {
  const actual = await orig<typeof import("../../auth/index.js")>();
  class MockAuthClient {
    async getCurrentUser(): Promise<Record<string, unknown>> {
      if (verifyState.reject) {
        const { ErrUnauthenticated: rej } = await import("../../auth/errors.js");
        throw rej("invalid key");
      }
      return verifyState.user;
    }
  }
  return { ...actual, AuthClient: MockAuthClient };
});

const ENV_KEYS = ["HEYGEN_API_KEY", "HYPERFRAMES_API_KEY", "HEYGEN_CONFIG_DIR"] as const;

describe("auth login --api-key rollback", () => {
  let dir: string;
  const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

  beforeEach(async () => {
    dir = await fs.mkdtemp(join(tmpdir(), "hf-login-"));
    for (const k of ENV_KEYS) {
      saved[k] = process.env[k];
      delete process.env[k];
    }
    process.env["HEYGEN_CONFIG_DIR"] = dir;
    verifyState.reject = false;
    verifyState.user = { email: "alice@example.com" };
    // process.exit throws so we can assert the post-rollback state.
    vi.spyOn(process, "exit").mockImplementation(((code?: string | number | null) => {
      throw new Error(`process.exit:${code ?? 0}`);
    }) as never);
    vi.spyOn(console, "log").mockImplementation(() => {});
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

  async function runLogin(apiKey: string): Promise<void> {
    const cmd = (await import("./login.js")).default;
    // citty command run only reads `args` here.
    await (cmd.run as (ctx: { args: Record<string, unknown> }) => Promise<void>)({
      args: { "api-key": apiKey },
    });
  }

  it("removes the rejected key on a failed FIRST login (no prior credential)", async () => {
    verifyState.reject = true;
    await expect(runLogin("hg_badkey123")).rejects.toThrow(/process\.exit:1/);

    // The store must NOT retain the rejected key — otherwise the next
    // command would silently resolve a known-bad credential.
    const { source } = await readStore();
    expect(source).toBe("absent");
  });

  it("restores the previous credential on a failed re-login", async () => {
    await writeStore({ api_key: "hg_previous_good" });
    verifyState.reject = true;
    await expect(runLogin("hg_newbadkey99")).rejects.toThrow(/process\.exit:1/);

    const { credentials } = await readStore();
    expect(credentials.api_key).toBe("hg_previous_good");
  });

  it("persists the key on a successful login", async () => {
    verifyState.reject = false;
    await runLogin("hg_goodkey456");
    const { credentials } = await readStore();
    expect(credentials.api_key).toBe("hg_goodkey456");
  });

  it("persists the friendly user block from /v3/users/me on a successful login", async () => {
    verifyState.user = {
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Doe",
      username: "jdoe",
    };
    await runLogin("hg_goodkey456");
    const { credentials } = await readStore();
    expect(credentials.api_key).toBe("hg_goodkey456");
    expect(credentials.user).toEqual({
      email: "jane@example.com",
      first_name: "Jane",
      last_name: "Doe",
      username: "jdoe",
    });
  });

  it("clears a stale user block when the new key's identity probe returns nothing", async () => {
    // Prior login left a user block on disk. The new key is valid but
    // /v3/users/me returns no identity fields — the stale block must be
    // cleared so `auth status` can't surface the previous account.
    await writeStore({ api_key: "hg_old", user: { email: "old@example.com" } });
    verifyState.user = {}; // verified, but no identity returned
    await runLogin("hg_newgoodkey");

    const { credentials } = await readStore();
    expect(credentials.api_key).toBe("hg_newgoodkey");
    expect(credentials.user).toBeUndefined();
  });

  it("rollback on a rejected key restores the previous user block too", async () => {
    await writeStore({ api_key: "hg_prev", user: { email: "prev@example.com" } });
    verifyState.reject = true;
    await expect(runLogin("hg_badnewkey")).rejects.toThrow(/process\.exit:1/);

    const { credentials } = await readStore();
    expect(credentials.api_key).toBe("hg_prev");
    expect(credentials.user).toEqual({ email: "prev@example.com" });
  });

  it("rollback on a rejected key preserves a prior foreign top-level key (no known credential)", async () => {
    // The prior file held ONLY a future/foreign top-level key — no
    // api_key, no oauth. A rejected new key must roll back WITHOUT
    // deleting the file, or the foreign credential another CLI owns is
    // clobbered. (Before the fix, rollback deleted the file because
    // neither api_key nor oauth was present.)
    await fs.writeFile(
      join(dir, "credentials"),
      JSON.stringify({ future_credential: { token: "owned_by_other_cli" } }),
      { mode: 0o600 },
    );
    verifyState.reject = true;
    await expect(runLogin("hg_badnewkey")).rejects.toThrow(/process\.exit:1/);

    const onDisk = JSON.parse(await fs.readFile(join(dir, "credentials"), "utf8"));
    expect(onDisk.api_key).toBeUndefined();
    expect(onDisk.future_credential).toEqual({ token: "owned_by_other_cli" });
  });

  it("preserves an unknown/foreign top-level key across a successful re-login", async () => {
    // Cross-CLI invariant end-to-end: a key heygen-cli (or a future
    // version) wrote must survive a hyperframes-cli login round-trip.
    await fs.writeFile(join(dir, "credentials"), JSON.stringify({ future_field: { x: 1 } }), {
      mode: 0o600,
    });
    verifyState.user = { email: "jane@example.com" };
    await runLogin("hg_goodkey456");

    const onDisk = JSON.parse(await fs.readFile(join(dir, "credentials"), "utf8"));
    expect(onDisk.api_key).toBe("hg_goodkey456");
    expect(onDisk.user).toEqual({ email: "jane@example.com" });
    expect(onDisk.future_field).toEqual({ x: 1 });
  });
});
