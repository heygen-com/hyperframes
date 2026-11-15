import { useStudioShellContext } from "../../contexts/StudioContext";
import { copyTextToClipboard } from "../../utils/clipboard";
import { trackStudioEvent } from "../../utils/studioTelemetry";
import { Button } from "../ui";

export const APPROVE_WORDS = "The storyboard is approved. Build the video from it.";

/** Studio talks to the person's own agent through their chat: Approve copies the go for them to paste there. */
export function ApproveBoardButton() {
  const { showToast } = useStudioShellContext();
  const approve = async () => {
    const copied = await copyTextToClipboard(APPROVE_WORDS);
    trackStudioEvent("storyboard_action", {
      action: copied ? "approve_copied" : "approve_copy_failed",
    });
    showToast(
      copied
        ? "Copied. Paste it to your agent to start the build."
        : `Couldn't copy. Tell your agent: "${APPROVE_WORDS}"`,
      "info",
    );
  };
  return (
    <Button
      variant="primary"
      size="sm"
      onClick={() => void approve()}
      data-testid="storyboard-approve"
    >
      Approve
    </Button>
  );
}
