# Final Security Patch — Nodemailer 9.1.1

Scope: dependency-only security patch. No refactoring, no
authentication/authorization/rate-limit/Kanban changes, no unrelated
dependency upgrades.

## Security Patch

- **Previous Nodemailer version:** `9.0.5`
- **Final Nodemailer version:** `9.1.1`
- **Reason for update:** `nodemailer@9.0.5` is affected by three
  published advisories (see below); one of them (`GHSA-8m3c-c648-2xjj`)
  has a range of `<=9.1.0`, so `9.1.0` alone would not fully resolve
  it — `9.1.1` was required, not just preferred, to land on a version
  free of all three.

| Advisory | Severity | CVSS | Issue | Fixed in |
|---|---|---|---|---|
| [GHSA-2x7j-588g-ccc2](https://github.com/advisories/GHSA-2x7j-588g-ccc2) | High | 7.5 | Quadratic-time (`O(n²)`) `addressparser` parsing — remote DoS via a crafted address list | 9.1.0 |
| [GHSA-wmmp-3585-3rmp](https://github.com/advisories/GHSA-wmmp-3585-3rmp) | Moderate | 6.5 | IDN/punycode domain allow-list bypass — mail can be routed to an attacker-controlled domain | 9.1.0 |
| [GHSA-8m3c-c648-2xjj](https://github.com/advisories/GHSA-8m3c-c648-2xjj) | Moderate | 5.9 | `resolveContent()` on a `MailMessage` bypasses `disableFileAccess`/`disableUrlAccess` when called with the legacy signature | 9.1.1 |

(These were previously identified as an out-of-scope finding in the
Final Release Cleanup phase — see `FINAL_RELEASE_CLEANUP.md`'s "Out of
Scope Findings" section, now annotated as resolved here.)

## Dependency Changes

- **Files changed:**
  - `package.json` — `nodemailer` bumped `9.0.5` → `9.1.1` in both
    `dependencies` and `overrides`.
  - `package-lock.json` — `nodemailer`'s `version`/`resolved`/
    `integrity` fields updated to match; nothing else in the lockfile
    changed (verified via diff — see below).
  - `CHANGELOG.md` — new entry prepended.
  - `FINAL_RELEASE_CLEANUP.md` — prior phase's "Out of Scope Findings"
    entry annotated as resolved (historical text left intact).
  - `__manual_test__/20-nodemailer-version-regression.test.cjs` — new
    regression test (see below).
  - `__manual_test__/README.md` — new test added to the run list and
    described.
- **Lockfile updated:** Yes.
- **Diff scope (`package-lock.json`):** exactly 8 lines changed, all
  `nodemailer`-related:
  ```
  21c21
  <         "nodemailer": "9.0.5",
  ---
  >         "nodemailer": "9.1.1",
  9624,9626c9624,9626
  <       "version": "9.0.5",
  <       "resolved": ".../nodemailer-9.0.5.tgz",
  <       "integrity": "sha512-wvjiKvj...",
  ---
  >       "version": "9.1.1",
  >       "resolved": ".../nodemailer-9.1.1.tgz",
  >       "integrity": "sha512-izw9mVK...",
  ```
  No other package's version, resolution, or integrity changed.
- **`src/lib/email.js`:** inspected, unchanged. Its `createTransport()`
  call (`host`/`port`/`secure`/`auth`) and `sendMail()` call
  (`to`/`from`/`subject`/`text`/`html`) use only stable, unchanged API
  surface between 9.0.5 and 9.1.1.

## Verification

All of the following were run in this session, in this order, from a
clean `npm ci` install.

| Command | Result | Status |
|---|---|---|
| `npm ci` | `added 772 packages, and audited 773 packages`, 0 vulnerabilities | VERIFIED NOW |
| `npm audit` | `found 0 vulnerabilities` | VERIFIED NOW |
| `npm audit --omit=dev` | `found 0 vulnerabilities` | VERIFIED NOW |
| `npm ls nodemailer` | Single resolved version `9.1.1` (direct + `next-auth`'s peer dep deduped to the same version); no duplicates | VERIFIED NOW |
| `npm run lint` | Clean, no output, exit 0 | VERIFIED NOW |
| `npm run build` | Compiles successfully, all 26 routes prerendered/built, exit 0 | VERIFIED NOW* |
| Manual test suite (20 files, run individually via `node` per `__manual_test__/README.md`) | **201 passed, 0 failed** | VERIFIED NOW |

\* `npm run build` requires `MONGODB_URI` (and the other vars in
`.env.example`) to be set at build time — this is pre-existing app
behavior (`src/lib/mongodb.js` throws at import if unset; already
documented in `README.md` and `PRODUCTION_READINESS_AUDIT.md` from a
prior phase), unrelated to this patch. Verified with the same
placeholder values `.env.example` ships with; no real credentials were
used and no `.env` file was included in the final ZIP.

### Before/after audit comparison

- **Before (nodemailer 9.0.5):** `npm audit` — 1 high, 2 moderate
  (the three advisories listed above).
- **After (nodemailer 9.1.1):** `npm audit` — 0 vulnerabilities.

### New regression test

`__manual_test__/20-nodemailer-version-regression.test.cjs` was added
because the existing email test
(`07-email-html-escaping.test.cjs`) stubs `nodemailer.createTransport`
out entirely to inspect the message it captures — it never calls into
the real, newly-installed package. The new test:

1. Asserts the installed `nodemailer/package.json` version matches
   `9.1.x`.
2. Calls the **real, unstubbed** `nodemailer.createTransport()` with
   the same option shape `email.js` uses, and sends a message through
   nodemailer's built-in `streamTransport` (`buffer: true`) mode — no
   real SMTP connection is opened, no credentials required.
3. Re-runs `sendVerificationEmail()`'s existing no-SMTP-configured
   fallback path with the real (unstubbed) import loaded, confirming
   `email.js`'s module-level code still initializes cleanly against
   9.1.1.

No new test framework, mocking library, or `npm test` script was
added — it follows the existing `__manual_test__/*.cjs` +
`harness.cjs` convention.

## Remaining Vulnerabilities

None. `npm audit` and `npm audit --omit=dev` both report 0
vulnerabilities after the patch.

## Files Changed (summary)

```
package.json
package-lock.json
CHANGELOG.md
FINAL_RELEASE_CLEANUP.md
__manual_test__/20-nodemailer-version-regression.test.cjs   (new)
__manual_test__/README.md
FINAL_SECURITY_PATCH.md                                     (new)
```

No source files under `src/` were modified. No authentication,
authorization, rate-limiting, Kanban, or database logic was touched.
No other dependency was upgraded.

## Known, Pre-Existing Limitations (unchanged by this patch)

- `npm run build` requires `MONGODB_URI`/`NEXTAUTH_SECRET`/
  `NEXTAUTH_URL` to be set — pre-existing, documented behavior.
- Live Atlas replica-set behavior (transactions, TTL sweep, real SMTP
  delivery) has not been exercised against real infrastructure in this
  sandbox — carried forward from every prior phase's report, not new
  or affected by this patch.
- `PRODUCTION_READINESS_AUDIT.md` and `FINAL_AUDIT.md` still list
  nodemailer `9.0.5` in their dependency tables from when those audits
  were written; per this patch's explicit instructions, historical
  audit records were left unmodified rather than rewritten. Only
  `CHANGELOG.md` and `FINAL_RELEASE_CLEANUP.md` were updated, plus
  this new report, as the current, authoritative record of the actual
  shipped version.
