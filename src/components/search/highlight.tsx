/**
 * Renders search snippets. The server marks matches with ⟦ ⟧ sentinels
 * (never HTML); we split on them and emit <mark> elements, so a snippet can
 * contain "<script>" as plain, escaped text.
 */
export function Highlighted({ text }: { text: string }) {
  const parts = text.split(/(⟦[^⟧]*⟧)/g).filter(Boolean);
  return (
    <>
      {parts.map((part, i) =>
        part.startsWith("⟦") && part.endsWith("⟧") ? (
          <mark key={i} className="rounded-[2px] bg-accent-soft px-0.5 text-ink">
            {part.slice(1, -1)}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}

/** Client-side title highlighting for the query's tokens. */
export function HighlightTokens({ text, query }: { text: string; query: string }) {
  const tokens = (query.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter((t) => t.length > 1).slice(0, 6);
  if (!tokens.length) return <>{text}</>;
  const escaped = tokens.map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const re = new RegExp(`(${escaped.join("|")})`, "gi");
  return (
    <>
      {text.split(re).map((part, i) =>
        tokens.includes(part.toLowerCase()) || tokens.some((t) => part.toLowerCase().startsWith(t) && part.length === t.length) ? (
          <mark key={i} className="bg-transparent font-semibold text-accent">
            {part}
          </mark>
        ) : (
          <span key={i}>{part}</span>
        ),
      )}
    </>
  );
}
