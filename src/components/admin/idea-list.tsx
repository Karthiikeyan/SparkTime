"use client";

import { ArrowRightLeft, PenLine } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { relativeTime } from "@/lib/dates";
import { api, errorMessage } from "./api";
import { useToast } from "./toast";

type Idea = { id: string; title: string; excerpt: string; typeName: string; typeId: string; createdAt: string };

export function IdeaList({ ideas, types }: { ideas: Idea[]; types: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);

  if (!ideas.length) return <p className="rounded-md border border-dashed border-line-strong p-10 text-center text-muted">No ideas in the backlog. The next one is a sentence away.</p>;

  const convert = async (idea: Idea, typeId: string) => {
    setBusy(idea.id);
    try {
      if (typeId !== idea.typeId) await api(`/api/admin/documents/${idea.id}/actions`, { method: "POST", body: { action: "convert", typeId } });
      else await api(`/api/admin/documents/${idea.id}/actions`, { method: "POST", body: { action: "setStatus", status: "draft" } });
      router.push(`/admin/documents/${idea.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(null);
    }
  };

  return (
    <ul className="divide-y divide-line rounded-md border border-line bg-surface">
      {ideas.map((idea) => (
        <li key={idea.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
          <div className="min-w-0 flex-1">
            <Link href={`/admin/documents/${idea.id}`} className="font-medium hover:text-accent">
              {idea.title || "Untitled idea"}
            </Link>
            {idea.excerpt && <p className="mt-0.5 line-clamp-1 text-sm text-muted">{idea.excerpt}</p>}
            <p className="mt-1 text-xs text-subtle">
              {idea.typeName} · captured {relativeTime(idea.createdAt)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="sr-only" htmlFor={`convert-${idea.id}`}>
              Convert to
            </label>
            <select
              id={`convert-${idea.id}`}
              defaultValue=""
              disabled={busy === idea.id}
              onChange={(e) => e.target.value && void convert(idea, e.target.value)}
              className="rounded-sm border border-line bg-bg px-2 py-1.5 text-sm"
            >
              <option value="">Convert to…</option>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>
            <ArrowRightLeft size={14} className="text-subtle" aria-hidden="true" />
            <Link href={`/admin/documents/${idea.id}`} className="btn btn-ghost btn-sm">
              <PenLine size={13} aria-hidden="true" /> Open
            </Link>
          </div>
        </li>
      ))}
    </ul>
  );
}
