import { useEffect, useRef, useState, type ReactNode } from "react";
import { useStudioShellContext } from "../contexts/StudioContext";
import { studioApiFetch } from "../utils/studioApiFetch";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { FrameyGlyph } from "./FrameyGlyph";
import { Button, buttonBase, buttonSizes, buttonVariants, cn, Popover } from "./ui";

// "Edit with Framey": the preview server (`/api/open-in-desktop`) says whether to show it, whether the app can take the
// project yet (its gate is the CLI's HANDOFF_READY) and whether it is installed. Every Studio open shows a card under
// the button with one action that ends in the app: open the project there, or download the app and open the project
// as soon as it is installed.
const ROUTE = "/api/open-in-desktop";
/** How far the pupils travel towards the pointer, in the glyph's own units. */
const GAZE = 2.2;
/** Long enough for the flight to finish before the label comes back. */
const OPENING_MS = 1600;
/** While someone installs the app, how often Studio asks whether it is in, and for how long. */
const INSTALL_POLL_MS = 3000;
const INSTALL_WAIT_MS = 15 * 60_000;

type OpenResult = { opened: true } | { opened: false; reason: string; downloadUrl: string };

type DesktopRoute = { handoff: boolean; downloadUrl: string | null; installed: boolean };

/** What the card can do here: open the project, download then open it, or only download (the app takes no project). */
type CardState = "open" | "install" | "download";

type Trigger = "auto" | "header" | "card" | "after_install";

/** Null hides the button: no route (the app's own Studio), or nothing here to open or download. */
async function readRoute(): Promise<DesktopRoute | null> {
  try {
    const res = await studioApiFetch(ROUTE);
    if (!res.ok) return null;
    const body = (await res.json()) as {
      available?: unknown;
      handoff?: unknown;
      downloadUrl?: unknown;
      installed?: unknown;
    } | null;
    if (body?.available !== true) return null;
    const handoff = body.handoff === true;
    const downloadUrl = typeof body.downloadUrl === "string" ? body.downloadUrl : null;
    return handoff || downloadUrl
      ? { handoff, downloadUrl, installed: body.installed === true }
      : null;
  } catch {
    return null;
  }
}

function cardState(route: DesktopRoute): CardState {
  if (route.handoff && route.installed) return "open";
  return route.handoff ? "install" : "download";
}

/** The download, tagged so a download that started in Studio can be told apart. */
function studioDownload(url: string): string {
  try {
    const tagged = new URL(url);
    tagged.searchParams.set("ref", "studio");
    return tagged.toString();
  } catch {
    return url;
  }
}

/** Framey looks at the pointer: one listener, one write per frame, no re-render. */
function useGaze(
  anchor: React.RefObject<HTMLElement | null>,
  eye: React.RefObject<SVGGElement | null>,
) {
  useEffect(() => {
    let frame = 0;
    const look = (event: PointerEvent) => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const box = anchor.current?.getBoundingClientRect();
        if (!box || !eye.current) return;
        const dx = event.clientX - (box.left + box.height / 2);
        const dy = event.clientY - (box.top + box.height / 2);
        const distance = Math.hypot(dx, dy) || 1;
        eye.current.style.transform = `translate(${(dx / distance) * GAZE}px, ${(dy / distance) * GAZE}px)`;
      });
    };
    window.addEventListener("pointermove", look);
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("pointermove", look);
    };
  }, [anchor, eye]);
}

/** While `installing`, asks the preview server every few seconds and hands over the route once the app is in. */
function useOpenOnceInstalled(
  installing: boolean,
  onInstalled: (route: DesktopRoute) => void,
  onGiveUp: () => void,
) {
  const latest = useRef({ onInstalled, onGiveUp });
  latest.current = { onInstalled, onGiveUp };
  useEffect(() => {
    if (!installing) return;
    const started = Date.now();
    let live = true;
    const timer = setInterval(() => {
      if (Date.now() - started > INSTALL_WAIT_MS) {
        clearInterval(timer);
        latest.current.onGiveUp();
        return;
      }
      void readRoute().then((found) => {
        if (!live || !found?.installed || !found.handoff) return;
        clearInterval(timer);
        latest.current.onInstalled(found);
      });
    }, INSTALL_POLL_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [installing]);
}

/** The card's one action: open the project in the app, or download the app (then open the project, where it can). */
function CardAction({
  state,
  downloadUrl,
  opening,
  onOpen,
  onDownload,
}: {
  state: CardState;
  downloadUrl: string | null;
  opening: boolean;
  onOpen: () => void;
  onDownload: () => void;
}) {
  if (state === "open")
    return (
      <Button variant="primary" disabled={opening} onClick={onOpen}>
        Open in HyperFrames
      </Button>
    );
  if (!downloadUrl) return null;
  return (
    <a
      href={studioDownload(downloadUrl)}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(buttonBase, buttonVariants.primary, buttonSizes.md)}
      onClick={onDownload}
    >
      {state === "install" ? "Open in HyperFrames" : "Download HyperFrames"}
    </a>
  );
}

function CardBody({
  state,
  installing,
  action,
}: {
  state: CardState;
  installing: boolean;
  action: ReactNode;
}) {
  if (installing)
    return (
      <div data-testid="desktop-card-installing">
        <p className="mt-2 text-balance text-text-1">
          Open the download and drag HyperFrames into Applications. This project opens there as soon
          as the app is installed.
        </p>
        <p className="mt-2 text-text-3">Waiting for the app…</p>
      </div>
    );
  return (
    <>
      <p className="mt-2 text-balance text-text-3">
        {state === "download"
          ? "Framey lives in the free HyperFrames desktop app:"
          : "This project opens in the free HyperFrames desktop app, where Framey keeps going with you:"}
      </p>
      <ul className="mt-1.5 grid gap-1 text-text-1">
        <li>Chat to change anything in the video</li>
        <li>Draw on a frame to point at it</li>
        <li>Watch me act out each edit</li>
      </ul>
      {action && <div className="mt-3 flex justify-end">{action}</div>}
    </>
  );
}

export function OpenInDesktopButton() {
  const { showToast } = useStudioShellContext();
  const [route, setRoute] = useState<DesktopRoute | null>(null);
  const [cardOpen, setCardOpen] = useState(false);
  // Opened by Studio itself rather than by a press: it must not take the keyboard from the player.
  const [autoShown, setAutoShown] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [opening, setOpening] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const eye = useRef<SVGGElement>(null);
  useGaze(trigger, eye);

  useEffect(() => {
    let live = true;
    void readRoute().then((found) => {
      if (!live || !found) return;
      setRoute(found);
      setAutoShown(true);
      setCardOpen(true);
      trackStudioEvent("desktop_card_shown", { trigger: "auto", state: cardState(found) });
    });
    return () => {
      live = false;
    };
  }, []);

  const openInApp = async (from: Trigger) => {
    if (opening) return;
    setOpening(true);
    try {
      const res = await studioApiFetch(ROUTE, { method: "POST" });
      const result = (await res.json()) as OpenResult;
      trackStudioEvent("desktop_open_result", {
        trigger: from,
        result: result.opened ? "opened" : result.reason,
      });
      if (result.opened) {
        setCardOpen(false);
        showToast("Framey is opening this project in the HyperFrames desktop app", "info");
        await new Promise((done) => setTimeout(done, OPENING_MS));
      } else {
        // The app went missing since Studio last asked: offer it again.
        setRoute((known) => (known ? { ...known, installed: false } : known));
        setCardOpen(true);
      }
    } catch {
      showToast("Couldn't reach the preview server to open the app", "error");
    } finally {
      setOpening(false);
    }
  };

  // Someone is installing the app from the card: open the project the moment it is in.
  useOpenOnceInstalled(
    installing,
    (found) => {
      setInstalling(false);
      setRoute(found);
      void openInApp("after_install");
    },
    () => setInstalling(false),
  );

  if (!route) return null;
  const state = cardState(route);

  const pressHeader = () => {
    trackStudioEvent("toolbar_action", { action: "open_in_desktop", source: "header" });
    if (state === "open") {
      void openInApp("header");
      return;
    }
    setAutoShown(false);
    setCardOpen(true);
    trackStudioEvent("desktop_card_shown", { trigger: "header", state });
  };

  const action = (
    <CardAction
      state={state}
      downloadUrl={route.downloadUrl}
      opening={opening}
      onOpen={() => {
        trackStudioEvent("toolbar_action", { action: "open_in_desktop", source: "card" });
        void openInApp("card");
      }}
      onDownload={() => {
        trackStudioEvent("toolbar_action", { action: "get_desktop_app", source: "card", state });
        if (state === "install") setInstalling(true);
        else setCardOpen(false);
      }}
    />
  );

  return (
    <Popover
      open={cardOpen}
      // The popover owns the trigger's press, also while Studio's own card is up (else a press only closes it).
      onOpenChange={(next, details) => {
        if (next || details.reason === "trigger-press") pressHeader();
        else setCardOpen(false);
      }}
      side="bottom"
      align="end"
      arrow
      aria-label="Keep editing with Framey"
      className="w-72"
      initialFocus={autoShown ? false : undefined}
      trigger={
        <Button
          ref={trigger}
          variant="ghost"
          data-testid="header-open-in-desktop"
          data-opening={opening || undefined}
          title="Open this project in the HyperFrames desktop app and edit it with Framey"
          className="hf-framey-trigger gap-1.5 border border-accent/40 bg-accent/10 pl-1 font-semibold text-text-0 enabled:hover:bg-accent/20"
          icon={<FrameyGlyph size={24} className="hf-framey" eyeRef={eye} />}
        >
          {opening ? "Opening in the app…" : "Edit with Framey"}
          {!opening && (
            <span className="rounded-full bg-accent px-1.5 text-[10px] leading-4 font-bold text-on-accent">
              New
            </span>
          )}
        </Button>
      }
    >
      <div className="flex items-center gap-2.5">
        <FrameyGlyph size={36} />
        <p className="text-step-12 font-medium text-text-0">Keep editing with Framey</p>
      </div>
      <CardBody state={state} installing={installing} action={action} />
    </Popover>
  );
}
