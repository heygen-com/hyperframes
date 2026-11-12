import { test } from "node:test";
import assert from "node:assert/strict";
import { reviewClient } from "../src/reviewClient.mjs";

function client(data) {
  return reviewClient({
    access: async () => ({
      token: "t",
      owner: "owner",
      heygen: "https://api.example.test",
      heygenApi: "",
    }),
    fetchImpl: async () => Response.json({ data }),
  });
}
for (const data of [null, {}, { items: null }, { items: "malformed", share_files: true }]) {
  test(`review flags reject malformed workspace lists: ${JSON.stringify(data)}`, async () => {
    await assert.rejects(client(data).reviewFlags(), { status: 502, reason: "malformed_spaces" });
  });
}
test("empty workspace lists are valid and only explicit true flags enable capabilities", async () => {
  assert.deepEqual(await client({ items: [], share_files: true }).reviewFlags(), {
    versionSharing: false,
    shareFiles: true,
  });
  assert.deepEqual(
    await client({ items: [], version_sharing: true, share_files: "true" }).reviewFlags(),
    { versionSharing: true, shareFiles: false },
  );
});
