import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getPublishApiBaseUrl, publishProjectArchive } from "./publishProject.js";

// End-to-end round-trip against a LIVE experiment-framework instance. The unit tests mock
// the DAO, so only this test proves the real behavior: publish -> edit -> re-publish returns
// the SAME URL with updated content.
//
// It is skipped unless HYPERFRAMES_E2E_API_URL is set, and it requires the runner to be
// authenticated first (`hyperframes auth login`, or a HEYGEN credential the auth store can
// resolve) — stable URLs are an owner-only capability. Run it manually or in a nightly job
// against canary/staging with a test account:
//
//   HYPERFRAMES_E2E_API_URL=https://api2.heygen.com \
//     bunx vitest run src/utils/publishProject.e2e.test.ts
const E2E_API_URL = process.env["HYPERFRAMES_E2E_API_URL"];
const describeE2E = E2E_API_URL ? describe : describe.skip;

describeE2E("publish stable-URL round trip (live server)", () => {
  const priorPublishBase = process.env["HYPERFRAMES_PUBLISHED_PROJECTS_API_URL"];

  beforeAll(() => {
    // Point the publish client at the E2E target for the duration of this suite.
    process.env["HYPERFRAMES_PUBLISHED_PROJECTS_API_URL"] = E2E_API_URL;
  });

  afterAll(() => {
    if (priorPublishBase === undefined)
      delete process.env["HYPERFRAMES_PUBLISHED_PROJECTS_API_URL"];
    else process.env["HYPERFRAMES_PUBLISHED_PROJECTS_API_URL"] = priorPublishBase;
  });

  async function fetchPublicProject(projectId: string): Promise<Record<string, unknown>> {
    const response = await fetch(
      `${getPublishApiBaseUrl()}/v1/hyperframes/projects/${projectId}/public`,
      { headers: { heygen_route: "canary" } },
    );
    expect(response.ok).toBe(true);
    const payload = (await response.json()) as { data: Record<string, unknown> };
    return payload.data;
  }

  it("re-publishing the same project keeps one URL and serves the updated content", async () => {
    const dir = mkdtempSync(join(tmpdir(), "hf-e2e-"));
    try {
      // First authenticated publish → the server creates and owns the project.
      writeFileSync(join(dir, "index.html"), "<html><body>version one</body></html>", "utf-8");
      const first = await publishProjectArchive(dir);
      // If this fails, the runner is not authenticated — stable URLs require an owner.
      expect(first.claimed).toBe(true);

      // Edit locally, then re-publish targeting the owned project id.
      writeFileSync(
        join(dir, "index.html"),
        "<html><body>version two</body><p>added</p></html>",
        "utf-8",
      );
      writeFileSync(join(dir, "extra.html"), "<html>second page</html>", "utf-8");
      const second = await publishProjectArchive(dir, { projectId: first.projectId });

      // Same project, same URL — the whole point.
      expect(second.projectId).toBe(first.projectId);
      expect(second.url).toBe(first.url);
      expect(second.claimed).toBe(true);

      // The live public project reflects the second publish (extra file included).
      const publicData = await fetchPublicProject(second.projectId);
      expect(publicData["project_id"]).toBe(first.projectId);
      expect(Number(publicData["file_count"])).toBeGreaterThanOrEqual(2);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
