import { describe, expect, it } from "vitest";
import { readPermissionRequest, refusalOption } from "./permissions";

const OPTIONS = [
  { optionId: "yes", name: "Allow this once", kind: "allow_once" },
  { optionId: "always", name: "Always allow writes", kind: "allow_always" },
  { optionId: "no", name: "Don't allow", kind: "reject_once" },
];

describe("readPermissionRequest", () => {
  it("keeps the agent's own title and options", () => {
    expect(
      readPermissionRequest({
        sessionId: "s1",
        toolCall: { toolCallId: "c1", title: "Write composition.html", kind: "edit" },
        options: OPTIONS,
      }),
    ).toEqual({ tool: "Write composition.html", options: OPTIONS });
  });

  // What a real agent sends: it asks about a call by id, having put the title
  // in the update that announced the call.
  it("uses the title the agent gave that call earlier", () => {
    expect(
      readPermissionRequest(
        { toolCall: { toolCallId: "exec-1", kind: "edit", status: "pending" }, options: OPTIONS },
        (id) => (id === "exec-1" ? "Run npx hyperframes lint" : undefined),
      ),
    ).toMatchObject({ tool: "Run npx hyperframes lint" });
  });

  // A uuid tells the user nothing they can decide on.
  it("prefers the kind over the call id when nothing named it", () => {
    expect(
      readPermissionRequest({
        toolCall: { toolCallId: "exec-282be8b3", kind: "edit" },
        options: OPTIONS,
      }),
    ).toMatchObject({ tool: "edit" });
  });

  // Every option shown is one the user might click, so an option Studio cannot
  // describe is one it must not offer.
  it("drops options it cannot read and keeps the rest", () => {
    expect(
      readPermissionRequest({
        toolCall: { title: "Write" },
        options: [{ optionId: "yes", name: "Allow" }, { name: "no id" }, "nonsense"],
      }),
    ).toEqual({ tool: "Write", options: [{ optionId: "yes", name: "Allow" }] });
  });

  // Nothing to click means nothing to show, and answering it on the user's
  // behalf is exactly what must not happen.
  it("refuses a request with no readable options at all", () => {
    expect(readPermissionRequest({ toolCall: { title: "Write" }, options: [] })).toBeNull();
    expect(readPermissionRequest({ toolCall: { title: "Write" } })).toBeNull();
    expect(readPermissionRequest(null)).toBeNull();
  });
});

describe("refusalOption", () => {
  it("prefers refusing this one call over refusing every call like it", () => {
    expect(refusalOption({ tool: "Write", options: OPTIONS })).toMatchObject({ optionId: "no" });
  });

  it("takes a blanket refusal when that is all there is", () => {
    expect(
      refusalOption({
        tool: "Write",
        options: [
          { optionId: "yes", name: "Allow", kind: "allow_once" },
          { optionId: "never", name: "Never", kind: "reject_always" },
        ],
      }),
    ).toMatchObject({ optionId: "never" });
  });

  it("finds none when the agent only offered ways to say yes", () => {
    expect(
      refusalOption({ tool: "Write", options: [{ optionId: "yes", name: "Allow" }] }),
    ).toBeNull();
  });
});
