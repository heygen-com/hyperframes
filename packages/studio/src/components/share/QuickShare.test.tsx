// @vitest-environment happy-dom
import React, { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { LocalShareSnapshot, LocalShareJob } from "@hyperframes/studio-server";
import type { Button } from "../ui/Button";
type ButtonProps = React.ComponentProps<typeof Button>;

const interaction = vi.hoisted(() => vi.fn());
vi.mock("./localShareTelemetry", () => ({ shareInteraction: interaction }));
vi.mock("../ui", () => ({
  Button: ({ children, variant: _variant, ...props }: ButtonProps) => (
    <button {...props}>{children}</button>
  ),
  Menu: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  MenuRadioGroup: ({
    children,
    value,
    onValueChange,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (value: string) => void;
  }) => (
    <select
      aria-label="Who can access"
      value={value}
      onChange={(event) => onValueChange(event.target.value)}
    >
      <option value="">Choose access</option>
      {children}
    </select>
  ),
  MenuRadioItem: ({ value, disabled }: { value: string; disabled?: boolean }) => (
    <option value={value} disabled={disabled}>
      {value === "private" ? "Only you" : value}
    </option>
  ),
  Popover: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
const { QuickShare, QuickShareContent } = await import("./QuickShare");
Reflect.set(globalThis, "IS_REACT_ACT_ENVIRONMENT", true);
let root: Root;
let host: HTMLDivElement;
let snapshot: LocalShareSnapshot;
let calls: unknown[];
let job: LocalShareJob;
const token = "a".repeat(43);
beforeEach(() => {
  interaction.mockReset();
  calls = [];
  snapshot = {
    versionSharing: true,
    share: {
      source: "not_checked",
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
  expect(host.textContent).toContain("5 of 5 free share links used");
  expect(button("Create share link")?.disabled).toBe(true);
  expect(calls).toEqual([]);
  await choose("public");
  expect(button("Create share link")?.disabled).toBe(false);
  await act(async () => button("Create share link")?.click());
  expect(calls).toEqual([{ action: "share", audience: "public", space: "team1" }]);
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
  await choose("public");
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

it("offers video-only recovery explicitly after a failed source upload", async () => {
  snapshot.share = {
    ...snapshot.share,
    state: "processing",
    audience: "private",
    spaceId: "team1",
  };
  snapshot.job = {
    ...job,
    state: "failed",
    error: { code: "source_unavailable", message: "Project files could not be attached." },
  };
  await mount();
  expect(calls).toEqual([]);
  await act(async () => button("Retry with video only")?.click());
  expect(calls).toEqual([{ action: "update", videoOnly: true }]);
});
it("labels files as included only after a ready upload result", async () => {
  snapshot.job = {
    ...job,
    state: "done",
    result: { ...snapshot.share, state: "ready", source: "ready" },
  };
  await mount();
  expect(host.textContent).toContain("Last Studio upload: project files included.");
});
it.each(["unauthenticated", "login_expired"])(
  "offers explicit browser login for %s and recovers signed-out polling",
  async (code) => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init?: RequestInit) => {
        if (url.endsWith("/actions")) {
          calls.push(JSON.parse(String(init?.body)));
          return Response.json({ ...job, step: "signing_in" });
        }
        return Response.json({ code, message: "Sign in to share.", job: null }, { status: 400 });
      }),
    );
    await mount();
    expect(calls).toEqual([]);
    expect(button("Sign in")).toBeDefined();
    await act(async () => button("Sign in")?.click());
    expect(calls).toEqual([{ action: "login" }]);
    expect(host.textContent).toContain("Finish signing in in your browser");
  },
);

it("records a copy only after the clipboard succeeds and opening once per panel", async () => {
  snapshot.share = {
    ...snapshot.share,
    state: "ready",
    url: "https://hyperframes.dev/r/old",
    audience: "private",
    spaceId: "team1",
  };
  const copy = vi.spyOn(navigator.clipboard, "writeText");
  copy.mockRejectedValueOnce(new Error("denied")).mockResolvedValue(undefined);
  await mount();
  expect(interaction).toHaveBeenCalledExactlyOnceWith(token, {
    event: "share_opened",
    link: "live",
  });
  await act(async () => button("Copy link")?.click());
  expect(interaction).toHaveBeenCalledTimes(1);
  await act(async () => button("Copy link")?.click());
  expect(interaction).toHaveBeenLastCalledWith(token, { event: "share_link_copied", via: "copy" });
  expect(calls).toEqual([]);
  copy.mockRestore();
});

it("clears account-specific links and workspace controls after an identity failure", async () => {
  snapshot.share = {
    ...snapshot.share,
    state: "ready",
    url: "https://hyperframes.dev/r/private",
    audience: "private",
    spaceId: "team1",
  };
  await mount();
  expect(button("Copy link")).toBeDefined();
  vi.mocked(fetch).mockResolvedValue(
    Response.json({ code: "login_changed", message: "Your login changed" }, { status: 400 }),
  );
  await act(async () => button("Update shared version")?.click());
  expect(button("Copy link")).toBeUndefined();
  expect(button("Update shared version")).toBeUndefined();
  expect(host.querySelector('[aria-label="Sharing workspace"]')).toBeNull();
  expect(host.textContent).not.toContain("Design team");
  expect(button("Sign in")).toBeDefined();
});

it("does not claim an older upload is current when its portable content identity is unknown", async () => {
  snapshot.share = {
    ...snapshot.share,
    state: "ready",
    changed: null,
    url: "https://hyperframes.dev/r/live",
  };
  await mount();
  expect(button("Copy current shared link")).toBeDefined();
  expect(host.textContent).toContain("Changes after your last upload aren’t shared automatically");
});

it("continues from a running browser login to fresh controls without refreshing or publishing", async () => {
  vi.useFakeTimers();
  let signedIn = false;
  const loginJob = { ...job, step: "signing_in" };
  vi.mocked(fetch).mockImplementation(async (url, init) => {
    const path = String(url);
    if (path.endsWith("/actions")) {
      calls.push(JSON.parse(String(init?.body)));
      return Response.json(loginJob, { status: 202 });
    }
    if (path.includes("/jobs/"))
      return Response.json(
        signedIn ? { ...loginJob, state: "done", result: snapshot.share } : loginJob,
      );
    return signedIn
      ? Response.json({ ...snapshot, job: { ...loginJob, state: "done", result: snapshot.share } })
      : Response.json({ code: "login_expired", message: "Sign in again." }, { status: 400 });
  });
  await mount();
  await act(async () => button("Sign in")?.click());
  await act(async () => vi.advanceTimersByTime(1000));
  expect(host.textContent).toContain("Finish signing in");
  signedIn = true;
  await act(async () => vi.advanceTimersByTime(1000));
  expect(button("Sign in")).toBeUndefined();
  expect(host.querySelector('[aria-label="Who can access"]')).not.toBeNull();
  expect(button("Create share link")?.disabled).toBe(true);
  expect(calls).toEqual([{ action: "login" }]);
});

it.each(["snapshot", "poll"])(
  "reconnects on return after a %s error without a refresh press",
  async (failureAt) => {
    vi.useFakeTimers();
    let restored = false;
    snapshot.job = failureAt === "poll" ? { ...job, step: "signing_in" } : null;
    vi.mocked(fetch).mockImplementation(async (url) => {
      if (restored) return Response.json({ ...snapshot, job: null });
      if (failureAt === "snapshot")
        return Response.json({ code: "login_expired", message: "Sign in again." }, { status: 400 });
      if (String(url).includes("/jobs/")) throw new Error("Connection lost");
      return Response.json(snapshot);
    });
    await mount();
    if (failureAt === "poll") await act(async () => vi.advanceTimersByTime(1000));
    restored = true;
    await act(async () => window.dispatchEvent(new Event("focus")));
    expect(host.querySelector('[aria-label="Who can access"]')).not.toBeNull();
    expect(button("Create share link")?.disabled).toBe(true);
    expect(calls).toEqual([]);
  },
);

it("keeps audience choices when a healthy panel regains focus", async () => {
  await mount();
  await choose("invite");
  const requests = vi.mocked(fetch).mock.calls.length;
  await act(async () => window.dispatchEvent(new Event("focus")));
  await act(async () => document.dispatchEvent(new Event("visibilitychange")));
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Who can access"]')?.value).toBe(
    "invite",
  );
  expect(vi.mocked(fetch).mock.calls.length).toBe(requests);
  expect(calls).toEqual([]);
});

it("does not send an authenticated sharing-admission refusal into another login loop", async () => {
  vi.mocked(fetch).mockResolvedValue(
    Response.json(
      {
        code: "sharing_not_admitted",
        message:
          "You're signed in, but sharing isn't accepting this sign-in. Try again later or contact support.",
      },
      { status: 400 },
    ),
  );
  await mount();
  expect(host.textContent).toContain("You're signed in");
  expect(button("Sign in")).toBeUndefined();
  expect(button("Create share link")).toBeUndefined();
  expect(calls).toEqual([]);
});

it("shows retry only for recoverable errors, never a permanent refresh footer", async () => {
  await mount();
  expect(button("Refresh")).toBeUndefined();
  expect(button("Try again")).toBeUndefined();
});

it.each(["login_expired", "sharing_not_admitted", "review_upload_origins_required"])(
  "does not offer a misleading retry for %s",
  async (code) => {
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ code, message: "Unavailable" }, { status: 400 }),
    );
    await mount();
    expect(button("Try again")).toBeUndefined();
  },
);

it.each(["request", "job"])(
  "restores the create action and audience after a failed %s",
  async (failureAt) => {
    await mount();
    await choose("public");
    const failed = {
      ...job,
      state: "failed" as const,
      error: { code: "share_failed", message: "Cannot render" },
    };
    if (failureAt === "request")
      vi.mocked(fetch).mockResolvedValueOnce(Response.json(failed.error, { status: 400 }));
    else {
      job = failed;
      snapshot.job = failed;
    }
    await act(async () => button("Create share link")?.click());
    expect(button("Create share link")?.disabled).toBe(false);
    expect(host.querySelector<HTMLSelectElement>('[aria-label="Who can access"]')?.value).toBe(
      "public",
    );
    expect(button("Try again")).toBeUndefined();
    expect(host.textContent).toContain("Cannot render");
  },
);

it("uses the OAuth-selected workspace among several without a dropdown", async () => {
  snapshot.spaces.unshift({ ...snapshot.spaces[0]!, id: "other", name: "Other", bound: false });
  await mount();
  expect(host.querySelector('[aria-label="Sharing workspace"]')).toBeNull();
  await choose("public");
  await act(async () => button("Create share link")?.click());
  expect(calls).toEqual([{ action: "share", audience: "public", space: "team1" }]);
});
it("refuses to substitute another workspace when the OAuth selection is missing", async () => {
  snapshot.spaces[0]!.bound = false;
  await mount();
  expect(button("Create share link")?.disabled).toBe(true);
  expect(host.textContent).toContain("workspace selected at sign-in");
  expect(calls).toEqual([]);
});

it("omits Only you for new shares but preserves an existing private audience", async () => {
  await mount();
  expect(host.querySelector('option[value="private"]')).toBeNull();
});
it("displays an existing private share without converting its audience", async () => {
  snapshot.share = { ...snapshot.share, state: "ready", audience: "private", spaceId: "team1" };
  await mount();
  expect(host.querySelector<HTMLSelectElement>('[aria-label="Who can access"]')?.value).toBe(
    "private",
  );
  expect(host.textContent).toContain("Only you");
  expect(calls).toEqual([]);
});

it("resumes a failed first creation without presenting an uploaded version", async () => {
  snapshot.share = {
    ...snapshot.share,
    state: "processing",
    audience: "public",
    spaceId: "team1",
    hasReadyVersion: false,
  };
  snapshot.job = {
    ...job,
    state: "failed",
    error: { code: "source_unavailable", message: "Project files could not upload" },
  };
  await mount();
  expect(button("Create share link")?.disabled).toBe(false);
  expect(button("Update shared version")).toBeUndefined();
  expect(host.textContent).not.toContain("still being prepared");
  await act(async () => button("Create share link")?.click());
  expect(calls).toEqual([{ action: "update" }]);
});

it.each(["free", "subscribed", null] as const)(
  "shows the Pro CTA only for authoritative free entitlement: %s",
  async (plan) => {
    snapshot.spaces[0]!.plan = plan;
    snapshot.spaces[0]!.upgradeUrl = "https://hyperframes.dev/pricing";
    await mount();
    const link = [...host.querySelectorAll("a")].find((a) =>
      a.textContent?.includes("Upgrade to Pro"),
    );
    if (plan === "free") expect(link?.href).toBe("https://hyperframes.dev/pricing");
    else expect(link).toBeUndefined();
  },
);
it("refuses an upgrade destination outside the public pricing flow", async () => {
  snapshot.spaces[0]!.plan = "free";
  snapshot.spaces[0]!.upgradeUrl = "https://example.com/checkout";
  await mount();
  expect(host.textContent).not.toContain("Upgrade to Pro");
});

it.each([false, true])(
  "shows a persisted failed export after reopen (previous version: %s)",
  async (previous) => {
    snapshot.share = {
      ...snapshot.share,
      state: "failed",
      failure: "This video can't be shared.",
      hasReadyVersion: previous,
      changed: true,
      audience: "public",
      spaceId: "team1",
      url: previous ? "https://hyperframes.dev/r/previous" : null,
    };
    await mount();
    expect(host.querySelector('[role="alert"]')?.textContent).toBe("This video can't be shared.");
    expect(host.textContent).not.toContain("still being prepared");
    expect(calls).toEqual([]);
    const action = button(previous ? "Update shared version" : "Create share link");
    expect(action?.disabled).toBe(false);
    if (previous) expect(button("Copy current shared link")).toBeDefined();
    await act(async () => action?.click());
    expect(calls).toEqual([{ action: "update" }]);
  },
);

it("does not probe unsupported Studio hosts for the CLI sharing bridge", async () => {
  await act(async () => root.render(<QuickShare />));
  expect(fetch).not.toHaveBeenCalled();
});

it("bootstraps sharing when the CLI advertises its bridge", async () => {
  const marker = document.createElement("meta");
  marker.name = "hyperframes-local-share";
  marker.content = "1";
  document.head.append(marker);
  vi.mocked(fetch).mockResolvedValue(Response.json({ csrf: token }));
  try {
    await act(async () => root.render(<QuickShare />));
    expect(fetch).toHaveBeenCalledWith(
      "/api/share/bootstrap",
      expect.objectContaining({ method: "GET" }),
    );
  } finally {
    marker.remove();
  }
});
