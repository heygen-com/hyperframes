import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  isExpectedStudioSmokeError,
  SMOKE_COMPOSITION_HTML,
  studioSmokeApiResponse,
} from "./studio-runtime-smoke.mjs";

function bodyOf(method, path) {
  const response = studioSmokeApiResponse(method, `http://localhost:5199${path}`);
  assert.ok(response && response !== null);
  return JSON.parse(response.body);
}

describe("Studio runtime smoke fixtures", () => {
  it("matches the collection and project-detail API schemas", () => {
    assert.deepEqual(bodyOf("GET", "/api/projects"), {
      projects: [{ id: "smoke-test", dir: "/tmp/smoke-test", title: "Smoke test" }],
    });
    assert.deepEqual(bodyOf("GET", "/api/projects/smoke-test"), {
      id: "smoke-test",
      dir: "/tmp/smoke-test",
      title: "Smoke test",
      files: ["index.html"],
      compositions: ["index.html"],
    });
  });

  it("returns file content rather than the unrelated file-tree shape", () => {
    assert.deepEqual(bodyOf("GET", "/api/projects/smoke-test/files/index.html"), {
      filename: "index.html",
      content: SMOKE_COMPOSITION_HTML,
    });
  });

  it("returns iterable collections for eager Studio queries", () => {
    assert.deepEqual(bodyOf("GET", "/api/projects/smoke-test/renders"), { renders: [] });
    assert.deepEqual(bodyOf("GET", "/api/projects/smoke-test/gsap-animations/index.html"), {
      animations: [],
      timelineVar: "tl",
      preamble: "",
      postamble: "",
    });
    assert.deepEqual(bodyOf("GET", "/api/projects/smoke-test/lint"), { findings: [] });
  });

  it("marks unknown API requests as fixture failures", () => {
    assert.equal(studioSmokeApiResponse("GET", "http://localhost:5199/api/new-endpoint"), null);
    assert.equal(studioSmokeApiResponse("GET", "http://localhost:5199/src/main.tsx"), undefined);
  });

  it("does not suppress generic JavaScript or network failures", () => {
    assert.equal(isExpectedStudioSmokeError("Cannot read properties of undefined"), false);
    assert.equal(isExpectedStudioSmokeError("value is not iterable"), false);
    assert.equal(isExpectedStudioSmokeError("Failed to fetch"), false);
    assert.equal(isExpectedStudioSmokeError("GET /favicon.ico 404"), true);
  });
});
