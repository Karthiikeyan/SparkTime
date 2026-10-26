import { cn } from "@/lib/cn";

/** Nothing here yet, said kindly: a dashed box with a serif line and a way on. */
export function EmptyState({ title, children, className, align = "center" }: { title: React.ReactNode; children?: React.ReactNode; className?: string; align?: "center" | "start" }) {
  return (
    <div className={cn("rounded-lg border-[1.5px] border-dashed border-line-field px-6 py-10 sm:px-8 sm:py-12", align === "center" && "text-center", className)}>
      <p className="font-serif text-[1.5rem] font-medium leading-tight sm:text-[1.625rem]">{title}</p>
      {children && <div className={cn("mt-3 max-w-xl text-ink-2", align === "center" && "mx-auto")}>{children}</div>}
    </div>
  );
}
