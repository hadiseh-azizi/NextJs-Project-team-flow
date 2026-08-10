import { NextResponse } from "next/server";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import { createVerificationToken } from "@/lib/verificationToken";
import { sendVerificationEmail } from "@/lib/email";

export async function POST(req) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: "Email is required" }, { status: 400 });

  await connectDB();

  const user = await User.findOne({ email });

  // Always respond the same way whether or not the account exists (and
  // whether or not it's already verified) — this avoids leaking which
  // emails have accounts on this app.
  if (user && !user.emailVerified) {
    const token = createVerificationToken(String(user._id), user.email);
    await sendVerificationEmail({ to: user.email, name: user.name, token });
  }

  return NextResponse.json({ ok: true });
}
