import { useEffect, useRef, useState } from "react";
import { encodeUrlPath } from "@hyperframes/parsers";
import { useFileManagerContextOptional } from "../../contexts/FileManagerContext";
import { onExternalFileChange } from "../../hooks/fileChangeFanout";
import { buildProjectApiPath } from "../../utils/projectRouting";
import { studioApiFetch } from "../../utils/studioApiFetch";
import {
  findBoardFile,
  readBoardFrames,
  stillPath,
  touchesBoard,
  type BoardFrame,
} from "./storyboardBoard";

export type BoardRead =
  | { state: "loading" }
  | { state: "read"; frames: BoardFrame[] }
  | { state: "failed" };

export interface StoryboardBoard {
  /** The board's project path, or null while the project has none. */
  path: string | null;
  /** Bumps on every write that changes what the board shows; key a still or an iframe on it to reload it. */
  revision: number;
  read: BoardRead;
  /** True once a board appears after the first file list: the agent just wrote it and is waiting on a go. */
  appeared: boolean;
}

/** A project file's URL on the preview server. */
export const projectFileUrl = (projectId: string, path: string, revision = 0): string =>
  `${buildProjectApiPath(projectId, `/preview/${encodeUrlPath(path)}`)}${revision ? `?v=${revision}` : ""}`;

function changeOf(payload: unknown): { path: string; projectId?: string } | null {
  const { path, projectId } = (payload ?? {}) as { path?: unknown; projectId?: unknown };
  if (typeof path !== "string") return null;
  return { path, projectId: typeof projectId === "string" ? projectId : undefined };
}

const isBoardName = (path: string): boolean => /(^|[\\/])storyboard\.html$/i.test(path);

/** The project's storyboard page, read into frames, and reread on every write that changes it. */
export function useStoryboardBoard(projectId: string): StoryboardBoard {
  const files = useFileManagerContextOptional();
  const fileTree = files?.fileTree;
  const loaded = files?.fileTreeLoaded === true;
  const path = fileTree ? findBoardFile(fileTree) : null;
  const [revision, setRevision] = useState(0);
  const [read, setRead] = useState<BoardRead>({ state: "loading" });
  const [appeared, setAppeared] = useState(false);
  const firstListing = useRef<boolean | null>(null);

  if (loaded && firstListing.current === null) firstListing.current = path !== null;
  useEffect(() => {
    if (path && firstListing.current === false) setAppeared(true);
    if (!path) setAppeared(false);
  }, [path]);

  const pathRef = useRef(path);
  pathRef.current = path;
  const stillsRef = useRef<ReadonlySet<string>>(new Set());
  const refreshRef = useRef(files?.refreshFileTree);
  refreshRef.current = files?.refreshFileTree;

  useEffect(() => {
    return onExternalFileChange((payload) => {
      const change = changeOf(payload);
      if (!change || (change.projectId && change.projectId !== projectId)) return;
      const board = pathRef.current;
      if (board && touchesBoard(change.path, board, stillsRef.current)) setRevision((n) => n + 1);
      // A board written or removed changes the file list the tab is found in.
      if (isBoardName(change.path)) void refreshRef.current?.();
    });
  }, [projectId]);

  useEffect(() => {
    if (!path) return;
    let live = true;
    setRead((prev) => (prev.state === "read" ? prev : { state: "loading" }));
    studioApiFetch(projectFileUrl(projectId, path, revision), { cache: "no-store" })
      .then((res) => (res.ok ? res.text() : Promise.reject(new Error(String(res.status)))))
      .then((html) => {
        if (!live) return;
        // DOMParser builds an inert document: the page's scripts never run here.
        const doc = new DOMParser().parseFromString(html, "text/html");
        const frames = readBoardFrames(doc);
        stillsRef.current = new Set(
          frames.map((frame) => stillPath(path, frame.still)).filter((still) => still !== null),
        );
        setRead({ state: "read", frames });
      })
      .catch(() => live && setRead({ state: "failed" }));
    return () => {
      live = false;
    };
  }, [projectId, path, revision]);

  return { path, revision, read, appeared };
}
