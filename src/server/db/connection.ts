/**
 * Connection helpers shared by the deploy migration and `npm run db:check`
 * (so no "server-only" import here). The running app does not use them: it
 * connects exactly as configured by DATABASE_URL (see client.ts).
 *
 * Supabase's pooler serves two modes on one host with the same credentials:
 *   - port 5432, session mode: one pooler client = one Postgres connection, capped
 *     at the pool size (15 on small plans). Serverless instances each keep their own
 *     connections, so enough of them fill the cap, and further connections fail with
 *     "(EMAXCONNSESSION) max clients reached in session mode".
 *   - port 6543, transaction mode: Supabase's recommendation for serverless.
 *
 * Moving the app to 6543 automatically was tried and backed out: in the first real
 * deploy every query made by the build's static generation stalled for 60 s. The
 * cause could not be established from the build log alone, so switching modes is a
 * deliberate, verified change of DATABASE_URL (see `npm run db:check`), not a
 * silent rewrite in code.
 */

const SUPABASE_POOLER_HOST = /\.pooler\.supabase\.com$/i;
const SESSION_PORT = "5432";
const TRANSACTION_PORT = "6543";

export type PoolerMode = "session" | "transaction";

/** The Supabase pooler mode a connection string selects, or null for anything else. */
export function supabasePoolerMode(databaseUrl: string): PoolerMode | null {
  let url: URL;
  try {
    url = new URL(databaseUrl);
  } catch {
    return null;
  }
  if (!SUPABASE_POOLER_HOST.test(url.hostname)) return null;
  const port = url.port || SESSION_PORT;
  if (port === SESSION_PORT) return "session";
  if (port === TRANSACTION_PORT) return "transaction";
  return null;
}

/** The same Supabase pooler URL in transaction mode; any other URL is returned unchanged. */
export function toTransactionPooler(databaseUrl: string): string {
  if (supabasePoolerMode(databaseUrl) !== "session") return databaseUrl;
  const url = new URL(databaseUrl);
  url.port = TRANSACTION_PORT;
  return url.toString();
}

/**
 * Pool settings for the app's own connections. Through Supabase's session pooler one client
 * is one Postgres connection out of a small shared cap (15), and every serverless instance
 * has its own pool, so a pool of several per instance turns a single studio page, which
 * issues about ten queries at once, into a burst that can fail with EMAXCONNSESSION even
 * though a one-query session check just succeeded. On that pooler the pool is therefore
 * limited to ONE connection (queries queue on it; the code base is written for a pool of
 * one, which is what local development uses) and idle connections are released quickly.
 * Any other database, and the transaction pooler, keep the configured values.
 *
 * Not during `next build`: the build runs far from the database (Vercel builds in Washington, the
 * database is in Singapore, about 220 ms per query) and renders several pages at once, so a single
 * shared connection made pages exceed Next's 60 s limit and failed deploys. The build is one short-lived
 * process; the cap exists for the long-lived serverless instances, which run next to the database.
 */
export function poolSettings(
  databaseUrl: string,
  configured: { max: number; idleTimeout: number },
  options: { building?: boolean } = {},
): { max: number; idleTimeout: number; capped: boolean } {
  if (options.building || supabasePoolerMode(databaseUrl) !== "session") return { ...configured, capped: false };
  const max = Math.min(configured.max, 1);
  const idleTimeout = Math.min(configured.idleTimeout, 5);
  return { max, idleTimeout, capped: max !== configured.max || idleTimeout !== configured.idleTimeout };
}
const CAPACITY_SQLSTATES = new Set(["53300", "53400", "08001", "08004", "08006", "57P03"]);
const NETWORK_CODES = new Set(["ECONNRESET", "ECONNREFUSED", "ETIMEDOUT", "EPIPE", "CONNECT_TIMEOUT", "CONNECTION_CLOSED", "CONNECTION_ENDED", "CONNECTION_DESTROYED"]);

/** Thrown by withConnectionRetry when one attempt exceeds its time limit (a hung connection or query). */
export class AttemptTimeoutError extends Error {
  readonly code = "ATTEMPT_TIMEOUT";
  constructor(ms: number) {
    super(`The database did not answer within ${Math.round(ms / 1000)} s.`);
    this.name = "AttemptTimeoutError";
  }
}

/**
 * True when the database could not be reached, had no room for another client,
 * or did not answer in time: worth retrying. False for real query errors (bad
 * SQL, constraint violations), which must fail the deploy straight away.
 * Drizzle wraps driver errors ("Failed query: ..."), so the whole cause chain
 * is inspected.
 */
export function isConnectionCapacityError(error: unknown): boolean {
  for (let e: unknown = error, depth = 0; e && depth < 6; e = (e as { cause?: unknown }).cause, depth++) {
    const { code, message } = e as { code?: unknown; message?: unknown };
    if (typeof code === "string" && (code === "ATTEMPT_TIMEOUT" || CAPACITY_SQLSTATES.has(code) || NETWORK_CODES.has(code))) return true;
    if (typeof message === "string" && /EMAXCONN|max clients reached|too many (?:connections|clients)|remaining connection slots are reserved/i.test(message)) return true;
  }
  return false;
}

/** The innermost database error as one short line: its message and SQLSTATE, never the SQL or its parameters. */
export function describeDatabaseError(error: unknown): string {
  let innermost: unknown = error;
  for (let depth = 0; depth < 6 && (innermost as { cause?: unknown })?.cause; depth++) innermost = (innermost as { cause: unknown }).cause;
  const { code, message } = innermost as { code?: unknown; message?: unknown };
  const text = String(message ?? innermost).replace(/\s+/g, " ").slice(0, 200);
  return typeof code === "string" && !text.includes(code) ? `${text} [${code}]` : text;
}

export type RetryOptions = {
  /** Waits between attempts; its length + 1 is the number of attempts. */
  delaysMs?: number[];
  /** Upper bound for one attempt, so a hung connection cannot stall a build until the platform's own timeout. */
  attemptTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
  log?: (message: string) => void;
};

const DEFAULT_DELAYS_MS = [5_000, 10_000, 20_000, 30_000, 45_000];
const DEFAULT_ATTEMPT_TIMEOUT_MS = 60_000;

/**
 * Runs `work` against the database, retrying only connection-capacity failures
 * (including a hung attempt) with backoff. The same URL is used every time.
 *
 * `work` receives an AbortSignal that fires when the attempt times out. It must use it to close
 * whatever it opened (e.g. `signal.addEventListener("abort", () => client.end({ timeout: 0 }))`):
 * an abandoned client would keep holding a pooler slot, and its socket would keep the process alive.
 */
export async function withConnectionRetry<T>(work: (signal: AbortSignal) => Promise<T>, options: RetryOptions = {}): Promise<T> {
  const delays = options.delaysMs ?? DEFAULT_DELAYS_MS;
  const limit = options.attemptTimeoutMs ?? DEFAULT_ATTEMPT_TIMEOUT_MS;
  const sleep = options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms)));
  const log = options.log ?? ((message: string) => console.log(message));
  for (let failures = 0; ; ) {
    const controller = new AbortController();
    const started = Date.now();
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const attempt = work(controller.signal);
      attempt.catch(() => undefined); // an attempt abandoned by the timeout may still reject later
      return await Promise.race([
        attempt,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            controller.abort();
            reject(new AttemptTimeoutError(limit));
          }, limit);
        }),
      ]);
    } catch (error) {
      if (!isConnectionCapacityError(error) || failures >= delays.length) throw error;
      const wait = delays[failures]!;
      failures += 1;
      log(`Database unavailable or full after ${Math.round((Date.now() - started) / 1000)} s (attempt ${failures} of ${delays.length + 1}: ${describeDatabaseError(error)}). Retrying in ${Math.round(wait / 1000)} s.`);
      await sleep(wait);
    } finally {
      clearTimeout(timer);
    }
  }
}
