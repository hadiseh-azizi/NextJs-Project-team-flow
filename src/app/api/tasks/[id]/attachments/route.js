import { NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { connectDB } from "@/lib/mongodb";
import Task from "@/models/Task";
import { toTaskDTO } from "@/lib/serialize";
import { getTaskAccess } from "@/lib/authz";
import { withMongoErrorHandling } from "@/lib/mongoErrors";
import { readFormDataWithLimit, PayloadTooLargeError } from "@/lib/limitedFormData";
import {
  MAX_FILE_SIZE,
  MAX_TOTAL_ATTACHMENTS_SIZE,
  MAX_ATTACHMENTS_PER_TASK,
  MAX_UPLOAD_REQUEST_SIZE,
  ALLOWED_TYPES_SUMMARY,
  sanitizeFilename,
  validateAttachmentFile,
} from "@/lib/attachmentPolicy";

export async function POST(req, { params }) {
  const session = await getServerSession(authOptions);
  if (!session?.user) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const userId = session.user.id;

  // Enforced before touching the database: an oversized request is
  // rejected as soon as that's detectable (immediately, from
  // Content-Length, or after MAX_UPLOAD_REQUEST_SIZE bytes have actually
  // arrived) rather than after a task lookup, and well before the whole
  // body would otherwise be read into memory by formData(). A
  // hand-crafted or truncated multipart body can also throw here rather
  // than returning something checkable — both cases map to a clean 4xx
  // instead of an uncaught 500.
  let formData;
  try {
    formData = await readFormDataWithLimit(req, MAX_UPLOAD_REQUEST_SIZE);
  } catch (err) {
    if (err instanceof PayloadTooLargeError) {
      return NextResponse.json({ error: "File size must not exceed 5MB" }, { status: 413 });
    }
    return NextResponse.json({ error: "The upload couldn't be read. Please try again." }, { status: 400 });
  }

  const { id } = await params;

  await connectDB();

  // Attachment metadata (sizes, count) is all this route needs from the
  // task besides its identity — the real bytes of existing attachments
  // are never read here, so getTaskAccess doesn't load them.
  const access = await getTaskAccess(id, userId);
  if (!access) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  const { task } = access;

  const file = formData.get("file");
  if (!file || typeof file === "string") {
    return NextResponse.json({ error: "No file was uploaded" }, { status: 400 });
  }
  if (file.size <= 0) {
    return NextResponse.json({ error: "The selected file is empty" }, { status: 400 });
  }
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json({ error: "File size must not exceed 5MB" }, { status: 400 });
  }
  if (task.attachments.length >= MAX_ATTACHMENTS_PER_TASK) {
    return NextResponse.json(
      { error: `This task already has the maximum of ${MAX_ATTACHMENTS_PER_TASK} attachments. Remove one before adding another.` },
      { status: 400 }
    );
  }

  const filename = sanitizeFilename(file.name);
  const mimeType = typeof file.type === "string" ? file.type.split(";")[0].trim().toLowerCase() : "";

  // Extension/MIME pairing is checked before reading the file into memory;
  // the actual byte signature is checked just below, once we have the
  // buffer, so an obviously-mislabeled upload never gets that far.
  const buffer = Buffer.from(await file.arrayBuffer());
  const validation = validateAttachmentFile(filename, mimeType, buffer);
  if (!validation.ok) {
    return NextResponse.json(
      { error: `${validation.error} Allowed: ${ALLOWED_TYPES_SUMMARY}.` },
      { status: 400 }
    );
  }

  const currentTotal = task.attachments.reduce((sum, a) => sum + a.size, 0);
  if (currentTotal + file.size > MAX_TOTAL_ATTACHMENTS_SIZE) {
    return NextResponse.json(
      { error: "This task has reached its total attachment storage limit (8MB). Remove a file before adding another." },
      { status: 400 }
    );
  }

  return withMongoErrorHandling(async () => {
    // The two checks above (count, running total) read `task` as it was
    // loaded at the top of this request — if a second upload to the same
    // task commits in between, that read is stale, and both requests
    // could otherwise pass their checks and each push, landing the task
    // over either limit. `task.attachments.push(...) + task.save()` would
    // not close this window: saving a Mongoose array modification only
    // conditions the write on `_id` by default, not on the array's prior
    // contents, so it can't detect that stale read either.
    //
    // Re-checking both limits inside the update's own filter makes the
    // check-and-write a single atomic operation on the database, so two
    // concurrent uploads are serialized by MongoDB itself rather than by
    // anything in this process: whichever one commits first is evaluated
    // against the true current state, and the second is evaluated against
    // what the first just wrote — closing the window entirely rather than
    // narrowing it.
    const updateResult = await Task.updateOne(
      {
        _id: task._id,
        $expr: {
          $and: [
            { $lt: [{ $size: "$attachments" }, MAX_ATTACHMENTS_PER_TASK] },
            { $lte: [{ $add: [{ $sum: "$attachments.size" }, file.size] }, MAX_TOTAL_ATTACHMENTS_SIZE] },
          ],
        },
      },
      {
        $push: {
          attachments: { filename, mimeType, size: file.size, data: buffer.toString("base64") },
        },
      }
    );

    if (updateResult.matchedCount === 0) {
      // The pre-checks above passed against a stale read, but another
      // upload to this task won the race and committed first. Reported as
      // a conflict rather than the same 400s above, since retrying with
      // the exact same file may now succeed (or fail for a different,
      // now-current reason) once the task is refreshed.
      return NextResponse.json(
        {
          error:
            "Another upload to this task just completed and changed the limit. Refresh and try again.",
        },
        { status: 409 }
      );
    }

    // Re-fetched without `attachments.data`: toTaskDTO() never includes
    // the base64 payload of any attachment, so there's no reason to pull
    // it (potentially several MB across every file on the task) back out
    // of MongoDB just to build this response.
    const populated = await Task.findById(task._id)
      .select("-attachments.data")
      .populate("assignees", "name")
      .lean();
    return NextResponse.json(toTaskDTO(populated), { status: 201 });
  });
}
