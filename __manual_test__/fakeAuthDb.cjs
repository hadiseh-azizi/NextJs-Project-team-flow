// In-memory stand-ins for the Mongoose models the M1-M6 tests touch
// (User, Team, Invitation, AutoLoginToken, PasswordResetToken). Same idea
// as the Map-backed fakes in 09/11/30: just enough query surface for the
// real route/lib files to run unmodified. Not a Mongo emulator.

// 24-hex ids so the routes' isValidObjectId() checks pass.
const oid = (tag) => Buffer.from(String(tag).padEnd(12, "_").slice(0, 12)).toString("hex");

function matches(doc, filter) {
  return Object.entries(filter || {}).every(([k, cond]) => {
    const v = doc[k];
    if (cond && typeof cond === "object" && !(cond instanceof Date) && !Array.isArray(cond)) {
      if ("$gt" in cond) return v instanceof Date && v.getTime() > cond.$gt.getTime();
      if ("$in" in cond) return cond.$in.map(String).includes(String(v));
    }
    return String(v) === String(cond);
  });
}

// Thenable, chainable query result: sort/select/populate/session/lean are
// no-ops except populate, which the caller wires via `populators`.
function query(getResult, populators = {}) {
  const q = {
    sort: () => q,
    select: () => q,
    session: () => q,
    lean: () => q,
    populate(path) {
      const fn = populators[path];
      if (fn) {
        const prev = getResult;
        getResult = () => {
          const r = prev();
          return Array.isArray(r) ? r.map(fn) : r ? fn(r) : r;
        };
      }
      return q;
    },
    then: (res, rej) => Promise.resolve().then(() => getResult()).then(res, rej),
  };
  return q;
}

function applyUpdate(doc, update) {
  for (const [k, v] of Object.entries(update.$set || {})) doc[k] = v;
  for (const [k, v] of Object.entries(update.$inc || {})) doc[k] = (doc[k] ?? 0) + v;
}

function makeDb() {
  let n = 0;
  const users = [];
  const teams = [];
  const invitations = [];
  const autoLogin = new Map();
  const resetTokens = [];

  const User = {
    __docs: users,
    async create(arr) {
      const out = [];
      for (const d of arr) {
        if (users.some((u) => u.email === d.email)) throw Object.assign(new Error("E11000"), { code: 11000 });
        const u = { _id: oid(`u${++n}`), tokenVersion: 0, emailVerified: false, ...d };
        users.push(u);
        out.push({ ...u });
      }
      return out;
    },
    findOne: (f) => query(() => { const u = users.find((x) => matches(x, f)); return u ? { ...u } : null; }),
    findById: (id) => query(() => { const u = users.find((x) => x._id === String(id)); return u ? { ...u } : null; }),
    async findOneAndUpdate(f, update) {
      const u = users.find((x) => matches(x, f));
      if (!u) return null;
      const before = { ...u };
      applyUpdate(u, update);
      return before;
    },
    async findByIdAndUpdate(id, update) {
      const u = users.find((x) => x._id === String(id));
      if (!u) return null;
      const before = { ...u };
      applyUpdate(u, update);
      return before;
    },
  };

  const Team = {
    __docs: teams,
    findById: (id) => query(() => teams.find((t) => t._id === String(id)) || null),
    async updateOne(f, update) {
      const t = teams.find((x) => matches(x, f));
      let modifiedCount = 0;
      if (t && update.$addToSet?.members && !t.members.map(String).includes(String(update.$addToSet.members))) {
        t.members.push(String(update.$addToSet.members));
        modifiedCount = 1;
      }
      return { modifiedCount };
    },
    async updateMany(f, update) {
      for (const t of teams.filter((x) => matches(x, { _id: f._id }))) {
        const add = update.$addToSet?.members;
        if (add && !t.members.map(String).includes(String(add))) t.members.push(String(add));
      }
    },
  };

  const Invitation = {
    __docs: invitations,
    find: (f) =>
      query(() => invitations.filter((i) => matches(i, f)).map((i) => ({ ...i })), {
        team: (i) => ({ ...i, team: teams.find((t) => t._id === String(i.team)) || null }),
        invitedBy: (i) => ({ ...i, invitedBy: users.find((u) => u._id === String(i.invitedBy)) || null }),
      }),
    findOne: (f) => query(() => { const i = invitations.find((x) => matches(x, f)); return i ? { ...i } : null; }),
    async create(d) {
      if (invitations.some((i) => i.email === d.email && String(i.team) === String(d.team))) {
        throw Object.assign(new Error("E11000"), { code: 11000 });
      }
      const doc = { _id: oid(`i${++n}`), createdAt: new Date(), expiresAt: new Date(Date.now() + 14 * 864e5), ...d, team: String(d.team) };
      invitations.push(doc);
      return doc;
    },
    async deleteOne(f) {
      const idx = invitations.findIndex((x) => matches(x, f));
      if (idx >= 0) invitations.splice(idx, 1);
    },
    async deleteMany(f) {
      for (let i = invitations.length - 1; i >= 0; i--) if (matches(invitations[i], f)) invitations.splice(i, 1);
    },
  };

  const AutoLoginToken = {
    store: autoLogin,
    async create(doc) { autoLogin.set(doc.tokenHash, { _id: oid(`a${++n}`), ...doc }); },
    async findOneAndDelete(f) {
      const d = autoLogin.get(f.tokenHash);
      if (!d || !(d.expiresAt.getTime() > f.expiresAt.$gt.getTime())) return null;
      autoLogin.delete(f.tokenHash);
      return d;
    },
  };

  const PasswordResetToken = {
    store: resetTokens,
    async deleteMany(f) {
      for (let i = resetTokens.length - 1; i >= 0; i--) if (String(resetTokens[i].userId) === String(f.userId)) resetTokens.splice(i, 1);
    },
    async create(doc) { resetTokens.push({ ...doc }); },
    // Read-only existence check (peekPasswordResetToken).
    findOne(f) {
      const d = resetTokens.find((t) => t.tokenHash === f.tokenHash && t.expiresAt.getTime() > f.expiresAt.$gt.getTime());
      const q = { select: () => q, lean: async () => (d ? { ...d } : null) };
      return q;
    },
    async findOneAndDelete(f) {
      const i = resetTokens.findIndex((d) => d.tokenHash === f.tokenHash && d.expiresAt.getTime() > f.expiresAt.$gt.getTime());
      return i >= 0 ? resetTokens.splice(i, 1)[0] : null;
    },
  };

  return { User, Team, Invitation, AutoLoginToken, PasswordResetToken, users, teams, invitations };
}

module.exports = { makeDb, oid };
