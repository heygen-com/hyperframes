import { describe, expect, it, vi } from "vitest";
import { addExternalFileReloadListener, notifyExternalFileReload } from "./externalFileReloadBus";

describe("external file reload bus", () => {
  it("lets the sole watcher reload every SDK owner of the changed path", () => {
    const first = vi.fn();
    const second = vi.fn();
    const removeFirst = addExternalFileReloadListener(first);
    const removeSecond = addExternalFileReloadListener(second);

    notifyExternalFileReload("scenes/card.html");
    expect(first).toHaveBeenCalledWith("scenes/card.html");
    expect(second).toHaveBeenCalledWith("scenes/card.html");

    removeFirst();
    removeSecond();
  });
});
