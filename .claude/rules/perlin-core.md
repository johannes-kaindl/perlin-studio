---
paths:
  - "perlin*.js"
  - "scripts/smoke-test.js"
---

# Perlin core gotchas

Loads when you touch the math, the engine or the smoke test. Subtle math bugs look visually normal until the loop stops closing or edges start flickering, so run `node scripts/smoke-test.js` after every change here. Background: `docs/ARCHITECTURE.md`.

- **Math bug class 1: float rounding at loop endpoints.** `Math.sin(2π)` is not `0` but about `-2.4e-16`. `Math.floor(-1.7e-16)` is `-1`, which masks to `255` in the hash lookup — a *completely different* image. Fix: `safeProgress = ((p % 1) + 1) % 1`. Guarded by smoke test C (loop identity, bytewise and bit-exact).
- **Math bug class 2: Z/W axis swap in `perlin4`.** In the 4D hash tree, `AAB` and `AAA+1` are different constructs: `AAB = perm[AA+1]+W` is a **Z shift**, `AAA+1 = perm[AA]+W+1` is a **W shift**. The offsets must line up: `AAB` uses `z-1`, `AAA+1` uses `w-1`. The outer lerp is over `tt` (W), not `s` (Z).
- **Animation: `t` progress too fast.** The initial implementation had `t += fps` per second — 30× too fast. The correct version is `t += 1` per second, and `scaleT` scales that in noise space. So the per-frame step is ~`scaleT / fps` ≈ 0.005 — a soft ripple instead of a flicker.
- **Worker CSP.** Under `file://`, some browsers block the worker. The code automatically falls back to main-thread rendering (see `initWorker` / `renderInMain`). While debugging, watch whether the FPS counter says "(main)" — if so, the fallback is active.
- **Never queue frames.** `requestFrame` skips if `state.workerBusy` is still `true`. Recordings use `renderFrameAndWait`, which synchronizes via `state.pendingResolves`.
- **Use transferables.** `postMessage({ ..., buffer: buf.buffer }, [buf.buffer])` → zero-copy back.
- **Don't commit performance tweaks in `perlin3`/`perlin4` without sanity checks.**
- **`perlin-gl.js` is a line-by-line port, not a rewrite.** The shader mirrors `perlin3`/`perlin4`, `fbm`, the warp and the colour modes, with the same Z/W pairing (`AAB` = Z shift, `AAA+1` = W shift). Don't tidy it; change both sides together and run `node scripts/check-gl-parity.mjs`. The loop angle is computed in JS on purpose: progress 1 must equal progress 0 bytewise, which `sin(2π)` in float32 would break.
- **The render loop exists twice on the CPU.** `generatePerlinImage` (main thread) and the loop inside `WORKER_SOURCE` are separate copies of the same code; a feature added to one and not the other shows only when the worker runs. `scripts/check-gl-parity.mjs` renders every case in a real `Worker` and requires it to equal the main-thread image bytewise, so run it after touching either loop.
