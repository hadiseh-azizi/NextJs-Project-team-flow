// Schema-level length cap for a text field.
//
// Mongoose's built-in `maxlength` validates every initialized path, not just
// the ones being changed. So a document stored before the API enforced its
// current limits, if it was over the limit, would fail `doc.save()` even when
// the request only changed some other field (completing a task, say).
// That would turn a harmless old value into a request that can't be saved.
//
// This validator applies the same cap, but only to values being written:
// new documents and paths that were modified. Old over-length values stay
// readable and don't block unrelated edits; changing the field itself is
// held to the limit, same as the API routes do. Update-style validators
// (where `this` is a query, not a document) always enforce the limit.
export function textLimit(path, max) {
  return {
    validator(value) {
      if (value == null) return true;
      if (typeof this?.isModified === "function" && !this.isNew && !this.isModified(path)) return true;
      return String(value).length <= max;
    },
    message: (props) => `Path \`${props.path}\` must be ${max} characters or fewer`,
  };
}
