import { useCallback, useEffect, useState } from "react";
import { applyInlineStyle, readInlineStyle } from "./inlineTextStyleRange";
import type { InlineTextEditSession } from "../../hooks/useInlineTextEdit";

/**
 * The controls for styling the characters selected inside an open text edit.
 *
 * It lives in Studio's document rather than the composition's, positioned over
 * the selection: putting it in the preview would mean injecting Studio's chrome
 * into the user's composition, where it would be captured by a render and
 * inherit the composition's own styling.
 *
 * `position: fixed` and viewport coordinates, so it does not have to know which
 * of the canvas' several nested coordinate systems it was mounted into.
 */

const READ_PROPERTIES = ["color", "font-weight", "font-style", "text-decoration-line"];

/** Enough above the text to clear it, without leaving the element behind. */
const GAP_PX = 10;
/** h-6 controls + p-1 + the border. Used only to keep an above-toolbar onscreen. */
const TOOLBAR_HEIGHT_PX = 34;
const DEFAULT_COLOR = "#ffffff";

interface ToolbarPlacement {
  left: number;
  top: number;
  placeBelow: boolean;
  styles: Record<string, string>;
}

export function InlineTextToolbar({
  session,
  iframe,
}: {
  session: InlineTextEditSession | null;
  iframe: HTMLIFrameElement | null;
}) {
  const [placement, setPlacement] = useState<ToolbarPlacement | null>(null);

  const refresh = useCallback(() => {
    setPlacement(session && iframe ? placeOverSelection(session.element, iframe) : null);
  }, [session, iframe]);

  // The selection lives in the preview's document, so the event does too.
  useEffect(() => {
    const doc = session?.element.ownerDocument;
    if (!doc) {
      setPlacement(null);
      return;
    }
    doc.addEventListener("selectionchange", refresh);
    return () => doc.removeEventListener("selectionchange", refresh);
  }, [session, refresh]);

  const apply = useCallback(
    (delta: Record<string, string | null>) => {
      const doc = session?.element.ownerDocument;
      const selection = doc?.defaultView?.getSelection();
      if (!selection || selection.rangeCount === 0) return;
      const range = selection.getRangeAt(0);
      applyInlineStyle(range, delta);
      refresh();
    },
    [session, refresh],
  );

  if (!placement) return null;
  const styles = placement.styles;

  return (
    <div
      data-inline-text-toolbar="true"
      role="toolbar"
      aria-label="Text formatting"
      className="pointer-events-auto fixed z-[200] flex items-center gap-1 rounded-lg border border-white/10 bg-[#15171c] p-1 shadow-[0_8px_24px_rgba(0,0,0,0.55)]"
      style={{
        left: placement.left,
        top: placement.top,
        transform: `translate(-50%, ${placement.placeBelow ? "0" : "-100%"})`,
      }}
      // Two different things have to be stopped here, and missing either one
      // loses the edit the toolbar exists to act on.
      //
      // The default, because a press anywhere in Studio moves the focus, and
      // moving it out of the text collapses the selection being styled.
      //
      // The propagation, because this renders inside the canvas overlay: a
      // press that reaches the canvas is read as a click on the composition,
      // which deselects the element and commits the edit out from under the
      // button that was just pressed.
      onPointerDown={swallow}
      onMouseDown={swallow}
      onClick={(event) => event.stopPropagation()}
    >
      <label
        className="relative flex h-6 w-6 cursor-pointer items-center justify-center rounded-md hover:bg-white/10"
        title="Text colour"
      >
        <span
          aria-hidden="true"
          className="h-3.5 w-3.5 rounded-full border border-white/25"
          style={{ background: styles.color || DEFAULT_COLOR }}
        />
        {/* `inset-0` is not enough on its own: a colour input carries a
            user-agent minimum width, which wins over the right edge and lets
            the invisible input spill across the buttons beside it. Hovering
            bold then opened the colour picker. The size is pinned instead. */}
        <input
          type="color"
          aria-label="Text colour"
          className="absolute inset-0 h-full w-full min-w-0 cursor-pointer opacity-0"
          value={toHexColor(styles.color)}
          onChange={(event) => apply({ color: event.target.value })}
        />
      </label>
      <ToolbarToggle
        label="Bold"
        glyph="B"
        bold
        on={isBold(styles["font-weight"])}
        onToggle={(on) => apply({ "font-weight": on ? "700" : null })}
      />
      <ToolbarToggle
        label="Italic"
        glyph="I"
        italic
        on={styles["font-style"] === "italic"}
        onToggle={(on) => apply({ "font-style": on ? "italic" : null })}
      />
      <ToolbarToggle
        label="Underline"
        glyph="U"
        underline
        on={styles["text-decoration-line"] === "underline"}
        onToggle={(on) => apply({ "text-decoration-line": on ? "underline" : null })}
      />
    </div>
  );
}

function swallow(event: { preventDefault: () => void; stopPropagation: () => void }): void {
  event.preventDefault();
  event.stopPropagation();
}

function ToolbarToggle({
  label,
  glyph,
  on,
  onToggle,
  bold,
  italic,
  underline,
}: {
  label: string;
  glyph: string;
  on: boolean;
  onToggle: (on: boolean) => void;
  bold?: boolean;
  italic?: boolean;
  underline?: boolean;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      aria-pressed={on}
      className={`flex h-6 w-6 items-center justify-center rounded-md text-xs ${
        on ? "bg-studio-accent/20 text-studio-accent" : "text-white/70 hover:bg-white/10"
      }`}
      style={{
        fontWeight: bold ? 700 : 400,
        fontStyle: italic ? "italic" : "normal",
        textDecoration: underline ? "underline" : "none",
      }}
      onClick={() => onToggle(!on)}
    >
      {glyph}
    </button>
  );
}

/** Where the selection is on screen, or null when there is nothing selected. */
function placeOverSelection(
  element: HTMLElement,
  iframe: HTMLIFrameElement,
): ToolbarPlacement | null {
  const doc = element.ownerDocument;
  const view = doc.defaultView;
  const selection = view?.getSelection();
  if (!view || !selection || selection.rangeCount === 0 || selection.isCollapsed) return null;

  const range = selection.getRangeAt(0);
  if (!element.contains(range.commonAncestorContainer)) return null;
  const rect = range.getBoundingClientRect();

  // The composition is drawn scaled into the iframe's box, so a point inside it
  // is that scale away from a point on Studio's screen. This is the inverse of
  // the mapping the canvas uses to turn a press into a caret position.
  const box = iframe.getBoundingClientRect();
  const scale = view.innerWidth ? box.width / view.innerWidth : 1;
  const above = box.top + rect.top * scale - GAP_PX;
  const placeBelow = above < TOOLBAR_HEIGHT_PX;

  return {
    left: box.left + (rect.left + rect.width / 2) * scale,
    top: placeBelow ? box.top + (rect.top + rect.height) * scale + GAP_PX : above,
    placeBelow,
    styles: readInlineStyle(range, READ_PROPERTIES),
  };
}

function isBold(weight: string | undefined): boolean {
  if (!weight) return false;
  if (weight === "bold" || weight === "bolder") return true;
  return Number.parseInt(weight, 10) >= 600;
}

/**
 * A colour input only accepts `#rrggbb`, and what the page reports is whatever
 * the stylesheet said. An unreadable value opens the picker on white rather
 * than refusing to open.
 */
function toHexColor(value: string | undefined): string {
  if (!value) return DEFAULT_COLOR;
  if (/^#[0-9a-f]{6}$/i.test(value)) return value;
  const channels = value.match(/\d+(\.\d+)?/g);
  if (!channels || channels.length < 3) return DEFAULT_COLOR;
  return `#${channels
    .slice(0, 3)
    .map((channel) => Number(channel).toString(16).padStart(2, "0"))
    .join("")}`;
}
