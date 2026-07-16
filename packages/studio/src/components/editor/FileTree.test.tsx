// @vitest-environment happy-dom

import React, { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FileTree } from "./FileTree";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | null = null;

afterEach(() => {
  act(() => root?.unmount());
  root = null;
  document.body.replaceChildren();
});

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve: (value) => {
      if (!resolvePromise) throw new Error("deferred promise not initialized");
      resolvePromise(value);
    },
  };
}

function input(): HTMLInputElement {
  const element = document.querySelector("input");
  if (!(element instanceof HTMLInputElement)) throw new Error("inline input not rendered");
  return element;
}

function setInputValue(element: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  if (!setter) throw new Error("input value setter unavailable");
  act(() => {
    setter.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function submit(element: HTMLInputElement): void {
  act(() => element.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));
}

function buttonWithText(label: string): HTMLButtonElement {
  const button = [...document.querySelectorAll("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
  );
  if (!(button instanceof HTMLButtonElement)) throw new Error(`${label} button not rendered`);
  return button;
}

function startCreate(): HTMLInputElement {
  const button = document.querySelector('button[title="New File"]');
  if (!(button instanceof HTMLButtonElement)) throw new Error("new file button not rendered");
  act(() => button.click());
  return input();
}

function startRename(path: string): HTMLInputElement {
  const fileButton = [...document.querySelectorAll("button")].find(
    (button) => button.textContent?.trim() === path,
  );
  if (!(fileButton instanceof HTMLButtonElement)) throw new Error(`${path} row not rendered`);
  act(() =>
    fileButton.dispatchEvent(
      new MouseEvent("contextmenu", { bubbles: true, clientX: 20, clientY: 20 }),
    ),
  );
  act(() => buttonWithText("Rename").click());
  return input();
}

function mount(element: React.ReactNode): void {
  const host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  act(() => root?.render(element));
}

async function expectFailedOperationRetry({
  render,
  start,
  initialName,
  retryName,
  error,
  expectedCalls,
}: {
  render: (onCommit: (...paths: string[]) => Promise<string | null>) => React.ReactNode;
  start: () => HTMLInputElement;
  initialName: string;
  retryName: string;
  error: string;
  expectedCalls: [string[], string[]];
}): Promise<void> {
  const operation = deferred<string | null>();
  const onCommit = vi.fn((..._paths: string[]) => operation.promise);
  mount(render(onCommit));

  const field = start();
  setInputValue(field, initialName);
  submit(field);

  expect(input().value).toBe(initialName);
  expect(input().disabled).toBe(true);
  expect(onCommit).toHaveBeenCalledOnce();
  expect(onCommit).toHaveBeenCalledWith(...expectedCalls[0]);

  await act(async () => operation.resolve(error));

  expect(input().value).toBe(initialName);
  await vi.waitFor(() => expect(input().disabled).toBe(false));
  expect(document.body.textContent).toContain(error);

  onCommit.mockResolvedValueOnce(null);
  setInputValue(input(), retryName);
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  });
  await vi.waitFor(() => expect(document.querySelector("input")).toBeNull());
  expect(onCommit).toHaveBeenNthCalledWith(2, ...expectedCalls[1]);
}

describe("FileTree inline operations", () => {
  it("keeps a failed create mounted with its typed name and a row-level error", async () => {
    await expectFailedOperationRetry({
      render: (onCreateFile) => (
        <FileTree
          files={[]}
          activeFile={null}
          onSelectFile={() => {}}
          onCreateFile={onCreateFile}
        />
      ),
      start: startCreate,
      initialName: "draft.html",
      retryName: "draft-2.html",
      error: "Couldn't create draft.html: already exists",
      expectedCalls: [["draft.html"], ["draft-2.html"]],
    });
  });

  it("dismisses a successful create and renders the created file", async () => {
    function Harness() {
      const [files, setFiles] = useState<string[]>([]);
      return (
        <FileTree
          files={files}
          activeFile={null}
          onSelectFile={() => {}}
          onCreateFile={async (path) => {
            setFiles((current) => [...current, path]);
            return null;
          }}
        />
      );
    }
    mount(<Harness />);

    const field = startCreate();
    setInputValue(field, "draft.html");
    submit(field);
    await act(async () => {});

    expect(document.querySelector("input")).toBeNull();
    expect(document.body.textContent).toContain("draft.html");
  });

  it("keeps a failed rename mounted with its typed name and a row-level error", async () => {
    await expectFailedOperationRetry({
      render: (onRenameFile) => (
        <FileTree
          files={["index.html"]}
          activeFile={null}
          onSelectFile={() => {}}
          onRenameFile={onRenameFile}
        />
      ),
      start: () => startRename("index.html"),
      initialName: "renamed.html",
      retryName: "renamed-2.html",
      error: "Couldn't rename index.html: already exists",
      expectedCalls: [
        ["index.html", "renamed.html"],
        ["index.html", "renamed-2.html"],
      ],
    });
  });

  it("dismisses a successful rename and renders the renamed file", async () => {
    function Harness() {
      const [files, setFiles] = useState(["index.html"]);
      return (
        <FileTree
          files={files}
          activeFile={null}
          onSelectFile={() => {}}
          onRenameFile={async (oldPath, newPath) => {
            setFiles((current) => current.map((path) => (path === oldPath ? newPath : path)));
            return null;
          }}
        />
      );
    }
    mount(<Harness />);

    const field = startRename("index.html");
    setInputValue(field, "renamed.html");
    submit(field);
    await act(async () => {});

    expect(document.querySelector("input")).toBeNull();
    expect(document.body.textContent).toContain("renamed.html");
    expect(document.body.textContent).not.toContain("index.html");
  });
});
