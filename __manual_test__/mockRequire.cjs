const path = require("path");
const fs = require("fs");
const Module = require("module");

const SRC_DIR = path.resolve(__dirname, "../src");

// Registers `exportsObj` as the result of any `require("@/<specifier>")`
// (post-alias-resolution, i.e. `require("<...>/src/<specifier>")`) or a
// bare package name like "mongoose" / "next-auth" / "next/server", made
// from any file loaded after this call. Used to swap real Mongoose
// models / Next.js internals for test doubles without touching the
// actual source files.
function mockModule(specifier, exportsObj) {
  let resolvedPath;
  if (specifier.startsWith("@/")) {
    resolvedPath = path.resolve(SRC_DIR, specifier.slice(2));
    if (!resolvedPath.endsWith(".js")) resolvedPath += ".js";
    resolvedPath = fs.realpathSync(path.dirname(resolvedPath)) + path.sep + path.basename(resolvedPath);
  } else {
    resolvedPath = require.resolve(specifier);
  }
  require.cache[resolvedPath] = {
    id: resolvedPath,
    filename: resolvedPath,
    loaded: true,
    exports: exportsObj,
  };
  return resolvedPath;
}

// Clears every mock previously registered via mockModule, and any
// already-loaded copy of the real modules under test, so each test file
// starts with a clean require cache.
function resetModuleCache() {
  for (const key of Object.keys(require.cache)) {
    if (key.startsWith(SRC_DIR) || key.includes("node_modules/next-auth") || key.includes("node_modules/mongoose")) {
      delete require.cache[key];
    }
  }
}

module.exports = { mockModule, resetModuleCache, SRC_DIR };
