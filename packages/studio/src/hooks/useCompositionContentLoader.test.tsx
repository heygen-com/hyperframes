// @vitest-environment happy-dom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { studioApiFetch } from "../utils/studioApiFetch";
import { useCompositionContentLoader } from "./useCompositionContentLoader";

vi.mock("../utils/studioApiFetch", () => ({ studioApiFetch: vi.fn() }));

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function pendingResponse() {
  let resolve: (response: Response) => void = () => {};
  let reject: (error: Error) => void = () => {};
  const promise = new Promise<Response>((resolveResponse, rejectResponse) => {
    resolve = resolveResponse;
    reject = rejectResponse;
  });
  vi.mocked(studioApiFetch).mockReturnValueOnce(promise);
  return { resolve, reject };
}

function mountLoader() {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const setEditingFile = vi.fn();
  const setActiveCompPath = vi.fn();
  const showToast = vi.fn();
  let select: ReturnType<typeof useCompositionContentLoader> | undefined;
  function Harness({ projectId }: { projectId: string | null }) {
    select = useCompositionContentLoader({
      projectId,
      setEditingFile,
      setActiveCompPath,
      showToast,
    });
    return null;
  }
  root = createRoot(document.createElement("div"));
  const render = (projectId: string | null) => {
    act(() => root?.render(<Harness projectId={projectId} />));
  };
  render("project-a");
  return {
    setEditingFile,
    setActiveCompPath,
    showToast,
    render,
    select(path: string) {
      if (!select) throw new Error("Loader did not mount");
      act(() => select?.(path));
    },
  };
}

describe("composition source loading", () => {
  it("keeps the latest composition's source when responses arrive in reverse order", async () => {
    const first = pendingResponse();
    const second = pendingResponse();
    const loader = mountLoader();
    loader.select("first.html");
    loader.select("second.html");
    expect(loader.setEditingFile).toHaveBeenLastCalledWith({ path: "second.html", content: null });

    await act(async () => second.resolve(Response.json({ content: "SECOND" })));
    await act(async () => first.resolve(Response.json({ content: "FIRST" })));

    expect(loader.setActiveCompPath).toHaveBeenLastCalledWith("second.html");
    expect(loader.setEditingFile).toHaveBeenLastCalledWith({
      path: "second.html",
      content: "SECOND",
    });
  });

  it("ignores failures from a composition that is no longer selected", async () => {
    const first = pendingResponse();
    const second = pendingResponse();
    const loader = mountLoader();
    loader.select("first.html");
    loader.select("second.html");
    await act(async () => second.resolve(Response.json({ content: "SECOND" })));
    await act(async () => first.reject(new Error("first file unavailable")));

    expect(loader.showToast).not.toHaveBeenCalled();
  });

  it("ignores source whose response body finishes after another composition is selected", async () => {
    const first = pendingResponse();
    const second = pendingResponse();
    let resolveBody: (value: { content: string }) => void = () => {};
    const body = new Promise<{ content: string }>((resolve) => (resolveBody = resolve));
    const firstResponse = Response.json({ content: "FIRST" });
    vi.spyOn(firstResponse, "json").mockReturnValue(body);
    const loader = mountLoader();
    loader.select("first.html");
    await act(async () => first.resolve(firstResponse));
    loader.select("second.html");
    await act(async () => second.resolve(Response.json({ content: "SECOND" })));
    await act(async () => resolveBody({ content: "FIRST" }));

    expect(loader.setEditingFile).toHaveBeenLastCalledWith({
      path: "second.html",
      content: "SECOND",
    });
  });

  it("does not accept an old response after leaving and returning to the same project", async () => {
    const response = pendingResponse();
    const loader = mountLoader();
    loader.select("index.html");
    loader.render("project-b");
    loader.render("project-a");
    loader.setEditingFile.mockClear();

    await act(async () => response.resolve(Response.json({ content: "OLD PROJECT A" })));

    expect(loader.setEditingFile).not.toHaveBeenCalled();
  });

  it.each(["success", "failure"])("ignores pending %s after unmount", async (outcome) => {
    const response = pendingResponse();
    const loader = mountLoader();
    loader.select("index.html");
    act(() => root?.unmount());
    root = null;
    loader.setEditingFile.mockClear();

    await act(async () => {
      if (outcome === "success") response.resolve(Response.json({ content: "UNMOUNTED" }));
      else response.reject(new Error("request failed"));
    });

    expect(loader.setEditingFile).not.toHaveBeenCalled();
    expect(loader.showToast).not.toHaveBeenCalled();
  });

  it("reports a current load failure without supplying empty source content", async () => {
    const response = pendingResponse();
    const loader = mountLoader();
    loader.select("index.html");
    await act(async () => response.resolve(new Response("unavailable", { status: 500 })));

    expect(loader.showToast).toHaveBeenCalledExactlyOnceWith(
      "Failed to load index.html (500)",
      "error",
    );
    expect(loader.setEditingFile).toHaveBeenCalledExactlyOnceWith({
      path: "index.html",
      content: null,
    });
  });
});
