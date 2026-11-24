import { afterEach, expect, it, vi } from "vitest";
import { consumeCommandResult } from "../utils/commandResult.js";
import { refusal } from "./a2Shared.js";

afterEach(() => {
  consumeCommandResult();
  vi.restoreAllMocks();
});

// fails without the fix: the reason and the fix were printed as they arrived
it.each([
  ["reason", "#clip\u0007 was not found", "choose an existing clip", "#clip\\x07 was not found; "],
  ["fix", "no stable id", "add an id in scene\u0007.html", "; add an id in scene\\x07.html."],
])("shows control characters in a refusal's %s as text", (_, reason, fix, shown) => {
  const error = vi.spyOn(console, "error").mockImplementation(() => {});

  refusal(reason, fix, false);

  const printed = error.mock.calls.map((call) => call.join(" ")).join("\n");
  expect(printed).toContain(shown);
  expect(printed).not.toContain("\u0007");
});
