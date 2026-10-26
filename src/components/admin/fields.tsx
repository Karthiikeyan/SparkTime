"use client";

import { useId } from "react";
import { cn } from "@/lib/cn";

/** Admin form primitives: consistent labels, help text, errors and focus. */

import { inputBase, inputClass } from "./styles";

export { inputBase, inputClass };

export function Field({ label, help, error, children, className }: { label: string; help?: string; error?: string; children: (id: string, describedBy: string | undefined) => React.ReactNode; className?: string }) {
  const id = useId();
  const helpId = `${id}-help`;
  const errId = `${id}-err`;
  const describedBy = [help ? helpId : null, error ? errId : null].filter(Boolean).join(" ") || undefined;
  return (
    <div className={cn("space-y-1.5", className)}>
      <label htmlFor={id} className="block text-xs font-medium text-muted">
        {label}
      </label>
      {children(id, describedBy)}
      {help && !error && (
        <p id={helpId} className="text-xs text-subtle">
          {help}
        </p>
      )}
      {error && (
        <p id={errId} className="text-xs text-danger">
          {error}
        </p>
      )}
    </div>
  );
}

export function TextInput({ label, value, onChange, help, error, placeholder, type = "text", maxLength, onBlur, mono = false }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  help?: string;
  error?: string;
  placeholder?: string;
  type?: string;
  maxLength?: number;
  onBlur?: () => void;
  mono?: boolean;
}) {
  return (
    <Field label={label} help={help} error={error}>
      {(id, describedBy) => (
        <input
          id={id}
          type={type}
          value={value}
          placeholder={placeholder}
          maxLength={maxLength}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          aria-invalid={Boolean(error)}
          aria-describedby={describedBy}
          className={cn(inputClass, mono && "font-mono")}
        />
      )}
    </Field>
  );
}

export function TextArea({ label, value, onChange, help, error, rows = 3, maxLength, placeholder }: { label: string; value: string; onChange: (v: string) => void; help?: string; error?: string; rows?: number; maxLength?: number; placeholder?: string }) {
  return (
    <Field label={label} help={help} error={error}>
      {(id, describedBy) => (
        <textarea id={id} value={value} rows={rows} maxLength={maxLength} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} aria-invalid={Boolean(error)} aria-describedby={describedBy} className={cn(inputClass, "resize-y leading-relaxed")} />
      )}
    </Field>
  );
}

export function Select<T extends string>({ label, value, onChange, options, help }: { label: string; value: T; onChange: (v: T) => void; options: Array<{ value: T; label: string }>; help?: string }) {
  return (
    <Field label={label} help={help}>
      {(id, describedBy) => (
        <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} aria-describedby={describedBy} className={inputClass}>
          {options.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      )}
    </Field>
  );
}

/**
 * A bare on/off switch. The knob is anchored with `left-0` and moved by an
 * exact translate: an absolutely positioned child with no inset sits at its
 * static position, which inside a <button> (centred content) is mid-track —
 * the knob then overshoots the track when on and rests on the "on" side when off.
 * Track 36px, knob 16px, 2px inset → off at 2px, on at 36 − 16 − 2 = 18px.
 */
export function Switch({ checked, onChange, id, label, describedBy, size = "md", className }: {
  checked: boolean;
  onChange: (v: boolean) => void;
  id?: string;
  /** Accessible name when there is no <label htmlFor>. */
  label?: string;
  describedBy?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const sm = size === "sm";
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      onClick={() => onChange(!checked)}
      className={cn(
        "relative inline-flex shrink-0 cursor-pointer rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent",
        sm ? "h-4 w-7" : "h-5 w-9",
        checked ? "bg-accent" : "bg-line-strong",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute left-0 top-0.5 rounded-full bg-white shadow-sm transition-transform duration-200 ease-out",
          sm ? "size-3" : "size-4",
          checked ? (sm ? "translate-x-3.5" : "translate-x-4.5") : "translate-x-0.5",
        )}
      />
    </button>
  );
}

export function Toggle({ label, checked, onChange, help }: { label: string; checked: boolean; onChange: (v: boolean) => void; help?: string }) {
  const id = useId();
  const helpId = `${id}-help`;
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="cursor-pointer text-sm">
          {label}
        </label>
        {help && (
          <p id={helpId} className="text-xs text-subtle">
            {help}
          </p>
        )}
      </div>
      <Switch id={id} checked={checked} onChange={onChange} describedBy={help ? helpId : undefined} className="mt-0.5" />
    </div>
  );
}

/** A compact inline switch with its label to the left — for per-row on/off settings in lists. */
export function InlineSwitch({ label, checked, onChange, className }: { label: string; checked: boolean; onChange: (v: boolean) => void; className?: string }) {
  const id = useId();
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-xs text-muted", className)}>
      <label htmlFor={id} className="cursor-pointer select-none">
        {label}
      </label>
      <Switch id={id} size="sm" checked={checked} onChange={onChange} />
    </span>
  );
}

export { Badge, statusTone } from "./badge";
