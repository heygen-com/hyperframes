import type { RefObject } from "react";
import { useMountEffect } from "../../hooks/useMountEffect";

export function useTimelineShiftModifier(container: RefObject<HTMLElement | null>): void {
  useMountEffect(() => {
    const hold = (held: boolean) => container.current?.toggleAttribute("data-shift-held", held);
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Shift") hold(event.type === "keydown");
    };
    const handleBlur = () => hold(false);
    window.addEventListener("keydown", handleKey);
    window.addEventListener("keyup", handleKey);
    window.addEventListener("blur", handleBlur);
    return () => {
      window.removeEventListener("keydown", handleKey);
      window.removeEventListener("keyup", handleKey);
      window.removeEventListener("blur", handleBlur);
    };
  });
}
