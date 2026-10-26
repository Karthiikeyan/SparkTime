import { AlertTriangle, Info, Lightbulb } from "lucide-react";
import { cn } from "@/lib/cn";

const ICONS = { info: Info, tip: Lightbulb, warning: AlertTriangle } as const;

/**
 * A note in the text: green with an info icon, or the warm tint with a warning
 * icon for what matters (Important, Warning). The label is the name assistive
 * technology announces.
 */
export function Callout({ tone = "note", icon, label, children, className }: { tone?: "note" | "warn"; icon?: keyof typeof ICONS; label: string; children: React.ReactNode; className?: string }) {
  const Icon = ICONS[icon ?? (tone === "warn" ? "warning" : "info")];
  return (
    <aside role="note" aria-label={label} className={cn("callout flex gap-3.5 rounded-xl px-4 py-3.5 font-sans text-base leading-relaxed text-ink sm:px-[22px] sm:py-[18px]", tone === "warn" ? "bg-warn-tint" : "bg-accent-soft", className)}>
      <Icon size={20} strokeWidth={2} aria-hidden="true" className={cn("mt-[3px] shrink-0", tone === "warn" ? "text-warn-text" : "text-accent-ink")} />
      <div className="min-w-0">{children}</div>
    </aside>
  );
}
