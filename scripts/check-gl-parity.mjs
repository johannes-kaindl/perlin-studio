// Parity gate for the GPU renderer (perlin-gl.js): renders each case on the CPU
// path (perlin.js generatePerlinImage) and on the GPU path in a real browser and
// compares the pixels. The cases and the comparison live in perlin-gl-check.js, which
// this script only drives; the same file runs on a phone via examples/gpu-check.html.
//
//   node scripts/check-gl-parity.mjs            # needs Playwright and a WebGL2 browser
//   PLAYWRIGHT_PATH=/path/to/node_modules/playwright node scripts/check-gl-parity.mjs
//
// Not part of the deploy gates: it needs a browser (zero-dependency repo), so it is
// run by hand after touching perlin-gl.js or the maths in perlin.js. Exit 0 = pass,
// 1 = a case differs or a control did not fail, 2 = skipped (no Playwright / no WebGL2).
//
// Why a tolerance and not equality: the CPU path is float64, the shader float32, and
// the colour is rounded once on each side. Pixels whose noise value lands next to a
// rounding edge can differ by one level; anything beyond that is a bug.
import fs from "fs";
import path from "path";
import { createRequire } from "module";
import { fileURLToPath } from "url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);

function loadPlaywright() {
  const candidates = [process.env.PLAYWRIGHT_PATH, "playwright"];
  for (const name of fs.readdirSync(path.join(root, ".."))) {
    candidates.push(path.join(root, "..", name, "node_modules", "playwright"));
  }
  for (const c of candidates) {
    if (!c) continue;
    try { return require(c); } catch (e) { /* try the next one */ }
  }
  return null;
}

const pw = loadPlaywright();
if (!pw) { console.log("SKIP: Playwright not found (set PLAYWRIGHT_PATH)"); process.exit(2); }

const browser = await pw.chromium.launch({
  args: process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"],
});
const page = await browser.newPage();
page.on("pageerror", (e) => console.log("[pageerror]", e.message));
await page.goto("about:blank");
for (const f of ["perlin.js", "perlin-presets.js", "perlin-gl.js", "perlin-gl-check.js"]) {
  await page.addScriptTag({ path: path.join(root, f) });
}
const out = await page.evaluate(() => window.MTPerlinGLCheck.run());
await browser.close();
if (out.skip) { console.log("SKIP: " + out.skip); process.exit(2); }

console.log("renderer: " + out.renderer);
let failed = 0;
for (const r of out.rows) {
  const stats = r.max === undefined ? (r.note || "") : `max ${r.max}, mean ${r.mean.toFixed(4)}, >1 level ${(r.frac * 100).toFixed(4)}%${r.note || ""}`;
  console.log(`${r.ok ? "ok  " : "FAIL"} ${r.name}  ${stats}`);
  if (!r.ok) failed++;
}
console.log(failed ? `${failed} case(s) failed` : `all ${out.rows.length} checks passed`);
process.exit(failed ? 1 : 0);
