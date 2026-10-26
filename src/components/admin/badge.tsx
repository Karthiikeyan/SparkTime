import { cn } from "@/lib/cn";

/** Server-safe (no hooks): usable from both server pages and client components. */
export type BadgeTone = "neutral" | "accent" | "success" | "warning" | "danger" | "info";

const TONES: Record<BadgeTone, string> = {
  neutral: "bg-surface-2 text-muted",
  accent: "bg-accent-soft text-accent",
  success: "bg-success/12 text-success",
  warning: "bg-warning/12 text-warning",
  danger: "bg-danger/12 text-danger",
  info: "bg-info/12 text-info",
};

export function Badge({ children, tone = "neutral" }: { children: React.ReactNode; tone?: BadgeTone }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-xs px-1.5 py-0.5 font-mono text-[10px] font-medium uppercase tracking-wider", TONES[tone])}>{children}</span>;
}

export function statusTone(status: string): BadgeTone {
  return status === "published" ? "success" : status === "idea" ? "accent" : status === "scheduled" ? "info" : status === "archived" ? "neutral" : "warning";
}
