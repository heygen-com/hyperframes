import { cloneElement, createContext, useState, type ReactElement } from "react";
import { Tooltip } from "../../components/ui/Tooltip";

export const ClipPeakDescriptionContext = createContext<((detail: string | null) => void) | null>(
  null,
);

export function ClipPeakTooltip({
  truncatedLabel = null,
  children,
}: {
  truncatedLabel?: string | null;
  children: ReactElement<{ title?: string; "aria-describedby"?: string }>;
}) {
  const [detail, setDetail] = useState<string | null>(null);
  const [triggerOpen, setTriggerOpen] = useState(false);
  const label = detail ?? truncatedLabel;
  const open = label !== null && (triggerOpen || truncatedLabel !== null);

  return (
    <ClipPeakDescriptionContext.Provider value={setDetail}>
      <Tooltip
        label={label ?? ""}
        open={open}
        onOpenChange={setTriggerOpen}
        disabled={label === null}
      >
        {cloneElement(children, { title: label === null ? children.props.title : undefined })}
      </Tooltip>
    </ClipPeakDescriptionContext.Provider>
  );
}
