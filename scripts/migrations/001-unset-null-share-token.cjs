#!/usr/bin/env node
//
// One-off data migration for audit issue C1.
//
// Older versions stored `shareToken: null` on every Project that wasn't
// shared. The unique sparse index on `shareToken` indexes an explicit null
// (sparse only skips *missing* fields), so a second such project collides
// with the first (E11000). This removes the field from those documents.
//
// - Touches ONLY documents where shareToken is stored as BSON null
//   (`$type: "null"`). Documents with no shareToken, and documents with a
//   real string token, are never matched.
// - Idempotent: once converted, nothing matches, so re-running is a no-op.
// - Dry run by default. Pass --apply to write.
// - Verifies afterwards that the number of string tokens is unchanged and
//   that no null remains; exits non-zero if not.
// - Reports the shareToken index definition and whether it is the expected
//   unique + sparse shape. It never drops or rebuilds indexes itself.
//
// Usage:
//   MONGODB_URI="mongodb+srv://..." node scripts/migrations/001-unset-null-share-token.cjs          # dry run
//   MONGODB_URI="mongodb+srv://..." node scripts/migrations/001-unset-null-share-token.cjs --apply  # write

const NULL_FILTER = { shareToken: { $type: "null" } };
const STRING_FILTER = { shareToken: { $type: "string" } };

function describeIndex(indexes) {
  const idx = (indexes || []).find((i) => i.key && Object.keys(i.key).length === 1 && i.key.shareToken === 1);
  if (!idx) return { found: false, ok: false, note: "no { shareToken: 1 } index exists (it will be created by Mongoose autoIndex on next app start)" };
  const ok = idx.unique === true && idx.sparse === true && !idx.partialFilterExpression;
  return {
    found: true,
    ok,
    name: idx.name,
    note: ok
      ? "unique + sparse (expected)"
      : `UNEXPECTED definition ${JSON.stringify({ unique: !!idx.unique, sparse: !!idx.sparse, partialFilterExpression: idx.partialFilterExpression })} — see the index procedure in the C1 notes`,
  };
}

// `collection` is a MongoDB driver Collection (also works with Mongoose's
// `connection.collection(...)`). Exported so the test suite can drive it.
async function migrate(collection, { apply = false } = {}) {
  const nullBefore = await collection.countDocuments(NULL_FILTER);
  const stringBefore = await collection.countDocuments(STRING_FILTER);

  let modified = 0;
  if (apply && nullBefore > 0) {
    const res = await collection.updateMany(NULL_FILTER, { $unset: { shareToken: "" } });
    modified = res.modifiedCount;
  }

  const nullAfter = await collection.countDocuments(NULL_FILTER);
  const stringAfter = await collection.countDocuments(STRING_FILTER);
  const indexes = await collection.indexes().catch(() => []);

  return {
    apply,
    nullBefore,
    stringBefore,
    modified,
    nullAfter,
    stringAfter,
    index: describeIndex(indexes),
    // Valid tokens must be untouched; after --apply nothing may remain null.
    ok: stringAfter === stringBefore && (apply ? nullAfter === 0 : nullAfter === nullBefore),
  };
}

async function main() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI is not set.");
    process.exit(2);
  }
  const apply = process.argv.includes("--apply");
  const mongoose = require("mongoose");
  await mongoose.connect(uri);
  try {
    const collection = mongoose.connection.collection("projects");
    console.log(apply ? "Mode: APPLY (writing)" : "Mode: DRY RUN (no writes; pass --apply to write)");
    const r = await migrate(collection, { apply });
    console.log(`Projects with a null shareToken  before: ${r.nullBefore}   after: ${r.nullAfter}`);
    console.log(`Projects with a string token     before: ${r.stringBefore}   after: ${r.stringAfter}`);
    if (apply) console.log(`Documents modified: ${r.modified}`);
    console.log(`shareToken index: ${r.index.found ? r.index.name + " — " : ""}${r.index.note}`);
    if (!r.ok) {
      console.error("Verification FAILED — string token count changed or nulls remain.");
      process.exitCode = 1;
    } else if (!r.index.ok && r.index.found) {
      process.exitCode = 3;
    }
  } finally {
    await mongoose.disconnect();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = { migrate, describeIndex, NULL_FILTER, STRING_FILTER };
