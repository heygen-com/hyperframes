import { afterEach, describe, expect, it, vi } from "vitest";
import { RENDER_VARIABLES_FILE } from "@hyperframes/core/project-folders";
import { renderHandoffCommand, saveRenderVariables } from "./renderHandoff";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("renderHandoffCommand", () => {
  it.each(["index.html", "compositions/intro.html", "scenes/v2_final-cut.html", "2026/q4.html"])(
    "renders %s with the values file",
    (compPath) => {
      expect(renderHandoffCommand(compPath)).toBe(
        `npx hyperframes render -c ${compPath} --variables-file .hyperframes/render-variables.json`,
      );
    },
  );

  it.each([
    "x';calc;'.html",
    'x";calc;".html',
    "a&calc.html",
    "a|calc.html",
    "a;calc.html",
    "a\\b.html",
    "a b.html",
    "$(id).html",
    "`id`.html",
    "%PATH%.html",
    "a^b.html",
    "a(b).html",
    "a!b.html",
    "a,b.html",
    "a{b}.html",
    "a*b.html",
    "a\nb.html",
    "~/a.html",
    "@a.html",
    "#a.html",
    "-o.html",
    "--output=x.html",
    ".x.html",
    "intró.html",
    "",
  ])("never puts a composition name a shell reads as syntax in the command: %j", (compPath) => {
    expect(renderHandoffCommand(compPath)).toBeNull();
  });

  it("names a values file that is one plain word in every shell", () => {
    expect(RENDER_VARIABLES_FILE).toMatch(/^[A-Za-z0-9_./-]+$/);
  });
});

describe("saveRenderVariables", () => {
  it("puts the values as JSON to the project's render-variables route", async () => {
    const fetch = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetch);
    const values = { title: "It's Q4'; calc; '", count: 3 };

    expect(await saveRenderVariables("my project", values)).toBe(true);

    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, init] = fetch.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/projects/my%20project/render-variables");
    expect(init.method).toBe("PUT");
    expect(JSON.parse(String(init.body))).toEqual(values);
  });

  it("is false when the server refuses the write", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("{}", { status: 403 })),
    );
    expect(await saveRenderVariables("p", {})).toBe(false);
  });

  it("is false when the server cannot be reached", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("Failed to fetch");
      }),
    );
    expect(await saveRenderVariables("p", {})).toBe(false);
  });
});
