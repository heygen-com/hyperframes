import { strict as assert } from "node:assert";
import { test } from "node:test";
import { normalizeXquikPost, xquikTweetSearch } from "./xquik-tweet-provider.mjs";

const ID = "2074176916819685648";

function tweet(overrides = {}) {
  return {
    id: ID,
    text: "Write HTML. Render video.",
    createdAt: "2026-08-20T12:00:00Z",
    url: `https://x.com/HyperFrames_/status/${ID}`,
    author: {
      id: "1",
      name: "HyperFrames",
      username: "HyperFrames_",
      profilePicture: "https://pbs.twimg.com/profile_images/hyperframes.jpg",
      isBlueVerified: true,
    },
    replyCount: 3,
    retweetCount: 5,
    likeCount: 42,
    quoteCount: 2,
    viewCount: 1200,
    bookmarkCount: 7,
    media: [
      {
        type: "photo",
        mediaUrl: "https://pbs.twimg.com/media/example?format=jpg&name=large",
        altText: "HyperFrames timeline",
        width: 1600,
        height: 900,
      },
    ],
    ...overrides,
  };
}

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: init.status || 200,
    headers: { "content-type": "application/json", ...init.headers },
  });
}

test("normalizes the X post fields consumed by the x-post block", () => {
  assert.deepEqual(normalizeXquikPost(tweet()), {
    id: ID,
    url: `https://x.com/HyperFrames_/status/${ID}`,
    text: "Write HTML. Render video.",
    created_at: "2026-08-20T12:00:00Z",
    author: {
      name: "HyperFrames",
      handle: "@HyperFrames_",
      avatar_url: "https://pbs.twimg.com/profile_images/hyperframes.jpg",
      verified: true,
    },
    metrics: { replies: 3, reposts: 5, likes: 42, quotes: 2, views: 1200, bookmarks: 7 },
    media: [
      {
        type: "photo",
        preview_url: "https://pbs.twimg.com/media/example?format=jpg&name=large",
        alt_text: "HyperFrames timeline",
        width: 1600,
        height: 900,
      },
    ],
  });
});

test("lookup accepts an X URL and never forwards the API key through redirects", async () => {
  const calls = [];
  const fetchStub = async (url, options) => {
    calls.push({ url, options });
    return jsonResponse({ tweet: tweet({ author: undefined }), author: tweet().author });
  };

  const resolved = await xquikTweetSearch(`https://x.com/HyperFrames_/status/${ID}`, {
    apiKey: "xq_test_key",
    fetch: fetchStub,
    signal: new AbortController().signal,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://xquik.com/api/v1/x/tweets/${ID}`);
  assert.equal(calls[0].options.headers["x-api-key"], "xq_test_key");
  assert.equal(calls[0].options.redirect, "manual");
  assert.equal(resolved.metadata.provider, "xquik.tweet");
  const frozen = JSON.parse(resolved.content);
  assert.equal(frozen.kind, "x_post");
  assert.equal(frozen.post.id, ID);
});

test("search freezes a reviewable candidate set instead of choosing the first post", async () => {
  let request;
  const resolved = await xquikTweetSearch("HTML video agents", {
    apiKey: "xq_test_key",
    fetch: async (url, options) => {
      request = { url: new URL(url), options };
      return jsonResponse({
        tweets: [tweet(), tweet({ id: "2074574265714905167", text: "A second result" })],
        has_next_page: true,
        next_cursor: "cursor-2",
      });
    },
    signal: new AbortController().signal,
  });

  assert.equal(request.url.pathname, "/api/v1/x/tweets/search");
  assert.equal(request.url.searchParams.get("q"), "HTML video agents");
  assert.equal(request.url.searchParams.get("limit"), "10");
  assert.equal(request.url.searchParams.get("queryType"), "Top");
  const frozen = JSON.parse(resolved.content);
  assert.equal(frozen.kind, "x_post_candidates");
  assert.equal(frozen.posts.length, 2);
  assert.equal(frozen.has_next_page, true);
  assert.equal(frozen.next_cursor, "cursor-2");
});

test("missing credentials produce a provider miss without a request", async () => {
  let called = false;
  const resolved = await xquikTweetSearch("agents", {
    apiKey: "",
    fetch: async () => {
      called = true;
      throw new Error("should not run");
    },
  });
  assert.equal(resolved, null);
  assert.equal(called, false);
});

test("search skips unusable entries and returns null when none remain", async () => {
  const resolved = await xquikTweetSearch("agents", {
    apiKey: "xq_test_key",
    fetch: async () => jsonResponse({ tweets: [{ id: ID, text: "Missing author" }] }),
    signal: new AbortController().signal,
  });
  assert.equal(resolved, null);
});

test("normalization rejects malformed post IDs and usernames", () => {
  assert.equal(normalizeXquikPost(tweet({ id: "../../private" })), null);
  assert.equal(
    normalizeXquikPost(tweet({ author: { ...tweet().author, username: "user/path" } })),
    null,
  );
});

test("lookup rejects redirects before reading a response body", async () => {
  await assert.rejects(
    xquikTweetSearch(ID, {
      apiKey: "xq_test_key",
      fetch: async () =>
        new Response(null, { status: 302, headers: { location: "https://example.com" } }),
      signal: new AbortController().signal,
    }),
    /refused an unexpected redirect/,
  );
});

test("HTTP failures expose only status and never the API key", async () => {
  await assert.rejects(
    xquikTweetSearch(ID, {
      apiKey: "xq_test_secret_value",
      fetch: async () => jsonResponse({ error: "private upstream detail" }, { status: 401 }),
      signal: new AbortController().signal,
    }),
    (error) => {
      assert.match(error.message, /HTTP 401/);
      assert.doesNotMatch(error.message, /xq_test_secret_value|private upstream detail/);
      return true;
    },
  );
});

test("invalid JSON and oversized responses fail with bounded errors", async () => {
  await assert.rejects(
    xquikTweetSearch(ID, {
      apiKey: "xq_test_key",
      fetch: async () => new Response("not-json", { status: 200 }),
      signal: new AbortController().signal,
    }),
    /invalid JSON/,
  );
  await assert.rejects(
    xquikTweetSearch(ID, {
      apiKey: "xq_test_key",
      fetch: async () =>
        new Response("{}", { status: 200, headers: { "content-length": "1048577" } }),
      signal: new AbortController().signal,
    }),
    /exceeds 1048576 bytes/,
  );
});

test("private response URLs are omitted and a canonical X URL is rebuilt", () => {
  const normalized = normalizeXquikPost(
    tweet({
      url: "https://attacker.example/post",
      author: { ...tweet().author, profilePicture: "https://127.0.0.1/private.jpg" },
      media: [{ type: "photo", mediaUrl: "https://127.0.0.1/private.jpg" }],
    }),
  );
  assert.equal(normalized.url, `https://x.com/HyperFrames_/status/${ID}`);
  assert.equal(normalized.author.avatar_url, "");
  assert.deepEqual(normalized.media, []);
});
