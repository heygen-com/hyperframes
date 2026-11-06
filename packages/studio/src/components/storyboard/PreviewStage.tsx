import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { usePlayerStore } from "../../player";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { Tab, Tabs, TabsList, cn } from "../ui";
import { StoryboardBoardView } from "./StoryboardBoardView";
import { useStoryboardBoard } from "./useStoryboardBoard";

type StageTab = "preview" | "storyboard";

/**
 * The preview panel's stage: the film, and beside it the storyboard once the project has one. With no board there
 * is no strip at all. The film keeps one place in the tree whether or not a board exists, so a board appearing or
 * going never remounts it, and it stays paused under the board so going back keeps its place.
 */
export function PreviewStage({ projectId, children }: { projectId: string; children: ReactNode }) {
  const board = useStoryboardBoard(projectId);
  const [tab, setTab] = useState<StageTab>("preview");
  const [dotted, setDotted] = useState(false);
  const shownRevision = useRef(board.revision);
  const tabRef = useRef(tab);
  tabRef.current = tab;

  const show = useCallback((next: StageTab, action?: string) => {
    if (next === tabRef.current) return;
    if (next === "storyboard") usePlayerStore.getState().requestPlayback(false);
    trackStudioEvent("storyboard_tab", {
      action: action ?? (next === "storyboard" ? "open" : "close"),
    });
    setTab(next);
  }, []);

  // A board that appears while Studio is open is the agent's stop: show it, as Desktop does.
  useEffect(() => {
    if (board.appeared) show("storyboard", "shown_on_write");
  }, [board.appeared, show]);

  // The film is hidden under the board: the player's own hold refuses a play from anywhere (J, Space, a request)
  // before it starts. Another owner's hold is left as it is.
  useEffect(() => {
    if (tab !== "storyboard" || usePlayerStore.getState().playLocked) return;
    usePlayerStore.getState().setPlayLocked(true);
    return () => usePlayerStore.getState().setPlayLocked(false);
  }, [tab]);

  useEffect(() => {
    if (tab === "storyboard") {
      shownRevision.current = board.revision;
      setDotted(false);
    } else if (board.revision !== shownRevision.current) setDotted(true);
  }, [tab, board.revision]);

  useEffect(() => {
    if (!board.path) setTab("preview");
  }, [board.path]);

  const path = board.path;
  const onBoard = path !== null && tab === "storyboard";
  return (
    <div className="flex h-full w-full min-w-0 flex-col">
      {path !== null && (
        <Tabs value={tab} onValueChange={(value) => show(value as StageTab)}>
          <div className="flex h-9 shrink-0 items-center border-b border-border-strong bg-surface px-2">
            <TabsList aria-label="Preview pages" className="bg-transparent p-0">
              <Tab value="preview">Preview</Tab>
              <Tab value="storyboard" data-testid="stage-tab-storyboard">
                Storyboard
                {dotted && (
                  <span
                    className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent"
                    aria-label=", updated"
                  />
                )}
              </Tab>
            </TabsList>
          </div>
        </Tabs>
      )}
      <div className={cn("relative min-h-0 flex-1", onBoard && "hidden")}>{children}</div>
      {onBoard && (
        <div className="min-h-0 flex-1">
          <StoryboardBoardView
            projectId={projectId}
            board={{ ...board, path }}
            onShowInPreview={(seconds) => {
              setTab("preview");
              if (seconds !== null) usePlayerStore.getState().requestSeek(seconds);
            }}
          />
        </div>
      )}
    </div>
  );
}
