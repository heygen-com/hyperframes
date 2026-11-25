import { afterEach, describe, expect, it, vi } from "vitest";
import { postStaticCompositionWhenParsed } from "./staticCompositionPost";

const ROOT =
  '<div data-composition-id="main" data-duration="10" data-width="1920" data-height="1080"></div>';

/** A frame's view of its parent: a window that only records posts. */
function framed() {
  const posts: unknown[] = [];
  const parent = { postMessage: (message: unknown) => posts.push(message) };
  vi.spyOn(window, "parent", "get").mockReturnValue(parent as unknown as Window);
  return posts;
}

const sent = (posts: unknown[]) =>
  posts.map((post) => {
    const { type, durationSeconds, width, height } = post as Record<string, unknown>;
    return { type, durationSeconds, width, height };
  });

describe("postStaticCompositionWhenParsed", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("tells a parent frame the document's length and size, once", () => {
    const posts = framed();
    document.body.innerHTML = ROOT;
    postStaticCompositionWhenParsed();
    expect(sent(posts)).toEqual([
      { type: "static-composition", durationSeconds: 10, width: 1920, height: 1080 },
    ]);
  });

  it("posts nothing from a top-level page", () => {
    const post = vi.spyOn(window, "postMessage");
    document.body.innerHTML = ROOT;
    postStaticCompositionWhenParsed();
    expect(post).not.toHaveBeenCalled();
  });

  it("posts while the page still parses, once the root declares its length", async () => {
    const posts = framed();
    vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    postStaticCompositionWhenParsed();
    document.body.innerHTML = '<div data-composition-id="main"></div>';
    await Promise.resolve();
    expect(posts).toEqual([]);
    document.body.innerHTML = ROOT;
    await Promise.resolve();
    expect(sent(posts)).toEqual([
      { type: "static-composition", durationSeconds: 10, width: 1920, height: 1080 },
    ]);
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(posts).toHaveLength(1);
  });
});
