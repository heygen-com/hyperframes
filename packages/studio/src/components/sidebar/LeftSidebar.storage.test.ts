// @vitest-environment happy-dom

import { afterEach, expect, it, vi } from "vitest";
import { getPersistedTab } from "./LeftSidebar";

vi.mock("../../utils/studioTelemetry", () => ({ trackStudioEvent: vi.fn() }));

const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  if (originalDescriptor) Object.defineProperty(globalThis, "localStorage", originalDescriptor);
});

it("falls back to the default tab when localStorage is blocked", () => {
  // Chrome throws on the property read itself when site data is blocked for
  // the document. This runs as a useState initializer, so throwing here takes
  // Studio to the crash boundary.
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    get() {
      throw new Error(
        "Failed to read the 'localStorage' property from 'Window': Access is denied for this document.",
      );
    },
  });

  expect(getPersistedTab()).toBe("compositions");
});
