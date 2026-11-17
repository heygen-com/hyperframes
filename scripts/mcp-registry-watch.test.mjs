import assert from "node:assert/strict";
import test from "node:test";
import { publishedListings, unexpectedListings } from "./mcp-registry-watch.mjs";

const listing = (name, version) => ({ server: { name, version } });

test("a listing under a HeyGen namespace that server.json never held is unexpected", () => {
  const published = new Set([
    "io.github.heygen-com/hyperframes@1.0.0",
    "com.heygen/hyperframes@1.0.0",
  ]);
  const servers = [
    listing("io.github.heygen-com/hyperframes", "1.0.0"),
    listing("com.heygen/hyperframes", "1.0.0"),
    listing("io.github.heygen-com/hyperframes", "1.0.1"),
    listing("io.github.heygen-com/other", "0.1.0"),
    listing("com.heygen/hyperframes-x", "9.9.9"),
    listing("com.heygen.docs/hyperframes", "1.0.0"),
    listing("com.heygenx/hyperframes", "1.0.0"),
    listing("io.github.someone/heygen-tools", "1.0.0"),
  ];
  assert.deepEqual(unexpectedListings(servers, published), [
    "io.github.heygen-com/hyperframes@1.0.1",
    "io.github.heygen-com/other@0.1.0",
    "com.heygen/hyperframes-x@9.9.9",
    "com.heygen.docs/hyperframes@1.0.0",
  ]);
});

test("what this repo published is every name and version server.json has held", () => {
  const history = [
    '{"name": "com.heygen/hyperframes", "version": "1.0.0"}',
    '{"name": "io.github.heygen-com/hyperframes", "version": "1.0.0"}',
    "not json",
  ];
  assert.deepEqual([...publishedListings(history)].sort(), [
    "com.heygen/hyperframes@1.0.0",
    "io.github.heygen-com/hyperframes@1.0.0",
  ]);
});
