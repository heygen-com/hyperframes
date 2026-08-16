// @vitest-environment happy-dom

import { describe, expect, it, vi } from "vitest";
import { usePlayerStore } from "./playerStore";
import { isAudibleUnderSolo, isGroupHalfLitUnderSolo } from "./audioSoloSlice";
import * as studioFileHistory from "../../utils/studioFileHistory";

describe("audioSoloSlice", () => {
  it("is exclusive by default, and clicking the only soloed element again clears it", () => {
    usePlayerStore.getState().toggleSolo("a");
    expect(usePlayerStore.getState().soloed).toEqual(new Set(["a"]));
    usePlayerStore.getState().toggleSolo("b");
    expect(usePlayerStore.getState().soloed).toEqual(new Set(["b"]));
    usePlayerStore.getState().toggleSolo("b");
    expect(usePlayerStore.getState().soloed).toEqual(new Set());
  });

  it("⌘/Ctrl-click adds and removes membership without disturbing the rest", () => {
    usePlayerStore.getState().toggleSolo("a");
    usePlayerStore.getState().toggleSolo("b", { add: true });
    expect(usePlayerStore.getState().soloed).toEqual(new Set(["a", "b"]));
    usePlayerStore.getState().toggleSolo("a", { add: true });
    expect(usePlayerStore.getState().soloed).toEqual(new Set(["b"]));
  });

  it("clearSolo empties the set", () => {
    usePlayerStore.getState().toggleSolo("a");
    usePlayerStore.getState().clearSolo();
    expect(usePlayerStore.getState().soloed).toEqual(new Set());
  });
});

describe("export-safety: solo never touches an attribute or the save path", () => {
  it("toggling, ⌘-adding, and clearing solo never calls setAttribute/removeAttribute on any element", () => {
    usePlayerStore.getState().clearSolo();
    const setAttributeSpy = vi.spyOn(Element.prototype, "setAttribute");
    const removeAttributeSpy = vi.spyOn(Element.prototype, "removeAttribute");

    usePlayerStore.getState().toggleSolo("a");
    usePlayerStore.getState().toggleSolo("b", { add: true });
    usePlayerStore.getState().toggleSolo("a", { add: true });
    usePlayerStore.getState().clearSolo();

    expect(setAttributeSpy).not.toHaveBeenCalled();
    expect(removeAttributeSpy).not.toHaveBeenCalled();
    setAttributeSpy.mockRestore();
    removeAttributeSpy.mockRestore();
  });

  it("toggling, ⌘-adding, and clearing solo never invokes the project save path (setElementsHidden's own write function)", () => {
    usePlayerStore.getState().clearSolo();
    const saveSpy = vi.spyOn(studioFileHistory, "saveProjectFilesWithHistory");

    usePlayerStore.getState().toggleSolo("a");
    usePlayerStore.getState().toggleSolo("b", { add: true });
    usePlayerStore.getState().clearSolo();

    expect(saveSpy).not.toHaveBeenCalled();
    saveSpy.mockRestore();
  });
});

describe("isAudibleUnderSolo — the three-bullet rule", () => {
  it("everything is audible when no solo is active", () => {
    expect(isAudibleUnderSolo(new Set(), "clip-a")).toBe(true);
    expect(isAudibleUnderSolo(new Set(), "clip-a", "group-1")).toBe(true);
  });

  it("a soloed element is audible", () => {
    expect(isAudibleUnderSolo(new Set(["clip-a"]), "clip-a")).toBe(true);
  });

  it("a sibling of a soloed element is silent", () => {
    expect(isAudibleUnderSolo(new Set(["clip-a"]), "clip-b")).toBe(false);
  });

  it("a member of a soloed group is audible (group solo = members solo)", () => {
    expect(isAudibleUnderSolo(new Set(["group-1"]), "clip-a", "group-1")).toBe(true);
  });

  it("a member of an UNsoloed group, while a sibling group is soloed, is silent", () => {
    expect(isAudibleUnderSolo(new Set(["group-2"]), "clip-a", "group-1")).toBe(false);
  });

  it("soloing one member of a group does not un-attenuate its siblings in the same group", () => {
    // clip-a is soloed directly; clip-b shares its group but is not itself
    // soloed and the group itself is not soloed — clip-b stays silent.
    expect(isAudibleUnderSolo(new Set(["clip-a"]), "clip-b", "group-1")).toBe(false);
  });

  it("the group itself, monitored as a bus, is audible only when it or a member is soloed", () => {
    expect(isAudibleUnderSolo(new Set(["clip-a"]), "group-1", null)).toBe(false);
    expect(isAudibleUnderSolo(new Set(["group-1"]), "group-1", null)).toBe(true);
  });
});

describe("isGroupHalfLitUnderSolo", () => {
  it("is false when no solo is active", () => {
    expect(isGroupHalfLitUnderSolo(new Set(), "group-1", ["a", "b"])).toBe(false);
  });

  it("is false when the group itself is soloed (fully lit, not half)", () => {
    expect(isGroupHalfLitUnderSolo(new Set(["group-1"]), "group-1", ["a", "b"])).toBe(false);
  });

  it("is true when a member is soloed but the group is not", () => {
    expect(isGroupHalfLitUnderSolo(new Set(["a"]), "group-1", ["a", "b"])).toBe(true);
  });

  it("is false when an unrelated element is soloed", () => {
    expect(isGroupHalfLitUnderSolo(new Set(["other"]), "group-1", ["a", "b"])).toBe(false);
  });
});
