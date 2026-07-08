import test from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import {
  entityFrom,
  titleMatches,
  svglQueriesFor,
  simpleIconSlugsFor,
  githubOrgFor,
  faviconDomainFor,
  svglSearch,
  simpleIconsSearch,
  githubAvatarSearch,
  faviconSearch,
} from "./logo-provider.mjs";
import { getProviders, runProviders } from "./registry.mjs";

test("entityFrom strips filler words from the intent; --entity wins", () => {
  assert.equal(entityFrom("LinkedIn logo"), "linkedin");
  assert.equal(entityFrom("official Slack brand mark"), "slack");
  assert.equal(entityFrom("anything", "Notion"), "notion");
});

test("titleMatches ignores case, spacing, punctuation — and rejects lookalikes", () => {
  assert.ok(titleMatches("Next.js", "nextjs"));
  assert.ok(titleMatches("Coca-Cola", "coca cola"));
  assert.ok(!titleMatches("Slackware", "slack"));
});

test("svgl queries include the alias forms the raw entity can't match", () => {
  assert.ok(svglQueriesFor("nextjs").includes("next.js"));
  assert.ok(svglQueriesFor("aws").includes("amazon web services"));
  assert.deepEqual(svglQueriesFor("figma"), ["figma"]);
});

test("simple-icons slugs cover the renamed entries", () => {
  assert.ok(simpleIconSlugsFor("nextjs").includes("nextdotjs"));
  assert.ok(simpleIconSlugsFor("aws").includes("amazonwebservices"));
  assert.deepEqual(simpleIconSlugsFor("nike"), ["nike"]);
});

test("github avatar tier never guesses an org", () => {
  assert.equal(githubOrgFor("slack"), "slackhq");
  assert.equal(githubOrgFor("heygen"), "heygen-com");
  assert.equal(githubOrgFor("some-random-startup"), null);
});

test("favicon domain defaults to <entity>.com with explicit overrides", () => {
  assert.equal(faviconDomainFor("cocacola"), "coca-cola.com");
  assert.equal(faviconDomainFor("stripe"), "stripe.com");
});

// --- async tiers, network mocked -------------------------------------------
// The 54-brand stress test is a manual snapshot; these pin the same behavior
// as CI gates: descriptor shape, alias retry, error→null fallthrough, the
// placeholder filter, and the real cascade order under a mocked network.

const json = (data) => new Response(JSON.stringify(data), { status: 200 });
const status = (code) => new Response(null, { status: code });
const bin = (n) => new Response(new Uint8Array(n), { status: 200 });

test("svglSearch returns the descriptor shape on an exact title hit", async (t) => {
  t.mock.method(globalThis, "fetch", async () =>
    json([{ title: "Figma", route: "https://svgl.app/library/figma.svg" }]),
  );
  const res = await svglSearch("Figma logo", {});
  assert.equal(res.url, "https://svgl.app/library/figma.svg");
  assert.equal(res.ext, ".svg");
  assert.equal(res.metadata.provider, "svgl");
});

test("svglSearch skips a non-array payload and retries with the alias query", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    seen.push(decodeURIComponent(String(url)));
    return seen.length === 1
      ? json({ error: "unexpected shape" })
      : json([{ title: "Next.js", route: "https://svgl.app/library/nextjs.svg" }]);
  });
  const res = await svglSearch("nextjs logo", {});
  assert.equal(res.metadata.provenance.query, "next.js", "hit came from the alias query");
  assert.ok(seen.length >= 2, "raw query then alias");
});

test("svglSearch returns null when the network is down — the cascade falls through", async (t) => {
  t.mock.method(globalThis, "fetch", async () => {
    throw new Error("network down");
  });
  assert.equal(await svglSearch("figma logo", {}), null);
});

test("simpleIconsSearch falls to the next slug on a 404", async (t) => {
  const seen = [];
  t.mock.method(globalThis, "fetch", async (url) => {
    seen.push(String(url));
    return String(url).includes("amazonwebservices") ? status(200) : status(404);
  });
  const res = await simpleIconsSearch("aws logo", {});
  assert.ok(res.url.endsWith("amazonwebservices.svg"));
  assert.equal(seen.length, 2, "plain slug 404s first, alias slug hits");
});

test("faviconSearch rejects DDG's sub-500B placeholder with null", async (t) => {
  t.mock.method(globalThis, "fetch", async () => bin(120));
  assert.equal(await faviconSearch("someco logo", {}), null);
});

test("faviconSearch hands verified bytes over as a local file — one fetch, no re-download", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => bin(600));
  const res = await faviconSearch("someco logo", {});
  assert.ok(res.localPath, "returns a localPath, not a url");
  assert.equal(readFileSync(res.localPath).byteLength, 600, "frozen bytes are the verified bytes");
  assert.equal(fetchMock.mock.callCount(), 1, "single network round-trip");
  assert.equal(res.metadata.provenance.low_res, true);
});

test("githubAvatarSearch never touches the network for an unmapped entity", async (t) => {
  const fetchMock = t.mock.method(globalThis, "fetch", async () => status(200));
  assert.equal(await githubAvatarSearch("some-random-startup logo", {}), null);
  assert.equal(fetchMock.mock.callCount(), 0);
});

test("the real logo cascade falls through tier by tier to the first hit", async (t) => {
  t.mock.method(globalThis, "fetch", async (url) => {
    const u = String(url);
    if (u.includes("api.svgl.app")) return json([]); // tier 1: no hit
    if (u.includes("jsdelivr")) return status(404); // tier 2: no such slug
    // tier 3 (github) is never called: entity is unmapped
    if (u.includes("duckduckgo")) return bin(600); // tier 4: real favicon
    throw new Error(`unexpected fetch: ${u}`);
  });
  const res = await runProviders(getProviders("logo"), "search", "zzzbrand logo", {
    entity: "zzzbrand",
  });
  assert.ok(res, "cascade must land on the favicon tier");
  assert.equal(res.metadata.provider, "favicon.ddg");
});
