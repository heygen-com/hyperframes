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
} from "./QuickShareControls";
export function QuickShare({ beforeShare }: { beforeShare?: () => Promise<void> }) {
  const [token, setToken] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  useMountEffect(() => {
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
      className="w-80 max-w-full"
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
  const model = useQuickShare(token, beforeShare);
  const { snapshot, busy, progress, error, reload } = model;
  const canRetry =
    error &&
    ["share_failed", "unavailable", "job_not_found"].includes(model.errorCode ?? "share_failed");
  const url = safeShareUrl(snapshot?.share.url ?? "");
  const manageUrl = safeShareUrl(snapshot?.share.manageUrl ?? "");
  return (
    <div className="flex flex-col gap-3">
      <div>
        <h2 className="text-step-13 font-medium">Share project</h2>
        <p className="mt-1 text-step-11 text-text-3">Share the latest saved project.</p>
      </div>
      {snapshot ? (
        <>
          <ShareSettings model={model} snapshot={snapshot} />
          <ShareNotices model={model} snapshot={snapshot} />
          <ShareSourceStatus model={model} snapshot={snapshot} />
          <ShareActions model={model} snapshot={snapshot} url={url} />
        </>
      ) : null}
      {!snapshot && !error ? <p role="status">Loading sharing…</p> : null}
      {progress ? (
        <p role="status">{progress} You can close this panel; keep Studio running.</p>
      ) : null}
      <ShareLogin model={model} />
      {error ? (
        <p role="alert" className="text-step-11 text-text-2">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-3">
        {manageUrl ? (
          <a href={manageUrl} target="_blank" rel="noreferrer" className="text-step-11 underline">
            Manage sharing
          </a>
        ) : null}
        {url ? (
          <a href={url} target="_blank" rel="noreferrer" className="text-step-11 underline">
            Open shared page
          </a>
        ) : null}
        {canRetry ? (
          <Button variant="ghost" disabled={busy} onClick={reload}>
            Try again
          </Button>
        ) : null}
      </div>
    </div>
  );
}
