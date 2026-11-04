// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalShareSnapshot, LocalShareJob } from "@hyperframes/studio-server";
import type { Button } from "../ui/Button";
type ButtonProps = React.ComponentProps<typeof Button>;
import type { SelectProps } from "../ui/Select";

vi.mock("../ui", () => ({
  Button: ({ children, variant: _variant, ...props }: ButtonProps) => (
    <button {...props}>{children}</button>
  ),
  Select: ({ label, value, disabled, onCommit, options }: SelectProps) => (
    <select
      aria-label={label}
      value={value}
      disabled={disabled}
      onChange={(event) => onCommit(event.target.value)}
    >
      {options.map((option) => (
        <option key={option.value} value={option.value} disabled={option.disabled}>
          {option.label}
        </option>
      ))}
    </select>
  ),
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const { QuickShareContent } = await import("./QuickShare");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let host: HTMLDivElement;
let snapshot: LocalShareSnapshot;
let calls: unknown[];
let job: LocalShareJob;
const token = "a".repeat(43);
beforeEach(() => {
  calls = [];
  snapshot = {
    versionSharing: true,
    share: {
      state: "not_shared",
      url: null,
      manageUrl: "https://hyperframes.dev/shares",
      changed: false,
      audience: null,
      spaceId: null,
    },
    spaces: [
      {
        id: "team1",
        name: "Design team",
        bound: true,
        canCreate: true,
        audiences: ["public", "private", "invite"],
        used: 5,
        limit: 5,
      },
    ],
    job: null,
  };
  job = { id: "job1", state: "running", step: "uploading", result: null, error: null };
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      expect(new Headers(init?.headers).get("X-Hyperframes-Share-CSRF")).toBe(token);
      if (url.endsWith("/snapshot")) return Response.json(snapshot);
      if (url.endsWith("/actions")) {
        calls.push(JSON.parse(String(init?.body)));
        return Response.json(job, { status: 202 });
      }
      return Response.json(job);
    }),
  );
});
afterEach(() => {
  act(() => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
const button = (label: string) =>
  [...host.querySelectorAll("button")].find((element) => element.textContent === label);
async function mount(beforeShare?: () => Promise<void>) {
  await act(async () => root.render(<QuickShareContent token={token} beforeShare={beforeShare} />));
}
async function choose(value: string) {
  const select = host.querySelector<HTMLSelectElement>('[aria-label="Who can access"]');
  if (!select) throw new Error("Missing audience");
  await act(async () => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true }));
  });
}
it("requires explicit audience, uses the bound workspace and permits server-authoritative quota retries", async () => {
  await mount();
  expect(host.textContent).toContain("5 of 5 free shared projects used");
  expect(button("Create share link")?.disabled).toBe(true);
  expect(calls).toEqual([]);
  await choose("private");
  expect(button("Create share link")?.disabled).toBe(false);
  await act(async () => button("Create share link")?.click());
  expect(calls).toEqual([{ action: "share", audience: "private", space: "team1" }]);
});
it("drains pending editor saves before creating or uploading", async () => {
  let resolveSave = () => {};
  const save = vi.fn(
    () =>
      new Promise<void>((resolve) => {
        resolveSave = resolve;
      }),
  );
  await mount(save);
  await choose("public");
  await act(async () => button("Create share link")?.click());
  expect(save).toHaveBeenCalledOnce();
  expect(calls).toEqual([]);
  await act(async () => resolveSave());
  expect(calls).toHaveLength(1);
});
it("does not publish when saving fails", async () => {
  await mount(async () => {
    throw new Error("write failed");
  });
  await choose("private");
  await act(async () => button("Create share link")?.click());
  expect(calls).toEqual([]);
  expect(host.querySelector('[role="alert"]')).not.toBeNull();
});
it("shows stale copy separately and never uploads merely by opening", async () => {
  snapshot.share = {
    ...snapshot.share,
    state: "ready",
    url: "https://hyperframes.dev/r/live",
    changed: true,
    audience: "private",
    spaceId: "team1",
  };
  await mount();
  expect(button("Copy current shared link")).toBeDefined();
  expect(calls).toEqual([]);
  await act(async () => button("Update shared version")?.click());
  expect(calls).toEqual([{ action: "update" }]);
});
it("keeps link-off updates separate from explicit re-enabling", async () => {
  snapshot.share = { ...snapshot.share, state: "link_off", audience: "private", spaceId: "team1" };
  await mount();
  expect(button("Turn link on")).toBeDefined();
  await act(async () => button("Update shared version")?.click());
  expect(calls).toEqual([{ action: "update" }]);
});
it("recovers a running job on reopening, and stops browser polling on close", async () => {
  vi.useFakeTimers();
  snapshot.job = job;
  await mount();
  expect(host.textContent).toContain("Uploading your video");
  expect(calls).toEqual([]);
  await act(async () => root.render(null));
  const before = vi.mocked(fetch).mock.calls.length;
  await act(async () => vi.advanceTimersByTime(3000));
  expect(vi.mocked(fetch).mock.calls.length).toBe(before);
  await mount();
  expect(host.textContent).toContain("Uploading your video");
  expect(calls).toEqual([]);
});
it("hides creation while feature is off but keeps existing management", async () => {
  snapshot.versionSharing = false;
  snapshot.share = { ...snapshot.share, state: "link_off", audience: "private", spaceId: "team1" };
  await mount();
  expect(button("Update shared version")).toBeUndefined();
  expect(button("Turn link on")).toBeDefined();
});
it("recovers a failed job on reopening instead of silently dropping the error", async () => {
  snapshot.job = {
    ...job,
    state: "failed",
    error: { code: "share_failed", message: "The upload failed. Try again." },
  };
  await mount();
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("The upload failed");
  expect(calls).toEqual([]);
});
