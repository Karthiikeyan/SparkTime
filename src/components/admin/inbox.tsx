"use client";

import { Archive, Mail, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { cn } from "@/lib/cn";
import { formatDate } from "@/lib/dates";
import { api, errorMessage } from "./api";
import { Badge } from "./fields";
import { useToast } from "./toast";

type Message = { id: string; name: string; email: string; reason: string; message: string; createdAt: string; read: boolean; archived: boolean };

/** Messages are rendered as plain text by React — hostile markup stays inert. */
export function InboxView({ messages, archived }: { messages: Message[]; archived: boolean }) {
  const router = useRouter();
  const toast = useToast();
  const [openId, setOpenId] = useState<string | null>(messages[0]?.id ?? null);
  const open = messages.find((m) => m.id === openId) ?? null;

  const patch = async (id: string, body: { read?: boolean; archived?: boolean }) => {
    try {
      await api(`/api/admin/messages/${id}`, { method: "PATCH", body });
      router.refresh();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="grid gap-6 px-6 py-6 lg:grid-cols-[22rem_1fr] lg:px-10">
      <div>
        <div className="mb-3 flex gap-2 text-sm">
          <Link href="/admin/inbox" className={cn("rounded-sm px-2.5 py-1", !archived ? "bg-ink text-bg" : "text-muted hover:bg-surface-2")}>
            Inbox
          </Link>
          <Link href="/admin/inbox?archived=1" className={cn("rounded-sm px-2.5 py-1", archived ? "bg-ink text-bg" : "text-muted hover:bg-surface-2")}>
            Archived
          </Link>
        </div>
        {messages.length === 0 ? (
          <p className="rounded-md border border-dashed border-line-strong p-8 text-center text-sm text-muted">No messages.</p>
        ) : (
          <ul className="divide-y divide-line rounded-md border border-line bg-surface">
            {messages.map((m) => (
              <li key={m.id}>
                <button
                  type="button"
                  onClick={() => {
                    setOpenId(m.id);
                    if (!m.read) void patch(m.id, { read: true });
                  }}
                  aria-current={openId === m.id}
                  className={cn("block w-full px-4 py-3 text-left hover:bg-surface-2", openId === m.id && "bg-surface-2")}
                >
                  <span className="flex items-center gap-2">
                    {!m.read && <span className="size-2 rounded-full bg-accent" aria-label="Unread" />}
                    <span className={cn("truncate", !m.read && "font-semibold")}>{m.name}</span>
                    <span className="ml-auto shrink-0 text-xs text-subtle">{formatDate(m.createdAt, "medium")}</span>
                  </span>
                  <span className="mt-0.5 block truncate text-sm text-muted">{m.message}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {open && (
        <article className="rounded-md border border-line bg-surface p-6" aria-label={`Message from ${open.name}`}>
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-lg font-semibold">{open.name}</h2>
              <p className="text-sm text-muted">
                {open.email} · {formatDate(open.createdAt, "dateTime")}
              </p>
            </div>
            {open.reason && <Badge tone="accent">{open.reason}</Badge>}
          </div>
          <p className="mt-6 whitespace-pre-wrap break-words leading-relaxed">{open.message}</p>
          <div className="mt-8 flex flex-wrap gap-2">
            <a href={`mailto:${encodeURIComponent(open.email)}?subject=${encodeURIComponent("Re: your message")}`} className="btn btn-primary btn-md">
              <Mail size={14} aria-hidden="true" /> Reply by email
            </a>
            <button type="button" className="btn btn-ghost btn-md" onClick={() => void patch(open.id, { archived: !open.archived })}>
              <Archive size={14} aria-hidden="true" /> {open.archived ? "Unarchive" : "Archive"}
            </button>
            <button
              type="button"
              className="btn btn-md border border-danger/40 text-danger hover:bg-danger/10"
              onClick={async () => {
                if (!confirm(`Delete the message from ${open.name} permanently? Archive it instead to keep a copy.`)) return;
                try {
                  await api(`/api/admin/messages/${open.id}`, { method: "DELETE" });
                  setOpenId(null);
                  router.refresh();
                } catch (e) {
                  toast.error(errorMessage(e));
                }
              }}
            >
              <Trash2 size={14} aria-hidden="true" /> Delete
            </button>
          </div>
        </article>
      )}
    </div>
  );
}
