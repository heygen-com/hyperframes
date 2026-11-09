import type { LocalShareSnapshot } from "@hyperframes/studio-server";
import { Button } from "../ui";
import { ShareAudience } from "./ShareAudience";
import { Link, ArrowUpRight } from "@phosphor-icons/react";
import type { QuickShareModel } from "./useQuickShare";

type Props = { model: QuickShareModel; snapshot: LocalShareSnapshot };
export function ShareSettings({ model, snapshot }: Props) {
  return <ShareAudience model={model} snapshot={snapshot} />;
}
export function ShareNotices({ model, snapshot }: Props) {
  const { share } = snapshot;
  const messages = [
    model.audience === "invite" ? "Add people from Manage sharing after creating the link." : null,
    share.changed
      ? "Local changes aren’t shared yet. Update the shared version when you’re ready."
      : share.changed === null
        ? "Changes after your last upload aren’t shared automatically. Update to share the current project."
        : null,
    share.state === "link_off" ? "The link is off. Updating the video keeps it off." : null,
    share.state === "processing" && !model.busy && snapshot.job?.state !== "failed"
      ? "The shared video is still being prepared. Reopen sharing to check its status."
      : null,
    share.state === "unavailable" ? "Sharing is paused. Open Manage sharing for details." : null,
    !snapshot.versionSharing && share.state === "not_shared"
      ? "Sharing isn’t available for this account yet."
      : null,
  ];
  return (
    <>
      {share.state === "failed" && share.failure ? (
        <p role="alert" className="text-step-11 text-text-3">
          {share.failure}
        </p>
      ) : null}
      {messages.filter(Boolean).map((message) => (
        <p key={message} className="text-step-11 text-text-3">
          {message}
        </p>
      ))}
    </>
  );
}
export function ShareActions({ model, snapshot, url }: Props & { url: string | null }) {
  if (snapshot.share.state === "not_shared")
    return <CreateShare model={model} snapshot={snapshot} />;
  return (
    <>
      {url ? <CopyShare model={model} snapshot={snapshot} url={url} /> : null}
      {snapshot.versionSharing && snapshot.share.state !== "unavailable" ? (
        <Button
          className="h-9 rounded-lg"
          variant={snapshot.share.changed !== false ? "primary" : "secondary"}
          disabled={model.busy}
          onClick={() => void model.run({ action: "update" })}
        >
          {(snapshot.job?.state === "failed" || snapshot.share.state === "failed") &&
          snapshot.share.hasReadyVersion === false
            ? "Create share link"
            : "Update shared version"}
        </Button>
      ) : null}
      <ManageShare model={model} snapshot={snapshot} url={url} />
    </>
  );
}
function CreateShare({ model, snapshot }: Props) {
  const space = snapshot.spaces.find((item) => item.id === model.spaceId);
  const canCreate = snapshot.versionSharing && space?.canCreate && model.audience !== "";
  return (
    <>
      {!space || !space.canCreate ? (
        <p className="text-step-11 text-text-3">
          Sharing isn’t available in the workspace selected at sign-in. Sign in with an accessible
          workspace to continue.
        </p>
      ) : null}
      <Button
        variant="primary"
        className="h-9 self-end rounded-lg px-3 text-step-13"
        disabled={model.busy || !canCreate}
        onClick={() => {
          if (model.audience)
            void model.run({ action: "share", audience: model.audience, space: model.spaceId });
        }}
      >
        Create share link
      </Button>
    </>
  );
}
function CopyShare({ model, snapshot, url }: Props & { url: string }) {
  const label = model.copied
    ? "Copied"
    : snapshot.share.changed !== false
      ? "Copy current shared link"
      : "Copy link";
  return (
    <div className="flex min-w-0 items-center gap-2 rounded-xl border border-border p-2.5">
      <span
        className="min-w-0 flex-1 truncate rounded-lg bg-press px-2.5 py-2 font-mono text-step-11 text-text-3"
        title={url}
      >
        {url.replace(/^https:\/\//, "")}
      </span>
      <Button
        className="h-9 shrink-0 rounded-lg px-3 text-step-12"
        variant={snapshot.share.changed !== false ? "secondary" : "primary"}
        disabled={model.busy}
        onClick={() => void model.copy(url)}
      >
        <Link size={15} aria-hidden="true" />
        {label}
      </Button>
    </div>
  );
}
function ManageShare({ model, snapshot, url }: Props & { url: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-1">
      {model.audience && model.audience !== snapshot.share.audience ? (
        <Button
          variant="ghost"
          className="h-8 rounded-full text-step-13"
          disabled={model.busy}
          onClick={() => {
            if (model.audience) void model.run({ action: "access", audience: model.audience });
          }}
        >
          Save access
        </Button>
      ) : null}
      {snapshot.share.state === "link_off" ? (
        <Button disabled={model.busy} onClick={() => void model.run({ action: "on" })}>
          Turn link on
        </Button>
      ) : null}
      {url ? (
        <Button
          variant="ghost"
          className="h-8 rounded-full text-step-13"
          disabled={model.busy}
          onClick={() => {
            if (
              window.confirm(
                "Turn off this link? Everyone using the link loses access. Comments are kept.",
              )
            )
              void model.run({ action: "off" });
          }}
        >
          Turn link off
        </Button>
      ) : null}
    </div>
  );
}

export function ShareSourceStatus({ model, snapshot }: Props) {
  const last = snapshot.job?.result;
  const recover = snapshot.job?.error?.code === "source_unavailable";
  let message = "Project files are checked when you share.";
  if (last?.source === "video_only")
    message = "Last Studio upload: video only. Project files weren’t included.";
  if (last?.source === "ready")
    message =
      last.state === "ready"
        ? "Last Studio upload: project files included."
        : "Project files are ready; sharing is still processing.";
  return (
    <>
      <p className="text-step-11 text-text-3">{message}</p>
      {recover ? (
        <Button
          variant="ghost"
          className="h-8 rounded-full text-step-13"
          disabled={model.busy}
          onClick={() => void model.run({ action: "update", videoOnly: true })}
        >
          Retry with video only
        </Button>
      ) : null}
    </>
  );
}

export function ShareLogin({ model }: { model: QuickShareModel }) {
  if (
    !model.errorCode ||
    ![
      "not_configured",
      "unauthenticated",
      "login_expired",
      "login_changed",
      "refresh_failed",
      "device_auth_failed",
    ].includes(model.errorCode)
  )
    return null;
  return (
    <>
      <Button
        variant="primary"
        disabled={model.busy}
        onClick={() => void model.run({ action: "login" })}
      >
        Sign in
      </Button>
      <p className="text-step-11 text-text-3">
        Or run <code>hyperframes auth login</code> in your terminal, then return to Studio. Sharing
        reconnects automatically.
      </p>
    </>
  );
}

export function SharePlan({ model, snapshot }: Props) {
  const space = snapshot.spaces.find((item) => item.id === model.spaceId);
  const upgrade = space?.upgradeUrl;
  const allowed =
    upgrade &&
    ["https://hyperframes.dev/pricing", "https://dev.hyperframes.dev/pricing"].includes(upgrade);
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 text-step-12">
      {space && space.limit !== null && space.used !== null ? (
        <span className="text-text-3 tabular-nums">
          {space.used} of {space.limit} free share links used
        </span>
      ) : null}
      {space?.plan === "free" && allowed ? (
        <a
          href={upgrade}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-8 items-center gap-1 rounded-full px-2 font-semibold text-accent hover:bg-hover"
        >
          Upgrade to Pro
          <ArrowUpRight size={13} aria-hidden="true" />
        </a>
      ) : null}
    </div>
  );
}
