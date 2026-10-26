# Security

SparkTime has one privileged user (me) and an anonymous public audience. The threat model follows from
that: keep anyone else out of the studio, make sure nothing unpublished ever leaks, and make sure
content (mine or imported) can't run code in a visitor's browser.

Each control below lists the code that implements it and the tests that cover it.

## 1. Getting into the studio

| Control | Where |
| --- | --- |
| GitHub OAuth web flow with a random `state` and PKCE (S256) | `src/server/auth/github.ts` |
| Only one GitHub account is allowed, matched by its immutable numeric id (usernames can be renamed and re-claimed); with nothing configured, nobody is admin | `src/server/auth/allowlist.ts` |
| Login callback is rate limited (20 attempts / 15 min per hashed IP) | `src/app/api/auth/github/callback/route.ts` |
| Local sign-in exists only when `NODE_ENV=development` **and** `AUTH_DEV_LOGIN=true` | `src/server/auth` |

**Sessions** are stored in Postgres, not as JWTs, so they can be revoked. The cookie holds 32 random
bytes; the database stores only their SHA-256, so a database leak doesn't yield usable sessions.
Cookies are `HttpOnly`, `SameSite=Lax`, and on HTTPS `Secure` with the `__Host-` prefix. Sessions last
30 days and slide forward when less than half remains. Expired sessions are pruned by the daily cron.
(`src/server/auth/session.ts`)

## 2. Every admin request is checked three times

1. **`src/proxy.ts`** turns away `/admin` and `/api/admin` requests that have no session cookie. This
   is only an early exit; nothing relies on it alone.
2. **`adminRoute()`** in `src/server/http/route.ts` wraps every admin API handler. It validates the
   session against the database, checks the owner allowlist, and for state-changing requests requires
   the `Origin` header to be this site and `Sec-Fetch-Site` (when present) to be `same-origin`. Bodies
   must be JSON and are size-capped. Combined with `SameSite=Lax`, this blocks cross-site request forgery.
3. **Services** (`src/server/services/*`) take an actor argument and assert it is the admin themselves,
   so a future route that forgets its wrapper still can't write.

Tests: `tests/db/api-authorization.test.ts` and `tests/db/auth-and-contact.test.ts` call the real
route handlers with no cookie, a forged cookie, a valid non-owner session, and a cross-site origin.

## 3. Nothing unpublished leaks

All public reads go through the predicates in `src/server/services/visibility.ts` (see
[ARCHITECTURE.md](ARCHITECTURE.md#lifecycle-and-visibility)). Drafts, ideas, scheduled, private and
trashed documents are never served, listed, searched, put in RSS or the sitemap, or shown as backlinks.

- `tests/db/visibility.test.ts` checks every read path against every status/visibility combination.
- `tests/db/export-published-only.test.ts` checks that a public export contains only published work.
- Previews of unpublished documents require an admin session and are sent with
  `Cache-Control: private, no-store` and `X-Robots-Tag: noindex`.

## 4. Content can't execute

- Editor output is ProseMirror JSON, never HTML. Before it is stored, `sanitizeDoc()`
  (`src/lib/content/blocks.ts`) rebuilds the document from an allowlist of node and mark types and
  re-validates every URL (no `javascript:`, `data:`, embedded credentials and so on).
- Imported HTML (Notion/Obsidian exports) is converted to the same JSON and sanitised the same way.
- Rendering is React components chosen from an allowlist, so the database can pick a template but
  never supply markup, CSS or scripts.
- Redirect targets and links are checked by `src/lib/url.ts` against open-redirect tricks such as
  `https://trusted.com@evil.com`.

Tests: `tests/unit/blocks.test.ts`, `tests/unit/renderer.test.ts`, `tests/unit/url-and-slug.test.ts`.

## 5. Browser hardening

| Header | Scope |
| --- | --- |
| Nonce-based CSP with `'strict-dynamic'`, `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'` | Admin pages (`src/proxy.ts`) |
| Content Security Policy | Public pages (`next.config.ts`) |
| `Strict-Transport-Security` (2 years, preload) | Everything, on HTTPS |
| `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy`, `Cross-Origin-Opener-Policy`, `Permissions-Policy` | Everything |
| `X-Robots-Tag: noindex` | `/admin`, `/preview`, `/api` |

Tests: `tests/unit/security-headers.test.ts`, `tests/unit/seo-and-security.test.ts`.

## 6. The database

- The app's tables live in a dedicated `studio` schema.
- Migration `drizzle/0002_lockdown.sql` enables row-level security on every table **with no policies**
  and revokes all privileges from Supabase's `anon` and `authenticated` roles. The application connects
  as the table owner and enforces authorisation in code; the auto-generated Supabase REST API can't read
  anything even if it is enabled. (`tests/db/database-lockdown.test.ts`)
- All queries go through Drizzle with bound parameters. Full-text search input is tokenised before it
  is used, so `to_tsquery` syntax can't be injected.

## 7. Uploads

Files are identified by magic bytes, decoded with a 40-megapixel cap, checked again by decoded format,
stripped of all metadata (EXIF, GPS, XMP) and re-encoded to WebP. Upload size is capped by
`MAX_UPLOAD_MB`. (`src/server/media`, `tests/unit/media.test.ts`)

## 8. Abuse of public endpoints

- **Contact form**: a hidden honeypot field (bots get a fake success), 5 messages per hashed IP per
  hour, and 200 per day site-wide. (`src/server/services/contact.ts`)
- **Rate limits** are stored in Postgres with one atomic upsert per check, so they hold across
  serverless instances and cold starts. IPs are HMAC-hashed with the server secret and never stored raw.
- **Cron endpoint** requires `CRON_SECRET`, compared in constant time.

## 9. Secrets

- Secrets come only from environment variables; `.env*` files other than `.env.example` are git-ignored.
- `src/server/*` modules import `server-only`, and an ESLint rule stops client code importing them.
- Unexpected errors are logged on the server; the client receives a generic message.

## Known gaps

- The rate limiter is fixed-window, so a client can burst up to twice the limit across a window edge.
- There is no second factor beyond GitHub's own; studio security depends on the GitHub account.
- The Playwright end-to-end suite is run manually, not on every push.

## Reporting

If you find a problem, please contact me through [sparktime.in/contact](https://sparktime.in/contact)
rather than opening a public issue.
