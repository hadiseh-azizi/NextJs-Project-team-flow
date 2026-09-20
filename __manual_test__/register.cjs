// Some lib modules fail fast at import time if these aren't set (see
// lib/mongodb.js, lib/authSecret.js) — harmless placeholders for a test
// run that never opens a real connection or signs a real token.
process.env.MONGODB_URI ||= "mongodb+srv://user:pass@cluster.mongodb.net/teamflow-test";
process.env.NEXTAUTH_SECRET ||= "test-secret-not-for-prod";
process.env.NEXTAUTH_URL ||= "http://localhost:3000";

require("@babel/register").default({
  configFile: __dirname + "/babel.config.cjs",
  ignore: [/node_modules/],
  extensions: [".js"],
});
