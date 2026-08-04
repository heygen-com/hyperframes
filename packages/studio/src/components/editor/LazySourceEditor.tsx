import { lazy } from "react";
import { LazyPanel } from "../LazyPanel";
import type { SourceEditorProps } from "./SourceEditor";

const SourceEditor = lazy(() =>
  import("./SourceEditor").then((module) => ({ default: module.SourceEditor })),
);

export function LazySourceEditor(props: SourceEditorProps) {
  return (
    <LazyPanel label="source editor">
      <SourceEditor {...props} />
    </LazyPanel>
  );
}
