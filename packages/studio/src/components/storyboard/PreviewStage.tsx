import { useEffect, useRef, useState, type ReactNode } from "react";
import { usePlayerStore } from "../../player";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { Tab, Tabs, TabsList, cn } from "../ui";
import { StoryboardBoardView } from "./StoryboardBoardView";
import { useStoryboardBoard } from "./useStoryboardBoard";

type StageTab = "preview" | "storyboard";

/**
 * The preview panel's stage: the film, and beside it the storyboard once the project has one. With no board there
 * is no strip at all. The film stays mounted under the board so going back keeps its place.
 */
export function PreviewStage({ projectId, children }: { projectId: string; children: ReactNode }) {
  const board = useStoryboardBoard(projectId);
  const [tab, setTab] = useState<StageTab>("preview");
  const [dotted, setDotted] = useState(false);
  const shownRevision = useRef(board.revision);

  // A board that appears while Studio is open is the agent's stop: show it, as Desktop does.
  useEffect(() => {
    if (!board.appeared) return;
    setTab("storyboard");
    trackStudioEvent("storyboard_tab", { action: "shown_on_write" });
  }, [board.appeared]);

  useEffect(() => {
    if (tab === "storyboard") {
      shownRevision.current = board.revision;
      setDotted(false);
    } else if (board.revision !== shownRevision.current) setDotted(true);
  }, [tab, board.revision]);

  useEffect(() => {
    if (!board.path) setTab("preview");
  }, [board.path]);

  const show = (next: StageTab) => {
    if (next === tab) return;
    if (next === "storyboard") usePlayerStore.getState().requestPlayback(false);
    trackStudioEvent("storyboard_tab", { action: next === "storyboard" ? "open" : "close" });
    setTab(next);
  };

  if (!board.path) return <>{children}</>;
  const path = board.path;
  return (
    <div className="flex h-full w-full min-w-0 flex-col">
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
      <div className={cn("relative min-h-0 flex-1", tab !== "preview" && "hidden")}>{children}</div>
      {tab === "storyboard" && (
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
