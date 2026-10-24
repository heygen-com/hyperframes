import { cloneElement, createContext, useState, type ReactElement } from "react";
import { Tooltip } from "../../components/ui/Tooltip";

export const ClipPeakDescriptionContext = createContext<((detail: string | null) => void) | null>(
  null,
);

export function ClipPeakTooltip({
  children,
  overflowLabel,
}: {
  children: ReactElement<{ title?: string; "aria-describedby"?: string }>;
  overflowLabel?: string;
}) {
  const [detail, setDetail] = useState<string | null>(null);
  const label = detail ?? overflowLabel ?? "";
  const show = detail !== null || overflowLabel !== undefined;
  return (
    <ClipPeakDescriptionContext.Provider value={setDetail}>
      <Tooltip label={label} disabled={!show}>
        {cloneElement(children, { title: show ? undefined : children.props.title })}
      </Tooltip>
    </ClipPeakDescriptionContext.Provider>
  );
}
