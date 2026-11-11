import { useState } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";
import { Button, Popover } from "../ui";
import { shareBootstrap, safeShareUrl } from "./localShareClient";
import { useQuickShare } from "./useQuickShare";
import {
  ShareSettings,
  ShareNotices,
  ShareActions,
  ShareSourceStatus,
  ShareLogin,
  SharePlan,
} from "./QuickShareControls";
export function QuickShare({ beforeShare }: { beforeShare?: () => Promise<void> }) {
  const [token, setToken] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useMountEffect(() => {
    if (!document.querySelector('meta[name="hyperframes-local-share"][content="1"]')) return;
    const controller = new AbortController();
    void shareBootstrap(controller.signal)
      .then((value) => {
        if (!controller.signal.aborted) setToken(value);
      })
      .catch(() => {});
    return () => controller.abort();
  });
  if (!token) return null;
  return (
    <Popover
      open={open}
      onOpenChange={setOpen}
      align="end"
      aria-label="Share project"
      trigger={<Button variant="secondary">Share</Button>}
      className="w-96 max-w-[calc(100vw-2rem)] rounded-2xl p-4"
    >
      {open ? <QuickShareContent token={token} beforeShare={beforeShare} /> : null}
    </Popover>
  );
}

export function QuickShareContent({
  token,
  beforeShare,
}: {
  token: string;
  beforeShare?: () => Promise<void>;
}) {
  const [includeSource, setIncludeSource] = useState(false);
  const model = { ...useQuickShare(token, beforeShare), includeSource, setIncludeSource };
  const { snapshot, progress, error } = model;
  const url = safeShareUrl(snapshot?.share.url ?? "");
  const manageUrl = safeShareUrl(snapshot?.share.manageUrl ?? "");
  return (
    <div className="flex flex-col gap-3 text-step-13">
      <div>
        <h2 className="text-step-15 font-semibold">Share project</h2>
        <p className="mt-1 text-step-11 text-text-3">Share the latest saved project.</p>
      </div>
      {snapshot ? (
        <>
          <ShareSettings model={model} snapshot={snapshot} />
          <ShareNotices model={model} snapshot={snapshot} />
          <ShareSourceStatus model={model} snapshot={snapshot} />
          <ShareActions model={model} snapshot={snapshot} url={url} />
          <SharePlan model={model} snapshot={snapshot} />
        </>
      ) : null}
      {!snapshot && !error ? <p role="status">Loading sharing…</p> : null}
      {progress ? (
        <p role="status">{progress} You can close this panel; keep Studio running.</p>
      ) : null}
      {model.notice ? <p role="status">{model.notice}</p> : null}
      <ShareLogin model={model} />
      {error ? (
        <p role="alert" className="text-step-11 text-text-2">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        {manageUrl ? (
          <a
            href={manageUrl}
            onClick={() =>
              model.track({ event: "share_navigation_clicked", destination: "manage" })
            }
            target="_blank"
            rel="noreferrer"
            className="flex h-8 items-center rounded-full px-2 text-step-12 text-text-2 hover:bg-hover"
          >
            Manage sharing
          </a>
        ) : null}
        {url ? (
          <a
            href={url}
            onClick={() =>
              model.track({ event: "share_navigation_clicked", destination: "shared_page" })
            }
            target="_blank"
            rel="noreferrer"
            className="flex h-8 items-center rounded-full px-2 text-step-12 text-text-2 hover:bg-hover"
          >
            Open shared page
          </a>
        ) : null}
      </div>
    </div>
  );
}
