// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StudioFeedbackBar } from "./StudioFeedbackBar";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

beforeEach(() => {
  vi.useFakeTimers();
  localStorage.clear();
  sessionStorage.clear();
});

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
  vi.useRealTimers();
});

describe("StudioFeedbackBar", () => {
  it("mounts and unmounts outside the editor layout flow", () => {
    localStorage.setItem("hyperframes-studio:feedbackSessionCount", "9");
    localStorage.setItem("hyperframes-studio:feedbackLastPromptedAt", "0");

    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);
    act(() => {
      root?.render(
        <div className="flex h-[600px] flex-col">
          <div data-testid="editing-surface" className="min-h-0 flex-1" />
          <StudioFeedbackBar />
        </div>,
      );
    });

    const editingSurface = document.querySelector('[data-testid="editing-surface"]');
    if (!(editingSurface instanceof HTMLElement)) {
      throw new Error("editing surface not rendered");
    }
    const before = {
      className: editingSurface.className,
      style: editingSurface.getAttribute("style"),
      width: editingSurface.getBoundingClientRect().width,
      height: editingSurface.getBoundingClientRect().height,
    };

    act(() => vi.advanceTimersByTime(3000));

    const prompt = [...document.querySelectorAll("span")].find(
      (element) => element.textContent === "How's the Studio experience?",
    );
    const feedbackBar = prompt?.parentElement;
    if (!feedbackBar) throw new Error("feedback bar not rendered");
    expect(feedbackBar.classList.contains("fixed")).toBe(true);
    expect(feedbackBar.classList.contains("bottom-0")).toBe(true);
    expect(feedbackBar.classList.contains("inset-x-0")).toBe(true);
    expect({
      className: editingSurface.className,
      style: editingSurface.getAttribute("style"),
      width: editingSurface.getBoundingClientRect().width,
      height: editingSurface.getBoundingClientRect().height,
    }).toEqual(before);

    const dismissButton = document.querySelector('button[aria-label="Dismiss"]');
    if (!(dismissButton instanceof HTMLButtonElement)) {
      throw new Error("dismiss button not rendered");
    }
    act(() => dismissButton.click());
    act(() => vi.advanceTimersByTime(300));

    expect(document.body.textContent).not.toContain("How's the Studio experience?");
    expect({
      className: editingSurface.className,
      style: editingSurface.getAttribute("style"),
      width: editingSurface.getBoundingClientRect().width,
      height: editingSurface.getBoundingClientRect().height,
    }).toEqual(before);
  });
});
