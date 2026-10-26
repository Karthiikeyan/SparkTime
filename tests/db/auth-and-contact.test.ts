import { eq } from "drizzle-orm";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { actorFromSession } from "@/server/auth/guard";
import { createSession, hashToken, invalidateSessionToken, validateSessionToken } from "@/server/auth/session";
import type { Db } from "@/server/db/client";
import { contactMessages, sessions, users } from "@/server/db/schema";
import { resetEnvCache } from "@/server/env";
import { issueContactToken, submitContact } from "@/server/services/contact";
import { createTestDb } from "../helpers/db";

let ctx: Awaited<ReturnType<typeof createTestDb>>;
let db: Db;
const envBackup = { ...process.env };

beforeAll(async () => {
  ctx = await createTestDb({ seed: true });
  db = ctx.db;
});
afterAll(() => ctx.close());
afterEach(() => {
  process.env = { ...envBackup };
  resetEnvCache();
});

async function user(githubId: number, login: string) {
  const [row] = await db.insert(users).values({ githubId, githubLogin: login }).returning();
  return row!;
}

describe("sessions", () => {
  it("stores only a hash of the token and validates it", async () => {
    const u = await user(1001, "owner");
    const { token } = await createSession(u.id, "test-agent");
    const [stored] = await db.select().from(sessions).where(eq(sessions.userId, u.id));
    expect(stored!.id).toBe(hashToken(token));
    expect(stored!.id).not.toBe(token);
    expect((await validateSessionToken(token))?.user.id).toBe(u.id);
  });

  it("rejects malformed, unknown, expired and revoked tokens", async () => {
    const u = await user(1002, "someone");
    expect(await validateSessionToken("short")).toBeNull();
    expect(await validateSessionToken("x".repeat(43) + "'; --")).toBeNull();
    expect(await validateSessionToken("A".repeat(43))).toBeNull();

    const { token } = await createSession(u.id, null);
    await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.id, hashToken(token)));
    expect(await validateSessionToken(token)).toBeNull();

    const fresh = await createSession(u.id, null);
    await invalidateSessionToken(fresh.token);
    expect(await validateSessionToken(fresh.token)).toBeNull();
  });

  it("an authenticated but non-allowlisted GitHub user is NOT an admin", async () => {
    process.env.ADMIN_GITHUB_ID = "1001";
    resetEnvCache();
    const intruder = await user(2002, "intruder");
    const { token } = await createSession(intruder.id, null);
    expect(actorFromSession(await validateSessionToken(token))).toBeNull();

    const owner = (await db.select().from(users).where(eq(users.githubId, 1001)))[0]!;
    const ownerSession = await createSession(owner.id, null);
    expect(actorFromSession(await validateSessionToken(ownerSession.token))).toMatchObject({ kind: "admin", userId: owner.id });
  });

  it("revokes access immediately when the allowlist changes", async () => {
    process.env.ADMIN_GITHUB_ID = "1001";
    resetEnvCache();
    const owner = (await db.select().from(users).where(eq(users.githubId, 1001)))[0]!;
    const { token } = await createSession(owner.id, null);
    expect(actorFromSession(await validateSessionToken(token))).not.toBeNull();
    process.env.ADMIN_GITHUB_ID = "9999";
    resetEnvCache();
    expect(actorFromSession(await validateSessionToken(token))).toBeNull();
  });

  it("the development login user is rejected outside development", async () => {
    const dev = await user(-1, "dev-admin");
    const { token } = await createSession(dev.id, null);
    process.env.AUTH_DEV_LOGIN = "true";
    resetEnvCache();
    expect(actorFromSession(await validateSessionToken(token))).toBeNull();
  });
});

describe("contact form", () => {
  const valid = () => ({ name: "Ada", email: "ada@example.com", reason: "Speaking", message: "Would you speak at our meetup next month?", token: issueContactToken(Date.now() - 10_000) });
  const context = { ip: "203.0.113.7", userAgent: "vitest" };

  it("stores a valid message without the raw IP", async () => {
    await submitContact(valid(), context);
    const [row] = await db.select().from(contactMessages);
    expect(row).toMatchObject({ name: "Ada", reason: "Speaking" });
    expect(row!.ipHash).not.toContain("203.0.113.7");
  });

  it("silently drops honeypot submissions", async () => {
    const before = (await db.select().from(contactMessages)).length;
    await expect(submitContact({ ...valid(), website: "http://spam.example" }, context)).resolves.toMatchObject({ ok: true });
    expect((await db.select().from(contactMessages)).length).toBe(before);
  });

  it("rejects instant submissions, forged tokens and link spam", async () => {
    await expect(submitContact({ ...valid(), token: issueContactToken(Date.now()) }, context)).rejects.toMatchObject({ code: "invalid" });
    await expect(submitContact({ ...valid(), token: "123.abc" }, context)).rejects.toMatchObject({ code: "invalid" });
    await expect(submitContact({ ...valid(), message: "https://a https://b https://c https://d https://e buy now" }, context)).rejects.toMatchObject({ code: "invalid" });
    await expect(submitContact({ ...valid(), email: "not-an-email" }, context)).rejects.toMatchObject({ code: "invalid" });
  });

  it("stores hostile markup as inert text and ignores unknown reasons", async () => {
    await submitContact({ ...valid(), name: "<img src=x onerror=alert(1)>", reason: "<script>", message: "Hello <script>alert(1)</script> there" }, { ...context, ip: "198.51.100.1" });
    const rows = await db.select().from(contactMessages);
    const hostile = rows.find((r) => r.name.includes("<img"));
    expect(hostile!.reason).toBe("");
    expect(hostile!.message).toBe("Hello <script>alert(1)</script> there"); // rendered escaped by React, never as HTML
  });

  it("rate-limits repeated submissions from one address", async () => {
    const ip = { ...context, ip: "192.0.2.55" };
    for (let i = 0; i < 5; i++) await submitContact(valid(), ip);
    await expect(submitContact(valid(), ip)).rejects.toMatchObject({ code: "rate_limited" });
  });
});
