// @vitest-environment happy-dom

import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AskAgentModal } from "./AskAgentModal";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.innerHTML = "";
});

function renderModal(props: {
  title: string;
  subtitle: string;
  initialValue?: string;
  onSubmit: (value: string) => void;
  onClose: () => void;
}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(<AskAgentModal {...props} />);
  });
}

function textarea(): HTMLTextAreaElement {
  const element = document.querySelector("textarea");
  if (!(element instanceof HTMLTextAreaElement)) throw new Error("textarea not rendered");
  return element;
}

describe("AskAgentModal", () => {
  it("supports an empty element instruction and closes on Escape while untouched", () => {
    const onClose = vi.fn();
    renderModal({
      title: "Copy prompt to AI agent",
      subtitle: "Selected heading",
      onSubmit: vi.fn(),
      onClose,
    });

    expect(textarea().value).toBe("");
    expect(document.body.textContent).toContain("Copy prompt to AI agent");
    expect(document.body.textContent).toContain("Selected heading");

    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("submits a prefilled block prompt and protects edits from Escape", () => {
    const onSubmit = vi.fn();
    const onClose = vi.fn();
    renderModal({
      title: "Ask agent",
      subtitle: "Data chart",
      initialValue: "Use /hyperframes to add the data chart.",
      onSubmit,
      onClose,
    });

    const input = textarea();
    expect(input.value).toBe("Use /hyperframes to add the data chart.");

    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    if (!setValue) throw new Error("textarea value setter unavailable");
    act(() => {
      setValue.call(input, `${input.value} Make it blue.`);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    act(() => document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(onClose).not.toHaveBeenCalled();

    const copyButton = [...document.querySelectorAll("button")].find((button) =>
      button.textContent?.includes("Copy prompt"),
    );
    if (!copyButton) throw new Error("copy button not rendered");
    act(() => copyButton.click());

    expect(onSubmit).toHaveBeenCalledWith("Use /hyperframes to add the data chart. Make it blue.");
    expect(copyButton.textContent).toBe("Copied!");
  });
});
