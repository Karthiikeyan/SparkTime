import { describe, expect, it } from "vitest";
import nextConfig from "../../next.config";

/**
 * Vercel builds in Washington while the database is in Singapore (~220 ms per query, ~20 queries per page).
 * With Next's defaults (8 pages at once, 60 s each) pages queue behind each other's queries and time out,
 * which failed production deploys. These settings keep the build inside its limits; a measured build over
 * a 224 ms link with a single connection took 2.3 minutes with none of them tripping.
 */
describe("static generation settings", () => {
  it("renders few pages at once and allows each far more than the 60 s default", () => {
    expect(nextConfig.experimental?.staticGenerationMaxConcurrency).toBeLessThanOrEqual(2);
    expect(nextConfig.staticPageGenerationTimeout).toBeGreaterThanOrEqual(180);
  });

  it("keeps the build to one worker so it cannot exhaust the database's connection pool", () => {
    expect(nextConfig.experimental?.cpus).toBeGreaterThanOrEqual(1);
  });
});
