import { Button } from "../ui";
import { useState } from "react";
import { quotedFilePath } from "@hyperframes/core/terminal-text";
import { useMountEffect } from "../../hooks/useMountEffect";
import { projectFilesStatus } from "./localShareClient";
import { ShareActions } from "./QuickShareControls";

type Props = React.ComponentProps<typeof ShareActions> & { token: string };

export function SourceShareActions(props: Props) {
  return (
    <>
      {props.model.spaceId && props.snapshot.versionSharing && <SourceSummary {...props} />}
      <ShareActions {...props} />
    </>
  );
}

function SourceSummary({ token, model }: Props) {
  const [summary, setSummary] = useState<Awaited<ReturnType<typeof projectFilesStatus>> | null>(
    null,
  );
  const paths = summary?.paths;
  const [failed, setFailed] = useState(false);
  useMountEffect(() => {
    const controller = new AbortController();
    void projectFilesStatus(token, model.spaceId, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) setSummary(items);
      })
      .catch(() => {
        if (!controller.signal.aborted) setFailed(true);
      });
    return () => controller.abort();
  });
  if (failed)
    return (
      <p role="status">Could not check synced project files. You can still share the video.</p>
    );
  if (!summary || summary.state === "off") return null;
  if (summary.state === "synced")
    return <p role="status">Project files synced. A matching video will include these files.</p>;
  return (
    <div className="grid gap-2 text-step-12 text-text-3">
      <p>
        Sync project files to include them with a matching video. You can also share the video on
        its own.
      </p>
      {paths?.length ? (
        <>
          <p>Referenced hidden assets included in sync</p>
          <ul className="max-h-48 overflow-auto">
            {paths.map((path) => (
              <li key={path} className="whitespace-pre-wrap break-all">
                <bdi>{quotedFilePath(path).slice(1, -1)}</bdi>
              </li>
            ))}
          </ul>
        </>
      ) : null}
      <Button
        variant="secondary"
        disabled={model.busy}
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
    </div>
  );
}
