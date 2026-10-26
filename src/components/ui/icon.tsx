import {
  BookOpen,
  Briefcase,
  Code2,
  Compass,
  FileText,
  FlaskConical,
  GraduationCap,
  Layers,
  Link2,
  Map,
  Mic,
  NotebookPen,
  PenLine,
  Sparkles,
  Star,
  Video,
  type LucideIcon,
} from "lucide-react";
import type { IconName } from "@/lib/content/model";

/** Content-type icons come from this fixed map — never from stored markup. */
const CONTENT_ICONS: Record<IconName, LucideIcon> = {
  file: FileText,
  pen: PenLine,
  note: NotebookPen,
  code: Code2,
  video: Video,
  mic: Mic,
  book: BookOpen,
  graduation: GraduationCap,
  flask: FlaskConical,
  compass: Compass,
  layers: Layers,
  sparkle: Sparkles,
  link: Link2,
  map: Map,
  star: Star,
  briefcase: Briefcase,
};

export function ContentIcon({ name, className, size = 16 }: { name: IconName | string; className?: string; size?: number }) {
  const Icon = CONTENT_ICONS[name as IconName] ?? FileText;
  return <Icon className={className} size={size} strokeWidth={1.6} aria-hidden="true" />;
}
