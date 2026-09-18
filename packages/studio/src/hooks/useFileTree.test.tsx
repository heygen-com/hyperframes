// @vitest-environment happy-dom

import { act, useImperativeHandle, useRef, forwardRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useFileTree } from "./useFileTree";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
});

interface Handle {
  compositions: string[];
  refresh: () => Promise<void>;
}

const Harness = forwardRef<Handle, { projectId: string }>(function Harness({ projectId }, ref) {
  const projectIdRef = useRef(projectId);
  projectIdRef.current = projectId;
  const { compositions, refreshFileTree } = useFileTree({ projectId, projectIdRef });
  useImperativeHandle(ref, () => ({ compositions, refresh: refreshFileTree }), [
    compositions,
    refreshFileTree,
  ]);
  return null;
});

describe("useFileTree.refreshFileTree", () => {
  it("updates compositions, not just the raw file list, on refresh", async () => {
    let call = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      // Initial load: one composition. After a refresh (e.g. a new file created),
      // the server now reports a second one — this is the exact shape a refresh
      // after creating/duplicating a composition produces.
      const body =
        call === 1
          ? { files: ["index.html"], compositions: ["index.html"] }
          : { files: ["index.html", "hero.html"], compositions: ["index.html", "hero.html"] };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const handleRef = { current: null as Handle | null };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <Harness
          ref={(h) => {
            handleRef.current = h;
          }}
          projectId="project-a"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(handleRef.current?.compositions).toEqual(["index.html"]);

    await act(async () => {
      await handleRef.current?.refresh();
    });
    expect(handleRef.current?.compositions).toEqual(["index.html", "hero.html"]);

    fetchSpy.mockRestore();
  });

  it("keeps the most-recently-issued refresh's data when an earlier one resolves later", async () => {
    let call = 0;
    const deferred: Array<(value: Response) => void> = [];
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return new Response(
          JSON.stringify({ files: ["index.html"], compositions: ["index.html"] }),
          {
            status: 200,
          },
        );
      }
      return new Promise<Response>((resolve) => {
        deferred.push(resolve);
      });
    });

    const handleRef = { current: null as Handle | null };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <Harness
          ref={(h) => {
            handleRef.current = h;
          }}
          projectId="project-a"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    let firstDone = false;
    let secondDone = false;
    act(() => {
      void handleRef.current?.refresh().then(() => {
        firstDone = true;
      });
      void handleRef.current?.refresh().then(() => {
        secondDone = true;
      });
    });

    // The second (later-issued) request resolves first, with its own data.
    await act(async () => {
      deferred[1](
        new Response(
          JSON.stringify({
            files: ["index.html", "second.html"],
            compositions: ["index.html", "second.html"],
          }),
          {
            status: 200,
          },
        ),
      );
      await vi.waitFor(() => secondDone);
    });
    expect(handleRef.current?.compositions).toEqual(["index.html", "second.html"]);

    // The first (earlier-issued, now stale) request resolves after — it must not win.
    await act(async () => {
      deferred[0](
        new Response(
          JSON.stringify({
            files: ["index.html", "stale.html"],
            compositions: ["index.html", "stale.html"],
          }),
          {
            status: 200,
          },
        ),
      );
      await vi.waitFor(() => firstDone);
    });
    expect(handleRef.current?.compositions).toEqual(["index.html", "second.html"]);

    fetchSpy.mockRestore();
  });

  it("keeps the prior compositions list when a refresh response omits the field", async () => {
    let call = 0;
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      call += 1;
      const body =
        call === 1
          ? { files: ["index.html"], compositions: ["index.html"] }
          : { files: ["index.html", "hero.html"] };
      return new Response(JSON.stringify(body), { status: 200 });
    });

    const handleRef = { current: null as Handle | null };
    const host = document.createElement("div");
    document.body.append(host);
    root = createRoot(host);

    await act(async () => {
      root?.render(
        <Harness
          ref={(h) => {
            handleRef.current = h;
          }}
          projectId="project-a"
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(handleRef.current?.compositions).toEqual(["index.html"]);

    await act(async () => {
      await handleRef.current?.refresh();
    });
    // `files` grew but the response carried no `compositions` field — the known-good
    // list must survive, not collapse to empty.
    expect(handleRef.current?.compositions).toEqual(["index.html"]);

    fetchSpy.mockRestore();
  });
});
