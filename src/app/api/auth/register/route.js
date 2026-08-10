import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { connectDB } from "@/lib/mongodb";
import User from "@/models/User";
import Team from "@/models/Team";
import Invitation from "@/models/Invitation";
import { createVerificationToken } from "@/lib/verificationToken";
import { sendVerificationEmail } from "@/lib/email";

export async function POST(req) {
  const { name, email, password } = await req.json();

  if (!name || !email || !password) {
    return NextResponse.json({ error: "All fields are required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }

  await connectDB();

  const existing = await User.findOne({ email }).lean();
  if (existing) {
    return NextResponse.json({ error: "This email is already registered" }, { status: 409 });
  }

  const passwordHash = await bcrypt.hash(password, 10);
  const user = await User.create({ name, email, passwordHash, emailVerified: false });

  // If this email was invited to any teams before signing up, join those
  // teams automatically now and clear the pending invitations.
  const invitations = await Invitation.find({ email: email.toLowerCase() }).lean();
  if (invitations.length > 0) {
    await Team.updateMany(
      { _id: { $in: invitations.map((i) => i.team) } },
      { $addToSet: { members: user._id } }
    );
    await Invitation.deleteMany({ email: email.toLowerCase() });
  }

  // The account exists but can't sign in yet — confirming this email is
  // what proves it's really them.
  const token = createVerificationToken(String(user._id), user.email);
  await sendVerificationEmail({ to: user.email, name: user.name, token });

  return NextResponse.json({ id: String(user._id), email: user.email, requiresVerification: true }, { status: 201 });
}
