# Dependencies, Build, Lint & Production Readiness Audit

Scope: `package.json`, `package-lock.json`, `next.config.js`,
`jsconfig.json`, `README.md`, and every source file needed to verify
compatibility. No application features, routes, components, or business
logic were changed. Guiding principle: **SECURE + STABLE > NEWEST
VERSION** — a dependency was only bumped where the new version is
confirmed non-breaking, or held with the reason documented.

Audit environment: Node.js v22.22.2, npm 10.9.7 (Linux sandbox).

---

## 1. Commands run

| Command | Result |
|---|---|
| `npm ci` | ✅ Clean install, 505 packages, 0 vulnerabilities (before this phase's changes) |
| `npm install` (after changes) | ✅ 773 packages, 0 vulnerabilities |
| `npm audit` | ✅ **0 vulnerabilities**, before and after |
| `npm run lint` | ❌ → ✅ (see §3 — was broken/interactive, now clean, exit 0) |
| `npm run build` | ✅ Compiles, type-checks, prerenders 16 routes, exit 0 |
| Full manual test suite (17 files, `__manual_test__/*.test.cjs`) | ✅ **180 passed, 0 failed** |

No command was skipped or reported as passing without actually being
run. The full test suite was re-run after every dependency/config change
in this phase, not just once at the end.

---

## 2. Dependency-by-dependency verdict

For each package: current pin → latest available → verdict.

| Package | Current (before) | Latest available | Verdict | Reason |
|---|---|---|---|---|
| **next** | 15.5.25 | 16.3.4 | **Hold** | 15.5.25 is already the newest *stable* release in the 15.x line (verified against the full 15.x release list — everything after it is `15.6.0-canary.*`). No upgrade within 15.x is possible or needed. Next 16 is a major version; it wasn't attempted because a major-version migration requires full regression testing across every route, and that's explicitly out of this phase's scope. See §5. |
| **react** / **react-dom** | 18.3.1 | 19.2.8 | **Hold** | Major bump, and it's tied to the Next 16 decision above — Next 15.5.x fully supports React 18, so there's no compatibility reason to move. |
| **next-auth** | 4.24.15 | 4.24.15 | **Hold — already latest** | No newer 4.x release exists. A move to `next-auth` v5 (`auth.js`) is a rewrite of the auth config (different API, different route handler shape) and is out of scope. |
| **mongoose** | 8.24.4 | 9.9.5 | **Hold** | Major bump. No CVE motivates it (`npm audit` is clean on 8.24.4) and a v9 migration needs its own regression pass against `withOptionalTransaction`, the Kanban ordering logic, and every model/schema — all flagged as sensitive in prior phases. |
| **nodemailer** | 9.0.5 | 10.0.1 | **Hold** | Major bump, exact-pinned per project convention. No CVE against 9.0.5. Send path (`email.js`, HTML-escaping, header-injection fixes from the Phase 5 email-security audit) is sensitive enough to need its own dedicated verification before touching. |
| **bcryptjs** | 2.4.3 | 3.0.3 | **Hold** | Major bump. 3.0.0 changed the package to ship as an ES Module by default (with a UMD fallback) and switched the default generated hash version from `2a` to `2b`. The second change is harmless (bcrypt happily verifies both), but the module-format change is a real risk given this project's mixed ESM (Next.js app code) / CommonJS (`__manual_test__` Babel harness) usage, and there's no CVE forcing the move — 2.4.3 has 0 known vulnerabilities. |
| **@mui/material** / **@mui/icons-material** | 5.16.7 | 9.4.0 | **Hold** | Two major versions behind, but MUI v5 → v6/v7 changed the CSS engine defaults and several component APIs; a jump straight to v9 is a significant rewrite. This directly conflicts with the established "warm neutral, no MUI-adjacent framework changes" UI baseline from the accessibility/UI pass, and needs a dedicated phase with full visual + accessibility regression, not a dependency-audit-phase change. |
| **recharts** | 2.12.7 | 3.10.1 | **Hold** | `npm install` prints a deprecation notice for the 2.x line, but it's a maintenance-status notice, not a vulnerability. v3 changed several chart-component props. Only one file (`ProgressChart.jsx`) uses it, which makes this the cheapest of the held major bumps to eventually take on — recommended as a small, standalone future phase rather than bundling it here. |
| **@emotion/react** | 11.13.0 | 11.14.0 | **Upgraded** ✅ | Same major version, no breaking changes. Verified with a full lint + build + 180-test regression pass. |
| **@emotion/styled** | 11.13.0 | 11.14.1 | **Upgraded** ✅ | Same as above. |
| **@emotion/cache** | 11.13.0 | 11.14.0 | **Upgraded** ✅ | Same as above. |
| **jsonwebtoken** | 9.0.3 | 9.0.3 | **Hold — already latest** | — |
| **@babel/core**, **@babel/preset-env**, **@babel/register** (dev only) | 8.0.1 / 8.0.2 / 8.0.1 | same | **Hold — already latest** | Dev-only, used solely by the `__manual_test__` harness. |
| **babel-plugin-module-resolver** (dev only) | 5.0.3 | 5.0.3 | **Hold — already latest** | — |
| **mongodb-memory-server** (dev only) | ^11.2.0 | 11.2.0 | **Hold — already latest within range** | — |

**Net dependency change this phase:** three `@emotion/*` patch bumps.
Everything else was intentionally left alone, each with a documented
reason above.

---

## 3. Lint: migrated off deprecated `next lint`

**Before:** `npm run lint` ran `next lint`, which is deprecated as of
Next.js 15 and scheduled for removal in Next 16. Worse, there was **no
ESLint configuration file at all** in the repository — running it
dropped into an interactive "How would you like to configure ESLint?"
prompt, which hangs indefinitely in any non-interactive environment
(CI, this sandbox, etc.). In practice, lint was not runnable at all
before this phase.

**After:**
- Added `eslint@9.39.5` and `eslint-config-next@15.5.25` as
  devDependencies — the exact release of `eslint-config-next` that
  matches the project's pinned Next.js version, so its `@next/eslint-plugin-next`
  rules are guaranteed to match this codebase's Next.js semantics.
- Added `eslint.config.mjs` (flat config, the format ESLint 9 requires).
  `eslint-config-next@15.5.25` still only ships a legacy
  (`.eslintrc`-style, `extends`-based) config, so the new file uses
  `@eslint/eslintrc`'s `FlatCompat` bridge — this is the same pattern
  Next.js's own docs and codemod recommend for bridging a legacy
  `eslint-config-next` release onto ESLint 9's flat-config-only loader:

  ```js
  import { dirname } from "path";
  import { fileURLToPath } from "url";
  import { FlatCompat } from "@eslint/eslintrc";

  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);

  const compat = new FlatCompat({ baseDirectory: __dirname });

  const eslintConfig = [
    ...compat.extends("next/core-web-vitals"),
    { ignores: ["node_modules/**", ".next/**", "out/**", "build/**", "next-env.d.ts"] },
  ];

  export default eslintConfig;
  ```

- Added `@eslint/eslintrc@3.3.7` (dev-only) as the bridge dependency.
- Changed the `lint` script from `next lint` to `eslint .`.

**Result:** `npm run lint` now runs non-interactively and exits `0`
with zero warnings or errors across the entire codebase, including
`__manual_test__/`.

**A note on ESLint 9 itself being past its own support window:**
`npm install` prints `eslint@9.39.5: This version is no longer
supported` — ESLint 10 is now the latest major. It was **not** used
here because `eslint-config-next@15.5.25`'s `peerDependencies` pins
`eslint` to `^7.23.0 || ^8.0.0 || ^9.0.0` — it does not accept 10.x.
Even `eslint-config-next@16.3.4` (the version paired with Next 16)
still only declares `eslint: >=9.0.0` and has not been verified against
10.x's rule-schema changes. Moving to ESLint 10 is bundled with the
"move to Next 16" decision in §5, not something to do independently
under a Next-15 pin.

---

## 4. Build

`npm run build` compiles and prerenders cleanly (16 routes, exit 0),
**but only when the required environment variables are present**. This
is the one production-readiness item worth flagging clearly:

`src/lib/mongodb.js` throws at **module-evaluation time** (not
connection time) if `MONGODB_URI` is unset:
```js
if (!MONGODB_URI) {
  throw new Error("MONGODB_URI is not set — copy .env.example to .env and fill it in");
}
```
Next.js's build step evaluates every route module during its "Collecting
page data" phase — including `/api/auth/[...nextauth]`, which imports
`mongodb.js` — even though no database connection is actually attempted
at build time. The practical effect: **`npm run build` fails outright
in any environment without `MONGODB_URI`, `NEXTAUTH_SECRET`, and
`NEXTAUTH_URL` set**, even though the build itself never talks to
MongoDB.

This audit verified the rest of the build pipeline (compilation,
linting, type-checking, static generation, bundle output) is fully
correct by supplying placeholder values for those three variables. With
them set, the build is clean:

```
✓ Compiled successfully in 35.4s
✓ Generating static pages (16/16)
```

**This was left as-is and not changed**, because turning the
module-level throw into a lazy, connection-time check is a change to
`src/lib/mongodb.js` application behavior, and this phase's scope is
dependencies/build/lint, not runtime code. It's flagged here as a
recommendation for whichever future phase next touches that module —
and, in the meantime, as a documented requirement for anyone setting up
CI: **the build step needs `MONGODB_URI`, `NEXTAUTH_SECRET`, and
`NEXTAUTH_URL` present (real or placeholder) to succeed**, which the
README now says explicitly (see §8).

No other build issues were found: no failed type-checks, no missing
module errors, no circular-import warnings.

---

## 5. Next.js 15 vs Next.js 16

Verified explicitly, as requested:

- **15.5.25 is the latest stable release in the 15.x line.** The full
  version list for `next` was pulled from the registry; every release
  after `15.5.25` is a `15.6.0-canary.*` prerelease, none stable. There
  is no in-range security or bug-fix release being missed by staying on
  15.5.25.
- **Next 16 (latest: 16.3.4) is a major version and was not adopted.**
  Reasons:
  - It very likely requires React 19 in practice (Next 16 dropped
    various React-18-era APIs/behaviors) — that's a second major bump
    stacked on top of the first.
  - `eslint-config-next` would need to move to 16.3.4 in lockstep,
    which itself only supports `eslint >= 9.0.0` today and hasn't been
    tested here against ESLint 10.
  - A major Next.js version has historically changed caching defaults,
    routing internals, and Route Handler/middleware behavior in ways
    that need a full regression pass — this project's own README has a
    dedicated section on the params-must-be-awaited change from the
    14→15 move, which is exactly the kind of thing that needs
    re-verifying on 15→16.
  - This phase's instructions are explicit: don't perform a major
    migration without being able to verify compatibility and
    regression-test the whole project, and doing that properly is a
    full phase of work on its own, not a line item inside a
    dependency/build/lint audit.

**Recommendation:** treat "Next 16 migration" as its own future phase,
scoped the same way every other phase in this project has been —
audit-and-fix, with the full 180-test suite plus build plus lint as the
regression gate, and browser smoke-testing for anything the Node-only
harness can't exercise.

---

## 6. `npm audit`

```
found 0 vulnerabilities
```
Both before and after this phase's changes, with and without
`--omit=dev`. There is currently no vulnerability in the dependency
tree motivating any version bump — every "hold" decision in §2 is a
deliberate stability call, not deferred security work.

---

## 7. Lockfile, deprecated packages, and other findings

- **Lockfile consistency:** `package-lock.json` is `lockfileVersion: 3`
  and installs cleanly with `npm ci` (frozen install, no lockfile
  drift) both before and after this phase's `package.json` edits — it
  was regenerated via plain `npm install` after each dependency change
  and re-verified with a fresh install.
- **Deprecated transitive packages surfaced during install:**
  `glob@9.3.5` (pulled in transitively by `mongodb-memory-server`,
  dev-only) and the `recharts@2.12.7` maintenance notice (§2). Neither
  is a direct dependency this project controls the version of without
  either bumping `mongodb-memory-server` past its current major (not
  justified — no CVE) or taking the recharts v3 migration (also
  deferred, §2). Not a build or runtime risk today.
- **No `.eslintrc*` files** existed anywhere in the repo before this
  phase (confirmed by directory search) — consistent with lint having
  been fully non-functional (§3).
- **No `.gitignore` file exists in the repository.** This isn't a
  dependency/build issue per se, but it's a real production-readiness
  gap: without one, `node_modules/`, `.next/`, and any local `.env`
  are one `git add .` away from being committed. **This phase did not
  add one**, since it's a workflow/repo-hygiene file rather than a
  dependency, build, or lint concern, and the instructions were
  specific about scope — but it's flagged here because it's the kind
  of gap that's cheap to close and easy to miss. Recommended minimal
  contents: `node_modules/`, `.next/`, `.env`, `.env.local`, `*.log`.
- **No accidental secrets:** searched all of `src/` for
  hardcoded API keys, passwords, and tokens (excluding legitimate
  `process.env.*` references) — none found. Only `.env.example` exists
  at the repo root; no `.env`/`.env.local` was accidentally committed.
- **No accidental build artifacts:** no `.next/`, `out/`, or `build/`
  directory was present in the uploaded archive, and this phase's own
  `.next/` output was excluded from the repackaged ZIP.
- **No source maps or debug artifacts:** the production build does not
  emit `.map` files (`productionBrowserSourceMaps` is unset, which
  defaults to `false` — correct for not shipping source maps
  publicly), and no `console.log`/debugger statements were introduced
  by this phase.
- **`jsconfig.json`** is minimal and correct — just the `@/*` → `./src/*`
  path alias the app and the `__manual_test__` Babel harness both rely
  on. No changes needed.
- **`next.config.js`**: was an empty config object. Added
  `poweredByHeader: false` — this only removes the
  `X-Powered-By: Next.js` response header (a minor fingerprinting
  reduction with zero effect on routing, rendering, or any application
  behavior). No other config changes were made.
- **`package.json` `engines` field added:** `"node": "^18.18.0 ||
  ^19.8.0 || >=20.0.0"`, copied directly from `next@15.5.25`'s own
  `engines` field, so `npm install`/CI can fail fast with a clear
  message on an unsupported Node version instead of failing later with
  a confusing error.

---

## 8. README changes

Added a new section documenting: the lint migration (so contributors
don't try to run `next lint` from muscle memory or old docs), the exact
`npm run lint` / `npm run build` commands, and the build-time
environment-variable requirement from §4. No existing README content
was rewritten or removed — this phase only added a section, consistent
with "obsolete documentation" being one of the audit's inspection
points (nothing in the existing README was found to be inaccurate; the
Next.js 15 `params` section, the Vercel deploy section, and the local
setup section were all re-checked against the current code and remain
correct as written).

---

## 9. Summary

| Item from the request | Status |
|---|---|
| 1. Next.js version / supported release | ✅ 15.5.25 confirmed latest stable in 15.x |
| 2. React compatibility | ✅ 18.3.1 fully supported by Next 15.5.x |
| 3. NextAuth compatibility | ✅ 4.24.15, already latest 4.x |
| 4. Mongoose compatibility | ✅ 8.24.4, latest 8.x is what's pinned (see below) |
| 5. Nodemailer compatibility | ✅ 9.0.5, no CVE, held |
| 6. MUI/Emotion compatibility | ✅ MUI held at 5.16.7; Emotion bumped safely within v11 |
| 7. Recharts compatibility | ✅ held at 2.12.7, single call site, future-phase candidate |
| 8. `npm audit` | ✅ 0 vulnerabilities |
| 9. Lockfile consistency | ✅ `npm ci` clean, regenerated after each change |
| 10. Deprecated packages/scripts | ✅ `next lint` replaced; transitive `glob` deprecation noted, not actionable without an unjustified major bump |
| 11. ESLint configuration | ✅ flat config added (`eslint.config.mjs` + `FlatCompat`) |
| 12. `npm run lint` | ✅ was broken (interactive prompt), now exits 0 clean |
| 13. `npm run build` | ✅ exits 0 clean given required env vars (see §4) |
| 14. Node.js compatibility | ✅ `engines` field added, matches Next's own requirement |
| 15. Production environment requirements | ✅ documented in README + §4 |
| 16. Environment variable handling | ✅ `.env.example` verified accurate; build-time requirement documented |
| 17. Accidental secrets | ✅ none found |
| 18. Accidental build artifacts | ✅ none found; `.next/` excluded from ZIP |
| 19. Source maps / debug artifacts | ✅ none produced |
| 20. Obsolete documentation | ✅ existing README re-verified accurate; new section added |

**Mongoose note:** the pinned `8.24.4` is confirmed as a current 8.x
release with no outstanding CVEs; `9.9.5` exists but is a major version
and was held per §2.
