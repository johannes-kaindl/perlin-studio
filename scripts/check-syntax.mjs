// Syntax gate for Perlin Studio — the mandatory pre-deploy check (PROF-WEB-03).
//
//   node scripts/check-syntax.mjs
//
// Perlin Studio ships as static client code: five external browser scripts
// loaded via <script src> plus one inline <script> in index.html. Plain
// `node --check` wouldn't see the inline block, and the external files are
// browser scripts (window globals, no ES modules), so we compile every piece
// with the VM compiler — which validates syntax WITHOUT executing (browser
// globals like `document`/`window` never run). Exit code is non-zero iff a
// block fails to parse.
//
// Scope = the deployable site (matches what `deploy-page.sh` publishes): the
// root perlin*.js files, the inline <script> blocks in index.html / any
// examples/*.html, AND the Web Worker source — which ships to the browser as a
// Blob worker (perlin-engine.js) but lives inside a template literal in
// perlin.js, so the file-level parse can't see into it. Node-only build tooling
// under scripts/ is exercised when it runs, not gated here.
import fs from 'fs';
import vm from 'vm';
import path from 'path';
import { fileURLToPath } from 'url';
import { createRequire } from 'module';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// External browser scripts, in index.html load order.
const jsFiles = [
  'perlin.js',
  'perlin-presets.js',
  'perlin-engine.js',
  'perlin-gl.js',
  'perlin-gl-check.js',
  'perlin-export.js',
  'perlin-studio.js',
  'perlin-element.js',
];

// HTML files whose inline <script> (no src=) blocks ship to the browser.
const htmlFiles = ['index.html', 'examples/embed.html'];

let ok = true;
let checked = 0;

function check(label, code) {
  checked++;
  try { new vm.Script(code, { filename: label }); }
  catch (e) { ok = false; console.error(`✗ syntax error in ${label}: ${e.message}`); }
}

for (const rel of jsFiles) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) { ok = false; console.error(`✗ missing expected script: ${rel}`); continue; }
  check(rel, fs.readFileSync(abs, 'utf8'));
}

// The Blob-worker source is a template literal inside perlin.js, invisible to
// the file-level parse above. Load perlin.js the way smoke-test.js does (stub
// window, require, read the global it sets) and parse the extracted source too.
try {
  const require = createRequire(import.meta.url);
  globalThis.window = globalThis.window || {};
  require(path.join(root, 'perlin.js'));
  const workerSrc = globalThis.window.MTPerlin && globalThis.window.MTPerlin.WORKER_SOURCE;
  if (typeof workerSrc === 'string' && workerSrc.length) {
    check('perlin.js → MTPerlin.WORKER_SOURCE (Blob worker)', workerSrc);
  } else {
    ok = false; console.error('✗ could not extract MTPerlin.WORKER_SOURCE from perlin.js');
  }
} catch (e) {
  ok = false; console.error(`✗ failed to load perlin.js to check WORKER_SOURCE: ${e.message}`);
}

for (const rel of htmlFiles) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) continue; // optional (examples/ may be trimmed)
  const html = fs.readFileSync(abs, 'utf8');
  // Negative lookahead skips external <script src=...>; the (?<![\w-]) guard
  // keeps it from mistaking a data-src= attribute for a real src=.
  const blocks = [...html.matchAll(/<script(?![^>]*(?<![\w-])src=)[^>]*>([\s\S]*?)<\/script>/gi)].map(m => m[1]);
  blocks.forEach((code, i) => check(`${rel} inline #${i}`, code));
}

console.log(ok ? `SYNTAX OK — ${checked} script block(s) parse` : 'SYNTAX FAILED');
process.exit(ok ? 0 : 1);
