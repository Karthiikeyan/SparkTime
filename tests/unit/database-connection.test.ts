import net from "node:net";
import { sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { AttemptTimeoutError, describeDatabaseError, isConnectionCapacityError, poolSettings, supabasePoolerMode, toTransactionPooler, withConnectionRetry } from "@/server/db/connection";

const SESSION = "postgres://postgres.abcdefgh:p%40ss@aws-0-ap-southeast-1.pooler.supabase.com:5432/postgres?sslmode=require";
const TRANSACTION = "postgres://postgres.abcdefgh:p%40ss@aws-0-ap-southeast-1.pooler.supabase.com:6543/postgres?sslmode=require";
const LOCAL = "postgres://postgres:postgres@127.0.0.1:54329/postgres";
const DIRECT = "postgres://postgres:pw@db.abcdefgh.supabase.co:5432/postgres";

describe("Supabase pooler URLs", () => {
  it("recognises session and transaction mode by port, and nothing else", () => {
    expect(supabasePoolerMode(SESSION)).toBe("session");
    expect(supabasePoolerMode(TRANSACTION)).toBe("transaction");
    expect(supabasePoolerMode(LOCAL)).toBeNull();
    expect(supabasePoolerMode(DIRECT)).toBeNull();
    expect(supabasePoolerMode("not a url")).toBeNull();
  });

  it("moves a session-pooler URL to the transaction pooler, keeping credentials, database and options", () => {
    expect(toTransactionPooler(SESSION)).toBe(TRANSACTION);
    expect(toTransactionPooler(TRANSACTION)).toBe(TRANSACTION);
    expect(toTransactionPooler(LOCAL)).toBe(LOCAL);
    expect(toTransactionPooler(DIRECT)).toBe(DIRECT);
  });
});

describe("pool sizing", () => {
  it("limits the Supabase session pooler to one short-lived connection per instance", () => {
    expect(poolSettings(SESSION, { max: 5, idleTimeout: 20 })).toEqual({ max: 1, idleTimeout: 5, capped: true });
    expect(poolSettings(SESSION, { max: 2, idleTimeout: 5 })).toEqual({ max: 1, idleTimeout: 5, capped: true });
    expect(poolSettings(SESSION, { max: 1, idleTimeout: 3 })).toEqual({ max: 1, idleTimeout: 3, capped: false });
  });

  it("does not cap during next build: the build runs far from the database and needs the configured pool", () => {
    expect(poolSettings(SESSION, { max: 2, idleTimeout: 5 }, { building: true })).toEqual({ max: 2, idleTimeout: 5, capped: false });
    expect(poolSettings(SESSION, { max: 5, idleTimeout: 20 }, { building: true })).toEqual({ max: 5, idleTimeout: 20, capped: false });
    expect(poolSettings(SESSION, { max: 5, idleTimeout: 20 }, { building: false }).max).toBe(1);
  });

  it("leaves every other database as configured", () => {
    expect(poolSettings(TRANSACTION, { max: 5, idleTimeout: 20 })).toEqual({ max: 5, idleTimeout: 20, capped: false });
    expect(poolSettings(LOCAL, { max: 2, idleTimeout: 1 })).toEqual({ max: 2, idleTimeout: 1, capped: false });
    expect(poolSettings(DIRECT, { max: 10, idleTimeout: 30 })).toEqual({ max: 10, idleTimeout: 30, capped: false });
  });
});

/** Answers every connection the way Supavisor does when its session-mode client cap is reached. */
function fullPooler(): Promise<{ port: number; close: () => Promise<void> }> {
  const message = "(EMAXCONNSESSION) max clients reached in session mode - max clients are limited to pool_size: 15";
  const fields = ["SFATAL", "VFATAL", "CXX000", `M${message}`].map((f) => Buffer.from(`${f}\0`));
  const body = Buffer.concat([...fields, Buffer.from("\0")]);
  const head = Buffer.alloc(5);
  head.write("E", 0);
  head.writeInt32BE(body.length + 4, 1);
  const reply = Buffer.concat([head, body]);
  const server = net.createServer((socket) => {
    socket.on("error", () => undefined);
    socket.once("data", () => socket.end(reply));
  });
  return new Promise((resolve) =>
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as net.AddressInfo;
      resolve({ port, close: () => new Promise((done) => server.close(() => done())) });
    }),
  );
}

describe("connection-capacity errors", () => {
  let pooler: Awaited<ReturnType<typeof fullPooler>>;
  beforeAll(async () => {
    pooler = await fullPooler();
  });
  afterAll(() => pooler.close());

  it("recognises the real EMAXCONNSESSION failure as drizzle reports it (the production deploy error)", async () => {
    const client = postgres(`postgres://u:p@127.0.0.1:${pooler.port}/postgres`, { max: 1, prepare: false, connect_timeout: 5, onnotice: () => undefined });
    const error = await drizzle(client)
      .execute(sql`create schema if not exists "drizzle"`)
      .then(() => null, (e: unknown) => e);
    await client.end({ timeout: 1 });
    expect(String((error as Error).message)).toContain("Failed query");
    expect(isConnectionCapacityError(error)).toBe(true);
  });

  it("treats network failures and Postgres's own connection limits as retryable", () => {
    expect(isConnectionCapacityError(Object.assign(new Error("connect ECONNREFUSED"), { code: "ECONNREFUSED" }))).toBe(true);
    expect(isConnectionCapacityError(Object.assign(new Error("sorry, too many clients already"), { code: "53300" }))).toBe(true);
    expect(isConnectionCapacityError(new Error("wrapper", { cause: Object.assign(new Error("timeout"), { code: "CONNECT_TIMEOUT" }) }))).toBe(true);
  });

  it("never retries a real query error", () => {
    expect(isConnectionCapacityError(Object.assign(new Error('relation "studio.x" does not exist'), { code: "42P01" }))).toBe(false);
    expect(isConnectionCapacityError(Object.assign(new Error("duplicate key value"), { code: "23505" }))).toBe(false);
    expect(isConnectionCapacityError(new Error("syntax error"))).toBe(false);
  });
});

describe("withConnectionRetry (deploy migrations)", () => {
  const full = () => Object.assign(new Error("(EMAXCONNSESSION) max clients reached in session mode"), { code: "XX000" });
  const quiet = { sleep: async () => undefined, log: () => undefined };

  it("retries a full pool with growing waits and succeeds when a slot frees up", async () => {
    let calls = 0;
    const waits: number[] = [];
    const result = await withConnectionRetry(async () => {
      calls += 1;
      if (calls < 3) throw full();
      return "migrated";
    }, { ...quiet, sleep: async (ms) => void waits.push(ms) });
    expect(result).toBe("migrated");
    expect(calls).toBe(3);
    expect(waits).toEqual([5_000, 10_000]);
  });

  it("fails immediately on a real migration error", async () => {
    let calls = 0;
    const broken = Object.assign(new Error('relation "studio.x" does not exist'), { code: "42P01" });
    await expect(withConnectionRetry(async () => {
      calls += 1;
      throw broken;
    }, quiet)).rejects.toBe(broken);
    expect(calls).toBe(1);
  });

  it("gives up after the last attempt with the underlying error", async () => {
    let calls = 0;
    await expect(withConnectionRetry(async () => {
      calls += 1;
      throw full();
    }, { ...quiet, delaysMs: [1, 1, 1] })).rejects.toThrow("EMAXCONNSESSION");
    expect(calls).toBe(4);
  });

  it("does not let a hung attempt stall the build: it times out and is retried", async () => {
    let calls = 0;
    const result = await withConnectionRetry(async () => {
      calls += 1;
      if (calls === 1) await new Promise(() => undefined); // a connection that never answers
      return "ok";
    }, { ...quiet, attemptTimeoutMs: 20 });
    expect(result).toBe("ok");
    expect(calls).toBe(2);
  });

  it("reports a persistently hung database as a timeout", async () => {
    await expect(withConnectionRetry(() => new Promise<never>(() => undefined), { ...quiet, delaysMs: [1], attemptTimeoutMs: 10 })).rejects.toBeInstanceOf(AttemptTimeoutError);
  });
});

describe("a hung attempt gives its connection back", () => {
  it("aborts the attempt's signal when it times out, then retries with a fresh one", async () => {
    const signals: AbortSignal[] = [];
    const logs: string[] = [];
    const result = await withConnectionRetry(async (signal) => {
      signals.push(signal);
      if (signals.length === 1) await new Promise(() => undefined);
      return "ok";
    }, { sleep: async () => undefined, log: (m) => logs.push(m), attemptTimeoutMs: 20 });
    expect(result).toBe("ok");
    expect(signals.map((s) => s.aborted)).toEqual([true, false]);
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatch(/did not answer within/);
  });

  it("closes the real socket of a client stuck on a server that never answers", async () => {
    const sockets: net.Socket[] = [];
    let closedAt: number | null = null;
    const silent = net.createServer((socket) => {
      sockets.push(socket);
      socket.on("data", () => undefined); // reads the startup message, never replies
      socket.on("close", () => (closedAt = Date.now()));
      socket.on("error", () => undefined);
    });
    await new Promise<void>((resolve) => silent.listen(0, "127.0.0.1", resolve));
    const { port } = silent.address() as net.AddressInfo;
    const started = Date.now();
    try {
      await expect(
        withConnectionRetry(async (signal) => {
          const client = postgres(`postgres://u:p@127.0.0.1:${port}/postgres`, { max: 1, prepare: false, connect_timeout: 30, onnotice: () => undefined });
          signal.addEventListener("abort", () => void client.end({ timeout: 0 }).catch(() => undefined));
          await client`select 1`;
        }, { sleep: async () => undefined, log: () => undefined, delaysMs: [], attemptTimeoutMs: 300 }),
      ).rejects.toBeInstanceOf(AttemptTimeoutError);
      await vi.waitFor(() => expect(closedAt).not.toBeNull(), { timeout: 3000 });
      expect(closedAt! - started).toBeLessThan(3000);
      expect(sockets).toHaveLength(1);
    } finally {
      sockets.forEach((s) => s.destroy());
      await new Promise<void>((resolve) => silent.close(() => resolve()));
    }
  });

  it("describes a database error without its SQL or parameters", () => {
    const wrapped = new Error('Failed query: select "key" from "studio"."site_settings" where "key" in ($1)\nparams: secret-param', {
      cause: Object.assign(new Error("(EMAXCONNSESSION) max clients reached in session mode"), { code: "XX000" }),
    });
    const text = describeDatabaseError(wrapped);
    expect(text).toBe("(EMAXCONNSESSION) max clients reached in session mode [XX000]");
    expect(text).not.toMatch(/select|secret-param/);
  });
});

describe("the app's own connection", () => {
  it("is never rewritten: client.ts connects with DATABASE_URL exactly as configured", async () => {
    const { readFileSync } = await import("node:fs");
    const source = readFileSync("src/server/db/client.ts", "utf8");
    expect(source).toContain("postgres(config.DATABASE_URL,");
    expect(source).not.toMatch(/toTransactionPooler|runtimeDatabaseUrl|6543/);
  });
});
