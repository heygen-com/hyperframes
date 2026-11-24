import { describe, expect, it } from "vitest";
import type { Page } from "puppeteer-core";
import {
  assertVariablesMatchPage,
  VariablesInvalidError,
  variablesIssues,
  type VariablesIssue,
} from "./variablesCheck.js";

const declare = (...decls: object[]): string => JSON.stringify(decls);
const title = { id: "title", type: "string", label: "Title", default: "x" };
const speed = { id: "speed", type: "number", label: "Speed", default: 1 };
const theme = {
  id: "theme",
  type: "enum",
  label: "Theme",
  default: "dark",
  options: [
    { value: "dark", label: "Dark" },
    { value: "light", label: "Light" },
  ],
};

describe("variablesIssues", () => {
  it("has nothing to check when the render passes no variables", () => {
    expect(variablesIssues({}, null)).toEqual([]);
  });

  it("accepts variables the page declares with matching types", () => {
    expect(variablesIssues({ title: "Hi", speed: 2 }, [declare(title, speed)])).toEqual([]);
  });

  it("names a variable the page does not declare", () => {
    expect(variablesIssues({ titel: "Hi" }, [declare(title)])).toEqual([
      { kind: "undeclared", variableId: "titel" },
    ]);
  });

  it("names the declared and the given type of a mismatch, never the value", () => {
    const issues = variablesIssues({ speed: "fast and secret" }, [declare(speed)]);
    expect(issues).toEqual([
      { kind: "type-mismatch", variableId: "speed", expected: "number", actual: "string" },
    ]);
    expect(JSON.stringify(issues)).not.toContain("secret");
  });

  it("names an enum value outside its options without echoing the value", () => {
    const issues = variablesIssues({ theme: "purple-secret" }, [declare(theme)]);
    expect(issues).toEqual([{ kind: "enum-out-of-range", variableId: "theme" }]);
  });

  it("lets a later declarer win a duplicate id, as the runtime merges them", () => {
    const first = declare({ ...speed, type: "string", default: "slow" });
    expect(variablesIssues({ speed: 2 }, [first, declare(speed)])).toEqual([]);
    expect(variablesIssues({ speed: 2 }, [declare(speed), first])).toHaveLength(1);
  });

  it("fails closed when the runtime offers no declarations to read", () => {
    expect(variablesIssues({ title: "Hi" }, null)).toEqual([{ kind: "declarations-unreadable" }]);
  });

  it.each([["not json"], ['{"id":"title"}']])(
    "does not call a variable undeclared when a declaration cannot be read (%s)",
    (broken) => {
      expect(variablesIssues({ title: "Hi" }, [broken])).toEqual([
        { kind: "declarations-unreadable" },
      ]);
    },
  );

  it("does not call a variable undeclared when one entry of the list is malformed", () => {
    const source = declare(speed, { id: "title" });
    expect(variablesIssues({ title: "Hi" }, [source])).toEqual([
      { kind: "declarations-unreadable" },
    ]);
    expect(variablesIssues({ speed: 2 }, [source])).toEqual([]);
  });
});

describe("VariablesInvalidError", () => {
  it("is a user-owned, non-retryable VARIABLES_INVALID the producer can transport", () => {
    const error = new VariablesInvalidError([{ kind: "undeclared", variableId: "titel" }]);
    expect(error.code).toBe("VARIABLES_INVALID");
    expect(error.owner).toBe("user");
    expect(error.retryable).toBe(false);
    expect(error.message).toBe('Variable "titel" is not declared in data-composition-variables.');
  });

  it("keeps ten issues and says how many there were", () => {
    const undeclared = (n: number): VariablesIssue => ({ kind: "undeclared", variableId: `v${n}` });
    const error = new VariablesInvalidError([
      undeclared(0),
      ...Array.from({ length: 24 }, (_, i) => undeclared(i + 1)),
    ]);
    expect(error.publicMetadata.issues).toHaveLength(10);
    expect(error.publicMetadata.total).toBe(25);
  });

  it("cuts a long name and strips control characters before it is carried anywhere", () => {
    const nameOf = (overrides: Record<string, unknown>): string | undefined => {
      const [issue] = variablesIssues(overrides, [declare(title)]);
      return issue && "variableId" in issue ? issue.variableId : undefined;
    };
    const long = nameOf({ [`${"a".repeat(200)}\n\u0000b`]: 1 });
    expect(long).toHaveLength(64);
    expect([...(long ?? "")].some((ch) => ch.charCodeAt(0) < 32)).toBe(false);
    expect(nameOf({ "a\nb": 1 })).toBe("a?b");
  });
});

function pageReturning(value: unknown): Page {
  return { evaluate: async () => value } as unknown as Page;
}

describe("assertVariablesMatchPage", () => {
  it("passes without reading the page when there are no variables", async () => {
    const page = {
      evaluate: async () => {
        throw new Error("must not be read");
      },
    } as unknown as Page;
    await expect(assertVariablesMatchPage(page, undefined)).resolves.toBeUndefined();
    await expect(assertVariablesMatchPage(page, {})).resolves.toBeUndefined();
  });

  it("passes when the page declares the variables", async () => {
    await expect(
      assertVariablesMatchPage(pageReturning([declare(title)]), { title: "Hi" }),
    ).resolves.toBeUndefined();
  });

  it("refuses with VARIABLES_INVALID naming the variable", async () => {
    await expect(
      assertVariablesMatchPage(pageReturning([declare(title)]), { titel: "Hi" }),
    ).rejects.toMatchObject({
      code: "VARIABLES_INVALID",
      message: expect.stringContaining("titel"),
    });
  });

  it("refuses when the page's runtime cannot list its declarations", async () => {
    await expect(
      assertVariablesMatchPage(pageReturning(null), { title: "Hi" }),
    ).rejects.toMatchObject({
      code: "VARIABLES_INVALID",
      publicMetadata: { issues: [{ kind: "declarations-unreadable" }] },
    });
  });
});
