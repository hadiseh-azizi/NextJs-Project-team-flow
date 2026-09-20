# TeamFlow — Final Release Cleanup

Scope, per this phase's instructions: (1) IP-based rate-limit trust and
deployment safety, (2) invitation-email abuse protection, (3) final test
documentation consistency and verification. No unrelated refactoring, no
UI changes, no framework migration, no dependency upgrades beyond what
these three tasks required (none did).

Every claim below was checked against the actual source in this ZIP, not
assumed from a prior phase's report.

## 1. IP rate-limit trust — architecture decision

### The question

`src/lib/clientIp.js` reads `x-forwarded-for` (falling back to
`x-real-ip`) to key per-IP rate-limit buckets in three places:
registration, login (`src/lib/auth.js`), and resend-verification. Can a
normal client set this header itself and pick its own rate-limit
identity?

### The answer: it depends on the deployment, so the trust decision is
now explicit rather than assumed

`README.md` documents this app's deployment target as Vercel, with no
customer-supplied reverse proxy in front of it (the "دیپلوی روی Vercel"
section only describes setting `MONGODB_URI` / `NEXTAUTH_SECRET` /
`NEXTAUTH_URL` in Vercel's project settings — nothing about a proxy in
front of Vercel). Vercel's own documentation is explicit about this
exact header:

> "If you are trying to use Vercel behind a proxy, we currently
> overwrite the X-Forwarded-For header and do not forward external
> IPs. This restriction is in place to prevent IP spoofing."
> — https://vercel.com/docs/headers/request-headers

In other words: on the deployment this project actually documents,
Vercel's edge network sets `x-forwarded-for` itself and discards
whatever a client's own request originally carried. A normal client
cannot make this header say anything other than what Vercel's edge saw.
The only way a client-supplied value would reach the app is Vercel's
Enterprise-only "trusted proxy in front of Vercel" feature, which this
project does not use (no such configuration exists in this repo).

**That guarantee is specific to that one deployment shape.** The same
`getClientIp()` function would happily run — and be silently wrong — in:

- a bare `next start` with nothing in front of it (no proxy at all
  means the header is 100% attacker-supplied),
- a self-hosted/Docker deployment behind a reverse proxy that hasn't
  been configured to strip client-supplied forwarding headers,
- any reverse proxy misconfiguration that appends to, rather than
  overwrites, the header.

### Decision made this phase

Rather than either (a) trusting the header unconditionally forever, or
(b) reflexively distrusting it and weakening the app's actual documented
deployment for no reason, `clientIp.js` now gates trust behind an
explicit environment variable:

- `RATE_LIMIT_TRUST_PROXY=vercel` (**default** — matches README's
  documented deployment target): trust `x-forwarded-for` / `x-real-ip`.
- `RATE_LIMIT_TRUST_PROXY=none`: the app cannot reliably determine the
  real client IP in this deployment. `getClientIp()` always returns
  `"unknown"`; every IP-keyed rate-limit component is skipped.

This is documented in `.env.example` and in README.md's Vercel deploy
section (Farsi, matching the rest of that document). **Anyone deploying
this app anywhere other than directly on Vercel must explicitly set
`RATE_LIMIT_TRUST_PROXY=none`** unless they have independently verified
their own reverse proxy overwrites (not merely appends to) these headers
for untrusted clients — the default is intentionally the documented
target, not a blanket "safe everywhere" default, because there is no
such thing as a universally safe default for a header whose
trustworthiness is entirely proxy-configuration-dependent.

A secondary hardening, independent of the trust question: `getClientIp()`
now validates that whatever it extracts is at least IPv4/IPv6-shaped
before returning it, rather than passing an arbitrary string straight
through to a MongoDB document key. This doesn't change the trust
decision above — a value from an untrusted header is still spoofed even
if it happens to look like a real IP — but it stops obviously-malformed
values (empty strings, injection attempts, multi-hundred-character
garbage) from being used as rate-limit keys at all.

### The "silently disable rate limiting" failure this avoids

`POST /api/auth/register` has no per-account identity to combine with
IP (there's no account yet), so its rate limit is IP-only. Before this
phase, `getClientIp()` returning `"unknown"` (whether because the header
was simply absent on one request, or because IP trust was correctly
disabled deployment-wide) caused the route to **skip its rate limit
entirely**. On a deployment that correctly sets
`RATE_LIMIT_TRUST_PROXY=none` (because it isn't Vercel), that would have
meant unlimited, unthrottled registration — exactly the failure mode
this phase's instructions called out by name.

Fixed: when the IP is unknown, `register/route.js` now falls back to one
shared bucket (`REGISTER_FALLBACK_LIMIT`: 100 attempts/hour, versus the
per-IP `REGISTER_IP_LIMIT`: 10/hour) instead of skipping the check. A
real user only ever needs one or two registration attempts, so a shared
100/hour cap still stops unattended bulk registration/enumeration; the
tradeoff is that legitimate concurrent registrations from different
untraceable clients could in principle collide into the same bucket —
acceptable because that scenario is specific to a deployment where the
real per-client IP genuinely isn't available, which is itself the
documented, opt-in state.

Login and resend-verification were **not** affected by this gap: both
already combine an IP check with a per-email check (see `src/lib/auth.js`
and `resend-verification/route.js`). An untrusted/unknown IP there just
means the secondary (IP) net doesn't apply on that request — the primary,
non-IP identity keeps enforcing the limit on its own. No change was
needed for either.

### Fail-open behavior — reviewed, kept as-is (explicit decision)

`rateLimit.js`'s `checkRateLimit()` fails open (does not block the
request) if the DB check itself errors — a transient Atlas blip, a
connection timeout, etc. This phase's instructions asked for an explicit
decision here rather than an automatic switch either way.

**Decision: keep fail-open**, for the reason already documented in
`rateLimit.js`'s header comment: this is an *authentication and
signup* rate limiter, not an access-control gate. A broken rate limiter
degrading to "no extra abuse protection for as long as the DB blip
lasts" is an acceptable, recoverable state. A rate limiter that instead
fails *closed* would turn a transient Atlas connectivity issue into a
full login/registration/resend outage for every user — a strictly worse
outcome for an availability-sensitive path, and disproportionate to the
threat (a DB blip is not, itself, an attack). This was not changed this
phase; it was reviewed and confirmed as the intended behavior.

## 2. Invitation-email rate limiting (new)

### The gap

`POST /api/teams/[id]/members` lets an authorized team manager invite
an email address that has no account yet, which records an `Invitation`
and sends a real email via `sendTeamInviteEmail()`
(`src/lib/email.js`, nodemailer). Unlike every authentication endpoint
in this app (all of which have DB-backed rate limits — see
`AUTH_SECURITY_AUDIT.md`), this route had none. A single authenticated,
authorized manager account could invite an unbounded number of
addresses in a tight loop, each one triggering a real outbound email —
an abuse vector against this app's own SMTP sender reputation and,
depending on the target addresses, a vector for sending unsolicited
mail to third parties.

### What was added

Three rate-limit identities, all backed by the existing
`checkRateLimit()` / `RateLimitAttempt` infrastructure (no new,
incompatible limiter implementation):

| Identity | Limit | Key | Purpose |
|---|---|---|---|
| Per-manager | 30 / hour | `invite:manager:<userId>` | Stops one compromised or malicious manager account from mass-emailing, across *any* team they manage. |
| Per-team | 30 / hour | `invite:team:<teamId>` | Stops one team's invite flow from being flooded regardless of who's driving it (relevant if this data model ever grows multiple managers per team; today one team has exactly one manager, so this and the per-manager limit largely coincide — kept separate because they answer different questions and diverge the moment that assumption changes). |
| Per-IP | 60 / hour | `invite:ip:<ip>` | Looser defense-in-depth net if a manager's session/credentials are compromised and driven from a script. Subject to the same `RATE_LIMIT_TRUST_PROXY` trust boundary as §1 — an attacker who can spoof their IP still hits the manager/team limits above, so defeating this one net alone doesn't defeat invitation abuse protection entirely. |

**Why these numbers:** sized the same way this app's existing auth
limits were (see `AUTH_SECURITY_AUDIT.md`) — generous enough that
bulk-onboarding a real team in one sitting (tens of people) never trips
it, tight enough that a script sending hundreds of invites per hour
does. 30/hour is roughly "onboard a large team, then some," not a number
derived from any specific incident.

**Where the check runs:** only on the branch that actually sends an
email — inviting an address with no existing account. Adding an
already-registered user to a team is a plain membership write with no
external side effect, so it's intentionally left ungated (the
manager-only authorization check already limits who can trigger it, and
there's no mail-sending cost to protect against). The rate-limit check
runs *before* the existing-invitation lookup, so an attacker rotating
through many different target addresses (which would never trip the
existing per-`(email, team)` duplicate-invite check, since each one
looks "new") is still capped.

**What was explicitly preserved, unchanged:**
- Authorization: the team-manager check runs first, as before; rate
  limiting is an additional gate, never a substitute for it.
- The `(email, team)` uniqueness index and the "already invited" 409.
- Invitation TTL / expiry (`Invitation.js`'s `expiresAt`, unchanged).
- Acceptance-on-registration (consuming a live invitation when the
  invited address signs up, in `register/route.js` — untouched).
- No duplicate invitation emails: the existing dedupe-on-live-invite
  logic is unchanged and runs after the new rate-limit check.

## 3. Test documentation consistency

**Confirmed against the filesystem** (not the prior audit report's
claim): `17-api-validation-audit.test.cjs` exists in
`__manual_test__/` and was already part of the shipped test suite as of
the API Validation Audit phase, but `__manual_test__/README.md`'s run
list stopped at `16-frontend-reliability-audit.test.cjs`. Fixed —
README.md's run list and description sections now include `17`, plus
this phase's two new files, `18-ip-trust-hardening.test.cjs` and
`19-invitation-rate-limit.test.cjs`.

New tests added this phase (see `__manual_test__/README.md` for what
each proves and doesn't):

- `18-ip-trust-hardening.test.cjs` — 11 assertions: `RATE_LIMIT_TRUST_PROXY`
  gating (default/`vercel`/`none`), well-formed single and multi-hop
  `x-forwarded-for`, `x-real-ip` fallback, missing headers, malformed/
  injection-shaped values, IPv6, and the registration no-ip-fallback
  bucket (both that it activates under `RATE_LIMIT_TRUST_PROXY=none`
  and that it does *not* change trusted-IP behavior).
- `19-invitation-rate-limit.test.cjs` — 7 assertions: authorization
  still enforced ahead of rate limiting, a normal invitation succeeding,
  the per-manager limit tripping with a 429 + `Retry-After` and no mail
  sent past the limit, per-manager scoping to that manager, the
  per-team vs. per-manager distinction, the existing 409-on-duplicate
  behavior staying intact, and that adding an existing user (no email)
  is never rate-limited by this limiter.

## 4. Commands run and exact results

Run in this sandbox, in order, after all code changes above:

```
npm ci
npm audit
npm run lint
npm run build   # requires MONGODB_URI / NEXTAUTH_SECRET / NEXTAUTH_URL —
                 # see README.md's pre-existing "npm run build" note
node __manual_test__/01-pure-ordering.test.cjs
... (all 19 files) ...
node __manual_test__/19-invitation-rate-limit.test.cjs
```

- **`npm ci`** — exit 0. 772 packages installed, lockfile consistent
  with `package.json` (no `EINTEGRITY`/`EUSAGE` errors, no resolution
  changes).
- **`npm audit`** — **2 vulnerabilities (1 moderate, 1 high)**, both in
  `nodemailer@9.0.5` (pulled in transitively via `next-auth`, and also
  a direct dependency of this app — `src/lib/email.js` uses it directly
  for real invitation/verification mail delivery, so this is not a
  dead/unused package). See "Out of Scope Findings" below for the
  specific advisories and why none of them were judged to fall under
  this phase's "immediate vulnerability directly affecting the three
  tasks" exception. **Not fixed this phase** — upgrading nodemailer
  wasn't required by any of the three scoped tasks, and this phase's
  instructions explicitly prohibit dependency upgrades outside that
  scope.
- **`npm run lint`** — exit 0, clean, 0 warnings.
- **`npm run build`** — fails with `MONGODB_URI is not set` if run with
  no env vars at all (documented, pre-existing behavior — Next.js
  collects page data for `/api/auth/[...nextauth]` at build time, which
  imports `src/lib/mongodb.js`, which throws if unconfigured; see
  README.md and `PRODUCTION_READINESS_AUDIT.md` for this same note from
  a prior phase). With the three documented env vars supplied
  (dummy/placeholder values, no real credentials — this is a build-time
  check only, no connection is actually made), it **compiles
  successfully and prerenders all routes, exit 0**.
- **Manual test suite — all 19 files, run individually via `node`:**

  | File | Result |
  |---|---|
  | 01–17 (carried over, unmodified except as noted) | 180 passed, 0 failed |
  | `18-ip-trust-hardening.test.cjs` | 11 passed, 0 failed |
  | `19-invitation-rate-limit.test.cjs` | 7 passed, 0 failed |
  | **Total** | **198 passed, 0 failed** |

### What kind of tests these are (per this phase's explicit request not
to blur these categories)

1. **Unit tests:** the IP-shape validator and trust-gating logic in
   `clientIp.js` (exercised directly, no mocks needed).
2. **Mock/in-memory integration tests:** everything else in `18` and
   `19` — real, unmodified route/lib files loaded via
   `@babel/register`, with Mongoose models
   (`RateLimitAttempt`, `Team`, `User`, `Invitation`) and `next-auth`'s
   `getServerSession` swapped for small in-memory fakes/spies. These
   prove the application's own control flow (which identity gets
   checked, in what order, what a 429 looks like, that authorization
   still runs first) is correct. They do **not** prove that MongoDB's
   `findOneAndUpdate` on `RateLimitAttempt` is atomic under real
   concurrent load from multiple server instances — that's a property
   of MongoDB itself (see `fakeRateLimitModel.cjs`'s header comment,
   unchanged and still accurate) and was already established, not
   re-verified, by this phase.
3. **Real MongoDB integration tests:** **not run** — this sandbox has
   no network access to a MongoDB server (Atlas or otherwise). See
   the manual test matrix below for what to run before relying on this
   in production.
4. **Real SMTP tests:** **not run** — no network access to an SMTP
   server either. `sendTeamInviteEmail()`'s actual delivery behavior
   under the new rate limits (i.e., that a 429 really does mean zero
   outbound emails, end to end through a real transporter) is asserted
   at the mock level (`sendTeamInviteEmail` call count) in `19`, not
   against a live mail server.
5. **Build verification:** `npm run build`, see above — real, not
   mocked.
6. **Static verification:** `npm run lint`, `npm audit`, `npm ci`
   (lockfile consistency) — all real, not mocked.

### Manual test matrix — required before production reliance

(Same category of gap as every prior phase; nothing new introduced
here beyond the two new limiter identities.)

| Scenario | Why the sandbox can't prove it | How to verify |
|---|---|---|
| Two truly concurrent requests from the same IP/manager/team racing `checkRateLimit()` | Requires MongoDB's real `findOneAndUpdate` atomicity under concurrent load; the in-memory fake proves the pipeline's *logic*, not the server's concurrency guarantee | Fire N concurrent requests (e.g. `ab`/`autocannon`) at `/api/teams/[id]/members` from one manager against a real Atlas cluster; confirm the count of sent emails matches the limit exactly, not N |
| `RateLimitAttempt`'s TTL index actually sweeping expired documents | MongoDB's background TTL monitor is a server-side process, not something an in-memory fake can simulate | Watch the collection in a real Atlas cluster after triggering several rate-limit windows; confirm documents disappear roughly 60s after `expiresAt` |
| Real invitation email delivery under `RATE_LIMIT_TRUST_PROXY=vercel` on an actual Vercel deployment | Needs a real Vercel deployment and a real SMTP provider | Deploy to Vercel, configure `EMAIL_SERVER_*`, send a test invitation past the limit, confirm the 31st attempt returns 429 with no email received |
| A real reverse-proxy-in-front-of-Vercel or non-Vercel deployment with `RATE_LIMIT_TRUST_PROXY` misconfigured | Requires an actual alternate deployment topology to observe header behavior | Before any non-Vercel deployment, manually send a request with a forged `x-forwarded-for` and confirm (via logs or `RateLimitAttempt` documents) which bucket it actually landed in |

## 5. Final source audit

Searched the full source tree (`src/`, `__manual_test__/`, root config)
for each of the following. Result: **clean**, nothing found requiring a
fix.

- `TODO` / `FIXME`: none.
- `console.log` debug leftovers: none (only `console.error`/
  `console.warn` calls, which are this app's established pattern for
  server-side error logging — not debug leftovers).
- Raw `fetch()` bypassing the shared client helper: none found outside
  `src/lib/apiFetch.js` itself and its documented callers.
- Duplicated rate-limit implementations: none — `checkRateLimit()` /
  `RateLimitAttempt` is the only rate-limit mechanism in the codebase;
  the new invitation limiter reuses it directly rather than
  reimplementing anything.
- Duplicated IP-parsing logic: none — `getClientIp()` in
  `src/lib/clientIp.js` is the only place any of `x-forwarded-for` /
  `x-real-ip` is read anywhere in `src/`.
- Direct invitation-email sends bypassing the new limiter:
  `sendTeamInviteEmail(` has exactly one call site in `src/`
  (`teams/[id]/members/route.js`), and it is now downstream of the
  rate-limit check added this phase.
- Unsafe `x-forwarded-for` assumptions: this was the subject of task 1
  above — the remaining assumption (Vercel overwrites the header) is
  now explicit, documented, and gated behind `RATE_LIMIT_TRUST_PROXY`
  rather than implicit.
- Accidental secrets / real credentials: none. `.env.example` contains
  only placeholder values (`<username>`, `your-email@gmail.com`, "replace
  with a random secret"), consistent with every prior phase.
- `.env` (real, non-example) files: none present in this ZIP.
- `node_modules`, build artifacts (`.next/`): present in this sandbox
  during development (`npm ci` installs them, `npm run build` produces
  `.next/`) but excluded from the packaged release ZIP — verified below.

### Out of Scope Findings

> **Resolved in the Final Security Patch phase** (see `CHANGELOG.md`
> and `FINAL_SECURITY_PATCH.md`): `nodemailer` was updated to `9.1.1`,
> which fixes the two advisories below plus one additional advisory
> (GHSA-8m3c-c648-2xjj) found affecting `9.0.5` at patch time. This
> paragraph is left as-is below as the historical record of this
> phase's own scope decision.

- **`npm audit`: 2 nodemailer advisories (1 moderate, 1 high).**
  `nodemailer@9.0.5` is affected by, among others,
  GHSA-cc9r-2j5m-2m83 (a recipient-domain-validation bypass via RFC
  5322 comment mis-parsing) and GHSA-2x7j-588g-ccc2 (quadratic-time
  address-list parsing). Reviewed against this specific phase's scope
  (invitation *volume/frequency* abuse — the new rate limiter — not
  address-parsing correctness) and judged not to directly affect it:
  the domain-bypass advisory matters to apps that make an
  access-control decision based on parsing a recipient's domain
  themselves and then handing the raw address to nodemailer — this app
  does no such domain allow/deny-listing (inviting arbitrary addresses
  is the intended behavior), so there's no domain-based decision here
  for nodemailer to disagree with. The quadratic-parsing advisory is
  triggered by "large or complex lists of email addresses" passed to
  nodemailer in one call; every call site in this app (`sendTeamInviteEmail`,
  `sendVerificationEmail`) sends to exactly one recipient per invocation,
  never a caller-controlled list. Recommended as a genuine finding for a
  future, dedicated dependency-security phase (upgrade to
  `nodemailer@>=9.1.0`, then re-run `07-email-html-escaping.test.cjs`
  and the new invitation tests to confirm no behavior change) — not
  fixed here, since it wasn't required by any of this phase's three
  tasks and this phase's instructions explicitly prohibit unscoped
  dependency upgrades.
- **`__manual_test__/README.md`'s title** still reads "Phase 2
  (ordering & concurrency)" — stale from several phases ago, predating
  even the 16→17 gap this phase was asked to fix. Left untouched: it
  wasn't the specific mismatch this phase's instructions called out
  (the missing `17` entry was), and retitling a file whose actual
  content already accurately describes each phase's additions inline
  is a documentation-polish change, not a correctness fix.

## 6. Final ZIP verification

Before packaging `team-flow-final-release-candidate.zip`:

1. **No `node_modules` included** — confirmed via the archive's file
   list before finalizing.
2. **No real `.env` secrets included** — only `.env.example` (placeholder
   values) is present; no `.env`/`.env.local`/etc. exists in this
   sandbox's working tree at all.
3. **No temporary audit artifacts accidentally included** — no stray
   scratch files, no `.next/` build output in the archive.
4. **`package-lock.json` matches `package.json`** — verified by `npm ci`
   succeeding cleanly (exit 0, no lockfile-drift errors) immediately
   before packaging.
5. **All changed files are syntactically valid** — `npm run build`'s
   compile step (Babel/SWC via Next.js) and `npm run lint` both parse
   every changed file; both passed.
6. **Tests re-run after all modifications** — the 198/0 result above is
   from the final state of the code, after every change in this
   document, not from an intermediate state.
7. **Build re-run after all modifications** — see §4; passed with the
   documented required env vars.
8. **ZIP contains the complete project** — `src/`, `__manual_test__/`,
   root config (`package.json`, `package-lock.json`, `next.config.js`,
   `jsconfig.json`, `eslint.config.mjs`, `.env.example`), and every
   markdown doc (`README.md`, `CHANGELOG.md`, this file, and every
   phase's named audit report) — everything needed to `npm ci && npm
   run build` from a clean checkout, nothing needed excluded beyond
   `node_modules`/`.next`.

## 7. Remaining known limitations

Carried forward from prior phases, unchanged by this one (this phase
did not touch these areas):

- Live Atlas replica-set behavior (real transaction concurrency, TTL
  sweep timing, real SMTP delivery) has never been executed in this
  sandbox — every phase, including this one, has documented this the
  same way. See §4's manual test matrix above for what's specifically
  new to verify this phase.
- Browser-level smoke testing for any component-level fix from prior
  phases remains unexercised in this Node-only sandbox (no browser
  automation available). Not applicable to this phase's changes, which
  are entirely server-side.
- The base64-in-MongoDB attachment architecture remains an intentional,
  documented tradeoff for this academic/self-contained deployment (see
  `ATTACHMENT_SECURITY_AUDIT.md`) — unrelated to and untouched by this
  phase.
- The nodemailer advisories noted above (§"Out of Scope Findings") are
  a genuine, if narrow, gap — recommended for a future dependency-focused
  phase.

## 8. Final release recommendation

**READY WITH KNOWN LIMITATIONS**

Rationale: all three scoped tasks are implemented, documented, and
covered by passing tests (198/198); `npm audit`/`lint`/`build` all ran
with clean or fully-explained results; the source audit found nothing
requiring a fix within scope. The "WITH KNOWN LIMITATIONS" qualifier is
carried forward from every prior phase for the same reason it always
has been: real MongoDB replica-set concurrency, TTL sweep timing, and
real SMTP delivery have never been exercised against live
infrastructure in this sandbox, only proven correct at the application-logic
level against in-memory fakes. Nothing in this phase's own three tasks
is blocked on that gap being closed — it is a pre-existing,
already-documented condition of this project's development environment,
not a new risk introduced here.
