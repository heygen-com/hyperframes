import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedCredential } from "../auth/resolver.js";
const mocks = vi.hoisted(() => ({
  resolve: vi.fn<() => Promise<ResolvedCredential>>(),
  refresh: vi.fn(),
  user: vi.fn(),
}));
vi.mock("../auth/resolver.js", () => ({ resolveCredential: mocks.resolve }));
vi.mock("../auth/oauth.js", () => ({ refreshTokens: mocks.refresh }));
vi.mock("../auth/client.js", () => ({
  apiBaseUrl: () => "https://api.heygen.com",
  AuthClient: class {
    getCurrentUser = mocks.user;
  },
}));
import { createShareAccess } from "./auth.js";
const oauth = (token: string): ResolvedCredential => ({
  type: "oauth",
  access_token: token,
  source: "file_json",
  refreshable: false,
});
beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ username: "owner", email: "owner@example.com" });
});
describe("share OAuth identity", () => {
  it("rejects API keys before any account request", async () => {
    mocks.resolve.mockResolvedValue({ type: "api_key", key: "secret", source: "env" });
    await expect(createShareAccess().access()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("never falls back to an API key after refresh", async () => {
    mocks.resolve
      .mockResolvedValueOnce({
        ...oauth("old"),
        type: "oauth",
        access_token: "old",
        refresh_token: "refresh",
        refreshable: true,
      })
      .mockResolvedValueOnce({ type: "api_key", key: "key", source: "env" });
    await expect(createShareAccess().access()).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    expect(mocks.refresh).toHaveBeenCalledWith("refresh");
    expect(mocks.user).not.toHaveBeenCalled();
  });
  it("rejects a different actor when the credential changes", async () => {
    mocks.resolve.mockResolvedValueOnce(oauth("a")).mockResolvedValueOnce(oauth("b"));
    mocks.user
      .mockResolvedValueOnce({ username: "first" })
      .mockResolvedValueOnce({ username: "second" });
    const auth = createShareAccess();
    expect((await auth.access()).owner).toBe("first");
    await expect(auth.access()).rejects.toMatchObject({ code: "LOGIN_CHANGED" });
  });
  it("does not retry a refused environment token", async () => {
    mocks.resolve.mockResolvedValue(oauth("refused"));
    await expect(createShareAccess().access("refused")).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    expect(mocks.refresh).not.toHaveBeenCalled();
  });
});

it("pins a Studio session across account switches but permits same-account token rotation", async () => {
  const auth = createShareAccess(true);
  mocks.resolve.mockResolvedValue(oauth("first"));
  await auth.access();
  mocks.resolve.mockResolvedValue(oauth("refreshed"));
  await expect(auth.access()).resolves.toMatchObject({ owner: "owner", token: "refreshed" });
  mocks.resolve.mockResolvedValue(oauth("other"));
  mocks.user.mockResolvedValue({ username: "other" });
  await expect(auth.access()).rejects.toMatchObject({ code: "LOGIN_CHANGED" });
  await expect(auth.access()).rejects.toMatchObject({ code: "LOGIN_CHANGED" });
});

it("can revalidate the same token instead of trusting a cached account", async () => {
  mocks.resolve.mockResolvedValue(oauth("same"));
  const auth = createShareAccess(true);
  await auth.access();
  mocks.user.mockRejectedValue(new Error("account validation refused"));
  await expect(auth.access(undefined, true)).rejects.toThrow("account validation refused");
  expect(mocks.user).toHaveBeenCalledTimes(2);
});
