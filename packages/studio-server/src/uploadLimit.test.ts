// @vitest-environment node
import { describe, expect, it } from "vitest";
import * as studioServer from "./index";
import { stubAdapter } from "./routes/stubAdapter.test-helpers";

describe("public upload limit", () => {
  it("exports the 500 MiB ceiling for hosts to share", () => {
    expect(Reflect.get(studioServer, "MAX_UPLOAD_BYTES")).toBe(524_288_000);
  });

  it.each([
    [524_288_000, 404, "not found"],
    [524_288_001, 413, "payload too large"],
  ])("handles a declared body of %i bytes with status %i", async (size, status, error) => {
    const api = studioServer.createStudioApi({
      ...stubAdapter("unused"),
      resolveProject: async () => null,
    });
    const response = await api.request("http://localhost/projects/missing/upload", {
      method: "POST",
      headers: { "content-length": String(size) },
      body: "x",
    });
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ error });
  });
});
