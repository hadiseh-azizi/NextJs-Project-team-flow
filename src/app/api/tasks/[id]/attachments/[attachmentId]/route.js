import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Task from "@/models/Task";
import { toTaskDTO } from "@/lib/serialize";
import { getTaskAccess } from "@/lib/authz";
import { isValidObjectId } from "@/lib/objectId";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { buildContentDisposition } from "@/lib/attachmentPolicy";

// Streams the raw file back with the right headers so the browser downloads
// it (or opens it inline for things like PDFs/images).
export async function GET(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id, attachmentId } = await params;

  // A malformed id can't match any subdocument anyway, so this is just a
  // clean 404 instead of letting an invalid string reach the ObjectId cast.
  if (!isValidObjectId(attachmentId)) return NextResponse.json({ error: "File not found" }, { status: 404 });

  await connectDB();

  // This is the one route that actually needs the attachment's bytes, so
  // it's the one place that opts into loading `attachments.data`. It still
  // loads every attachment on the task (Mongoose subdocument arrays don't
  // support a per-element projection alongside `.id()` lookups), but that's
  // bounded by MAX_TOTAL_ATTACHMENTS_SIZE (see lib/attachmentPolicy.js),
  // not by however many tasks or projects exist.
  const access = await getTaskAccess(id, userId, { includeAttachmentData: true });
  if (!access) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const { task } = access;

  const attachment = task.attachments.id(attachmentId);
  if (!attachment) return NextResponse.json({ error: "File not found" }, { status: 404 });

  const buffer = Buffer.from(attachment.data, "base64");
  return new NextResponse(buffer, {
    headers: {
      "Content-Type": attachment.mimeType || "application/octet-stream",
      "Content-Disposition": buildContentDisposition(attachment.filename),
      "Content-Length": String(buffer.length),
      // The upload route already validates the file's contents against
      // its declared type, but this stops a browser from ever second-
      // guessing that type itself (e.g. sniffing a maliciously-crafted
      // file as HTML/script) when a link is opened directly instead of
      // downloaded.
      "X-Content-Type-Options": "nosniff",
    },
  });
}

export async function DELETE(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  const { id, attachmentId } = await params;

  if (!isValidObjectId(attachmentId)) return NextResponse.json({ error: "File not found" }, { status: 404 });

  await connectDB();

  // Deleting only needs to locate the subdocument by id — its contents
  // are never read, so the base64 data for every attachment on the task
  // stays out of memory for this request.
  const access = await getTaskAccess(id, userId);
  if (!access) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const { task } = access;

  const attachment = task.attachments.id(attachmentId);
  if (!attachment) return NextResponse.json({ error: "File not found" }, { status: 404 });

  return withMongoErrorHandling(async () => {
    // An atomic `$pull` rather than `task.attachments.id(x).deleteOne()` +
    // `task.save()` — both approaches are safe against corruption here
    // (deleting one attachment can't push the task over any limit, so
    // there's no check-then-write race to close the way the upload route
    // has), but this way the delete doesn't depend on the full
    // (metadata-only) attachments array being loaded and re-saved just to
    // remove one element.
    await Task.updateOne({ _id: task._id }, { $pull: { attachments: { _id: attachmentId } } });

    const populated = await Task.findById(task._id)
      .select("-attachments.data")
      .populate("assignees", "name")
      .lean();
    return NextResponse.json(toTaskDTO(populated));
  });
}
