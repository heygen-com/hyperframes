import { act, type ComponentProps } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, expect, vi } from "vitest";
import { thumbnailScheduler } from "../../player/lib/thumbnailScheduler";
import { usePlayerStore } from "../../player/store/playerStore";
import { CompositionsTab } from "./CompositionsTab";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
(
  window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }
).happyDOM.settings.disableIframePageLoading = true;

let root: Root | null = null;

afterEach(() => {
  if (root) act(() => root?.unmount());
  root = null;
  thumbnailScheduler.invalidateProject("demo");
  document.body.innerHTML = "";
  usePlayerStore.setState({ thumbnailRevisions: {} });
});

export function mountCompositionsTab(props: Partial<ComponentProps<typeof CompositionsTab>> = {}) {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => {
    root?.render(
      <CompositionsTab
        projectId="demo"
        compositions={["compositions/headline.html"]}
        activeComposition={null}
        onSelect={vi.fn()}
        {...props}
      />,
    );
  });
  return host;
}

export const FRAME_TOKEN = "T".repeat(43);

export function stubFrameTokenFetch(token: string | null = FRAME_TOKEN) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (input) => {
    expect(String(input)).toBe("/api/projects/demo/frame-token");
    return { ok: token !== null, json: async () => ({ token }) } as Response;
  });
}

export async function settleFrameToken() {
  await act(async () => {
    for (let i = 0; i < 10; i += 1) await Promise.resolve();
  });
}
