# 08 — Security Posture

> Audience: a Novo Nordisk reviewer asking "would we let this near our data?". The honest answer is *not yet, and here is exactly what stands between here and there*. Naming the gaps is a Feasibility argument, not a weakness — see `docs/07-TEAM-AND-RISKS.md` §5.
>
> Last reviewed: 13 August 2026. Re-run this review after every migration and before the final demo.

## 1. What is enforced today

### Authentication
- Supabase Auth, email and password. Session refreshed in `proxy.ts` on every request.
- `supabase.auth.getUser()` is used everywhere, never `getSession()` — the latter trusts the cookie without revalidating it against the auth server.
- Every route except `/sign-in` and `/auth` requires a session; unauthenticated requests are redirected, verified by `npm run verify`.

### Authorisation
- Enforced in **Postgres Row Level Security**, not in application code. 10 tables, all RLS-enabled, all policies scoped `to authenticated`.
- Approved and submitted considerations are shared organisation-wide; drafts and in-review items are visible only to the owning team, plus CTA Management and Admin.
- Cost telemetry (`ai_calls`) is restricted to CTA Management and Admin.
- **One documented exception:** ingestion writes with the service client behind an application role gate (ADR-013). It is a single function, gated on entry, audited on every call, and covered by five checks in `npm run verify:ingest`.

### Data integrity
- `audit_events` is append-only, enforced by database triggers on `UPDATE`, `DELETE` **and `TRUNCATE`**. The truncate case matters: row-level triggers do not fire on truncate, so without it a single statement could erase the trail.
- Verified to hold even against the service role — a leaked service key cannot rewrite history.

### Secrets
- No secret is committed. Verified against tracked files and full git history.
- `.env.local` is gitignored; `.env.example` carries placeholders only.
- The service-role key is confirmed absent from the client bundle and from every build artefact.
- `lib/db/service.ts` throws if it is ever constructed in a browser.

### Input handling
- Zod validation on every server action and search parameter.
- Uploads: extension, MIME type, size **and `%PDF` magic bytes** are all checked — extension and MIME are attacker-controlled.
- Storage keys are validated against the exact generated shape, not a `startsWith` prefix, keeping traversal segments out of the Storage API.
- `JSON.parse` on client-supplied override data is wrapped; malformed input returns a message instead of crashing the action.
- The commit path **re-parses from the stored file** rather than trusting the posted payload. Only explicit per-consideration overrides are honoured, matched by number — a tampered request can change a category, which the audit trail records, but cannot inject text that was never in the document.

### Transport and browser
Set for every response in `next.config.ts` and verified against a production build:

| Header | Value |
|---|---|
| `Content-Security-Policy` | `default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `connect-src` limited to self and the Supabase origin |
| `X-Frame-Options` | `DENY` |
| `X-Content-Type-Options` | `nosniff` |
| `Referrer-Policy` | `strict-origin-when-cross-origin` |
| `Permissions-Policy` | camera, microphone, geolocation, payment, USB all denied |
| `Strict-Transport-Security` | 2 years, `includeSubDomains`, `preload` |
| `X-Powered-By` | removed |

### Storage
- Private bucket, PDF-only, 20 MB ceiling.
- Anonymous listing returns empty and the public object path returns 400 — verified directly against the API with the anon key.

### Abuse
- Per-user sliding-window rate limits on both ingestion actions. PDF parsing is CPU-bound and was previously unbounded.

### Data residency
- Supabase in `eu-central-1` (Frankfurt). The application host must be pinned to an EU region as an acceptance criterion (ADR-008).

## 2. Known gaps — deliberate, with the path named

| Gap | Why it is acceptable now | What production needs |
|---|---|---|
| CSP allows `'unsafe-inline'` for scripts | Next's bootstrap requires it; the policy still blocks external script sources and framing | Nonce-based CSP threaded through `proxy.ts` |
| Rate limiting is in-memory | Prototype scale; correct per instance | Redis or a Postgres-backed shared window |
| Leaked-password protection disabled | Supabase project setting, dashboard-only | Enable HaveIBeenPwned checking (one toggle) |
| No MFA, no SSO | Demo accounts only | Entra ID / SAML through Supabase Auth |
| Demo passwords are public | The corpus is synthetic and contains nothing real | Delete demo accounts before any real data |
| No OCR | Scanned PDFs are detected and refused rather than parsed badly | Vision model over page images |
| No formal CSV | Out of scope for one month | Computerised-system validation as a deployment activity |
| No dependency scanning in CI | Small, recent dependency tree | `npm audit` and Dependabot in the CI workflow |

## 3. How to re-verify

```bash
npm run verify          # RLS isolation, anonymous access, audit immutability
npm run verify:ingest   # role gate, tamper resistance, duplicate refusal
npm run test            # parser, classifier, rate limiter
npm run build && npx next start -p 3100   # then curl -D - for the headers
```

Plus the Supabase security advisors after every migration. They currently report a single warning — leaked-password protection — which is a dashboard toggle, not a code change.

**Note what the advisors did not catch.** Policies written without a `TO` clause applied to `anon` as well as `authenticated`, which meant an unauthenticated caller could read every approved consideration through the REST API. The linter passed clean while that was true. It was found by reading `pg_policies.roles` directly. Automated advisors are a floor, not a ceiling.
