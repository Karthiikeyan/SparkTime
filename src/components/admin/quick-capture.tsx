"use client";

import { Lightbulb, Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, errorMessage } from "./api";
import { inputBase, inputClass } from "./styles";
import { useToast } from "./toast";

const rowSize = "h-9 px-3 text-sm";

/** Capture an idea in seconds: title + a thought + tags. Becomes a full document later. */
export function QuickCapture({ types, defaultTypeId }: { types: Array<{ id: string; name: string }>; defaultTypeId: string }) {
  const router = useRouter();
  const toast = useToast();
  const [title, setTitle] = useState("");
  const [thought, setThought] = useState("");
  const [tags, setTags] = useState("");
  const [typeId, setTypeId] = useState(defaultTypeId);
  const [busy, setBusy] = useState(false);

  return (
    <form
      className="rounded-md border border-line bg-surface p-4"
      onSubmit={async (e) => {
        e.preventDefault();
        if (!title.trim()) return;
        setBusy(true);
        try {
          await api("/api/admin/documents", {
            method: "POST",
            body: { typeId, title: title.trim(), status: "idea", thought, tagNames: tags.split(",").map((t) => t.trim()).filter(Boolean) },
          });
          setTitle("");
          setThought("");
          setTags("");
          toast.success("Idea captured.");
          router.refresh();
        } catch (err) {
          toast.error(errorMessage(err));
        } finally {
          setBusy(false);
        }
      }}
    >
      <p className="flex items-center gap-2 text-sm font-semibold">
        <Lightbulb size={15} className="text-accent" aria-hidden="true" /> Capture an idea
      </p>
      <label htmlFor="qc-title" className="sr-only">
        Idea title
      </label>
      <input id="qc-title" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="What's the idea?" className={`${inputBase} mt-3 w-full px-3 py-2 text-base`} maxLength={300} />
      <label htmlFor="qc-thought" className="sr-only">
        Short thought
      </label>
      <textarea id="qc-thought" value={thought} onChange={(e) => setThought(e.target.value)} placeholder="A short thought, a link, a spark… (optional)" rows={2} className={`${inputClass} mt-2`} />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label htmlFor="qc-tags" className="sr-only">
          Tags
        </label>
        <input id="qc-tags" value={tags} onChange={(e) => setTags(e.target.value)} placeholder="tags, comma, separated" className={`${inputBase} ${rowSize} min-w-40 flex-1`} />
        <label htmlFor="qc-type" className="sr-only">
          Eventually a
        </label>
        <select id="qc-type" value={typeId} onChange={(e) => setTypeId(e.target.value)} className={`${inputBase} ${rowSize}`}>
          {types.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
        <button type="submit" className="btn btn-primary btn-md" disabled={busy || !title.trim()}>
          {busy && <Loader2 size={14} className="animate-spin" aria-hidden="true" />} Capture
        </button>
      </div>
    </form>
  );
}
