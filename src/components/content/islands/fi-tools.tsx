"use client";

import { useId, useState } from "react";
import type { ToolKind } from "@/lib/content/blocks";

/**
 * Small, honest financial-independence calculators that can be dropped into
 * any article (the "tool" block). Pure client-side arithmetic; no data leaves
 * the page. Illustrative only — the UI says so.
 */

type Currency = "INR" | "USD";

function money(value: number, currency: Currency): string {
  if (!Number.isFinite(value)) return "—";
  return new Intl.NumberFormat(currency === "INR" ? "en-IN" : "en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(Math.round(value));
}

function NumberField({ label, value, onChange, suffix, step = 1, min = 0, max }: { label: string; value: number; onChange: (v: number) => void; suffix?: string; step?: number; min?: number; max?: number }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-muted">
        {label}
      </label>
      <div className="mt-1 flex items-center rounded-sm border border-line-field bg-surface focus-within:border-accent">
        <input
          id={id}
          type="number"
          inputMode="decimal"
          value={Number.isFinite(value) ? value : ""}
          min={min}
          max={max}
          step={step}
          onChange={(e) => onChange(Math.max(min, Math.min(max ?? Number.POSITIVE_INFINITY, Number(e.target.value) || 0)))}
          className="w-full bg-transparent px-3 py-2 font-mono text-sm outline-none"
        />
        {suffix && <span className="pr-3 text-sm text-subtle">{suffix}</span>}
      </div>
    </div>
  );
}

function Shell({ title, children, result }: { title: string; children: React.ReactNode; result: React.ReactNode }) {
  return (
    <section className="not-prose rounded-md border border-line bg-surface p-5 font-sans sm:p-6" aria-label={title}>
      <p className="eyebrow">Interactive tool</p>
      <h3 className="mt-1 text-lg font-semibold">{title}</h3>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">{children}</div>
      <div className="mt-5 rounded-sm bg-bg-tint p-4" aria-live="polite">
        {result}
      </div>
      <p className="mt-3 text-xs text-subtle">Illustrative arithmetic only — not financial advice. Real returns vary and are not guaranteed.</p>
    </section>
  );
}

function CurrencyToggle({ value, onChange }: { value: Currency; onChange: (c: Currency) => void }) {
  const id = useId();
  return (
    <div>
      <label htmlFor={id} className="block text-sm text-muted">
        Currency
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as Currency)} className="mt-1 w-full rounded-sm border border-line-field bg-surface px-3 py-2 text-sm">
        <option value="INR">₹ INR</option>
        <option value="USD">$ USD</option>
      </select>
    </div>
  );
}

function FireNumber() {
  const [currency, setCurrency] = useState<Currency>("INR");
  const [monthly, setMonthly] = useState(50000);
  const [rate, setRate] = useState(4);
  const target = rate > 0 ? (monthly * 12 * 100) / rate : Number.NaN;
  return (
    <Shell
      title="Your FI number"
      result={
        <p>
          At <strong>{money(monthly, currency)}</strong> a month and a <strong>{rate}%</strong> withdrawal rate, your financial-independence number is{" "}
          <strong className="text-accent">{money(target, currency)}</strong>.
        </p>
      }
    >
      <CurrencyToggle value={currency} onChange={setCurrency} />
      <NumberField label="Monthly expenses" value={monthly} onChange={setMonthly} step={1000} />
      <NumberField label="Safe withdrawal rate" value={rate} onChange={setRate} suffix="%" step={0.25} min={0.5} max={10} />
    </Shell>
  );
}

function CompoundGrowth() {
  const [currency, setCurrency] = useState<Currency>("INR");
  const [initial, setInitial] = useState(100000);
  const [monthly, setMonthly] = useState(20000);
  const [annual, setAnnual] = useState(10);
  const [years, setYears] = useState(20);
  const r = annual / 100 / 12;
  const n = Math.min(years, 60) * 12;
  const fv = r === 0 ? initial + monthly * n : initial * (1 + r) ** n + monthly * (((1 + r) ** n - 1) / r);
  const invested = initial + monthly * n;
  return (
    <Shell
      title="Compound growth"
      result={
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <div>
            <dt className="text-subtle">Invested</dt>
            <dd className="font-mono">{money(invested, currency)}</dd>
          </div>
          <div>
            <dt className="text-subtle">Growth</dt>
            <dd className="font-mono">{money(fv - invested, currency)}</dd>
          </div>
          <div>
            <dt className="text-subtle">Final value</dt>
            <dd className="font-mono font-semibold text-accent">{money(fv, currency)}</dd>
          </div>
        </dl>
      }
    >
      <CurrencyToggle value={currency} onChange={setCurrency} />
      <NumberField label="Starting amount" value={initial} onChange={setInitial} step={10000} />
      <NumberField label="Monthly investment" value={monthly} onChange={setMonthly} step={1000} />
      <NumberField label="Expected annual return" value={annual} onChange={setAnnual} suffix="%" step={0.5} max={30} />
      <NumberField label="Years" value={years} onChange={setYears} step={1} min={1} max={60} />
    </Shell>
  );
}

function SavingsRate() {
  const [currency, setCurrency] = useState<Currency>("INR");
  const [income, setIncome] = useState(150000);
  const [expenses, setExpenses] = useState(75000);
  const [real, setReal] = useState(5);
  const [swr, setSwr] = useState(4);
  const savings = Math.max(0, income - expenses);
  const rate = income > 0 ? (savings / income) * 100 : 0;
  const target = swr > 0 ? (expenses * 12 * 100) / swr : Number.POSITIVE_INFINITY;
  let years = 0;
  let balance = 0;
  while (balance < target && years < 100 && savings > 0) {
    balance = balance * (1 + real / 100) + savings * 12;
    years++;
  }
  return (
    <Shell
      title="Savings rate → years to FI"
      result={
        <p>
          You save <strong>{rate.toFixed(0)}%</strong> of your income ({money(savings, currency)}/month). At a {real}% real return you’d reach{" "}
          <strong>{money(target, currency)}</strong> in about <strong className="text-accent">{savings > 0 && years < 100 ? `${years} years` : "— (increase savings)"}</strong>.
        </p>
      }
    >
      <CurrencyToggle value={currency} onChange={setCurrency} />
      <NumberField label="Monthly take-home income" value={income} onChange={setIncome} step={5000} />
      <NumberField label="Monthly expenses" value={expenses} onChange={setExpenses} step={1000} />
      <NumberField label="Real (after-inflation) return" value={real} onChange={setReal} suffix="%" step={0.5} max={20} />
      <NumberField label="Withdrawal rate" value={swr} onChange={setSwr} suffix="%" step={0.25} min={0.5} max={10} />
    </Shell>
  );
}

export function FiTool({ kind }: { kind: ToolKind }) {
  if (kind === "fire-number") return <FireNumber />;
  if (kind === "compound-growth") return <CompoundGrowth />;
  return <SavingsRate />;
}
