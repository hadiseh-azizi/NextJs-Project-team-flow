// Test-only Babel config. Lets the manual test harness `require()` the
// real, unmodified ESM source files (which Next.js normally transpiles
// via SWC) directly under plain Node, with the same `@/*` -> `src/*`
// alias jsconfig.json defines for the app itself.
module.exports = {
  presets: [["@babel/preset-env", { targets: { node: "current" } }]],
  plugins: [
    [
      "module-resolver",
      {
        alias: { "@": __dirname + "/../src" },
      },
    ],
  ],
};
