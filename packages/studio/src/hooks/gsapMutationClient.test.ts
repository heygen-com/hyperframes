import { afterEach, describe, expect, it, vi } from "vitest";
import { GsapPreviewConvergenceError, postGsapMutation } from "./gsapMutationClient";

afterEach(() => vi.unstubAllGlobals());

const refuse = (status: number, body: unknown) =>
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(JSON.stringify(body), { status })),
  );

describe("postGsapMutation", () => {
  // fails without the fix: a refused mutation threw the server's words without its status.
  it("a refused mutation keeps the server's words and its status", async () => {
    refuse(400, { error: "No tween at that index" });
    const refused = postGsapMutation(
      "p",
      "index.html",
      { op: "update" },
      "Couldn't save animation",
    );
    await expect(refused).rejects.toBeInstanceOf(GsapPreviewConvergenceError);
    await expect(refused).rejects.toThrow("No tween at that index (400)");
  });

  it("a refusal with no words of its own keeps the fallback and the status", async () => {
    refuse(500, {});
    await expect(
      postGsapMutation("p", "index.html", { op: "update" }, "Couldn't save animation"),
    ).rejects.toThrow("Couldn't save animation (500)");
  });
});
