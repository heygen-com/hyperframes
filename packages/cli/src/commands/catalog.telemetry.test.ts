import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  trackEvent: vi.fn(),
  shouldTrack: vi.fn(() => true),
  startAuthorizationCodeFlow: vi.fn(),
}));

vi.mock("@clack/prompts", () => ({
  select: vi.fn(),
  isCancel: () => false,
  cancel: vi.fn(),
}));
vi.mock("../telemetry/client.js", () => ({
  trackEvent: mocks.trackEvent,
  shouldTrack: mocks.shouldTrack,
}));
vi.mock("../telemetry/config.js", () => ({
  readConfig: () => ({ anonymousId: "anonymous-catalog" }),
}));
vi.mock("../auth/index.js", () => ({
  tryResolveOAuthCredential: vi.fn(),
  startAuthorizationCodeFlow: mocks.startAuthorizationCodeFlow,
  AuthClient: class {},
}));
vi.mock("./add.js", () => ({ runAdd: vi.fn() }));
vi.mock("../registry/resolver.js", () => ({
  listRegistryItems: vi.fn(async () => [
    { name: "thread-message-stack", type: "hyperframes:block" },
    { name: "data-chart", type: "hyperframes:block" },
  ]),
  loadAllItems: vi.fn(async () => [
    {
      name: "thread-message-stack",
      type: "hyperframes:block",
      title: "Thread Message Stack",
      description: "Conversation messages",
      tags: ["social"],
      dimensions: { width: 1920, height: 1080 },
      duration: 8,
      files: [],
    },
    {
      name: "data-chart",
      type: "hyperframes:block",
      title: "Data Chart",
      description: "Animated chart",
      tags: ["data"],
      dimensions: { width: 1920, height: 1080 },
      duration: 8,
      files: [],
    },
  ]),
}));

import catalogCommand from "./catalog.js";

describe("anonymous catalog result-delivery telemetry", () => {
  beforeEach(() => {
    mocks.trackEvent.mockReset();
    mocks.shouldTrack.mockReset().mockReturnValue(true);
    mocks.startAuthorizationCodeFlow.mockReset();
    vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  it.each([
    ["JSON", { json: true, query: "messages" }],
    ["noninteractive table", { query: "messages" }],
  ])("emits one privacy-safe canonical search event on %s result delivery", async (_name, args) => {
    await catalogCommand.run!({ args, rawArgs: [], cmd: catalogCommand } as never);

    expect(mocks.startAuthorizationCodeFlow).not.toHaveBeenCalled();
    expect(mocks.trackEvent).toHaveBeenCalledTimes(1);
    expect(mocks.trackEvent).toHaveBeenCalledWith(
      "primitive_catalog_searched",
      expect.objectContaining({
        primitive_id: "thread-message-stack",
        result_count: 1,
        auth_state: "anonymous",
        funnel_id: expect.any(String),
        event_id: expect.any(String),
      }),
    );
    const payload = JSON.stringify(mocks.trackEvent.mock.calls[0]?.[1]);
    expect(payload).not.toContain("messages");
    expect(payload).not.toMatch(/raw_query|query_text|credential|token/);
  });
});
