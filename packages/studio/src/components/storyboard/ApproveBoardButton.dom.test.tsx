// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const showToast = vi.fn();
vi.mock("../../contexts/StudioContext", () => ({ useStudioShellContext: () => ({ showToast }) }));
const track = vi.fn();
vi.mock("../../utils/studioTelemetry", () => ({ trackStudioEvent: track }));
const copy = vi.fn(async (_text: string) => true);
vi.mock("../../utils/clipboard", () => ({ copyTextToClipboard: copy }));

const { APPROVE_WORDS, ApproveBoardButton } = await import("./ApproveBoardButton");

afterEach(() => {
  document.body.innerHTML = "";
  vi.clearAllMocks();
});

async function press() {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  await act(async () => root.render(<ApproveBoardButton />));
  await act(async () =>
    document.querySelector<HTMLButtonElement>('[data-testid="storyboard-approve"]')!.click(),
  );
  await act(async () => root.unmount());
}

it("approves without the desktop app: copies the go for the person's own agent", async () => {
  await press();
  expect(copy).toHaveBeenCalledWith(APPROVE_WORDS);
  expect(showToast).toHaveBeenCalledWith(
    "Copied. Paste it to your agent to start the build.",
    "info",
  );
  expect(track).toHaveBeenCalledWith("storyboard_action", { action: "approve_copied" });
});

it("spells the go out when the clipboard refuses, so the person can still type it", async () => {
  copy.mockResolvedValueOnce(false);
  await press();
  expect(showToast).toHaveBeenCalledWith(expect.stringContaining(APPROVE_WORDS), "info");
  expect(track).toHaveBeenCalledWith("storyboard_action", { action: "approve_copy_failed" });
});
