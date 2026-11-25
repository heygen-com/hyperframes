import { describe, expect, it, vi } from "vitest";

const looked = vi.hoisted(() => ({ at: [] as string[] }));

vi.mock("@hyperframes/parsers/asset-resolution", async (original) => ({
  ...(await original<typeof import("@hyperframes/parsers/asset-resolution")>()),
  // POSIX has no second network root, so the answer Windows gives for `\\server\share` is stood in here.
  namesAnotherNetworkRoot: (_base: string, target: string) => target.startsWith("/share/"),
}));
vi.mock("@hyperframes/core/safe-path", async (original) => {
  const actual = await original<typeof import("@hyperframes/core/safe-path")>();
  return {
    ...actual,
    realFilePath: (path: string) => {
      looked.at.push(path);
      return actual.realFilePath(path);
    },
  };
});

const { isPrivateUnderAssetRoots } = await import("./assetRoots.js");

describe("isPrivateUnderAssetRoots on another network root", () => {
  it("answers without looking at the file", () => {
    expect(isPrivateUnderAssetRoots("/share/.git/clip.mp4", ["/project"], true)).toBe(false);
    expect(looked.at).toEqual([]);
  });

  it("still looks at a file on this machine when asked to", () => {
    expect(isPrivateUnderAssetRoots("/elsewhere/clip.mp4", ["/project"], true)).toBe(false);
    expect(looked.at).toContain("/elsewhere/clip.mp4");
  });
});
