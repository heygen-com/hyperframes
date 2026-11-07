import type { LocalShareAudience, LocalShareSnapshot } from "@hyperframes/studio-server";
import { Button, Select } from "../ui";
import { isAudience } from "./localShareClient";
import type { QuickShareModel } from "./useQuickShare";

type Props = { model: QuickShareModel; snapshot: LocalShareSnapshot };
const LABELS: Record<LocalShareAudience, string> = {
  public: "Anyone with the link",
  team: "Anyone in this workspace",
  invite: "Only invited people",
  private: "Only you",
};
export function ShareSettings({ model, snapshot }: Props) {
  const { audience, setAudience, spaceId, busy } = model;
  const state = snapshot.share;
  const space = snapshot.spaces.find((item) => item.id === spaceId);
  return (
    <>
      {space && space.limit !== null && space.used !== null ? (
        <p className="text-step-11 text-text-3">
          {space.used} of {space.limit} free shared projects used
        </p>
      ) : null}
      <label className="flex flex-col gap-1 text-text-3">
        Who can access
        <Select
          label="Who can access"
          value={audience}
          disabled={busy || state.state === "unavailable"}
          onCommit={(value) => {
            if (isAudience(value)) setAudience(value);
          }}
          options={[
            { value: "", label: "Choose access…", disabled: true },
            ...(
              [
                "public",
                "team",
                "invite",
                ...(state.audience === "private" ? ["private" as const] : []),
              ] as const
            ).map((value) => ({
              value,
              label: LABELS[value],
              disabled: !space?.audiences.includes(value) && value !== state.audience,
            })),
          ]}
        />
      </label>
    </>
  );
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
        <Button disabled={model.busy} onClick={() => void model.run({ action: "update" })}>
          {snapshot.job?.state === "failed" && snapshot.share.hasReadyVersion === false
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
    <Button variant="primary" disabled={model.busy} onClick={() => void model.copy(url)}>
      {label}
    </Button>
  );
}
function ManageShare({ model, snapshot, url }: Props & { url: string | null }) {
  return (
    <>
      {model.audience && model.audience !== snapshot.share.audience ? (
        <Button
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
    </>
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
