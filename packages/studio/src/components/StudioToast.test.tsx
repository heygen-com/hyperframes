// @vitest-environment happy-dom

import React, { act } from "react";
import { afterEach, describe, expect, it } from "vitest";
import { mountReactHarness } from "../hooks/domSelectionTestHarness";
import { StudioToast } from "./StudioToast";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

afterEach(() => {
  document.body.innerHTML = "";
});

function mount(tone: "error" | "info") {
  const dismissed: string[] = [];
  mountReactHarness(
    <StudioToast message="Saved" tone={tone} onDismiss={() => dismissed.push(tone)} />,
  );
  return dismissed;
}

describe("StudioToast", () => {
  it("dismisses an info toast on a click anywhere on it, with no Dismiss button", () => {
    const dismissed = mount("info");
    expect(document.querySelector("button")).toBeNull();
    act(() => document.querySelector<HTMLElement>("[role=status]")?.click());
    expect(dismissed).toEqual(["info"]);
  });

  it("keeps an error toast up on a click on it, so its text can be selected and copied", () => {
    const dismissed = mount("error");
    act(() => document.querySelector<HTMLElement>("[role=alert]")?.click());
    expect(dismissed).toEqual([]);
  });

  it("gives a persisting error toast a Dismiss button that dismisses it once", () => {
    const dismissed = mount("error");
    act(() => document.querySelector<HTMLElement>("[aria-label=Dismiss]")?.click());
    expect(dismissed).toEqual(["error"]);
  });
});
