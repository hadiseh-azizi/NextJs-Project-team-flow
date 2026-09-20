import { Types } from "mongoose";

// Route params come straight from the URL, so anything can show up there —
// a malformed id would otherwise reach Mongoose and throw an uncaught
// CastError (surfaced to the client as an unstyled 500). Routes should
// check this before querying and return a clean 400 instead.
export function isValidObjectId(id) {
  return typeof id === "string" && Types.ObjectId.isValid(id) && String(new Types.ObjectId(id)) === id;
}
