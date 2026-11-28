import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as path from "node:path";
import { createStudioServer, type StudioServer } from "./studioServer.js";
import {
  cleanupStudioServerRoot,
  makeStudioServerRoot,
  writeStudioIndexHtml,
} from "./studioServerTestFixture.js";

/**
 * Studio routes by `location.hash` only, so it has no page
 * that legitimately receives a path or an OAuth return. When the catch-all
 * answered every unknown GET with the shell, an authorization redirect to the
 * preview port (`/oauth/callback?code=…&state=…`) committed a same-origin page
 * that re-mounted the project, and project script read the code from the
 * address. The preview server must answer those with an inert refusal.
 */

const hooks = vi.hoisted(() => ({ studioDir: "" }));

// fallow-ignore-next-line code-duplication
vi.mock("node:path", async (importOriginal) => {
  const actual = await importOriginal<typeof path>();
  return {
    ...actual,
    resolve: (...parts: string[]) =>
      hooks.studioDir && parts.length === 2 && parts[0]?.endsWith("server") && parts[1] === "studio"
        ? hooks.studioDir
        : actual.resolve(...parts),
  };
});

const CODE = "victim-auth-code-1234";
const STATE = "attacker-state-5678";

let root: string;
let server: StudioServer;

beforeEach(() => {
  const fixture = makeStudioServerRoot("hf-studio-unknown-paths-");
  root = fixture.root;
  hooks.studioDir = fixture.studioDir;
  writeStudioIndexHtml(hooks.studioDir);
  server = createStudioServer({ projectDir: fixture.projectDir });
});

afterEach(() => cleanupStudioServerRoot(server, root, () => (hooks.studioDir = "")));

function navigate(target: string, host = "127.0.0.1:3002"): Promise<Response> {
  return Promise.resolve(
    server.app.request(target, { headers: { host, "sec-fetch-mode": "navigate" } }),
  );
}

async function expectInertRefusal(response: Response): Promise<void> {
  expect(response.status).toBeGreaterThanOrEqual(400);
  expect(response.headers.get("Content-Type")).toMatch(/^text\/plain/);
  expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe("same-origin");
  expect(response.headers.get("X-Frame-Options")).toBe("DENY");
  const csp = response.headers.get("Content-Security-Policy") ?? "";
  expect(csp).toContain("frame-ancestors 'none'");
  // A CSP sandbox gives the document an opaque origin, so even a same-origin
  // parent or opener that keeps a handle cannot read its address.
  expect(csp).toMatch(/(^|;\s*)sandbox(;|$)/);
  expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.text();
  expect(body).not.toContain("Studio");
  expect(body).not.toContain("<");
  expect(body).not.toContain(CODE);
  expect(body).not.toContain(STATE);
}

describe("preview server unknown paths", () => {
  it.each(["/oauth/callback", "/callback"])(
    "refuses an OAuth return at %s instead of serving the Studio shell",
    async (route) => {
      const response = await navigate(`${route}?code=${CODE}&state=${STATE}`);
      await expectInertRefusal(response);
    },
  );

  it.each(["/editor", "/projects/demo", "/index.htm", "/some/deep/path?x=1"])(
    "refuses unknown path %s",
    async (route) => {
      await expectInertRefusal(await navigate(route));
    },
  );

  it("refuses an OAuth return on the localhost host too", async () => {
    await expectInertRefusal(
      await navigate(`/oauth/callback?code=${CODE}&state=${STATE}`, "localhost:3002"),
    );
  });

  it.each([
    `/?code=${CODE}&state=${STATE}`,
    `/?code=${CODE}`,
    `/?state=${STATE}`,
    `/index.html?code=${CODE}&state=${STATE}`,
  ])("refuses an OAuth-shaped query on the entry route: %s", async (target) => {
    await expectInertRefusal(await navigate(target));
  });

  it("refuses an OAuth-shaped query on a route that loads project script", async () => {
    const response = await navigate(`/api/projects/project/preview?code=${CODE}&state=${STATE}`);
    await expectInertRefusal(response);
  });

  it("refuses an OAuth-shaped query sent with a non-GET method", async () => {
    const response = await server.app.request(`/oauth/callback?code=${CODE}&state=${STATE}`, {
      method: "POST",
      headers: { host: "127.0.0.1:3002" },
    });
    await expectInertRefusal(response);
  });
});

describe("preview server entry routes", () => {
  it.each(["/", "/index.html", "/?hf_canary_some_feature=on"])(
    "still serves the Studio shell at %s",
    async (route) => {
      const response = await navigate(route);
      expect(response.status).toBe(200);
      expect(response.headers.get("Content-Type")).toMatch(/^text\/html/);
      expect(await response.text()).toContain("Studio");
    },
  );
});
