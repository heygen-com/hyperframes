import { isDirectMediaUrl } from "./freeze.mjs";

const BASE_URL = "https://xquik.com/api/v1";
const SEARCH_LIMIT = 10;
const MAX_RESPONSE_BYTES = 1024 * 1024;
const TWEET_ID = /^\d{15,20}$/;
const X_USERNAME = /^[A-Za-z0-9_]{1,15}$/;
const TWEET_URL =
  /https:\/\/(?:www\.)?(?:x\.com|twitter\.com)\/[^\s/]+\/status\/(\d{15,20})(?:[/?#]|$)/i;

function tweetIdFromIntent(intent) {
  const value = String(intent || "").trim();
  if (TWEET_ID.test(value)) return value;
  return value.match(TWEET_URL)?.[1] || null;
}

function nonEmptyString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function nonNegativeInteger(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
}

function httpsUrl(value) {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.href : null;
  } catch {
    return null;
  }
}

function safeMediaUrl(value) {
  const candidate = httpsUrl(value);
  return candidate && isDirectMediaUrl(candidate) ? candidate : null;
}

function canonicalPostUrl(username, id) {
  return `https://x.com/${username}/status/${id}`;
}

function normalizeMedia(items) {
  if (!Array.isArray(items)) return [];
  return items.flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const previewUrl = safeMediaUrl(item.mediaUrl);
    if (!previewUrl) return [];
    const type = ["photo", "video", "animated_gif"].includes(item.type) ? item.type : "photo";
    return [
      {
        type,
        preview_url: previewUrl,
        alt_text: nonEmptyString(item.altText) || "",
        width: nonNegativeInteger(item.width),
        height: nonNegativeInteger(item.height),
      },
    ];
  });
}

export function normalizeXquikPost(tweet, envelopeAuthor = null) {
  if (!tweet || typeof tweet !== "object") return null;
  const id = nonEmptyString(tweet.id);
  const text = nonEmptyString(tweet.noteTweet?.text) || nonEmptyString(tweet.text);
  const author = envelopeAuthor || tweet.author;
  const username = nonEmptyString(author?.username);
  if (
    !id ||
    !TWEET_ID.test(id) ||
    !text ||
    !author ||
    typeof author !== "object" ||
    !username ||
    !X_USERNAME.test(username)
  ) {
    return null;
  }

  return {
    id,
    url: canonicalPostUrl(username, id),
    text,
    created_at: nonEmptyString(tweet.createdAt) || "",
    author: {
      name: nonEmptyString(author.name) || username,
      handle: `@${username}`,
      avatar_url: safeMediaUrl(author.profilePicture) || "",
      verified: Boolean(author.verified || author.isVerified || author.isBlueVerified),
    },
    metrics: {
      replies: nonNegativeInteger(tweet.replyCount),
      reposts: nonNegativeInteger(tweet.retweetCount),
      likes: nonNegativeInteger(tweet.likeCount),
      quotes: nonNegativeInteger(tweet.quoteCount),
      views: nonNegativeInteger(tweet.viewCount),
      bookmarks: nonNegativeInteger(tweet.bookmarkCount),
    },
    media: normalizeMedia(tweet.media),
  };
}

async function readJson(response) {
  const declared = Number(response.headers.get("content-length"));
  if (declared > MAX_RESPONSE_BYTES) {
    throw new Error(`Xquik tweet response exceeds ${MAX_RESPONSE_BYTES} bytes.`);
  }
  if (!response.body) throw new Error("Xquik returned an empty tweet response.");

  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    total += chunk.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      throw new Error(`Xquik tweet response exceeds ${MAX_RESPONSE_BYTES} bytes.`);
    }
    chunks.push(Buffer.from(chunk));
  }
  if (total === 0) throw new Error("Xquik returned an empty tweet response.");

  try {
    return JSON.parse(Buffer.concat(chunks, total).toString("utf8"));
  } catch {
    throw new Error("Xquik returned invalid JSON for the tweet source.");
  }
}

async function requestXquik(url, { apiKey, fetchImpl, signal }) {
  const response = await fetchImpl(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "hyperframes-media-use",
      "x-api-key": apiKey,
    },
    redirect: "manual",
    signal,
  });
  if (response.status >= 300 && response.status < 400) {
    throw new Error("Xquik tweet resolution refused an unexpected redirect.");
  }
  if (!response.ok) throw new Error(`Xquik tweet resolution failed with HTTP ${response.status}.`);
  return readJson(response);
}

function result(content, description, provenance) {
  return {
    content: `${JSON.stringify(content, null, 2)}\n`,
    ext: ".json",
    source: "search",
    metadata: {
      description,
      provider: "xquik.tweet",
      provenance,
    },
  };
}

export async function xquikTweetSearch(intent, ctx = {}) {
  const apiKey = ctx.apiKey ?? process.env.XQUIK_API_KEY;
  if (!apiKey) return null;

  const fetchImpl = ctx.fetch || fetch;
  const signal = ctx.signal || AbortSignal.timeout(15_000);
  const tweetId = tweetIdFromIntent(intent);

  if (tweetId) {
    const data = await requestXquik(`${BASE_URL}/x/tweets/${tweetId}`, {
      apiKey,
      fetchImpl,
      signal,
    });
    const post = normalizeXquikPost(data?.tweet, data?.author);
    if (!post) throw new Error("Xquik returned an invalid tweet lookup response.");
    return result(
      { schema: "hyperframes.tweet-source.v1", kind: "x_post", post },
      `X post by ${post.author.handle}`,
      { mode: "lookup", post_id: post.id, post_url: post.url },
    );
  }

  const query = String(intent || "").trim();
  const params = new URLSearchParams({
    q: query,
    limit: String(SEARCH_LIMIT),
    queryType: "Top",
  });
  const data = await requestXquik(`${BASE_URL}/x/tweets/search?${params}`, {
    apiKey,
    fetchImpl,
    signal,
  });
  if (!Array.isArray(data?.tweets))
    throw new Error("Xquik returned an invalid tweet search response.");
  const posts = data.tweets.map((tweet) => normalizeXquikPost(tweet)).filter(Boolean);
  if (posts.length === 0) return null;

  return result(
    {
      schema: "hyperframes.tweet-source.v1",
      kind: "x_post_candidates",
      query,
      posts,
      has_next_page: data.has_next_page === true,
      next_cursor: nonEmptyString(data.next_cursor),
    },
    `X post candidates for ${query}`,
    { mode: "search", result_count: posts.length },
  );
}
