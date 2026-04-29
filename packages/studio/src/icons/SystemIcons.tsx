import {
  WarningCircle,
  Warning,
  ArrowLeft as PhArrowLeft,
  Check as PhCheck,
  CheckCircle as PhCheckCircle,
  Circle as PhCircle,
  Clock as PhClock,
  Code as PhCode,
  DownloadSimple,
  Pencil as PhPencil,
  ArrowSquareOut,
  Eye as PhEye,
  EyeClosed,
  File as PhFile,
  FileCode as PhFileCode,
  FileText as PhFileText,
  FilmStrip,
  Heart as PhHeart,
  Image as PhImage,
  Info as PhInfo,
  Stack,
  SpinnerGap,
  ArrowsOut,
  CornersOut,
  ChatCircle,
  ChatCenteredText,
  Cursor,
  ArrowsOutCardinal,
  MusicNote,
  Palette as PhPalette,
  Paperclip as PhPaperclip,
  Pause as PhPause,
  Play as PhPlay,
  Plus as PhPlus,
  MagnifyingGlass,
  PaperPlaneRight,
  SkipBack as PhSkipBack,
  SkipForward as PhSkipForward,
  Square as PhSquare,
  Trash,
  TextT,
  UploadSimple,
  User as PhUser,
  UsersThree,
  VideoCamera,
  X as PhX,
  Lightning,
  MagnifyingGlassPlus,
  MagnifyingGlassMinus,
  Terminal as PhTerminal,
  CaretDown,
  CaretRight,
  ClipboardText,
  ArrowCounterClockwise,
  Camera as PhCamera,
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
export const AlertCircle = makeIcon(WarningCircle);
export const AlertTriangle = makeIcon(Warning);
export const ArrowLeft = makeIcon(PhArrowLeft);
export const Check = makeIcon(PhCheck);
export const CheckCircle = makeIcon(PhCheckCircle);
/** CheckCircle2 in lucide is visually identical to CheckCircle */
export const CheckCircle2 = makeIcon(PhCheckCircle);
export const Circle = makeIcon(PhCircle);
export const Clock = makeIcon(PhClock);
export const Code = makeIcon(PhCode);
export const Download = makeIcon(DownloadSimple);
export const Edit2 = makeIcon(PhPencil);
export const ExternalLink = makeIcon(ArrowSquareOut);
export const Eye = makeIcon(PhEye);
export const EyeOff = makeIcon(EyeClosed);
export const File = makeIcon(PhFile);
export const FileCode = makeIcon(PhFileCode);
// FileIcon alias (lucide exports both `File` and `FileIcon`)
export const FileIcon = makeIcon(PhFile);
export const FileText = makeIcon(PhFileText);
export const Film = makeIcon(FilmStrip);
export const Heart = makeIcon(PhHeart);
export const Image = makeIcon(PhImage);
export const Info = makeIcon(PhInfo);
export const Layers = makeIcon(Stack);
export const Loader2 = makeIcon(SpinnerGap);
export const Maximize = makeIcon(ArrowsOut);
export const Maximize2 = makeIcon(CornersOut);
export const MessageCircle = makeIcon(ChatCircle);
export const MessageSquare = makeIcon(ChatCenteredText);
export const MousePointer = makeIcon(Cursor);
export const Move = makeIcon(ArrowsOutCardinal);
export const Music = makeIcon(MusicNote);
export const Palette = makeIcon(PhPalette);
export const Paperclip = makeIcon(PhPaperclip);
export const Pause = makeIcon(PhPause);
export const Pencil = makeIcon(PhPencil);
export const Play = makeIcon(PhPlay);
export const Plus = makeIcon(PhPlus);
export const Search = makeIcon(MagnifyingGlass);
export const Send = makeIcon(PaperPlaneRight);
export const SkipBack = makeIcon(PhSkipBack);
export const SkipForward = makeIcon(PhSkipForward);
export const Square = makeIcon(PhSquare);
export const Trash2 = makeIcon(Trash);
export const Type = makeIcon(TextT);
export const Upload = makeIcon(UploadSimple);
export const User = makeIcon(PhUser);
export const Users = makeIcon(UsersThree);
export const Video = makeIcon(VideoCamera);
export const X = makeIcon(PhX);
export const Zap = makeIcon(Lightning);
export const ZoomIn = makeIcon(MagnifyingGlassPlus);
export const ZoomOut = makeIcon(MagnifyingGlassMinus);
// Extra icons used in this project (not in lucide's default mapping above)
export const Terminal = makeIcon(PhTerminal);
export const ChevronDown = makeIcon(CaretDown);
export const ChevronRight = makeIcon(CaretRight);
export const ClipboardList = makeIcon(ClipboardText);
export const RotateCcw = makeIcon(ArrowCounterClockwise);
export const Camera = makeIcon(PhCamera);
export const Settings = makeIcon(Gear);
