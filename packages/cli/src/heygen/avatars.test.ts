import { afterEach, describe, expect, it, vi } from "vitest";

const refresh = vi.hoisted(() => ({ fails: null as Error | null }));
vi.mock("../cloud/auth.js", () => ({
  resolveCloudAuthHeaders: async () => {
    if (refresh.fails) throw refresh.fails;
    return { "x-api-key": "k" };
  },
  resolveCloudBaseUrl: () => "https://api.test",
}));

const { ownAvatarLooks } = await import("./avatars.js");
const { explainNetworkFailure } = await import("../utils/networkFailure.js");

const reply = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

const look = (id: string) => ({
  id,
  name: `Look ${id}`,
  avatar_type: "digital_twin",
  group_id: "ag_1",
  status: "completed",
  preview_image_url: null,
  tags: [],
});

afterEach(() => {
  refresh.fails = null;
  vi.unstubAllGlobals();
});

describe("ownAvatarLooks", () => {
  it("lists the private looks of the HyperFrames sign-in as avatar ids for generate", async () => {
    const asked: { url: string; key: string | null }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      asked.push({ url, key: new Headers(init.headers).get("x-api-key") });
      return reply(200, { data: [look("lk_1")], has_more: false, next_token: null });
    });

    expect(await ownAvatarLooks(5)).toEqual([
      {
        avatar_id: "lk_1",
        name: "Look lk_1",
        avatar_type: "digital_twin",
        group_id: "ag_1",
        status: "completed",
      },
    ]);
    const sent = new URL(asked[0]!.url);
    expect(sent.pathname).toBe("/v3/avatars/looks");
    expect(sent.searchParams.get("ownership")).toBe("private");
    expect(sent.searchParams.get("limit")).toBe("5");
    expect(asked[0]!.key).toBe("k");
  });

  it("follows next_token past HeyGen's 50-per-page cap until --limit is reached", async () => {
    const tokens: (string | null)[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      const token = new URL(url).searchParams.get("token");
      tokens.push(token);
      const ids = Array.from({ length: 50 }, (_, i) => `lk_${token ?? "a"}${i}`);
      return reply(200, { data: ids.map(look), has_more: true, next_token: "b" });
    });

    expect(await ownAvatarLooks(60)).toHaveLength(60);
    expect(tokens).toEqual([null, "b"]);
  });

  it("refuses with the sign-in fix when HeyGen turns the account away, instead of listing anything", async () => {
    vi.stubGlobal("fetch", async () => reply(401, { message: "no" }));
    await expect(ownAvatarLooks(5)).rejects.toMatchObject({ fix: "npx hyperframes auth login" });
  });

  it("says it is offline, not signed out, when refreshing the stored login cannot reach HeyGen", async () => {
    const lookup = Object.assign(new Error("getaddrinfo ENOTFOUND"), { code: "ENOTFOUND" });
    const failure = explainNetworkFailure(
      new TypeError("fetch failed", { cause: lookup }),
      "https://api.heygen.com/v1/oauth/token",
    );
    refresh.fails = failure instanceof Error ? failure : null;
    await expect(ownAvatarLooks(5)).rejects.toMatchObject({
      message: expect.stringMatching(/^Could not reach api\.heygen\.com: .*offline/),
      fix: expect.stringContaining("internet connection"),
    });
  });
});
