import { CopyButton } from "@/components/content/islands/copy-button";

export type CodeLine = Array<{ content: string; style: Record<string, string> }>;

/**
 * A code block: the language and a Copy button in a bar, the code below it,
 * scrolling sideways inside the box so a long line never widens the page.
 * Tokens are coloured on the server; the only script is the copy button.
 */
export function CodeBlock({ label, raw, lines }: { label: string | null; raw: string; lines: CodeLine[] }) {
  return (
    <div className="code-block not-prose block-wide overflow-hidden rounded-md border border-line bg-code-bg font-mono sm:rounded-xl">
      <div className="flex items-center justify-between border-b border-line bg-code-bar py-1 pl-3.5 pr-1.5 sm:py-1.5 sm:pl-4 sm:pr-2">
        <span className="font-sans text-xs font-semibold text-muted sm:text-[0.8125rem]">{label ?? "Code"}</span>
        <CopyButton text={raw} />
      </div>
      <pre tabIndex={0} aria-label={label ? `${label} code` : "Code"} className="p-3.5 text-[0.8125rem] leading-[1.7] text-ink sm:px-5 sm:py-[18px] sm:text-[0.9063rem]">
        <code>
          {lines.map((line, li) => (
            <span key={li} className="block min-h-[1.7em]">
              {line.map((token, ti) => (
                <span key={ti} className="token" style={token.style as React.CSSProperties}>
                  {token.content}
                </span>
              ))}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
