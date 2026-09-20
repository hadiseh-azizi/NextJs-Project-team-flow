# Authentication & Abuse-Protection Security Audit

Scope: login, registration, verification-email resend, and email
verification. This is a point-in-time audit against the codebase as
uploaded (`team-flow-final-verified.zip`), covering the state of each
area before this phase's changes, what was changed, and why.

## 1. Login brute-force protection

**Before:** none. `authorize()` in `src/lib/auth.js` looked up the user
and compared the password with no limit on attempts. Nothing stopped an
automated credential-stuffing run against one account, or a low-and-slow
password spray across many accounts from one source.

**After:** two independent DB-backed rate limits inside `authorize()`
(see `src/lib/rateLimit.js`), checked before the database lookup or any
password comparison:
- `login:email:<normalized email>` — max 10 attempts / 15 minutes.
- `login:ip:<client ip>` — max 30 attempts / 15 minutes (skipped if no
  IP can be determined at all, see §8).

Either limit tripping throws `Error("TooManyAttempts")`, which NextAuth
surfaces verbatim as `signIn()`'s `error` field (verified against
`node_modules/next-auth/core/routes/callback.js`); `src/app/login/page.jsx`
now shows a distinct message for it instead of folding it into "incorrect
email or password".

## 2. Registration abuse protection

**Before:** none. Any client could call `POST /api/auth/register`
without limit — usable for automated bulk account creation or, combined
with the 409 response (see §5), for scripted account-existence checks
against a large list of addresses.

**After:** a per-IP limit — `register:ip:<client ip>` — max 10
registrations / hour, checked as the very first thing in the route,
before body parsing. Returns `429` with a `Retry-After` header. Not
keyed by email, since the whole point of the endpoint is to accept an
email that hasn't been seen before.

## 3. Verification-email resend abuse protection

**Before:** an in-memory `Map` cooldown (60s per normalized email),
reset on process restart and not shared across instances (see §8 for why
that matters).

**After:** replaced with the same DB-backed limiter:
- `resend:email:<normalized email>` — max 3 / 10 minutes.
- `resend:ip:<client ip>` — max 20 / 10 minutes (protects against one
  source blasting the send-email endpoint across many addresses; doesn't
  affect the anti-enumeration property in §5, since the response is
  identical whether the limit was hit or not).

## 4. Verification-token security and replay protection

Already solid before this phase, and unchanged: tokens are JWTs signed
with `NEXTAUTH_SECRET`, carry a `purpose` claim so they can't be confused
with anything else, expire after 24h, and embed the user's
`tokenVersion` at issuance time — consuming a token bumps
`User.tokenVersion`, so the same token can never verify twice. Brute-forcing
a token isn't computationally practical (HMAC-signed JWT), so no rate
limit was added to `/api/auth/verify-email` itself; the risk this phase
addresses there is the race condition in §6, not guessing.

## 5. Account enumeration

Two places were checked:

- **Login** — does not leak existence. A wrong password and a
  nonexistent email now take the same code path and the same amount of
  wall-clock time (see §7's timing fix), and both return the same
  generic `null` → "Incorrect email or password".
- **Resend-verification** — already returned an identical `{ ok: true }`
  regardless of whether the account exists; unchanged.
- **Registration** — `POST /api/auth/register` returns `409 "This email
  is already registered"` when the address is taken. This **does**
  disclose account existence, and was left in place deliberately rather
  than changed. The alternative — accepting the "registration" silently
  and, e.g., emailing the existing owner "someone tried to sign up with
  your address" — is worse UX for a real user who just wants to know
  they should log in instead, and doesn't fully close the gap either (an
  attacker can still infer existence from the different email sent
  either way, or from timing). Given that, the accepted mitigation is
  the new per-IP rate limit (§2): it caps how many addresses a given
  source can check, rather than trying to eliminate the signal entirely.
  This is a judgment call worth revisiting if the threat model changes.

## 6. Email-verification race condition

**Before:** `verify-email/route.js` did a `findById`, checked
`tokenVersion`/`email` in application code, and — only if
`!user.emailVerified` — mutated and called `.save()`. Two requests
racing with the *same* token (e.g., an email client prefetching links)
could both pass the check before either saved; whichever `.save()` landed
last determined the final `tokenVersion`, so the net effect could be a
single `+1` instead of two independent successful verifications each
consuming the token. Practically low-severity (both racers are the
legitimate token holder performing the same action), but it quietly
weakens the "each token works exactly once" guarantee under concurrency.

**After:** the lookup, the `tokenVersion`/email match, and the mutation
are now one atomic `findOneAndUpdate({ _id, email, tokenVersion }, { $set,
$inc })` call. At most one of any number of concurrent requests carrying
the same token can match and succeed; every other one — including a
later genuine replay — finds no document at that exact `tokenVersion`
and gets the generic invalid-token response.

## 7. Password handling and bcrypt behavior

- Passwords are capped at 72 bytes before hashing (`MAX_PASSWORD_LENGTH`
  in `register/route.js`) — correct, since bcrypt silently truncates
  beyond that and a longer accepted password would be misleading about
  its own strength. Unchanged.
- Hashing cost factor raised from **10 to 12** (`BCRYPT_COST` in
  `register/route.js`, and the fixed dummy hash in `auth.js` regenerated
  to match). Cost 10 was not broken, but 12 is closer to current general
  guidance and the change is free: `bcrypt.compare()` reads the cost
  from the stored hash, so this needs no migration and doesn't affect
  any existing hash (none exist yet in this project's data — this is a
  from-scratch app).
- **Timing side-channel fixed:** `authorize()` previously returned early
  (`if (!user) return null`) before ever calling `bcrypt.compare()`,
  making "no such account" measurably faster than "wrong password" — a
  real, exploitable enumeration channel independent of the resend/register
  behavior in §5. It now always calls `bcrypt.compare()`, against the
  real hash if a user was found or a fixed dummy hash otherwise (§ see
  `DUMMY_PASSWORD_HASH` in `auth.js`), so both branches do the same
  amount of work.

## 8. Is in-memory rate limiting suitable for this deployment?

No — and the one place that had it (resend-verification's cooldown
`Map`) has been replaced. This app's target deployment is Next.js on top
of MongoDB Atlas (per `.env.example` / the existing transaction-handling
code), which typically means either multiple long-lived server instances
behind a load balancer, or a serverless/edge runtime with many
short-lived ones. A counter kept in a module-level `Map`:
- only limits requests that land on the same warm instance — with more
  than one instance (the normal case, not an edge case) it stops
  providing real protection, while still *looking* correct in a
  single-instance local test;
- resets to zero on every cold start or redeploy, so an attacker who can
  cause or wait for either gets a fresh budget.

That's a correctness gap, not just a hardening nice-to-have — it's
exactly the shape of bug that makes a rate limit pass every local test
and then do nothing in production.

**What was done instead:** `src/lib/rateLimit.js` implements a fixed-window
counter backed by a new `RateLimitAttempt` collection in the same MongoDB
database the app already requires. This adds no new infrastructure (no
Redis, no third-party service) and gives every instance — however many
there are, however long they live — a single consistent view of attempt
counts, using MongoDB's own per-document atomicity (`findOneAndUpdate`
with an aggregation pipeline) rather than a transaction.

**Documented limitations of this approach**, so it isn't mistaken for
more than it is:
- **Fixed window, not sliding/token-bucket.** A caller right at a window
  boundary can get up to ~2x the nominal limit (e.g., near the end of one
  10-minute window and the start of the next). This doesn't meaningfully
  help an attacker running hundreds or thousands of automated attempts,
  which is the actual threat model — it's called out here for accuracy,
  not because it's a practical hole.
- **Fails open.** If the rate-limit check itself errors (a transient
  Atlas blip, a connection hiccup), `checkRateLimit()` logs the error and
  returns "not limited" rather than blocking the request. A broken
  limiter degrading to "no extra protection" was judged better than a
  broken limiter taking down login/registration/resend entirely. This
  means a sustained DB outage affecting only the rate-limit path (an
  unusual failure mode) would leave these endpoints temporarily
  unprotected by rate limiting, though still functioning normally
  otherwise.
- **Adds one extra DB round-trip** per login/register/resend call (two,
  for login and resend, which check both an email- and IP-keyed bucket
  in parallel via `Promise.all`). Negligible against Atlas's normal
  latency budget for an auth flow, but worth noting as a cost of this
  design versus a purely in-process one.
- **IP extraction is best-effort and spoofable** — see §9 below.
- **Not verified against live concurrent traffic.** Every test in this
  phase runs against an in-memory fake of the `RateLimitAttempt` model
  (a generic evaluator for the exact aggregation pipeline
  `checkRateLimit()` builds — see `__manual_test__/fakeRateLimitModel.cjs`),
  not a real MongoDB server. This proves the pipeline's own logic is
  correct for every state it can encounter, and that `checkRateLimit()`'s
  control flow (upsert options, the duplicate-key retry, failing open) is
  wired correctly. It does **not** prove MongoDB actually serializes two
  real concurrent `findOneAndUpdate` calls against the same document the
  way its own documentation says it does — that's a property of MongoDB
  itself, not something this sandbox can independently verify without a
  live replica set. **Recommended manual test before relying on this in
  production:** from two separate processes/terminals hitting a real
  Atlas cluster, fire concurrent requests at `/api/auth/register` (or a
  small script calling `checkRateLimit` directly) with the same key and
  confirm the final count matches the number of calls exactly, with no
  double-counted or dropped increments.

## 9. Client IP extraction (`src/lib/clientIp.js`)

Read from `x-forwarded-for` (first entry) or `x-real-ip`, falling back to
`"unknown"`. This is explicitly best-effort and **only used to key
rate-limit buckets**, never for any access-control or trust decision — a
spoofed header just puts that request in a different bucket than its
real source, it can't be used to bypass a limit tied to something else
(email, token) or impersonate another IP's bucket. Validating a specific
trusted-proxy chain (e.g., only trusting `x-forwarded-for` when the
connection came from a known load balancer) is a hosting-platform
concern and wasn't added here — if this app is deployed somewhere that
doesn't reliably set/overwrite this header (unlike Vercel and most
reverse proxies), the per-IP limits degrade to "everyone with a header-stripping
client shares one bucket," while the per-email/per-token limits are
unaffected.

## Not changed / explicitly out of scope

- NextAuth's `CredentialsProvider` and JWT session strategy — preserved
  as-is; no demonstrated security reason to change either.
- The existing email-verification *requirement* for login — unchanged.
- Kanban ordering, attachments, and any other business logic outside
  authentication — untouched, per this phase's scope.
- No new external services or dependencies were added; `npm audit`
  reports 0 vulnerabilities both before and after this phase.
