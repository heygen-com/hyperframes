import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewClient } from "../src/reviewClient.mjs";

const email = "person@example.test";
const invite = () => ({
  email,
  role: "editor",
  expected_revision: null,
  client_operation_id: crypto.randomUUID(),
});
const reply = (data, status = 200) => Response.json({ data }, { status });
function fixture() {
  let owner = "owner",
    site = "https://api.example.test";
  const requests = [];
  const responses = [];
  const client = reviewClient({
    access: async () => ({ token: "token", owner, heygen: site, heygenApi: site }),
    fetchImpl: async (url, init) => {
      requests.push({
        url: new URL(url),
        method: init.method,
        body: init.body ? JSON.parse(init.body) : null,
      });
      assert.ok(responses.length, "unexpected request");
      const response = responses.shift();
      if (response instanceof Error) throw response;
      return response;
    },
  });
  return {
    client,
    requests,
    responses,
    switchAccount: () => {
      owner = "other";
    },
    switchSite: () => {
      site = "https://other.example.test";
    },
  };
}
const revoked = { id: "g1", email, role: "commenter", revision: 2, revoked_at: "2026-01-01" };
const page = (items, next_cursor = null) => reply({ items, next_cursor });

test("listed revoked grants stay hidden and re-invite in one POST with their revision", async () => {
  const f = fixture();
  f.responses.push(
    page([revoked], "next"),
    page([{ ...revoked, id: "g2", email: "live@example.test", revoked_at: null }]),
  );
  assert.equal((await f.client.grants("p1")).items.length, 1);
  assert.ok(f.requests.every((r) => r.url.searchParams.get("include_revoked") === "true"));
  assert.equal(f.requests[1].url.searchParams.get("cursor"), "next");
  const asked = invite();
  f.responses.push(reply({ ...revoked, revision: 3, revoked_at: null }));
  assert.equal((await f.client.createGrant("p1", asked)).revision, 3);
  assert.equal(f.requests.length, 3);
  assert.equal(f.requests[2].body.expected_revision, 2);
  assert.notEqual(f.requests[2].body.client_operation_id, asked.client_operation_id);
});

test("a lost direct re-grant response retries the same operation", async () => {
  const f = fixture();
  f.responses.push(page([revoked]));
  await f.client.grants("p1");
  const asked = invite();
  f.responses.push(new Error("offline"));
  await assert.rejects(f.client.createGrant("p1", asked));
  f.responses.push(reply({ revision: 3 }));
  await f.client.createGrant("p1", asked);
  assert.deepEqual(f.requests[1].body, f.requests[2].body);
  assert.equal(f.requests[1].body.expected_revision, 2);
});

for (const scope of ["account", "site", "project"])
  test(`revoked revisions do not cross ${scope} boundaries`, async () => {
    const f = fixture();
    f.responses.push(page([revoked]));
    await f.client.grants("p1");
    if (scope === "account") f.switchAccount();
    if (scope === "site") f.switchSite();
    f.responses.push(reply({ revision: 1 }));
    await f.client.createGrant(scope === "project" ? "p2" : "p1", invite());
    assert.equal(f.requests[1].body.expected_revision, null);
  });

for (const listed of [false, true])
  test(`revision conflicts still recover with listed=${listed}`, async () => {
    const f = fixture();
    f.responses.push(page(listed ? [revoked] : []));
    await f.client.grants("p1");
    f.responses.push(
      reply({ reason: "revision_conflict", current_revision: 4 }, 409),
      reply({ revision: 5 }),
    );
    assert.equal((await f.client.createGrant("p1", invite())).revision, 5);
    assert.equal(f.requests[1].body.expected_revision, listed ? 2 : null);
    assert.equal(f.requests[2].body.expected_revision, 4);
    assert.notEqual(f.requests[1].body.client_operation_id, f.requests[2].body.client_operation_id);
  });

test("refreshing the list clears revoked revisions and explicit revisions are preserved", async () => {
  const f = fixture();
  f.responses.push(page([revoked]), page([]), reply({ revision: 1 }));
  await f.client.grants("p1");
  await f.client.grants("p1");
  await f.client.createGrant("p1", invite());
  assert.equal(f.requests[2].body.expected_revision, null);
  f.responses.push(page([revoked]), reply({ revision: 8 }));
  await f.client.grants("p1");
  const asked = { ...invite(), expected_revision: 7 };
  await f.client.createGrant("p1", asked);
  assert.deepEqual(f.requests[4].body, asked);
});
