import { useEffect, useRef, useState } from "react";
import { useStudioShellContext } from "../contexts/StudioContext";
import { studioApiFetch } from "../utils/studioApiFetch";
import { trackStudioEvent } from "../utils/studioTelemetry";
import { useStudioTranslation } from "../i18n/StudioI18nProvider";
import { FrameyGlyph } from "./FrameyGlyph";
import { Button, buttonBase, buttonSizes, buttonVariants, cn, Popover } from "./ui";

// "Edit with Framey": the preview server (`/api/open-in-desktop`) says whether to show it and whether the app can
// take the project yet (its gate is the CLI's HANDOFF_READY); until then a press introduces Framey with the download.
const ROUTE = "/api/open-in-desktop";
/** How far the pupils travel towards the pointer, in the glyph's own units. */
const GAZE = 2.2;
/** Long enough for the flight to finish before the label comes back. */
const OPENING_MS = 1600;

type OpenResult = { opened: true } | { opened: false; reason: string; downloadUrl: string };

type DesktopRoute = { handoff: boolean; downloadUrl: string | null };

/** Null hides the button: no route (the app's own Studio), or nothing here to open or download. */
function useDesktopRoute(): DesktopRoute | null {
  const [route, setRoute] = useState<DesktopRoute | null>(null);
  useEffect(() => {
    let live = true;
    studioApiFetch(ROUTE)
      .then((res) => (res.ok ? res.json() : null))
      .then((body: { available?: unknown; handoff?: unknown; downloadUrl?: unknown } | null) => {
        if (!live || body?.available !== true) return;
        const handoff = body.handoff === true;
        const downloadUrl = typeof body.downloadUrl === "string" ? body.downloadUrl : null;
        if (handoff || downloadUrl) setRoute({ handoff, downloadUrl });
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, []);
  return route;
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

export function OpenInDesktopButton() {
  const { t } = useStudioTranslation();
  const { showToast } = useStudioShellContext();
  const route = useDesktopRoute();
  const [opening, setOpening] = useState(false);
  // The card under the button, introducing Framey with the app's download.
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const eye = useRef<SVGGElement>(null);
  useGaze(trigger, eye);
  if (!route) return null;

  const open = async () => {
    if (!route.handoff) {
      trackStudioEvent("toolbar_action", { action: "open_in_desktop" });
      setDownloadUrl(route.downloadUrl);
      return;
    }
    if (opening) return;
    setOpening(true);
    trackStudioEvent("toolbar_action", { action: "open_in_desktop" });
    try {
      const res = await studioApiFetch(ROUTE, { method: "POST" });
      const result = (await res.json()) as OpenResult;
      if (result.opened) {
        showToast(t("desktop.opened"), "info");
        await new Promise((done) => setTimeout(done, OPENING_MS));
      } else setDownloadUrl(result.downloadUrl);
    } catch {
      showToast(t("desktop.unreachable"), "error");
    } finally {
      setOpening(false);
    }
  };

  return (
    <Popover
      open={downloadUrl !== null}
      // The popover owns the trigger's press: a press runs the hand-off, and the card shows only when there is
      // something to say (the download). A second handler on the button raced this one.
      onOpenChange={(next) => {
        if (next) void open();
        else setDownloadUrl(null);
      }}
      side="bottom"
      align="end"
      arrow
      aria-label={t("desktop.meet")}
      className="w-72"
      trigger={
        <Button
          ref={trigger}
          variant="ghost"
          data-testid="header-open-in-desktop"
          data-opening={opening || undefined}
          title={t("desktop.openTooltip")}
          className="hf-framey-trigger gap-1.5 border border-accent/40 bg-accent/10 pl-1 font-semibold text-text-0 enabled:hover:bg-accent/20"
          icon={<FrameyGlyph size={24} className="hf-framey" eyeRef={eye} />}
        >
          {opening ? t("desktop.opening") : t("desktop.edit")}
          {!opening && (
            <span className="rounded-full bg-accent px-1.5 text-[10px] leading-4 font-bold text-on-accent">
              {t("desktop.new")}
            </span>
          )}
        </Button>
      }
    >
      <div className="flex items-center gap-2.5">
        <FrameyGlyph size={36} />
        <p className="text-step-12 font-medium text-text-0">{t("desktop.meet")}</p>
      </div>
      <p className="mt-2 text-balance text-text-3">{t("desktop.intro")}</p>
      <ul className="mt-1.5 grid gap-1 text-text-1">
        <li>{t("desktop.chat")}</li>
        <li>{t("desktop.draw")}</li>
        <li>{t("desktop.watch")}</li>
      </ul>
      <div className="mt-3 flex items-center justify-end gap-2 whitespace-nowrap">
        <Button variant="ghost" onClick={() => setDownloadUrl(null)}>
          {t("desktop.notNow")}
        </Button>
        <a
          href={downloadUrl ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className={cn(buttonBase, buttonVariants.primary, buttonSizes.md)}
          onClick={() => trackStudioEvent("toolbar_action", { action: "get_desktop_app" })}
        >
          {t("desktop.getApp")}
        </a>
      </div>
    </Popover>
  );
}
