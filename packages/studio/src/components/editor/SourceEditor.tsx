import { useRef, useCallback, memo } from "react";
import {
  EditorView,
  keymap,
  lineNumbers,
  highlightActiveLine,
  highlightActiveLineGutter,
} from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { bracketMatching, foldGutter, indentOnInput } from "@codemirror/language";
import { closeBrackets, closeBracketsKeymap } from "@codemirror/autocomplete";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { oneDark } from "@codemirror/theme-one-dark";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { javascript } from "@codemirror/lang-javascript";

function getLanguageExtension(language: string) {
  switch (language) {
    case "html":
      return html();
    case "css":
      return css();
    case "javascript":
    case "js":
    case "typescript":
    case "ts":
      return javascript({ typescript: language === "typescript" || language === "ts" });
    default:
      return html();
  }
}

function detectLanguage(filePath: string): string {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? "";
  const map: Record<string, string> = {
    html: "html",
    htm: "html",
    css: "css",
    js: "javascript",
    ts: "typescript",
    jsx: "javascript",
    tsx: "typescript",
    json: "javascript",
  };
  return map[ext] ?? "html";
}

interface SourceEditorProps {
  content: string;
  filePath?: string;
  language?: string;
  onChange?: (content: string) => void;
  readOnly?: boolean;
}

export const SourceEditor = memo(function SourceEditor({
  content,
  filePath,
  language,
  onChange,
  readOnly = false,
}: SourceEditorProps) {
  const editorRef = useRef<EditorView | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const mountEditor = useCallback(
    (node: HTMLDivElement | null) => {
      if (editorRef.current) {
        editorRef.current.destroy();
        editorRef.current = null;
      }
      if (!node) return;
      containerRef.current = node;

      const lang = language ?? (filePath ? detectLanguage(filePath) : "html");

      const updateListener = EditorView.updateListener.of((update) => {
        if (update.docChanged && onChangeRef.current) {
          onChangeRef.current(update.state.doc.toString());
        }
      });

      const state = EditorState.create({
        doc: content,
        extensions: [
          lineNumbers(),
          highlightActiveLine(),
          highlightActiveLineGutter(),
          history(),
          foldGutter(),
          indentOnInput(),
          bracketMatching(),
          closeBrackets(),
          highlightSelectionMatches(),
          keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap]),
          getLanguageExtension(lang),
          oneDark,
          updateListener,
          EditorState.readOnly.of(readOnly),
          EditorView.theme({
            "&": { height: "100%" },
            ".cm-scroller": { overflow: "auto" },
          }),
        ],
      });

      editorRef.current = new EditorView({ state, parent: node });
    },
    [content, filePath, language, readOnly],
  );

  return <div ref={mountEditor} className="h-full w-full overflow-hidden" />;
});
