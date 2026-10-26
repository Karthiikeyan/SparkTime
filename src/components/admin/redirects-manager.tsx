"use client";

import { Trash2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { relativeTime } from "@/lib/dates";
import { api, errorMessage } from "./api";
import { Badge, inputClass } from "./fields";
import { useToast } from "./toast";

type Row = { id: string; fromPath: string; toPath: string; matchType: string; statusCode: number; source: string; hits: number; lastHitAt: string | null };

export function RedirectsManager({ rows }: { rows: Row[] }) {
  const router = useRouter();
  const toast = useToast();
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  return (
    <div className="max-w-5xl space-y-6 px-6 py-8 lg:px-10">
      <form
        className="flex flex-wrap items-end gap-2 rounded-md border border-line bg-surface p-4"
        onSubmit={async (e) => {
          e.preventDefault();
          try {
            await api("/api/admin/redirects", { method: "POST", body: { fromPath: from, toPath: to } });
            setFrom("");
            setTo("");
            toast.success("Redirect added.");
            router.refresh();
          } catch (err) {
            toast.error(errorMessage(err));
          }
        }}
      >
        <label className="flex-1 text-xs text-muted">
          From (old path)
          <input value={from} onChange={(e) => setFrom(e.target.value)} placeholder="/old-page" className={`${inputClass} mt-1 font-mono`} />
        </label>
        <label className="flex-1 text-xs text-muted">
          To (site path)
          <input value={to} onChange={(e) => setTo(e.target.value)} placeholder="/article/new-page" className={`${inputClass} mt-1 font-mono`} />
        </label>
        <button type="submit" className="btn btn-primary btn-md" disabled={!from || !to}>
          Add permanent redirect
        </button>
      </form>
      <p className="text-sm text-muted">Slug and type renames create redirects automatically. Only same-site destinations are allowed, and chains are flattened.</p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs uppercase tracking-wider text-subtle">
              <th scope="col" className="py-2 font-medium">From</th>
              <th scope="col" className="py-2 font-medium">To</th>
              <th scope="col" className="py-2 font-medium">Source</th>
              <th scope="col" className="py-2 text-right font-medium">Hits</th>
              <th scope="col" className="py-2" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={5} className="py-10 text-center text-muted">
                  No redirects yet.
                </td>
              </tr>
            )}
            {rows.map((r) => (
              <tr key={r.id} className="border-b border-line/70">
                <td className="py-2 pr-3 font-mono text-xs">
                  {r.fromPath}
                  {r.matchType === "prefix" && "/*"}
                </td>
                <td className="py-2 pr-3 font-mono text-xs">
                  {r.toPath}
                  {r.matchType === "prefix" && "/*"}
                </td>
                <td className="py-2 pr-3">
                  <Badge>{r.source}</Badge> <span className="text-xs text-subtle">{r.statusCode}</span>
                </td>
                <td className="py-2 pr-3 text-right text-xs text-muted">
                  {r.hits}
                  {r.lastHitAt && <span className="block text-subtle">{relativeTime(r.lastHitAt)}</span>}
                </td>
                <td className="py-2 text-right">
                  <button
                    type="button"
                    aria-label={`Delete redirect from ${r.fromPath}`}
                    className="p-1 text-subtle hover:text-danger"
                    onClick={async () => {
                      try {
                        await api(`/api/admin/redirects/${r.id}`, { method: "DELETE" });
                        router.refresh();
                      } catch (err) {
                        toast.error(errorMessage(err));
                      }
                    }}
                  >
                    <Trash2 size={14} aria-hidden="true" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
