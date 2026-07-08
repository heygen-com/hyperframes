import test from "node:test";
import assert from "node:assert";
import {
  entityFrom,
  titleMatches,
  svglQueriesFor,
  simpleIconSlugsFor,
  githubOrgFor,
  faviconDomainFor,
} from "./logo-provider.mjs";

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
