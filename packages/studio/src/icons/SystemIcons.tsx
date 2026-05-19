import {
  Check as PhCheck,
  Clock as PhClock,
  Eye as PhEye,
  FilmStrip,
  Stack,
  ChatCenteredText,
  ArrowsOutCardinal,
  MusicNote,
  Palette as PhPalette,
  Plus as PhPlus,
  Square as PhSquare,
  TextT,
  X as PhX,
  Lightning,
  CaretDown,
  CaretRight,
  ClipboardText,
  ArrowCounterClockwise,
  Camera as PhCamera,
  ArrowClockwise,
  Gear,
} from "@phosphor-icons/react";
import type { Icon as PhosphorIcon, IconProps as PhosphorIconProps } from "@phosphor-icons/react";

type IconProps = PhosphorIconProps & { title?: string };

const makeIcon = (Icon: PhosphorIcon) => {
  const Wrapped = ({ title, ...props }: IconProps) => (
    <Icon alt={title} aria-label={title} aria-hidden={title ? undefined : true} {...props} />
  );
  return Wrapped;
};

// Lucide name → Phosphor equivalent
export const Check = makeIcon(PhCheck);
export const Clock = makeIcon(PhClock);
export const Eye = makeIcon(PhEye);
export const Film = makeIcon(FilmStrip);
export const Layers = makeIcon(Stack);
export const MessageSquare = makeIcon(ChatCenteredText);
export const Move = makeIcon(ArrowsOutCardinal);
export const Music = makeIcon(MusicNote);
export const Palette = makeIcon(PhPalette);
export const Plus = makeIcon(PhPlus);
export const Square = makeIcon(PhSquare);
export const Type = makeIcon(TextT);
export const X = makeIcon(PhX);
export const Zap = makeIcon(Lightning);
// Extra icons used in this project (not in lucide's default mapping above)
export const ChevronDown = makeIcon(CaretDown);
export const ChevronRight = makeIcon(CaretRight);
export const ClipboardList = makeIcon(ClipboardText);
export const RotateCcw = makeIcon(ArrowCounterClockwise);
export const Camera = makeIcon(PhCamera);
export const RotateCw = makeIcon(ArrowClockwise);
export const Settings = makeIcon(Gear);
