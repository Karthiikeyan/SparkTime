"use client";

import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import { useState } from "react";
import { cn } from "@/lib/cn";
import type { FieldDefinition } from "@/lib/content/model";
import { DIFFICULTIES, DIFFICULTY_LABELS, readGuide, roundId, type GuideQuestion, type GuideRound, type InterviewGuide } from "@/lib/interviews/guide";
import { inputBase, inputClass } from "../styles";

function newId(prefix: string, taken: Set<string>): string {
  for (;;) {
    const id = `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    if (!taken.has(id)) return id;
  }
}

/** Lists edited as one item per line; blank lines are dropped when saved. */
const toLines = (list: string[]) => list.join("\n");
const fromLines = (text: string) => text.split("\n");

const iconButton = "inline-flex size-7 items-center justify-center rounded-xs text-muted hover:bg-surface-2 disabled:opacity-30";
const smallInput = cn(inputBase, "px-2 py-1 text-xs");

function Move({ label, index, length, onMove, onRemove }: { label: string; index: number; length: number; onMove: (by: -1 | 1) => void; onRemove: () => void }) {
  return (
    <div className="flex shrink-0 gap-0.5">
      <button type="button" aria-label={`Move ${label} up`} disabled={index === 0} onClick={() => onMove(-1)} className={iconButton}>
        <ArrowUp size={14} aria-hidden="true" />
      </button>
      <button type="button" aria-label={`Move ${label} down`} disabled={index === length - 1} onClick={() => onMove(1)} className={iconButton}>
        <ArrowDown size={14} aria-hidden="true" />
      </button>
      <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} className={cn(iconButton, "hover:text-danger")}>
        <Trash2 size={14} aria-hidden="true" />
      </button>
    </div>
  );
}

function moved<T>(list: T[], index: number, by: -1 | 1): T[] {
  const target = index + by;
  if (target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target]!, next[index]!];
  return next;
}

/**
 * An interview page's guide, edited below the body: the counts, highlights,
 * preparation and official sources, and — on a role's page — its rounds with
 * their summaries and questions. Changes go through the normal autosave, so a
 * published page stages them like any other edit.
 */
export function GuideEditor({ field, value, hasRole, onChange, error }: { field: FieldDefinition; value: unknown; hasRole: boolean; onChange: (next: InterviewGuide) => void; error?: string }) {
  const guide = readGuide(value);
  const [onlyReview, setOnlyReview] = useState(false);
  const choices = field.options.choices ?? [];
  const pending = guide.rounds.reduce((n, r) => n + r.questions.filter((q) => q.review).length, 0);
  const total = guide.rounds.reduce((n, r) => n + r.questions.length, 0);
  const set = (patch: Partial<InterviewGuide>) => onChange({ ...guide, ...patch });
  const setRound = (index: number, patch: Partial<GuideRound>) => set({ rounds: guide.rounds.map((r, i) => (i === index ? { ...r, ...patch } : r)) });
  const setQuestion = (r: number, q: number, patch: Partial<GuideQuestion>) => setRound(r, { questions: guide.rounds[r]!.questions.map((x, i) => (i === q ? { ...x, ...patch } : x)) });

  return (
    <section aria-labelledby="guide-heading" className="mt-12 border-t border-line pt-8">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="guide-heading" className="text-sm font-medium">
          {field.label}
          {hasRole && <span className="text-muted"> · {guide.rounds.length} rounds · {total} questions</span>}
          {pending > 0 && <span className="text-warning"> · {pending} held back until reviewed</span>}
        </h2>
        {pending > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <label className="flex items-center gap-1.5 text-xs text-muted">
              <input type="checkbox" checked={onlyReview} onChange={(e) => setOnlyReview(e.target.checked)} /> Only questions needing review
            </label>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ rounds: guide.rounds.map((r) => ({ ...r, questions: r.questions.map((q) => ({ ...q, review: false })) })) })}>
              Mark all reviewed
            </button>
          </div>
        )}
      </div>
      <p className="mt-1 text-xs text-subtle">
        {hasRole
          ? "Everything here except Official is candidate-reported. Only questions candidates explicitly reported, in the round they reported them. A question marked “Needs review” stays off the public page (and out of counts, search and Copy for AI) until you clear the flag; it never blocks publishing."
          : "This is the company’s own page (no role): it shows the official sources and highlights below, and lists the company’s published role pages."}
      </p>
      {error && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {error}
        </p>
      )}

      <div className="mt-4 grid gap-3 sm:grid-cols-3">
        <label className="text-xs text-muted">
          Candidate accounts
          <input type="number" min={0} max={9999} value={guide.accounts} onChange={(e) => set({ accounts: Math.max(0, Math.min(9999, Math.trunc(Number(e.target.value) || 0))) })} className={cn(inputClass, "mt-1")} />
        </label>
        <label className="text-xs text-muted">
          Years covered
          <input value={guide.period} maxLength={40} placeholder="2021–2026" onChange={(e) => set({ period: e.target.value })} className={cn(inputClass, "mt-1")} />
        </label>
        <label className="text-xs text-muted">
          Researched
          <input type="date" value={guide.researched} onChange={(e) => set({ researched: e.target.value })} className={cn(inputClass, "mt-1")} />
        </label>
      </div>

      <div className={cn("mt-4 grid gap-3", hasRole && "sm:grid-cols-2")}>
        <label className="text-xs text-muted">
          Highlights (one per line; patterns across the accounts)
          <textarea rows={4} value={toLines(guide.highlights)} onChange={(e) => set({ highlights: fromLines(e.target.value) })} className={cn(inputClass, "mt-1 resize-y")} />
        </label>
        {hasRole && (
          <label className="text-xs text-muted">
            Preparation candidates name (one per line)
            <textarea rows={4} value={toLines(guide.preparation)} onChange={(e) => set({ preparation: fromLines(e.target.value) })} className={cn(inputClass, "mt-1 resize-y")} />
          </label>
        )}
      </div>

      <fieldset className="mt-6">
        <legend className="text-xs font-medium">Official sources (what the company itself publishes)</legend>
        <ul className="mt-2 space-y-3">
          {guide.official.map((o, i) => (
            <li key={i} className="rounded-md border border-line p-3">
              <div className="flex gap-2">
                <div className="grid min-w-0 flex-1 gap-2 sm:grid-cols-2">
                  <input aria-label={`Official source ${i + 1} title`} value={o.title} placeholder="Amazon: SDE II interview prep" onChange={(e) => set({ official: guide.official.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })} className={smallInput} />
                  <input aria-label={`Official source ${i + 1} link`} type="url" value={o.url} placeholder="https://…" onChange={(e) => set({ official: guide.official.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)) })} className={cn(smallInput, "font-mono")} />
                </div>
                <Move label={`official source ${i + 1}`} index={i} length={guide.official.length} onMove={(by) => set({ official: moved(guide.official, i, by) })} onRemove={() => set({ official: guide.official.filter((_, j) => j !== i) })} />
              </div>
              <textarea aria-label={`Official source ${i + 1} points`} rows={3} value={toLines(o.points)} placeholder="What the page says, one point per line" onChange={(e) => set({ official: guide.official.map((x, j) => (j === i ? { ...x, points: fromLines(e.target.value) } : x)) })} className={cn(inputClass, "mt-2 resize-y text-xs")} />
            </li>
          ))}
        </ul>
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => set({ official: [...guide.official, { title: "", url: "", points: [] }] })}>
          <Plus size={13} aria-hidden="true" /> Add official source
        </button>
      </fieldset>

      {hasRole && guide.sequences.length > 0 && (
        <details className="mt-6">
          <summary className="cursor-pointer text-xs font-medium">Reported sequences ({guide.sequences.length}) — from the research</summary>
          <ul className="mt-2 space-y-1 text-xs text-muted">
            {guide.sequences.map((s, i) => (
              <li key={i} className="flex items-start justify-between gap-2">
                <span>
                  {s.steps.join(" → ")} <span className="text-subtle">· {s.reports}</span>
                </span>
                <button type="button" aria-label={`Remove sequence ${i + 1}`} onClick={() => set({ sequences: guide.sequences.filter((_, j) => j !== i) })} className={cn(iconButton, "hover:text-danger")}>
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      {hasRole && (
        <div className="mt-8 space-y-6">
          <h3 className="text-xs font-medium">Rounds, in the order candidates usually meet them</h3>
          {guide.rounds.map((round, r) => {
            const visible = round.questions.map((q, i) => ({ q, i })).filter(({ q }) => !onlyReview || q.review);
            if (onlyReview && !visible.length) return null;
            return (
              <article key={r} className="rounded-md border border-line p-4">
                <div className="flex flex-wrap items-start gap-2">
                  <input
                    aria-label={`Round ${r + 1} name`}
                    value={round.name}
                    maxLength={80}
                    onChange={(e) => setRound(r, { name: e.target.value, id: roundId(e.target.value) || `round-${r + 1}` })}
                    className={cn(inputBase, "min-w-48 flex-1 px-2 py-1.5 text-sm font-medium")}
                  />
                  <label className="flex items-center gap-1 text-xs text-muted">
                    Accounts
                    <input type="number" min={0} max={9999} value={round.reports} onChange={(e) => setRound(r, { reports: Math.max(0, Math.min(9999, Math.trunc(Number(e.target.value) || 0))) })} className={cn(smallInput, "w-16")} />
                  </label>
                  <Move label={`round ${round.name || r + 1}`} index={r} length={guide.rounds.length} onMove={(by) => set({ rounds: moved(guide.rounds, r, by) })} onRemove={() => set({ rounds: guide.rounds.filter((_, j) => j !== r) })} />
                </div>
                <textarea
                  aria-label={`${round.name || `Round ${r + 1}`} summary`}
                  rows={3}
                  maxLength={1500}
                  value={round.summary}
                  placeholder="What candidates describe about this round: format, length, focus."
                  onChange={(e) => setRound(r, { summary: e.target.value })}
                  className={cn(inputClass, "mt-2 resize-y")}
                />
                <ol className="mt-3 space-y-2">
                  {visible.map(({ q, i }) => (
                    <li key={q.id} className={cn("rounded-md border p-2.5", q.review ? "border-warning/50 bg-warning/5" : "border-line")}>
                      <div className="flex gap-2">
                        <span className="mt-2 w-6 shrink-0 text-right font-mono text-xs text-subtle">{i + 1}.</span>
                        <textarea aria-label={`${round.name} question ${i + 1}`} value={q.text} rows={2} maxLength={500} onChange={(e) => setQuestion(r, i, { text: e.target.value })} className={cn(inputClass, "resize-y")} placeholder="The question as the candidate reported it" />
                        <Move
                          label={`${round.name} question ${i + 1}`}
                          index={i}
                          length={round.questions.length}
                          onMove={(by) => setRound(r, { questions: moved(round.questions, i, by) })}
                          onRemove={() => setRound(r, { questions: round.questions.filter((_, j) => j !== i) })}
                        />
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2 pl-8 text-xs">
                        <select aria-label={`${round.name} question ${i + 1} category`} value={q.category} onChange={(e) => setQuestion(r, i, { category: e.target.value })} className={smallInput}>
                          {!choices.some((c) => c.value === q.category) && <option value={q.category}>{q.category} (not a category)</option>}
                          {choices.map((c) => (
                            <option key={c.value} value={c.value}>
                              {c.label}
                            </option>
                          ))}
                        </select>
                        <select aria-label={`${round.name} question ${i + 1} difficulty`} value={q.difficulty ?? ""} onChange={(e) => setQuestion(r, i, { difficulty: (e.target.value || null) as GuideQuestion["difficulty"] })} className={smallInput}>
                          <option value="">Difficulty: not stated</option>
                          {DIFFICULTIES.map((d) => (
                            <option key={d} value={d}>
                              {DIFFICULTY_LABELS[d]}
                            </option>
                          ))}
                        </select>
                        <input aria-label={`${round.name} question ${i + 1} practice link`} type="url" value={q.practiceUrl ?? ""} placeholder="Practice link the candidate gave (https://leetcode.com/problems/…)" onChange={(e) => setQuestion(r, i, { practiceUrl: e.target.value.trim() || null })} className={cn(smallInput, "min-w-56 flex-1 font-mono")} />
                        <label className="flex items-center gap-1 text-muted" title="Independent candidate accounts that reported it in this round. Shown publicly from 2.">
                          Reports
                          <input type="number" min={0} max={9999} value={q.reports} onChange={(e) => setQuestion(r, i, { reports: Math.max(0, Math.min(9999, Math.trunc(Number(e.target.value) || 0))) })} className={cn(smallInput, "w-14")} />
                        </label>
                        <label className="flex items-center gap-1.5">
                          <input type="checkbox" checked={q.review} onChange={(e) => setQuestion(r, i, { review: e.target.checked })} /> Needs review
                        </label>
                        {q.review && <span className="text-warning">Not shown publicly until reviewed</span>}
                      </div>
                    </li>
                  ))}
                </ol>
                {!onlyReview && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm mt-2"
                    onClick={() => setRound(r, { questions: [...round.questions, { id: newId("q-", new Set(round.questions.map((q) => q.id))), text: "", category: choices[0]?.value ?? "other", difficulty: null, practiceUrl: null, reports: 0, review: false }] })}
                  >
                    <Plus size={13} aria-hidden="true" /> Add question
                  </button>
                )}
              </article>
            );
          })}
          {!onlyReview && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => set({ rounds: [...guide.rounds, { id: `round-${guide.rounds.length + 1}`, name: `Round ${guide.rounds.length + 1}`, reports: 0, summary: "", questions: [] }] })}>
              <Plus size={13} aria-hidden="true" /> Add round
            </button>
          )}
          {guide.rounds.length === 0 && <p className="text-sm text-muted">No rounds yet. Import the company’s research (Studio → Import) or add them by hand.</p>}
        </div>
      )}
    </section>
  );
}
