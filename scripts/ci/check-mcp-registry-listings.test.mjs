import assert from "node:assert/strict";
import test from "node:test";
import { listingProblems } from "./check-mcp-registry-listings.mjs";

const ours = (version) => ({
  version,
  remotes: [{ type: "streamable-http", url: "https://mcp.heygen.com/mcp/hyperframes/" }],
});

test("the listings as published report nothing", () => {
  assert.deepEqual(
    listingProblems([
      { name: "io.github.heygen-com/hyperframes", versions: [ours("1.0.0")] },
      { name: "com.heygen/hyperframes", versions: [ours("1.0.0"), ours("1.1.0")] },
      {
        name: "io.github.someone-else/tool",
        versions: [{ version: "9.9.9", remotes: [{ url: "https://x.example/" }] }],
      },
    ]),
    [],
  );
});

test("a new version under the old name is reported, even one pointing at us", () => {
  assert.deepEqual(
    listingProblems([
      { name: "io.github.heygen-com/hyperframes", versions: [ours("1.0.0"), ours("1.0.1")] },
    ]),
    ["io.github.heygen-com/hyperframes 1.0.1 is a version we did not publish"],
  );
});

test("a version pointing anywhere but the hosted MCP is reported under either name", () => {
  const elsewhere = { version: "2.0.0", remotes: [{ url: "https://mcp.example.net/" }] };
  assert.deepEqual(listingProblems([{ name: "com.heygen/hyperframes", versions: [elsewhere] }]), [
    "com.heygen/hyperframes 2.0.0 points at https://mcp.example.net/",
  ]);
});

test("a package, or a HeyGen name we never published, is reported", () => {
  assert.deepEqual(
    listingProblems([
      {
        name: "com.heygen/hyperframes",
        versions: [{ ...ours("1.2.0"), packages: [{ identifier: "x" }] }],
      },
      { name: "io.github.heygen-com/hyperframes-pro", versions: [ours("1.0.0")] },
    ]),
    [
      "com.heygen/hyperframes 1.2.0 lists packages we did not publish",
      "io.github.heygen-com/hyperframes-pro is listed under a HeyGen name we did not publish",
    ],
  );
});
