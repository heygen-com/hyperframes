import { Button } from "../ui";
import { useState } from "react";
import { quotedFilePath } from "@hyperframes/core/terminal-text";
import { useMountEffect } from "../../hooks/useMountEffect";
import { ReconnectProject } from "./ReconnectProject";
import { projectFilesStatus } from "./localShareClient";
import { ShareActions } from "./QuickShareControls";

type Props = React.ComponentProps<typeof ShareActions> & { token: string };

export function SourceShareActions(props: Props) {
  const [revision, setRevision] = useState(0);
  return (
    <>
      {props.model.spaceId && props.snapshot.versionSharing && (
        <SourceSummary
          key={revision}
          {...props}
          onConnected={() => setRevision((value) => value + 1)}
        />
      )}
      <ShareActions {...props} />
    </>
  );
}

function SourceSummary({ token, model, onConnected }: Props & { onConnected: () => void }) {
  const { summary, failed } = useProjectFilesSummary(token, model.spaceId);
  const [choosing, setChoosing] = useState(false);
  if (failed)
    return (
      <p role="status">Could not check synced project files. You can still share the video.</p>
    );
  if (!summary || summary.state === "off") return null;
  if (summary.state === "synced")
    return <p role="status">Project files synced. A matching video will include these files.</p>;
  if (choosing)
    return (
      <ReconnectProject
        token={token}
        space={model.spaceId}
        onCancel={() => setChoosing(false)}
        onConnected={onConnected}
      />
    );
  return (
    <div className="grid gap-2 text-step-12 text-text-3">
      <p>{syncDescription(summary)}</p>
      {summary.paths.length ? (
        <>
          <p>Referenced hidden assets included in sync</p>
          <ul className="max-h-48 overflow-auto">
            {summary.paths.map((path) => (
              <li key={path} className="whitespace-pre-wrap break-all">
                <bdi>{quotedFilePath(path).slice(1, -1)}</bdi>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Button
        variant="secondary"
        disabled={summary.state === "at_limit" || model.busy}
        onClick={() =>
          void model.run({
            action: "sync",
            space: model.spaceId,
            expectedReferencedHiddenDigest: summary.digest,
          })
        }
      >
        Sync project files
      </Button>
      {summary.canReconnect && (
        <Button variant="ghost" disabled={model.busy} onClick={() => setChoosing(true)}>
          Reconnect a moved or upgraded project
        </Button>
      )}
    </div>
  );
}

function syncDescription(summary: Awaited<ReturnType<typeof projectFilesStatus>>) {
  if (summary.state === "at_limit")
    return "This workspace has reached its cloud composition limit.";
  if (summary.canReconnect) return "Syncing this folder will create a new cloud composition.";
  return "Sync project files to include them with a matching video. You can also share the video on its own.";
}

function useProjectFilesSummary(token: string, space: string) {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof projectFilesStatus>> | null>(
    null,
  );
  const [failed, setFailed] = useState(false);
  useMountEffect(() => {
    const controller = new AbortController();
    void projectFilesStatus(token, space, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setSummary(items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  });
  return { summary, failed };
}
