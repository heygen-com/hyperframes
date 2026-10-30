import { promises as fs } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupTempAuthEnv } from "./_test-utils.js";
import { persistFreshOAuth } from "./oauth.js";
import { withMediaAuthEnvironment } from "./media-environment.js";

describe("media-use authentication", () => {
  let fixture: Awaited<ReturnType<typeof setupTempAuthEnv>>;
  beforeEach(async () => {
    fixture = await setupTempAuthEnv();
  });
  afterEach(async () => {
    vi.unstubAllGlobals();
    await fixture.restore();
  });

  it("passes a fresh access token through a private, temporary Go credential file", async () => {
    await persistFreshOAuth({ access_token: "hf-access", refresh_token: "hf-refresh" });
    let path = "";
    await withMediaAuthEnvironment(async (env) => {
      path = join(env.HEYGEN_CONFIG_DIR!, "credentials");
      expect(env.HEYGEN_ACCESS_TOKEN).toBe("hf-access");
      expect(env.HEYGEN_API_BASE).toBe("https://api.heygen.com");
      expect(env.HEYGEN_API_KEY).toBeUndefined();
      const copied = JSON.parse(await fs.readFile(path, "utf8"));
      expect(copied.oauth.access_token).toBe("hf-access");
      expect(copied.oauth.refresh_token).toBeUndefined();
      if (process.platform !== "win32") {
        expect((await fs.stat(path)).mode & 0o777).toBe(0o600);
        expect((await fs.stat(env.HEYGEN_CONFIG_DIR!)).mode & 0o777).toBe(0o700);
      }
    });
    await expect(fs.stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await fs.readFile(join(fixture.dir, "credentials"), "utf8")).toContain("hf-refresh");
  });

  it("refreshes a token before a helper could outlive it", async () => {
    await persistFreshOAuth({
      access_token: "near-expiry",
      refresh_token: "hf-refresh",
      expires_at: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({ access_token: "refreshed", refresh_token: "rotated", expires_in: 3600 }),
          { status: 200, headers: { "content-type": "application/json" } },
        ),
    );
    vi.stubGlobal("fetch", fetchMock);
    await withMediaAuthEnvironment(async (env) => {
      expect(fetchMock).toHaveBeenCalledOnce();
      expect(env.HEYGEN_ACCESS_TOKEN).toBe("refreshed");
      const copied = JSON.parse(
        await fs.readFile(join(env.HEYGEN_CONFIG_DIR!, "credentials"), "utf8"),
      );
      expect(copied.oauth.access_token).toBe("refreshed");
      expect(copied.oauth.refresh_token).toBeUndefined();
    });
    expect(await fs.readFile(join(fixture.dir, "credentials"), "utf8")).toContain("rotated");
  });

  it("refuses to send OAuth to a non-HeyGen media gateway", async () => {
    await persistFreshOAuth({ access_token: "hf-access", refresh_token: "hf-refresh" });
    process.env["HEYGEN_API_BASE"] = "https://gateway.example";
    try {
      await expect(withMediaAuthEnvironment(() => undefined)).rejects.toThrow(
        "requires its own API credential",
      );
    } finally {
      delete process.env["HEYGEN_API_BASE"];
    }
  });

  it("isolates an anonymous operation from an existing HeyGen login", async () => {
    process.env["HEYGEN_CONFIG_DIR"] = join(fixture.dir, "heygen");
    await fs.mkdir(process.env["HEYGEN_CONFIG_DIR"]);
    const legacyPath = join(process.env["HEYGEN_CONFIG_DIR"], "credentials");
    await fs.writeFile(legacyPath, "hg_other_wallet");
    await withMediaAuthEnvironment(async (env) => {
      expect(env.HEYGEN_CONFIG_DIR).not.toBe(process.env["HEYGEN_CONFIG_DIR"]);
      expect(await fs.readdir(env.HEYGEN_CONFIG_DIR!)).toEqual([]);
      expect(env.HEYGEN_API_KEY).toBeUndefined();
    });
    expect(await fs.readFile(legacyPath, "utf8")).toBe("hg_other_wallet");
  });

  it("preserves an explicit host gateway and cleans up after a subprocess error", async () => {
    process.env["HEYGEN_API_BASE"] = "https://gateway.example";
    process.env["HEYGEN_API_KEY"] = "gateway-key";
    let dir = "";
    try {
      await expect(
        withMediaAuthEnvironment((env) => {
          dir = env.HEYGEN_CONFIG_DIR!;
          expect(env.HEYGEN_API_BASE).toBe("https://gateway.example");
          expect(env.HEYGEN_API_KEY).toBe("gateway-key");
          throw new Error("subprocess failed");
        }),
      ).rejects.toThrow("subprocess failed");
      await expect(fs.stat(dir)).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      delete process.env["HEYGEN_API_BASE"];
    }
  });
});
