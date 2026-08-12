import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { readStore, writeStore } from "../../auth/store.js";
import { setupTempAuthEnv, type EnvFixture } from "../../auth/_test-utils.js";
import { CliRuntimeError } from "../../utils/commandResult.js";

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

// Spy on the telemetry the login flow emits, so we can assert the identity is
// attributed on success. login.ts imports these via a dynamic import of
// telemetry/index.js; the mock intercepts it.
const telemetry = vi.hoisted(() => ({
  trackAuthLoginStarted: vi.fn(),
  trackAuthLoginCompleted: vi.fn(),
  trackAuthLoginFailed: vi.fn(),
  identifyUser: vi.fn(),
}));
vi.mock("../../telemetry/index.js", () => telemetry);

const deviceChallenge = vi.hoisted(() => ({
  verificationUriComplete: undefined as string | undefined,
}));

const deviceAuth = vi.hoisted(() => ({
  start: vi.fn(async (options?: { onChallenge?: (value: unknown) => void }) => {
    options?.onChallenge?.({
      verificationUri: "https://app.heygen.com/oauth/device",
      ...(deviceChallenge.verificationUriComplete
        ? { verificationUriComplete: deviceChallenge.verificationUriComplete }
        : {}),
      userCode: "ABCD-2345",
    });
    return {
      access_token: "device-at",
      refresh_token: "device-rt",
      token_type: "Bearer",
    };
  }),
  persist: vi.fn(async () => {}),
  revoke: vi.fn(async () => {}),
}));

vi.mock("../../auth/index.js", async (orig) => {
  const actual = await orig<typeof import("../../auth/index.js")>();
  class MockAuthClient {
    async getCurrentUser(): Promise<Record<string, unknown>> {
      if (verifyState.reject) {
        const { ErrUnauthenticated: rej } = await import("../../auth/errors.js");
        throw rej("invalid token");
      }
      return verifyState.user;
    }
  }
  return {
    ...actual,
    AuthClient: MockAuthClient,
    startDeviceAuthorizationFlow: deviceAuth.start,
    persistVerifiedOAuthSession: deviceAuth.persist,
    revokeTokens: deviceAuth.revoke,
  };
});

describe("auth login", () => {
  let dir: string;
  let envFixture: EnvFixture;
  let runtimeEnv: Record<string, string | undefined>;
  let stdinTTYDescriptor: PropertyDescriptor | undefined;
  let stdoutTTYDescriptor: PropertyDescriptor | undefined;

  beforeEach(async () => {
    runtimeEnv = Object.fromEntries(
      [
        "CI",
        "SSH_CONNECTION",
        "SSH_CLIENT",
        "SSH_TTY",
        "BROWSER",
        "HF_NO_BROWSER",
        "CODESPACES",
        "GITHUB_CODESPACES",
        "REMOTE_CONTAINERS",
        "GITPOD_WORKSPACE_ID",
        "container",
      ].map((key) => [key, process.env[key]]),
    );
    for (const key of Object.keys(runtimeEnv)) delete process.env[key];
    stdinTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdin, "isTTY");
    stdoutTTYDescriptor = Object.getOwnPropertyDescriptor(process.stdout, "isTTY");
    Object.defineProperty(process.stdin, "isTTY", {
      configurable: true,
      value: true,
    });
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: true,
    });
    envFixture = await setupTempAuthEnv("hf-login-");
    dir = envFixture.dir;
    verifyState.reject = false;
    verifyState.user = { email: "alice@example.com" };
    deviceChallenge.verificationUriComplete = undefined;
    for (const fn of Object.values(telemetry)) fn.mockClear();
    for (const fn of Object.values(deviceAuth)) fn.mockClear();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    await envFixture.restore();
    for (const [key, value] of Object.entries(runtimeEnv)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    if (stdinTTYDescriptor) Object.defineProperty(process.stdin, "isTTY", stdinTTYDescriptor);
    else delete (process.stdin as { isTTY?: boolean }).isTTY;
    if (stdoutTTYDescriptor) Object.defineProperty(process.stdout, "isTTY", stdoutTTYDescriptor);
    else delete (process.stdout as { isTTY?: boolean }).isTTY;
  });

  async function runCommand(args: Record<string, unknown>): Promise<void> {
    const cmd = (await import("./login.js")).default;
    // citty command run only reads `args` here.
    await (cmd.run as (ctx: { args: Record<string, unknown> }) => Promise<void>)({
      args,
    });
  }

  async function runLogin(apiKey: string): Promise<void> {
    await runCommand({ "api-key": apiKey });
  }

  it("removes the rejected key on a failed FIRST login (no prior credential)", async () => {
    verifyState.reject = true;
    await expect(runLogin("hg_badkey123")).rejects.toThrow(CliRuntimeError);

    // The store must NOT retain the rejected key — otherwise the next
    // command would silently resolve a known-bad credential.
    const { source } = await readStore();
    expect(source).toBe("absent");
  });

  it("restores the previous credential on a failed re-login", async () => {
    await writeStore({ api_key: "hg_previous_good" });
    verifyState.reject = true;
    await expect(runLogin("hg_newbadkey99")).rejects.toThrow(CliRuntimeError);

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
    await writeStore({
      api_key: "hg_prev",
      user: { email: "prev@example.com" },
    });
    verifyState.reject = true;
    await expect(runLogin("hg_badnewkey")).rejects.toThrow(CliRuntimeError);

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
    await expect(runLogin("hg_badnewkey")).rejects.toThrow(CliRuntimeError);

    const onDisk = JSON.parse(await fs.readFile(join(dir, "credentials"), "utf8"));
    expect(onDisk.api_key).toBeUndefined();
    expect(onDisk.future_credential).toEqual({ token: "owned_by_other_cli" });
  });

  it("attributes a successful login to the account email", async () => {
    verifyState.user = { email: "alice@example.com", username: "alice" };
    await runLogin("hg_goodkey456");
    expect(telemetry.identifyUser).toHaveBeenCalledWith("alice@example.com");
    expect(telemetry.trackAuthLoginCompleted).toHaveBeenCalledWith("api_key", "alice@example.com");
  });

  it("falls back to username when the account has no email", async () => {
    verifyState.user = { username: "alice" };
    await runLogin("hg_goodkey456");
    expect(telemetry.identifyUser).toHaveBeenCalledWith("alice");
    expect(telemetry.trackAuthLoginCompleted).toHaveBeenCalledWith("api_key", "alice");
  });

  it("does not identify when the identity probe returns nothing", async () => {
    verifyState.user = {}; // verified key, but no identity fields
    await runLogin("hg_goodkey456");
    expect(telemetry.identifyUser).not.toHaveBeenCalled();
    expect(telemetry.trackAuthLoginCompleted).toHaveBeenCalledWith("api_key", undefined);
  });

  it("records a rejected key as failed and never identifies", async () => {
    verifyState.reject = true;
    await expect(runLogin("hg_badkey123")).rejects.toThrow(CliRuntimeError);
    expect(telemetry.identifyUser).not.toHaveBeenCalled();
    expect(telemetry.trackAuthLoginFailed).toHaveBeenCalledWith("api_key", "rejected");
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

  it("requires the explicit --device flag in a remote terminal", async () => {
    process.env["SSH_CONNECTION"] = "192.0.2.1 1234 192.0.2.2 22";
    await expect(runCommand({})).rejects.toThrow(/Invalid command usage/);
    expect(deviceAuth.start).not.toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining("hyperframes auth login --device"),
    );
  });

  it.each([
    "CODESPACES",
    "GITHUB_CODESPACES",
    "REMOTE_CONTAINERS",
    "GITPOD_WORKSPACE_ID",
    "container",
  ])("requires --device in the %s remote environment", async (name) => {
    process.env[name] = "true";
    await expect(runCommand({})).rejects.toThrow(/Invalid command usage/);
    expect(deviceAuth.start).not.toHaveBeenCalled();
  });

  it("opens verification_uri_complete without asking the user to re-enter the code", async () => {
    deviceChallenge.verificationUriComplete =
      "https://app.heygen.com/oauth/device?user_code=ABCD-2345";

    await runCommand({ device: true });

    expect(console.log).toHaveBeenCalledWith(
      expect.stringContaining("https://app.heygen.com/oauth/device?user_code=ABCD-2345"),
    );
    expect(console.log).not.toHaveBeenCalledWith(expect.stringContaining("Enter code"));
  });

  it("verifies the device token before persisting it", async () => {
    verifyState.user = { email: "device@example.com" };
    await runCommand({ device: true });

    expect(deviceAuth.start).toHaveBeenCalledOnce();
    expect(deviceAuth.persist).toHaveBeenCalledWith(
      expect.objectContaining({ access_token: "device-at" }),
      expect.objectContaining({ email: "device@example.com" }),
    );
    expect(deviceAuth.revoke).not.toHaveBeenCalled();
    expect(telemetry.trackAuthLoginCompleted).toHaveBeenCalledWith("device", "device@example.com");
  });

  it("revokes and never persists a device token that identity verification rejects", async () => {
    verifyState.reject = true;
    await expect(runCommand({ device: true })).rejects.toThrow(CliRuntimeError);

    expect(deviceAuth.persist).not.toHaveBeenCalled();
    expect(deviceAuth.revoke).toHaveBeenCalledTimes(2);
    expect(deviceAuth.revoke).toHaveBeenNthCalledWith(
      1,
      "device-at",
      expect.objectContaining({ token_type_hint: "access_token" }),
    );
    expect(deviceAuth.revoke).toHaveBeenNthCalledWith(
      2,
      "device-rt",
      expect.objectContaining({ token_type_hint: "refresh_token" }),
    );
    expect(telemetry.trackAuthLoginFailed).toHaveBeenCalledWith("device", "rejected");
  });

  it("refuses device authorization in CI", async () => {
    process.env["CI"] = "true";
    await expect(runCommand({ device: true })).rejects.toThrow(/Invalid command usage/);
    expect(deviceAuth.start).not.toHaveBeenCalled();
  });

  it("does not treat CI=false as an unattended environment", async () => {
    process.env["CI"] = "false";
    await runCommand({ device: true });
    expect(deviceAuth.start).toHaveBeenCalledOnce();
  });

  it("refuses device authorization when either terminal stream is not a TTY", async () => {
    Object.defineProperty(process.stdout, "isTTY", {
      configurable: true,
      value: undefined,
    });
    await expect(runCommand({ device: true })).rejects.toThrow(/Invalid command usage/);
    expect(deviceAuth.start).not.toHaveBeenCalled();
  });
});
