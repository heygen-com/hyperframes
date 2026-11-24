import { describe, expect, it } from "vitest";
import { requestSubPath } from "./requestSubPath";

const ROUTE = "projects/:id/files";

describe("requestSubPath", () => {
  it.each([
    ["/api/projects/film/files/scenes/intro.html", "/projects/film/files/scenes/intro.html"],
    ["/api/pr%6Fjects/film/files/sub", "/pr%6Fjects/film/files/sub"],
    ["/api/projects/film/fil%65s/a%20b.html", "/projects/film/fil%65s/a%20b.html"],
    ["/api/pr%6Fjects/film/files/..%2F..%2Fsub", "/pr%6Fjects/film/files/..%2F..%2Fsub"],
  ])("reads the same path from %s before and after /api is stripped", (outer, inner) => {
    const before = requestSubPath(`http://localhost${outer}`, ROUTE);
    expect(before).not.toBeNull();
    expect(requestSubPath(`http://localhost${inner}`, ROUTE)).toBe(before);
  });

  it("decodes the path after the route", () => {
    expect(requestSubPath("http://localhost/pr%6Fjects/film/files/..%2F..%2Fsub", ROUTE)).toBe(
      "../../sub",
    );
    expect(requestSubPath("http://localhost/projects/film/files/100%.png", ROUTE)).toBe("100%.png");
  });

  it("finds the route where it first appears", () => {
    expect(
      requestSubPath("http://localhost/projects/film/files/projects/x/files/a.html", ROUTE),
    ).toBe("projects/x/files/a.html");
  });

  it("gives no path when the route is not in the URL", () => {
    expect(requestSubPath("http://localhost/api/project/film/files/a.html", ROUTE)).toBeNull();
    expect(requestSubPath("http://localhost/projects/film", ROUTE)).toBeNull();
    expect(requestSubPath("http://localhost/elsewhere/a.html", "composition")).toBeNull();
  });
});
