import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Project from "@/models/Project";
import { isValidObjectId } from "@/lib/objectId";
import { generateShareToken } from "@/lib/shareToken";
import { withMongoErrorHandling } from "@/lib/mongoErrors";

// Kept separate from the main project DTO (see lib/serialize.js's
// toProjectDTO) on purpose: only the manager should ever see the share
// link, and there's no reason for every project fetch — including ones
// made by ordinary members/editors — to carry it. `shareUrl` is a
// relative path; the frontend prefixes it with its own origin when
// building the copyable link, so this route never needs to guess the
// deployment's public URL.
function shareStatus(project) {
  return {
    shareEnabled: !!project.shareEnabled,
    shareUrl: project.shareEnabled && project.shareToken ? `/shared/board/${project.shareToken}` : null,
  };
}

async function loadProjectAsManager(id, userId) {
  if (!isValidObjectId(id)) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };

  const project = await Project.findById(id).lean();
  if (!project) return { error: NextResponse.json({ error: "Project not found" }, { status: 404 }) };

  if (String(project.manager) !== userId) {
    return { error: NextResponse.json({ error: "Only the project manager can manage sharing" }, { status: 403 }) };
  }

  return { project };
}

// Current sharing status — used to populate the Share dialog whenever the
// manager opens it, including after a page reload (the link itself is
// stored as plain text specifically so it can be shown again like this;
// see models/Project.js).
export async function GET(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await params;
  await connectDB();

  const { project, error } = await loadProjectAsManager(id, session.user.id);
  if (error) return error;

  return NextResponse.json(shareStatus(project));
}

// Enables sharing (if it isn't already) and/or issues a brand-new token,
// invalidating whatever link existed before — this is both "Enable
// Sharing" and "Regenerate Link" from the UI, which only differ in
// whether a link already existed.
export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await params;
  await connectDB();

  const { project, error } = await loadProjectAsManager(id, session.user.id);
  if (error) return error;

  return withMongoErrorHandling(async () => {
    // Retried on the extremely unlikely chance a fresh 192-bit token
    // collides with one already stored on another project — the unique
    // index (see models/Project.js) is what actually prevents a
    // collision from being saved; this just means a request doesn't fail
    // outright if it happens to land on that one-in-billions case.
    for (let attempt = 0; attempt < 3; attempt++) {
      const token = generateShareToken();
      try {
        await Project.updateOne({ _id: id }, { $set: { shareEnabled: true, shareToken: token } });
        return NextResponse.json(shareStatus({ ...project, shareEnabled: true, shareToken: token }));
      } catch (err) {
        if (err?.code !== 11000 || attempt === 2) throw err;
      }
    }
  });
}

// Disables sharing and clears the token in the same update, so this one
// action is both "Disable Sharing" and an immediate revoke — a link
// captured before this call stops working the instant it lands, and
// turning sharing back on later always starts from a fresh token rather
// than reviving the old one.
export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });

  const { id } = await params;
  await connectDB();

  const { error } = await loadProjectAsManager(id, session.user.id);
  if (error) return error;

  return withMongoErrorHandling(async () => {
    await Project.updateOne({ _id: id }, { $set: { shareEnabled: false, shareToken: null } });
    return NextResponse.json({ shareEnabled: false, shareUrl: null });
  });
}
