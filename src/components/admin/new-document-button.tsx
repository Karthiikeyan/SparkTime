"use client";

import { Plus } from "lucide-react";
import { useCallback, useRef, useState } from "react";
import { useCreateDocument } from "./admin-shell";
import { useDismiss } from "@/components/ui/use-dismiss";

export function NewDocumentButton({ types }: { types: Array<{ id: string; name: string }> }) {
  const [open, setOpen] = useState(false);
  const create = useCreateDocument();
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  useDismiss(root, open, close, trigger);
  return (
    <div ref={root} className="relative">
      <button ref={trigger} type="button" className="btn btn-accent btn-md" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open}>
        <Plus size={15} aria-hidden="true" /> New document
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-40 max-h-80 w-56 overflow-y-auto rounded-md border border-line bg-elevated p-1.5 shadow-float">
          {types.map((t) => (
            <button key={t.id} type="button" role="menuitem" onClick={() => { setOpen(false); void create(t.id); }} className="block w-full rounded-sm px-2.5 py-1.5 text-left text-sm hover:bg-surface-2">
              {t.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
