import bcryptjs from "bcryptjs";

// The one place passwords are hashed and verified (L19).
//
// Why this exists: bcryptjs is pure JavaScript. Its async API yields to the
// event loop between chunks of work, but every cost-12 hash or comparison
// (~300 ms of CPU) still runs on the same thread that serves requests, so
// under load other requests stall behind it. The native `bcrypt` addon runs
// the same algorithm on libuv's thread pool and leaves the main thread free.
//
// Nothing about the stored data changes:
//   - Both libraries implement the same bcrypt, so each verifies hashes made
//     by the other. Existing `$2a$` hashes (bcryptjs) keep working with the
//     native addon, and new `$2b$` hashes (native) are accepted by bcryptjs,
//     so switching back is always possible. No migration, no rehash on login.
//   - The cost stays 12 (BCRYPT_COST below; the dummy hash in lib/auth.js has
//     the same cost, which is what keeps "no such account" and "wrong
//     password" equally slow).
//   - Inputs over bcrypt's 72-byte limit are rejected by lib/passwordPolicy.js
//     before they reach here, exactly as before.
//
// The native addon is optional (package.json `optionalDependencies`). If it
// can't be loaded in some environment, this falls back to bcryptjs, which is
// the behavior the app had before this file existed. Set
// PASSWORD_HASHER=bcryptjs to force the fallback (an operational switch, and
// what the existing test files use so they keep exercising bcryptjs).

export const BCRYPT_COST = 12;

let nativeTried = false;
let nativeBcrypt = null;

function loadNative() {
  if (nativeTried) return nativeBcrypt;
  nativeTried = true;
  try {
    // A plain require inside try/catch: if the package or its binary is
    // missing, bundlers treat it as optional rather than failing the build.
    const mod = require("bcrypt");
    const impl = mod?.default ?? mod;
    if (typeof impl?.hash === "function" && typeof impl?.compare === "function") nativeBcrypt = impl;
  } catch (err) {
    console.warn(`[passwordHash] native bcrypt unavailable, using bcryptjs (${err?.code || err?.message || "unknown error"})`);
  }
  return nativeBcrypt;
}

function implementation() {
  if (process.env.PASSWORD_HASHER === "bcryptjs") return bcryptjs;
  return loadNative() ?? bcryptjs;
}

// Which library is in use right now; for diagnostics and tests.
export function passwordHasherName() {
  return implementation() === bcryptjs ? "bcryptjs" : "bcrypt";
}

export function hashPassword(password) {
  return implementation().hash(password, BCRYPT_COST);
}

export function verifyPassword(password, hash) {
  return implementation().compare(password, hash);
}
