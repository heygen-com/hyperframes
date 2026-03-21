import { memo, type Ref } from "react";
import { Player } from "../../player";

interface NLEPreviewProps {
  projectId: string;
  iframeRef: Ref<HTMLIFrameElement>;
  onIframeLoad: () => void;
  portrait?: boolean;
  directUrl?: string;
  refreshKey?: number;
}

export const NLEPreview = memo(function NLEPreview({
  projectId,
  iframeRef,
  onIframeLoad,
  portrait,
  directUrl,
  refreshKey,
}: NLEPreviewProps) {
  const playerKey = `${directUrl ?? projectId}_${refreshKey ?? 0}`;

  return (
    <div className="flex flex-col h-full min-h-0">
      <div className="flex-1 flex items-center justify-center p-2 overflow-hidden min-h-0">
        <Player
          key={playerKey}
          ref={iframeRef}
          projectId={directUrl ? undefined : projectId}
          directUrl={directUrl}
          onLoad={onIframeLoad}
          portrait={portrait}
        />
      </div>
    </div>
  );
});
