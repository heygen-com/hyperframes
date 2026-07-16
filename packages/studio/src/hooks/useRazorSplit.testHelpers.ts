import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { vi } from "vitest";

export interface SplitBody {
  splitTime: number;
  elementStart: number;
  elementDuration: number;
}

function decodePathFromUrl(url: string, marker: string): string {
  const encoded = url.slice(url.indexOf(marker) + marker.length);
  return decodeURIComponent(encoded);
}

/**
 * Fetch mock shared by both harnesses: GSAP mutations 400 (no script in fixtures),
 * split-element writes a `<!--split-->` marker so `changed` is true, and file reads
 * echo the in-memory `disk`. `onSplit` (when set) records each split request's body.
 */
export function createSplitFetchMock(
  disk: Record<string, string>,
  onSplit?: (path: string, body: SplitBody) => void,
) {
  return vi.fn(async (url: string, init?: RequestInit) => {
    const u = String(url);
    if (u.includes("/gsap-mutations/")) {
      // No GSAP script in the fixtures — mirror the server's 400 response.
      return new Response(JSON.stringify({ error: "no GSAP script found in file" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (u.includes("/file-mutations/split-element/")) {
      const path = decodePathFromUrl(u, "/file-mutations/split-element/");
      onSplit?.(path, JSON.parse(String(init?.body)) as SplitBody);
      // Return content that differs from the original so `changed` is true.
      const after = `${disk[path]}<!--split-->`;
      const version = `"test-${path}-${after.length}"`;
      disk[path] = after; // server writes the split to disk
      return new Response(JSON.stringify({ ok: true, changed: true, content: after, version }), {
        status: 200,
        headers: { "Content-Type": "application/json", ETag: version },
      });
    }
    if (u.includes("/files/")) {
      const path = decodePathFromUrl(u, "/files/").replace(/\?.*$/, "");
      return new Response(JSON.stringify({ content: disk[path] ?? "" }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    void init;
    throw new Error(`unexpected fetch: ${u}`);
  });
}

/** Mount a render-only probe component into a fresh host and return its root. */
export function mountProbe(Component: React.ComponentType): ReturnType<typeof createRoot> {
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  act(() => root.render(React.createElement(Component)));
  return root;
}
