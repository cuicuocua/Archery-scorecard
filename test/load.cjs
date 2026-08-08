// Compiles ArcheryScorecard.jsx (JSX + ESM) to a plain CJS module in memory
// via esbuild — already a devDependency for the site build, so this adds no
// new dependency — and requires it, so tests can call its pure logic
// functions (see the "test-only exports" block at the bottom of the
// component file) directly, with no browser, bundler config, or Supabase
// network access needed.
//
// A couple of things the component file does at module load time need a
// minimal shim in plain Node:
//   - `localStorage`, used by the offline outbox (readPending/writePending)
//   - `createClient()` from @supabase/supabase-js, which the module calls
//     at the top level to build its `supabase` client. Real credentials are
//     fine here — the client is never actually used by anything this test
//     suite calls, so no network request happens.
const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');
const os = require('os');
const Module = require('module');

function makeLocalStorageShim() {
  const store = new Map();
  return {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
  };
}

let cached = null;

function loadScorecardModule() {
  if (cached) return cached;

  if (typeof global.localStorage === 'undefined') {
    global.localStorage = makeLocalStorageShim();
  }

  const result = esbuild.buildSync({
    entryPoints: [path.join(__dirname, '..', 'ArcheryScorecard.jsx')],
    bundle: false,
    format: 'cjs',
    jsx: 'automatic',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  });

  const code = result.outputFiles[0].text;
  const tmpFile = path.join(os.tmpdir(), `archery-scorecard-test-${process.pid}.cjs`);
  fs.writeFileSync(tmpFile, code);

  const mod = new Module(tmpFile, module);
  mod.filename = tmpFile;
  mod.paths = Module._nodeModulePaths(path.join(__dirname, '..'));
  mod._compile(code, tmpFile);

  fs.rmSync(tmpFile, { force: true });
  cached = mod.exports;
  return cached;
}

module.exports = { loadScorecardModule };
