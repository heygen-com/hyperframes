// @vitest-environment happy-dom
// Imports DOM editing the way a host app does: by package name, mounted outside EditorShell.
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, expectTypeOf, it, vi } from "vitest";
import {
  ConnectedDomEditOverlay,
  DomEditProvider,
  PreviewReadOnlyProvider,
  useDomEditSelectionContext,
  useDomEditSession,
  usePreviewPersistence,
  type ConnectedDomEditOverlayProps,
  type DomEditCapabilities,
  type DomEditSelection,
  type UseDomEditSessionParams,
  type UsePreviewPersistenceParams,
} from "@hyperframes/studio";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

describe("DOM editing package exports", () => {
  it("exposes the session and persistence hooks with their params types", () => {
    expect(typeof useDomEditSession).toBe("function");
    expect(typeof usePreviewPersistence).toBe("function");
    expectTypeOf<UseDomEditSessionParams>().toHaveProperty("writeProjectFile");
    expectTypeOf<UsePreviewPersistenceParams>().toHaveProperty("recordEdit");
    expectTypeOf<DomEditSelection>().toHaveProperty("capabilities");
    expectTypeOf<DomEditCapabilities>().toHaveProperty("canApplyManualOffset");
    expectTypeOf<ConnectedDomEditOverlayProps>().toHaveProperty("canvasInput");
  });

  it("mounts the connected overlay in host mode inside a host's providers", async () => {
    const seen: Array<DomEditSelection | null> = [];
    function Probe() {
      seen.push(useDomEditSelectionContext().domEditSelection);
      return null;
    }
    const session = {
      domEditSelection: null,
      domEditGroupSelections: [],
      domEditHoverSelection: null,
      previewIframeRef: { current: null },
      handlePreviewCanvasPointerLeave: vi.fn(),
    } as unknown as Parameters<typeof DomEditProvider>[0]["value"];
    const el = document.createElement("div");
    document.body.append(el);
    const root = createRoot(el);
    await act(async () =>
      root.render(
        <PreviewReadOnlyProvider readOnly={false}>
          <DomEditProvider value={session}>
            <Probe />
            <ConnectedDomEditOverlay
              activeCompositionPath={null}
              showHoverSelection={false}
              shouldShowSelectedDomBounds={true}
              canvasInput="host"
            />
          </DomEditProvider>
        </PreviewReadOnlyProvider>,
      ),
    );
    expect(seen.at(-1)).toBeNull();
    const canvas = el.querySelector('[aria-label="Composition canvas"]');
    expect(canvas?.className).toContain("pointer-events-none");
    await act(async () => root.unmount());
  });
});
