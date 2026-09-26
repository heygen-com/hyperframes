// @vitest-environment happy-dom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DomEditProvider } from "../../contexts/DomEditContext";
import { TimelineEditProvider } from "../../contexts/TimelineEditContext";
import { jsonResponse, requestUrl } from "../../hooks/fetchStubTestUtils";
import { useTimelineEditing } from "../../hooks/useTimelineEditing";
import { usePlayerStore, type TimelineElement } from "../store/playerStore";
import { serializeAutomation, type HfAutomation } from "@hyperframes/core/audio-automation";
import { groupAutomationElement } from "./groupAutomationElement";
import { useAutomationLanes, type AutomationLaneBinding } from "./useAutomationLanes";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

type CanEdit = NonNullable<Parameters<typeof useTimelineEditing>[0]["canEdit"]>;
type DomEditValue = Parameters<typeof DomEditProvider>[0]["value"];

const SOURCE =
  '<audio id="music" data-start="0" data-duration="12" data-track-index="0"></audio>' +
  '<hf-audio-group id="hf-group"></hf-audio-group>';
const LOCKED = { blocked: true as const, reason: "Reserved by an agent" };
const NEXT = { version: 1 as const, lanes: [{ target: "volume", points: [{ t: 0, v: 0.5 }] }] };

const music: TimelineElement = {
  id: "music",
  key: "music",
  domId: "music",
  tag: "audio",
  start: 0,
  duration: 12,
  track: 0,
  sourceFile: "index.html",
};

afterEach(() => {
  document.body.innerHTML = "";
  usePlayerStore.getState().reset();
  vi.unstubAllGlobals();
});

function mountLanes(target: TimelineElement, canEdit?: CanEdit, recording = false) {
  let file = SOURCE;
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: Parameters<typeof fetch>[0]) =>
      requestUrl(input).includes("/files/") ? jsonResponse({ content: file }) : jsonResponse({}),
    ),
  );
  const iframe = document.createElement("iframe");
  document.body.append(iframe);
  iframe.contentDocument!.body.innerHTML = SOURCE;
  usePlayerStore.getState().setElements([{ ...music, audioGroup: "hf-group" }]);
  const writeProjectFile = vi.fn(async (_path: string, content: string) => {
    file = content;
  });
  const refresh = vi.fn(async () => {});
  const selection = { id: target.id };
  const previewIframeRef = { current: iframe };
  let binding: AutomationLaneBinding | null = null;

  function Probe() {
    binding = useAutomationLanes().bind(target, true);
    return null;
  }
  function Host() {
    const editing = useTimelineEditing({
      projectId: "p1",
      activeCompPath: "index.html",
      timelineElements: [music],
      showToast: () => {},
      writeProjectFile,
      recordEdit: async () => {},
      reloadPreview: () => {},
      previewIframeRef,
      pendingTimelineEditPathRef: { current: new Set<string>() },
      uploadProjectFiles: async () => [],
      canEdit,
      isRecordingRef: { current: recording },
    });
    const domEdit = {
      domEditSelectionRef: { current: selection },
      refreshDomEditSelectionFromPreview: refresh,
    } as unknown as DomEditValue;
    return (
      <DomEditProvider value={domEdit}>
        <TimelineEditProvider
          value={{
            onSetElementAttributeLive: editing.setElementFxAttribute.setLive,
            onSetElementAttributeQuiet: editing.setElementFxAttribute.setQuiet,
            onSetAudioGroupAttributeLive: editing.setAudioGroupAttribute.setLive,
            onSetAudioGroupAttributeQuiet: editing.setAudioGroupAttribute.setQuiet,
          }}
        >
          <Probe />
        </TimelineEditProvider>
      </DomEditProvider>
    );
  }

  const host = document.createElement("div");
  document.body.append(host);
  act(() => createRoot(host).render(<Host />));
  const commit = async (next: HfAutomation = NEXT) => {
    let outcome: unknown;
    await act(async () => {
      outcome = await binding!.onCommit(next);
    });
    return outcome;
  };
  const preview = (next: HfAutomation = NEXT) => act(() => binding!.onPreview(next));
  const startCommit = (next: HfAutomation) => binding!.onCommit(next);
  return {
    commit,
    startCommit,
    preview,
    writeProjectFile,
    refresh,
    selection,
    iframe,
    setFile: (next: string) => (file = next),
  };
}

describe("useAutomationLanes saves report what happened", () => {
  it("saves a clip's automation, and the lane and the panel read it back", async () => {
    const { commit, writeProjectFile, refresh, selection } = mountLanes(music);
    expect(await commit()).toEqual({ status: "saved" });
    expect(writeProjectFile.mock.calls[0]?.[1]).toContain("data-automation=");
    expect(usePlayerStore.getState().elements[0]?.automation).toContain('"volume"');
    expect(refresh).toHaveBeenCalledWith(selection);
  });

  it("refuses an automation edit on a locked clip and writes nothing", async () => {
    const { commit, writeProjectFile } = mountLanes(music, () => LOCKED);
    expect(await commit()).toEqual({ status: "refused", reason: "Reserved by an agent" });
    expect(writeProjectFile).not.toHaveBeenCalled();
    expect(usePlayerStore.getState().elements[0]?.automation).toBeUndefined();
  });

  it("puts a dragged preview back when the lock refuses the release", async () => {
    const { commit, iframe, preview } = mountLanes(music, () => LOCKED);
    preview();
    const node = iframe.contentDocument!.getElementById("music");
    expect(node?.getAttribute("data-automation")).toContain('"volume"');
    await commit();
    expect(node?.hasAttribute("data-automation")).toBe(false);
  });

  it("puts a dragged preview back when a recording refuses the release", async () => {
    const { commit, iframe, preview, writeProjectFile } = mountLanes(music, undefined, true);
    preview();
    expect(await commit()).toEqual({
      status: "refused",
      reason: "Cannot edit timeline while recording",
    });
    expect(iframe.contentDocument!.getElementById("music")?.hasAttribute("data-automation")).toBe(
      false,
    );
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it("resolves an automation edit whose write fails as failed", async () => {
    const { commit, writeProjectFile, iframe } = mountLanes(music);
    writeProjectFile.mockRejectedValue(new Error("disk full"));
    expect(await commit()).toEqual({
      status: "failed",
      reason: expect.stringContaining("disk full"),
    });
    expect(iframe.contentDocument!.getElementById("music")?.hasAttribute("data-automation")).toBe(
      false,
    );
  });

  it("refuses a group lane edit when a member is locked", async () => {
    const group = groupAutomationElement({ id: "hf-group", label: "Music", anchorKey: 0 }, 12);
    const { commit, writeProjectFile } = mountLanes(group, (el) =>
      el.id === "music" ? LOCKED : true,
    );
    expect(await commit()).toEqual({ status: "refused", reason: "Reserved by an agent" });
    expect(writeProjectFile).not.toHaveBeenCalled();
  });

  it("saves a group lane on the group and mirrors it to the members", async () => {
    const group = groupAutomationElement({ id: "hf-group", label: "Music", anchorKey: 0 }, 12);
    const { commit, writeProjectFile } = mountLanes(group);
    expect(await commit()).toEqual({ status: "saved" });
    expect(writeProjectFile.mock.calls[0]?.[1]).toMatch(
      /<hf-audio-group id="hf-group" data-automation=/,
    );
    expect(usePlayerStore.getState().elements[0]?.audioGroupAutomation).toContain('"volume"');
  });

  it("keeps what an earlier save wrote when a later one fails while it is in flight", async () => {
    const { startCommit, preview, writeProjectFile, iframe, setFile } = mountLanes(music);
    const saved = serializeAutomation(NEXT);
    let landFirst = () => {};
    writeProjectFile
      .mockImplementationOnce(
        (_path, content) =>
          new Promise<void>((resolve) => {
            landFirst = () => {
              setFile(content);
              resolve();
            };
          }),
      )
      .mockRejectedValueOnce(new Error("disk full"));
    preview();
    const first = startCommit(NEXT);
    await act(() => vi.waitFor(() => expect(writeProjectFile).toHaveBeenCalledTimes(1)));
    const later = {
      version: 1 as const,
      lanes: [{ target: "volume", points: [{ t: 0, v: 0.9 }] }],
    };
    preview(later);
    const second = startCommit(later);
    landFirst();
    let outcomes: unknown[] = [];
    await act(async () => {
      outcomes = await Promise.all([first, second]);
    });
    expect(outcomes).toMatchObject([{ status: "saved" }, { status: "failed" }]);
    expect(iframe.contentDocument!.getElementById("music")?.getAttribute("data-automation")).toBe(
      saved,
    );
    expect(usePlayerStore.getState().elements[0]?.automation).toBe(saved);
  });

  it("settles on a queued save that lands after an earlier one fails", async () => {
    const { startCommit, preview, writeProjectFile, iframe, setFile } = mountLanes(music);
    let failFirst = () => {};
    writeProjectFile
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            failFirst = () => reject(new Error("offline"));
          }),
      )
      .mockImplementationOnce(async (_path, content) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        setFile(content);
      });
    preview();
    const first = startCommit(NEXT);
    await act(() => vi.waitFor(() => expect(writeProjectFile).toHaveBeenCalledTimes(1)));
    const later = {
      version: 1 as const,
      lanes: [{ target: "volume", points: [{ t: 0, v: 0.9 }] }],
    };
    preview(later);
    const second = startCommit(later);
    await act(() => new Promise((resolve) => setTimeout(resolve, 20)));
    failFirst();
    let outcomes: unknown[] = [];
    await act(async () => {
      outcomes = await Promise.all([first, second]);
    });
    expect(outcomes).toMatchObject([{ status: "failed" }, { status: "saved" }]);
    const landed = serializeAutomation(later);
    expect(iframe.contentDocument!.getElementById("music")?.getAttribute("data-automation")).toBe(
      landed,
    );
    expect(usePlayerStore.getState().elements[0]?.automation).toBe(landed);
  });

  it("settles on the file when two overlapping saves both fail", async () => {
    const { startCommit, preview, writeProjectFile, iframe } = mountLanes(music);
    let failFirst = () => {};
    writeProjectFile
      .mockImplementationOnce(
        () =>
          new Promise<void>((_resolve, reject) => {
            failFirst = () => reject(new Error("offline"));
          }),
      )
      .mockRejectedValueOnce(new Error("offline"));
    preview();
    const first = startCommit(NEXT);
    await act(() => vi.waitFor(() => expect(writeProjectFile).toHaveBeenCalledTimes(1)));
    const later = {
      version: 1 as const,
      lanes: [{ target: "volume", points: [{ t: 0, v: 0.9 }] }],
    };
    preview(later);
    const second = startCommit(later);
    failFirst();
    let outcomes: unknown[] = [];
    await act(async () => {
      outcomes = await Promise.all([first, second]);
    });
    expect(outcomes).toMatchObject([{ status: "failed" }, { status: "failed" }]);
    expect(iframe.contentDocument!.getElementById("music")?.hasAttribute("data-automation")).toBe(
      false,
    );
    expect(usePlayerStore.getState().elements[0]?.automation).toBeUndefined();
  });

  it("puts a group's dragged preview and mirror back when a recording refuses the release", async () => {
    const group = groupAutomationElement({ id: "hf-group", label: "Music", anchorKey: 0 }, 12);
    const { commit, preview, iframe } = mountLanes(group, undefined, true);
    preview();
    expect(usePlayerStore.getState().elements[0]?.audioGroupAutomation).toContain('"volume"');
    expect(await commit()).toMatchObject({ status: "refused" });
    expect(
      iframe.contentDocument!.getElementById("hf-group")?.hasAttribute("data-automation"),
    ).toBe(false);
    expect(usePlayerStore.getState().elements[0]?.audioGroupAutomation).toBeUndefined();
  });
});
