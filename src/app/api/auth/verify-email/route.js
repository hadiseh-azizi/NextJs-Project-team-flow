import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { verifyVerificationToken } from "@/lib/verificationToken";

export async function POST(req) {
  const { token } = await req.json();
  if (!token) return NextResponse.json({ error: "Missing token" }, { status: 400 });

  let payload;
  try {
    payload = verifyVerificationToken(token);
  } catch {
    return NextResponse.json({ error: "This verification link is invalid or has expired" }, { status: 400 });
  }

  await connectDB();

  const user = await User.findById(payload.userId);
  if (!user) return NextResponse.json({ error: "Account not found" }, { status: 404 });

  if (!user.emailVerified) {
    user.emailVerified = true;
    await user.save();
  }

  return NextResponse.json({ ok: true, email: user.email });
}
