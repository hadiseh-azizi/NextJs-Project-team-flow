// Shared by 10-rate-limit.test.cjs and 11-auth-hardening.test.cjs. See the
// header comment in 10-rate-limit.test.cjs for what this fake does and
// does not prove: it's a generic evaluator for the specific aggregation
// pipeline shape src/lib/rateLimit.js builds ($set / $cond / $or / $eq /
// $lte / $add over `count` and `expiresAt`), backing an in-memory
// Map<key, doc> instead of a real MongoDB collection.

function evalExpr(expr, doc) {
  if (expr instanceof Date) return expr;
  if (typeof expr === "string" && expr.startsWith("$")) return doc ? doc[expr.slice(1)] : undefined;
  if (expr === null || typeof expr !== "object") return expr;
  if (Array.isArray(expr)) return expr.map((e) => evalExpr(e, doc));
  const op = Object.keys(expr)[0];
  const args = expr[op];
  // MongoDB's aggregation comparison operators treat a missing field the
  // same as an explicit `null` (unlike plain JS `undefined === null`,
  // which is false) — normalized here so a brand-new document with no
  // `expiresAt` yet behaves the same as real Mongo would.
  const toComparable = (v) => {
    if (v === undefined) return null;
    return v instanceof Date ? v.getTime() : v;
  };
  switch (op) {
    case "$eq": {
      const [a, b] = evalExpr(args, doc);
      return toComparable(a) === toComparable(b);
    }
    case "$or":
      return evalExpr(args, doc).some(Boolean);
    case "$lte": {
      const [a, b] = evalExpr(args, doc);
      return toComparable(a) <= toComparable(b);
    }
    case "$add": {
      const [a, b] = evalExpr(args, doc);
      return a + b;
    }
    case "$cond": {
      const [cond, thenV, elseV] = args;
      return evalExpr(cond, doc) ? evalExpr(thenV, doc) : evalExpr(elseV, doc);
    }
    default:
      throw new Error(`test evaluator: unsupported operator ${op}`);
  }
}

function applyPipeline(pipeline, existingDoc) {
  let doc = existingDoc ? { ...existingDoc } : {};
  for (const stage of pipeline) {
    if (!stage.$set) throw new Error("test evaluator: unsupported pipeline stage");
    const updates = {};
    for (const [field, expr] of Object.entries(stage.$set)) {
      updates[field] = evalExpr(expr, doc);
    }
    doc = { ...doc, ...updates };
  }
  return doc;
}

function makeFakeRateLimitModel() {
  const store = new Map();
  const duplicateOnce = new Set();
  let forcedError = null;

  return {
    async findOneAndUpdate(filter, pipeline, options = {}) {
      if (forcedError) throw forcedError;
      const key = filter.key;
      const existing = store.get(key) || null;
      if (!existing && duplicateOnce.has(key)) {
        duplicateOnce.delete(key);
        throw Object.assign(new Error("E11000 duplicate key"), { code: 11000 });
      }
      if (!existing && !options.upsert) return null;
      const updated = applyPipeline(pipeline, existing);
      updated.key = key;
      store.set(key, updated);
      return { ...updated };
    },
    __store: store,
    __forceDuplicateOnce: (key) => duplicateOnce.add(key),
    __forceError: (err) => {
      forcedError = err;
    },
    __clearForcedError: () => {
      forcedError = null;
    },
  };
}

module.exports = { makeFakeRateLimitModel };
