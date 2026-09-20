import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { verifyVerificationToken } from "@/lib/verificationToken";
import { normalizeEmail } from "@/lib/normalizeEmail";
import { parseJsonBody } from "@/lib/parseJsonBody";
import { isValidObjectId } from "@/lib/objectId";

function invalidTokenResponse() {
  return NextResponse.json({ error: "This verification link is invalid or has expired" }, { status: 400 });
}

export async function POST(req) {
  const body = await parseJsonBody(req);
  const token = body?.token;
  if (typeof token !== "string" || !token) {
    return NextResponse.json({ error: "Missing token" }, { status: 400 });
  }

  let payload;
  try {
    payload = verifyVerificationToken(token);
  } catch {
    return invalidTokenResponse();
  }

  // The token carries a userId straight from client input (albeit signed) —
  // validate its shape before it ever reaches Mongoose, or a malformed id
  // throws an uncaught CastError and this route 500s instead of 400ing.
  if (!isValidObjectId(payload.userId)) {
    return invalidTokenResponse();
  }

  await connectDB();

  const tokenEmail = normalizeEmail(payload.email);

  // A single atomic find-and-update, rather than a separate findById +
  // manual field checks + save(): the lookup (matching on id, current
  // email, and current tokenVersion all at once) and the mutation
  // (flipping emailVerified, bumping tokenVersion) happen as one
  // document operation. That closes a real race — two requests carrying
  // the *same* token (e.g. an email client prefetching links, or a
  // double-submit) previously could both pass a separate "is this
  // already verified?" check before either had saved, and each would
  // independently set `tokenVersion = payload.tokenVersion + 1`; if both
  // saves landed, the net effect was tokenVersion advancing by only 1
  // instead of 2, quietly weakening the intended "each token works
  // exactly once" guarantee under concurrency. With the match condition
  // and the update in the same atomic operation, at most one of any
  // number of concurrent requests for the same token can ever match and
  // succeed — every other one (including a genuine replay afterward)
  // finds no document with that exact tokenVersion anymore and falls
  // through to the generic invalid-token response below.
  const user = await User.findOneAndUpdate(
    { _id: payload.userId, email: tokenEmail, tokenVersion: payload.tokenVersion },
    { $set: { emailVerified: true }, $inc: { tokenVersion: 1 } }
  );

  // Deliberately the same generic message for every failure mode here —
  // no such user, a token issued for an email the account no longer has,
  // or a tokenVersion that's already moved on (already used, or stale) —
  // so the response can't be used to tell these apart or enumerate
  // accounts.
  if (!user) {
    return invalidTokenResponse();
  }

  return NextResponse.json({ ok: true });
}
