import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { formatPeriod, fromDateTimeLocal, toDateTimeLocal } from "@/lib/dates";

describe("datetime-local round trip", () => {
  // Pin a non-UTC zone: the old UTC-slice approach drifted by the offset here.
  const originalTz = process.env.TZ;
  beforeEach(() => {
    process.env.TZ = "Asia/Kolkata";
  });
  afterEach(() => {
    process.env.TZ = originalTz;
  });

  it("shows stored UTC instants as local wall-clock time", () => {
    expect(toDateTimeLocal("2026-09-13T10:00:00.000Z")).toBe("2026-09-13T15:30");
  });

  it("saves the local value back as the same instant, so repeated edits never drift", () => {
    const stored = "2026-09-13T10:00:00.000Z";
    let value = stored;
    for (let i = 0; i < 3; i++) value = fromDateTimeLocal(toDateTimeLocal(value))!;
    expect(value).toBe(stored);
  });

  it("treats empty and invalid values as no date", () => {
    expect(toDateTimeLocal(null)).toBe("");
    expect(toDateTimeLocal("nope")).toBe("");
    expect(fromDateTimeLocal("")).toBeNull();
    expect(fromDateTimeLocal("nope")).toBeNull();
  });
});

describe("formatPeriod", () => {
  it("uses years for spans across years, and 'now' for open spans", () => {
    expect(formatPeriod("2017-08-01", "2021-05-30")).toBe("2017 – 2021");
    expect(formatPeriod("2021-07-01", null)).toBe("2021 – now");
  });

  it("uses months within a single year, so a short experiment never reads '2026 – 2026'", () => {
    expect(formatPeriod("2026-05-01", "2026-05-30")).toBe("May 2026");
    expect(formatPeriod("2026-03-01", "2026-06-15")).toBe("Mar – Jun 2026");
  });

  it("falls back to whatever date exists", () => {
    expect(formatPeriod(null, "2020-01-01")).toBe("2020");
    expect(formatPeriod(null, null)).toBe("");
    expect(formatPeriod("not a date", null)).toBe("");
  });
});
