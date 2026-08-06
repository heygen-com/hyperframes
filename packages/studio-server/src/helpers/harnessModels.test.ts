import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listAcpModels } from "./acp/models";
import { clearHarnessModelCache, listHarnessModels } from "./harnessModels";

// The ACP path opens a real session; what is under test here is which path a
// harness is sent down, not what an agent answers.
vi.mock("./acp/models", () => ({
  listAcpModels: vi.fn(async () => [{ id: "sonnet", name: "Claude Sonnet" }]),
}));

const acpModels = vi.mocked(listAcpModels);

beforeEach(() => {
  clearHarnessModelCache();
  acpModels.mockClear();
});

afterEach(() => clearHarnessModelCache());

describe("listHarnessModels", () => {
  it("asks an ACP agent over the protocol it already speaks", async () => {
    const models = await listHarnessModels({
      kind: "custom",
      command: "npx",
      args: ["-y", "some-acp-agent"],
      transport: "acp",
      cwd: "/tmp/project",
    });

    expect(models).toEqual([{ id: "sonnet", name: "Claude Sonnet" }]);
    expect(acpModels.mock.calls[0]?.[0]).toEqual({
      command: "npx",
      args: ["-y", "some-acp-agent"],
      cwd: "/tmp/project",
    });
  });

  // "custom" over the native transport has no way to be asked; the catalog is
  // the fallback, and null is how that is said.
  it("has nothing to ask a native harness that does not answer", async () => {
    expect(await listHarnessModels({ kind: "custom", command: "my-agent", args: [] })).toBeNull();
    expect(acpModels).not.toHaveBeenCalled();
  });

  // Two ACP adapters are both "custom" and are two different answers, so the
  // command has to be part of what is remembered.
  it("caches per harness as invoked, not per kind", async () => {
    const first = {
      kind: "custom" as const,
      command: "agent-a",
      args: [],
      transport: "acp" as const,
    };
    await listHarnessModels(first);
    await listHarnessModels(first);
    expect(acpModels).toHaveBeenCalledTimes(1);

    await listHarnessModels({ ...first, command: "agent-b" });
    expect(acpModels).toHaveBeenCalledTimes(2);
  });
});
