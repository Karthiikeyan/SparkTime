import { cn } from "@/lib/cn";

/** A full-width band in the muted surface: "More free courses", "Keep reading", the Notes on /topics. */
export function Band({ children, className, innerClassName, id, labelledBy }: { children: React.ReactNode; className?: string; innerClassName?: string; id?: string; labelledBy?: string }) {
  return (
    <section id={id} aria-labelledby={labelledBy} className={cn("border-y border-line bg-bg-tint", className)}>
      <div className={cn("container-page py-12 sm:py-16", innerClassName)}>{children}</div>
    </section>
  );
}
