"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";
import { INDEXING_INFO, INDEXINGS, PUBLICATION_INFO, PUBLICATIONS, type Indexing, type Outcome, type Publication } from "@/lib/content/publication";
import { Badge, type BadgeTone } from "./badge";

/**
 * The publishing controls every importer shares: what imported items become
 * (Draft · Published · Unlisted) and what search engines may do (Automatic ·
 * Index · Noindex), plus the badge that states an item's result. Same words,
 * same defaults, whatever is being imported (docs/content-publishing-redesign.md).
 */

type Extra<T extends string> = { value: T; label: string; help: string };

function RadioGroup<T extends string>({ legend, name, value, options, onChange, disabled }: { legend: string; name: string; value: T; options: Array<{ value: T; label: string; help: string }>; onChange: (v: T) => void; disabled?: boolean }) {
  const current = options.find((o) => o.value === value);
  const helpId = useId();
  return (
    <fieldset className="min-w-0" disabled={disabled} aria-describedby={helpId}>
      <legend className="text-xs font-medium text-muted">{legend}</legend>
      <div className="mt-1.5 inline-flex flex-wrap rounded-sm border border-line bg-surface p-0.5">
        {options.map((o) => (
          <label
            key={o.value}
            className={cn(
              "cursor-pointer rounded-xs px-3 py-1.5 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent",
              value === o.value ? "bg-ink text-bg" : "text-muted hover:text-ink",
            )}
          >
            <input type="radio" name={name} value={o.value} checked={value === o.value} onChange={() => onChange(o.value)} className="sr-only" />
            {o.label}
          </label>
        ))}
      </div>
      <p id={helpId} className="mt-1.5 text-xs text-subtle">
        {current?.help}
      </p>
    </fieldset>
  );
}

export function PublicationControls<P extends string = Publication>({
  publication,
  indexing,
  onPublication,
  onIndexing,
  disabled,
  extraPublication = [],
  indexingHelp,
}: {
  publication: Publication | P;
  indexing: Indexing;
  onPublication: (v: Publication | P) => void;
  onIndexing: (v: Indexing) => void;
  disabled?: boolean;
  /** Importer-specific choices after the shared three (e.g. "Follow each file"). */
  extraPublication?: Array<Extra<P>>;
  /** What Automatic means for this kind of content. */
  indexingHelp?: string;
}) {
  const name = useId();
  return (
    <div className="grid gap-5 sm:grid-cols-2">
      <RadioGroup<Publication | P>
        legend="Imported items become"
        name={`${name}-publication`}
        value={publication}
        disabled={disabled}
        onChange={onPublication}
        options={[...PUBLICATIONS.map((p) => ({ value: p as Publication | P, label: p === "draft" ? "Drafts" : PUBLICATION_INFO[p].label, help: PUBLICATION_INFO[p].help })), ...extraPublication]}
      />
      <RadioGroup<Indexing>
        legend="Search engines"
        name={`${name}-indexing`}
        value={indexing}
        disabled={disabled}
        onChange={onIndexing}
        options={INDEXINGS.map((i) => ({ value: i, label: INDEXING_INFO[i].label, help: i === "auto" && indexingHelp ? indexingHelp : INDEXING_INFO[i].help }))}
      />
    </div>
  );
}

const OUTCOME_TONE: Record<string, BadgeTone> = { Published: "success", Unlisted: "info", Draft: "warning", Private: "neutral", Archived: "neutral" };

/** "Published · Indexed", "Draft · Index once live": what an item will be once imported. */
export function OutcomeBadges({ outcome, staged = false }: { outcome: Pick<Outcome, "label" | "live" | "indexed" | "indexedWhenLive">; staged?: boolean }) {
  const indexing = outcome.live ? (outcome.indexed ? "Indexed" : "Noindex") : outcome.label === "Draft" ? (outcome.indexedWhenLive ? "Index once live" : "Noindex") : null;
  return (
    <span className="inline-flex flex-wrap items-center gap-1">
      <Badge tone={OUTCOME_TONE[outcome.label] ?? "neutral"}>{staged ? `${outcome.label} · update staged` : outcome.label}</Badge>
      {indexing && <Badge tone={outcome.live && outcome.indexed ? "success" : "neutral"}>{indexing}</Badge>}
    </span>
  );
}
