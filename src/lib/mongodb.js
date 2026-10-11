import mongoose from "mongoose";

// Validated when a connection is actually needed, not when this module is
// imported. `next build` imports every route module to collect page data, and
// a build has no reason to hold the production database URL. Runtime stays
// strict: the first connectDB() without MONGODB_URI throws this same message.
export function getMongoUri() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    throw new Error("MONGODB_URI is not set — copy .env.example to .env and fill it in");
  }
  return uri;
}

// Connection options tuned for serverless (Vercel) + Atlas.
// - serverSelectionTimeoutMS: the driver default is 30s, longer than a
//   Vercel function is allowed to run, so a bad connection would just
//   time out the whole request. 5s still covers an Atlas cold start / SRV
//   lookup and leaves room for the next request to retry.
// - maxPoolSize: every warm serverless instance holds its own pool, so a
//   small pool keeps the total under Atlas's connection limit. A single
//   instance rarely serves more than a few requests (or one
//   transaction session each) at a time.
// - connectTimeoutMS: how long a single TCP/TLS connect may take (driver
//   default 30s).
// - socketTimeoutMS: how long an in-flight operation may sit without a reply
//   before the socket is dropped (driver default: no limit), so a stalled
//   server fails the request instead of hanging it.
// - waitQueueTimeoutMS: how long an operation may wait for a free pooled
//   connection (driver default: no limit).
// - bufferTimeoutMS: how long Mongoose buffers a command while it has no
//   connection (Mongoose default 10s).
const MONGODB_OPTIONS = {
  serverSelectionTimeoutMS: 5000,
  connectTimeoutMS: 10000,
  socketTimeoutMS: 30000,
  waitQueueTimeoutMS: 10000,
  bufferTimeoutMS: 8000,
  maxPoolSize: 10,
};

// Cache the connection across hot-reloads in dev so we don't open a new
// connection on every request.
const cached = global._mongoose || { conn: null, promise: null };
global._mongoose = cached;

export async function connectDB() {
  if (cached.conn) return cached.conn;
  if (!cached.promise) {
    cached.promise = mongoose.connect(getMongoUri(), MONGODB_OPTIONS);
  }
  const pending = cached.promise;
  try {
    cached.conn = await pending;
  } catch (error) {
    // Don't keep a rejected promise: clear it so the next call makes a
    // fresh connection attempt. The identity check stops a late failure
    // from an old attempt from wiping a newer, still-pending attempt.
    if (cached.promise === pending) cached.promise = null;
    throw error;
  }
  return cached.conn;
}
