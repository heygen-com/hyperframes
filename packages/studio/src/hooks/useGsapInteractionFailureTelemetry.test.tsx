// @vitest-environment happy-dom

import React, { act } from "react";
import { describe, expect, it, vi } from "vitest";
import type { DomEditSelection } from "../components/editor/domEditingTypes";
import { mountReactHarness } from "./domSelectionTestHarness";
import { GsapEditBlockedError } from "./gsapEditOutcome";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const trackStudioSaveFailure = vi.hoisted(() => vi.fn());
vi.mock("../utils/studioSaveDiagnostics", () => ({ trackStudioSaveFailure }));

import { useGsapInteractionFailureTelemetry } from "./useGsapInteractionFailureTelemetry";

describe("useGsapInteractionFailureTelemetry", () => {
  it("surfaces the blocked reason instead of a generic save failure", () => {
    const showToast = vi.fn();
    const selection = {
      id: "clip",
      selector: "#clip",
      element: document.createElement("div"),
    } as unknown as DomEditSelection;
    let report!: ReturnType<typeof useGsapInteractionFailureTelemetry>;
    function Harness() {
      report = useGsapInteractionFailureTelemetry("index.html", showToast);
      return null;
    }
    const root = mountReactHarness(<Harness />);

    act(() => report(new GsapEditBlockedError("unroll-required"), selection, "drag", "Move"));

    expect(showToast).toHaveBeenCalledWith(
      "This motion comes from a helper or loop. Choose Unroll to edit it explicitly.",
      "error",
    );
    expect(trackStudioSaveFailure).toHaveBeenCalledWith(
      expect.objectContaining({ source: "gsap_commit", mutationType: "drag", targetId: "clip" }),
    );
    act(() => root.unmount());
  });
});
