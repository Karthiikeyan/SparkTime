"use client";

import { ArrowUpRight, Search } from "lucide-react";
import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { Pill } from "@/components/ui/pill";
import { trackInterviewCopy } from "@/lib/analytics";
import { cn } from "@/lib/cn";
import { copyCount, formatForAI, formatList, type CopyRound } from "@/lib/interviews/copy";
import { questionTone } from "@/lib/interviews/display";

export type PracticeQuestion = { id: string; text: string; category: string; categoryLabel: string; difficulty: string | null; practiceUrl: string | null; practiceHost: string; reports: number };
export type PracticeRound = { id: string; name: string; reports: number; summary: string; questions: PracticeQuestion[] };

type Config = {
  company: string;
  role: string;
  /** The page's path; what is copied names its full URL. */
  path: string;
  slug: string;
  accounts: number;
  rounds: PracticeRound[];
  categories: Array<{ value: string; label: string }>;
};

const ALL = "all";
/** A round with more questions than this shows its first few; the rest open from "Show all". */
const LONG_ROUND = 8;
const FIRST_SHOWN = 5;
const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

function matches(q: PracticeQuestion, terms: string[]): boolean {
  if (!terms.length) return true;
  const text = `${q.text} ${q.categoryLabel}`.toLowerCase();
  return terms.every((t) => text.includes(t));
}

type Practice = ReturnType<typeof useBuild>;
const Context = createContext<Practice | null>(null);

function usePractice(): Practice {
  const value = useContext(Context);
  if (!value) throw new Error("Practice components must sit inside <PracticeProvider>.");
  return value;
}

function useBuild({ company, role, path, slug, accounts, rounds, categories }: Config) {
  const [round, setRound] = useState(ALL);
  const [topic, setTopic] = useState(ALL);
  const [query, setQuery] = useState("");
  const [copied, setCopied] = useState<"ai" | "list" | null>(null);
  const [status, setStatus] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ready = useRef(false);

  const terms = useMemo(() => query.toLowerCase().split(/\s+/).filter(Boolean), [query]);
  // A question keeps its number in its round whatever the filters show.
  const numbers = useMemo(() => new Map(rounds.flatMap((r) => r.questions.map((q, i) => [`${r.id}/${q.id}`, i + 1] as const))), [rounds]);
  const total = rounds.reduce((n, r) => n + r.questions.length, 0);
  const valid = (id: string) => rounds.some((r) => r.id === id);

  // Filters from the URL on load; #round-{id} opens that round (also when a link on the page changes the hash).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromHash = () => {
      const id = window.location.hash.startsWith("#round-") ? decodeURIComponent(window.location.hash.slice(7)) : "";
      return valid(id) ? id : null;
    };
    const r = fromHash() ?? params.get("round");
    // Restoring state from the URL once, after hydration (the server renders the unfiltered page).
    /* eslint-disable react-hooks/set-state-in-effect */
    if (r && valid(r)) setRound(r);
    const t = params.get("topic");
    if (t && categories.some((c) => c.value === t)) setTopic(t);
    const q = params.get("q");
    if (q) setQuery(q.slice(0, 100));
    /* eslint-enable react-hooks/set-state-in-effect */
    ready.current = true;
    const onHash = () => {
      const id = fromHash();
      if (!id) return;
      setRound(id);
      setTopic(ALL);
      setQuery("");
      requestAnimationFrame(() => document.getElementById(`round-${id}`)?.scrollIntoView({ block: "start" }));
    };
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Keep the URL in step with the filters, without adding history entries.
  useEffect(() => {
    if (!ready.current) return;
    const params = new URLSearchParams();
    if (round !== ALL) params.set("round", round);
    if (topic !== ALL) params.set("topic", topic);
    if (query.trim()) params.set("q", query.trim());
    const qs = params.toString();
    const hash = window.location.hash.startsWith("#round-") ? "" : window.location.hash;
    window.history.replaceState(window.history.state, "", `${window.location.pathname}${qs ? `?${qs}` : ""}${hash}`);
  }, [round, topic, query]);

  const keep = (q: PracticeQuestion, ignore?: "topic") => (ignore === "topic" || topic === ALL || q.category === topic) && matches(q, terms);
  const filtering = topic !== ALL || terms.length > 0;
  const shown = rounds
    .filter((r) => round === ALL || r.id === round)
    .map((r) => ({ ...r, questions: r.questions.filter((q) => keep(q)) }))
    // With a topic or search, a round with nothing matching is hidden; otherwise every round shows (its summary is useful on its own).
    .filter((r) => !filtering || r.questions.length > 0);
  const count = shown.reduce((n, r) => n + r.questions.length, 0);
  const roundCount = (id: string) => rounds.filter((r) => id === ALL || r.id === id).reduce((n, r) => n + r.questions.filter((q) => keep(q)).length, 0);
  const topicCount = (value: string) => rounds.filter((r) => round === ALL || r.id === round).reduce((n, r) => n + r.questions.filter((q) => (value === ALL || q.category === value) && keep(q, "topic")).length, 0);
  const roundName = rounds.find((r) => r.id === round)?.name ?? "";
  const topicName = categories.find((c) => c.value === topic)?.label ?? "";
  const scope = [roundName, topicName, terms.length ? `matching “${query.trim()}”` : ""].filter(Boolean).join(" · ");

  function reset() {
    setRound(ALL);
    setTopic(ALL);
    setQuery("");
  }

  function pickRound(id: string) {
    setRound(id);
    const top = document.getElementById("question-list");
    if (top && window.scrollY > top.offsetTop) top.scrollIntoView({ block: "start" });
  }

  async function copy(format: "ai" | "list") {
    if (!count) return;
    const list: CopyRound[] = shown.map((r) => ({ name: r.name, questions: r.questions.map((q) => ({ text: q.text, category: q.category, categoryLabel: q.categoryLabel })) }));
    const ctx = { company, role, url: new URL(path, window.location.origin).toString(), scope };
    const text = format === "ai" ? formatForAI(ctx, list) : formatList(ctx, list);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(format);
      const n = copyCount(list);
      setStatus(format === "ai" ? `Copied ${plural(n, "question")} as a practice prompt. Paste it into ChatGPT, Claude or Gemini to practise with an AI interviewer.` : `Copied ${plural(n, "question")}.`);
      trackInterviewCopy({ format, scope: scope ? "filtered" : "all", count: n, content_slug: slug });
    } catch {
      setCopied(null);
      setStatus("Couldn’t copy here. Select the questions and copy them instead.");
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2200);
  }

  return { rounds, categories, accounts, round, topic, query, setQuery, setTopic, setRound, copied, status, numbers, total, filtering, shown, count, roundCount, topicCount, scope, reset, pickRound, copy };
}

/** Holds the filters and the clipboard for everything on a role's page that touches its questions. */
export function PracticeProvider({ children, ...config }: Config & { children: React.ReactNode }) {
  const value = useBuild(config);
  return <Context.Provider value={value}>{children}</Context.Provider>;
}

/** Copies the questions currently shown as a prompt for an AI interviewer. */
export function CopyAiButton({ variant = "solid", children }: { variant?: "solid" | "ghost" | "inverse"; children?: React.ReactNode }) {
  const { copy, count, copied } = usePractice();
  return (
    <button
      type="button"
      onClick={() => copy("ai")}
      disabled={!count}
      aria-label={`Copy ${plural(count, "question")} as a prompt for an AI assistant`}
      className={cn(
        "inline-flex min-h-11 items-center justify-center rounded-[8px] px-4 text-[0.9375rem] font-semibold transition-colors disabled:opacity-50",
        variant === "solid" && "bg-accent text-accent-contrast hover:bg-accent-hover",
        variant === "ghost" && "border border-line-strong bg-surface text-ink hover:border-line-field",
        variant === "inverse" && "bg-feature-button text-feature-button-text hover:opacity-90",
      )}
    >
      {copied === "ai" ? "Copied" : (children ?? "Copy for AI")}
    </button>
  );
}

/** The dark "Practise with an AI interviewer" card in a role page's sidebar. */
export function PracticeCard() {
  return (
    <div className="rounded-lg border border-feature-border bg-feature p-[22px] text-feature-text">
      <p className="font-serif text-[1.375rem] font-medium leading-tight">Practise with an AI interviewer</p>
      <p className="mt-2 text-sm leading-relaxed text-feature-2">Copy the questions you&rsquo;re viewing as a ready-made prompt for ChatGPT, Claude or Gemini.</p>
      <div className="mt-3.5">
        <CopyAiButton variant="inverse" />
      </div>
    </div>
  );
}

const pill = "inline-flex min-h-11 items-center gap-1.5 whitespace-nowrap border px-3.5 text-sm font-medium transition-colors disabled:opacity-40";

/**
 * The questions: a sticky bar (rounds, topics, search, counts, Copy for AI and
 * Copy list), then every round with its questions. The server renders every
 * round and question, so without JavaScript all of them are on the page; the
 * script adds the filters (kept in the URL: ?round=…&topic=…&q=…) and the
 * clipboard. A long round shows its first few, and "Show all" opens the rest
 * as a native disclosure.
 */
export function QuestionsPanel() {
  const p = usePractice();
  const { rounds, categories, round, topic, query, filtering, shown, count, total, copied, status } = p;
  return (
    <div id="question-list" className="scroll-mt-4">
      <div className="sticky top-16 z-20 -mx-4 mt-5 border-b border-line bg-bg px-4 py-3 sm:top-0 sm:mx-0 sm:px-0 lg:top-18">
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0 sm:pb-0" role="group" aria-label="Filter by round">
          {[{ id: ALL, name: "All rounds" }, ...rounds].map((r) => (
            <button key={r.id} type="button" aria-pressed={round === r.id} onClick={() => p.pickRound(r.id)} className={cn(pill, "rounded-full", round === r.id ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink hover:border-line-field")}>
              {r.name} <span className="text-[0.8125rem] tabular-nums opacity-75">{p.roundCount(r.id)}</span>
            </button>
          ))}
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          {categories.length > 1 && (
            <>
              <label htmlFor="topic-picker" className="sr-only">
                Filter by topic
              </label>
              <select
                id="topic-picker"
                value={topic}
                onChange={(e) => p.setTopic(e.target.value)}
                className="min-h-11 flex-1 rounded-[8px] border border-line-field bg-surface px-3 text-sm font-semibold sm:hidden"
              >
                {[{ value: ALL, label: "All topics" }, ...categories].map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label} ({p.topicCount(c.value)})
                  </option>
                ))}
              </select>
              <div role="group" aria-label="Filter by topic" className="hidden flex-wrap gap-2 sm:flex">
                {[{ value: ALL, label: "All topics" }, ...categories].map((c) => (
                  <button
                    key={c.value}
                    type="button"
                    aria-pressed={topic === c.value}
                    disabled={p.topicCount(c.value) === 0 && topic !== c.value}
                    onClick={() => p.setTopic(c.value)}
                    className={cn(pill, "rounded-[8px]", topic === c.value ? "border-ink bg-ink text-bg" : "border-line-strong bg-surface text-ink hover:border-line-field")}
                  >
                    {c.label} <span className="text-[0.8125rem] tabular-nums opacity-75">{p.topicCount(c.value)}</span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="order-last flex min-h-11 basis-full items-center gap-2 rounded-[8px] border border-line-field bg-surface px-3 focus-within:outline-2 focus-within:outline-accent sm:order-none sm:basis-48 sm:flex-1">
            <Search size={16} aria-hidden="true" className="shrink-0 text-muted" />
            <label htmlFor="question-search" className="sr-only">
              Search questions
            </label>
            <input id="question-search" type="search" value={query} maxLength={100} onChange={(e) => p.setQuery(e.target.value)} placeholder="Search questions" className="min-w-0 flex-1 bg-transparent text-[0.9375rem] outline-none placeholder:text-muted" />
          </div>
          <div className="sm:hidden">
            <CopyAiButton />
          </div>
        </div>
        <div className="mt-2.5 hidden flex-wrap items-center justify-between gap-2.5 sm:flex">
          <p aria-live="polite" className="text-sm text-muted">
            Showing {count} of {plural(total, "question")}
            {(round !== ALL || filtering) && (
              <>
                {" · "}
                <button type="button" onClick={p.reset} className="font-semibold text-accent-ink underline underline-offset-2">
                  Show all
                </button>
              </>
            )}
          </p>
          <div className="flex gap-2">
            <CopyAiButton />
            <button type="button" onClick={() => p.copy("list")} disabled={!count} aria-label={`Copy ${plural(count, "question")} as a plain list`} className="inline-flex min-h-11 items-center rounded-[8px] border border-line-strong bg-surface px-3.5 text-[0.9375rem] font-medium text-ink transition-colors hover:border-line-field disabled:opacity-50">
              {copied === "list" ? "Copied" : "Copy list"}
            </button>
          </div>
        </div>
        {status && (
          <p role="status" className="mt-2.5 rounded-[8px] bg-accent-soft px-3.5 py-2.5 text-sm font-medium text-accent-ink">
            {status}
          </p>
        )}
      </div>

      {shown.length === 0 && (
        <div className="mt-8 rounded-lg border-[1.5px] border-dashed border-line-field px-5 py-8 text-center">
          <p className="text-ink-2">No reported question matches{p.scope ? ` ${p.scope}` : ""}.</p>
          <button type="button" onClick={p.reset} className="mt-3 inline-flex min-h-11 items-center rounded-[8px] border border-line-strong bg-surface px-4 text-sm font-semibold">
            Show all questions
          </button>
        </div>
      )}

      {shown.map((r) => {
        const full = rounds.find((x) => x.id === r.id)!;
        const collapse = round === ALL && !filtering && r.questions.length > LONG_ROUND;
        const items = collapse ? r.questions.slice(0, FIRST_SHOWN) : r.questions;
        const rest = collapse ? r.questions.slice(FIRST_SHOWN) : [];
        return (
          <section key={r.id} id={`round-${r.id}`} aria-labelledby={`round-${r.id}-name`} className="scroll-mt-16 pt-7 sm:pt-9">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5">
              <h3 id={`round-${r.id}-name`} className="font-serif text-[1.375rem] font-medium sm:text-[1.625rem]">
                {r.name}
              </h3>
              <span className="text-[0.8125rem] text-muted sm:text-sm">
                {filtering ? `${r.questions.length} of ${full.questions.length}` : plural(full.questions.length, "question")} · {r.reports} of {p.accounts} accounts
              </span>
            </div>
            {r.summary && !filtering && <p className="mt-2 max-w-3xl whitespace-pre-line text-base leading-relaxed text-ink-2">{r.summary}</p>}
            {r.questions.length > 0 ? (
              <>
                <ol className="mt-3.5 overflow-hidden rounded-lg border border-line bg-surface">
                  {items.map((q) => (
                    <Question key={q.id} q={q} round={r.id} n={p.numbers.get(`${r.id}/${q.id}`) ?? 0} />
                  ))}
                  {rest.length > 0 && (
                    <li className="list-none">
                      <details className="group">
                        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-center border-b border-line-soft text-[0.9375rem] font-semibold text-accent-ink group-open:hidden [&::-webkit-details-marker]:hidden">
                          Show all {r.questions.length} questions
                        </summary>
                        <ol>
                          {rest.map((q) => (
                            <Question key={q.id} q={q} round={r.id} n={p.numbers.get(`${r.id}/${q.id}`) ?? 0} />
                          ))}
                        </ol>
                      </details>
                    </li>
                  )}
                </ol>
              </>
            ) : (
              <p className="mt-3 text-sm text-muted">Candidates who described this round didn&rsquo;t name specific questions.</p>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Question({ q, round, n }: { q: PracticeQuestion; round: string; n: number }) {
  return (
    <li id={`q-${round}-${q.id}`} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-3 border-b border-line-soft px-4 py-3.5 last:border-b-0 sm:grid-cols-[2rem_minmax(0,1fr)] sm:px-[22px] sm:py-[18px]">
      <span aria-hidden="true" className="pt-1 font-mono text-xs text-muted sm:text-[0.8125rem]">
        {n}
      </span>
      <div className="min-w-0">
        <p className="text-[0.9375rem] leading-normal text-ink sm:text-[1.0625rem] sm:leading-relaxed">{q.text}</p>
        <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs sm:mt-2.5 sm:text-[0.8125rem]">
          <Pill tone={questionTone(q.category)} className="px-2 py-0 text-xs sm:text-[0.8125rem]">
            {q.categoryLabel}
          </Pill>
          {q.difficulty && (
            <Pill tone="warn" className="px-2 py-0 text-xs sm:text-[0.8125rem]">
              {q.difficulty}
            </Pill>
          )}
          {q.reports >= 2 && <span className="text-muted">Reported by {q.reports} candidates</span>}
          {q.practiceUrl && (
            <a href={q.practiceUrl} target="_blank" rel="noopener noreferrer" data-analytics="practice" className="ml-auto inline-flex min-h-8 items-center gap-0.5 font-semibold text-accent-ink hover:underline">
              Practice<span className="max-sm:sr-only">&nbsp;on {q.practiceHost}</span>
              <ArrowUpRight size={12} aria-hidden="true" />
              <span className="sr-only"> (opens in a new tab)</span>
            </a>
          )}
        </p>
      </div>
    </li>
  );
}
