/**
 * perlin-engine.js — headless render engine for Perlin Studio.
 *
 * Owns a canvas, the Web Worker lifecycle (with a synchronous main-thread
 * fallback), and the requestAnimationFrame loop. Knows nothing about the
 * studio UI, presets, masks, or recording chrome — those live in consumers
 * (perlin-studio.js, perlin-element.js).
 *
 * Plain script: attaches `window.PerlinEngine`. file://-safe — the worker is
 * an inline Blob built from MTPerlin.WORKER_SOURCE. If the worker can't start
 * (CSP under file://, older engines), it transparently falls back to
 * main-thread rendering via MTPerlin.generatePerlinImage.
 *
 * Callbacks (all optional, passed to the constructor):
 *   - onTick(position)                 fired every RAF tick while playing —
 *                                      lets a consumer track the time position
 *                                      (e.g. move a slider) at display rate.
 *   - onFrame({ position, fps, isMain }) fired after each painted frame —
 *                                      carries the smoothed FPS for a readout.
 *   - transformFrame(imageData)        mutate pixels in place before paint
 *                                      (e.g. apply an alpha mask).
 *   - transformActive()                tells the GPU path whether transformFrame
 *                                      would change anything right now; without
 *                                      it every frame pays a pixel read-back.
 *
 * Two backends render the same params: "cpu" (worker, the default) and "gpu"
 * (perlin-gl.js, WebGL2). `setBackend("gpu")` opts in; frames the GPU renderer
 * does not support (flow / multi-channel colour modes) quietly use the CPU
 * path, and a GPU failure drops back to "cpu" for good (`onBackendChange`).
 *
 * @license AGPL-3.0-or-later
 */
(function (root) {
  "use strict";

  class PerlinEngine {
    /**
     * @param {HTMLCanvasElement} canvas
     * @param {{onTick?: Function, onFrame?: Function, transformFrame?: Function}} [opts]
     */
    constructor(canvas, opts = {}) {
      this.canvas = canvas;
      this.ctx = canvas.getContext("2d");
      this.onTick = opts.onTick || null;
      this.onFrame = opts.onFrame || null;
      this.transformFrame = opts.transformFrame || null;
      this.transformActive = opts.transformActive || null;
      this.onBackendChange = opts.onBackendChange || null;

      this._backend = "cpu";
      this._gl = null;          // perlin-gl.js renderer, created on first setBackend("gpu")

      this.params = null;
      this.worker = null;
      this.workerBusy = false;
      this.workerJobId = 0;
      this.latestJobId = 0;     // highest requested id; older replies are dropped
      this.pendingResolves = []; // [{id, resolve}] — promises awaiting a frame

      this._playing = false;
      this.rafHandle = 0;
      this.animStartTime = 0;   // performance.now() when play()/seek() anchored
      this.animStartPos = 0;    // time position at that anchor
      this.position = 0;        // current time position (loop progress or t)

      this.lastFrameTime = 0;
      this.fpsEMA = 0;          // exponentially smoothed FPS

      this._initWorker();
    }

    _initWorker() {
      const M = root.MTPerlin;
      if (!M || !M.WORKER_SOURCE) return; // no module → main-thread fallback
      try {
        const blob = new Blob([M.WORKER_SOURCE], { type: "application/javascript" });
        this.worker = new Worker(URL.createObjectURL(blob));
        this.worker.onmessage = (e) => this._onWorkerMessage(e);
        this.worker.onerror = (e) => {
          // The worker died (CSP, OOM, internal throw). Drop it so renders
          // fall back to the main thread — and fail any frames awaiting it so
          // callers (e.g. WebM recording) surface the error instead of hanging
          // forever on a promise that can never resolve.
          this.worker = null;
          this.workerBusy = false;
          const pending = this.pendingResolves;
          this.pendingResolves = [];
          const err = new Error("Perlin worker crashed" + (e && e.message ? ": " + e.message : ""));
          for (const p of pending) { if (p.reject) p.reject(err); }
          // The in-flight frame is lost with the worker; repaint it on the main
          // thread so the canvas isn't left blank and consumers' onFrame still
          // fires (e.g. to clear a first-paint loading state). Subsequent
          // renders take the main-thread path automatically (worker is null).
          if (this.params) this.renderOnce();
        };
      } catch (e) {
        this.worker = null;
      }
    }

    /** Store the current params. Does not render. */
    setParams(params) { this.params = params; }

    get backend() { return this._backend; }

    /**
     * Choose the renderer: "cpu" (worker) or "gpu" (WebGL2). Returns the backend
     * that is active afterwards — "gpu" falls back to "cpu" when WebGL2 or the
     * module is missing. Does not render; call renderOnce() to repaint.
     */
    setBackend(name) {
      let next = "cpu";
      if (name === "gpu") {
        const G = root.MTPerlinGL;
        if (!this._gl && G && G.isAvailable()) this._gl = G.createRenderer();
        if (this._gl) next = "gpu";
      }
      if (next !== this._backend) {
        this._backend = next;
        if (this.onBackendChange) this.onBackendChange(next);
      }
      return next;
    }

    _useGpu(params) { return this._backend === "gpu" && !!this._gl && this._gl.supports(params); }

    get playing() { return this._playing; }
    get fps() { return this.fpsEMA; }

    /**
     * Set the time position. When playing, re-anchors the wall-clock origin so
     * the animation continues smoothly from the new position.
     */
    seek(value) {
      this.position = value;
      if (this._playing) {
        this.animStartTime = performance.now();
        this.animStartPos = value;
      }
    }

    // Build a per-frame params object for a given time position, mapping it to
    // loopProgress (loop mode) or t (linear mode), matching the worker's reader.
    _paramsAt(position) {
      const p = Object.assign({}, this.params);
      if (p.loop) { p.loopProgress = ((position % 1) + 1) % 1; p.t = 0; }
      else { p.t = position; p.loopProgress = 0; }
      return p;
    }

    /** Render the current params once at the current position. */
    renderOnce() {
      if (!this.params) return;
      this._requestFrame(this._paramsAt(this.position));
    }

    play() {
      if (this._playing || !this.params) return;
      this._playing = true;
      this.animStartTime = performance.now();
      this.animStartPos = this.position;
      this.lastFrameTime = 0;
      this.fpsEMA = 0;
      this.rafHandle = requestAnimationFrame((now) => this._tick(now));
    }

    pause() {
      if (!this._playing) return;
      this._playing = false;
      cancelAnimationFrame(this.rafHandle);
    }

    // Wall-clock drives the position: loop mode wraps progress over
    // loopDuration seconds; linear mode advances t at 1 unit/second.
    _tick(now) {
      if (!this._playing) return;
      const elapsedSec = (now - this.animStartTime) / 1000;
      const p = Object.assign({}, this.params);
      let position;
      if (p.loop) {
        const dur = p.loopDuration || 4;
        position = ((this.animStartPos + elapsedSec / dur) % 1 + 1) % 1;
        p.loopProgress = position; p.t = 0;
      } else {
        position = this.animStartPos + elapsedSec;
        p.t = position; p.loopProgress = 0;
      }
      this.position = position;
      if (this.onTick) this.onTick(position);
      this._requestFrame(p);
      this.rafHandle = requestAnimationFrame((n) => this._tick(n));
    }

    // Only one frame is ever in flight in the worker — no queue, no drift. If
    // the worker is busy the request is dropped; wall-clock timing means the
    // next tick simply renders the then-current position.
    _requestFrame(params) {
      if (this._useGpu(params) && this._renderGpu(params)) return;
      if (!this.worker) { this._renderInMain(params); return; }
      if (this.workerBusy) return;
      this.workerBusy = true;
      this.latestJobId = ++this.workerJobId;
      this.worker.postMessage({ id: this.workerJobId, params });
    }

    /**
     * Render one frame and resolve when it has painted. Used for deterministic
     * recording where every frame must land (the skip logic would drop frames).
     */
    renderFrameAndWait(params) {
      if (this._useGpu(params) && this._renderGpu(params)) return Promise.resolve();
      if (!this.worker) { this._renderInMain(params); return Promise.resolve(); }
      return new Promise((resolve, reject) => {
        const id = ++this.workerJobId;
        this.latestJobId = id;
        this.pendingResolves.push({ id, resolve, reject });
        this.workerBusy = true;
        this.worker.postMessage({ id, params });
      });
    }

    _renderInMain(params) {
      const M = root.MTPerlin;
      if (this.canvas.width !== params.width || this.canvas.height !== params.height) {
        this.canvas.width = params.width;
        this.canvas.height = params.height;
      }
      M.generatePerlinImage(params, this.ctx);
      if (this.transformFrame) {
        const imgData = this.ctx.getImageData(0, 0, params.width, params.height);
        this.transformFrame(imgData);
        this.ctx.putImageData(imgData, 0, 0);
      }
      this._measureFps(true);
    }

    // GPU frames are synchronous. Bumping latestJobId makes any worker frame still
    // in flight (from before a backend switch) stale, so it cannot overwrite this one.
    // Returns false when the GPU failed and the engine switched to "cpu": the caller
    // then renders the frame on the CPU path, so a recording never skips a frame.
    _renderGpu(params) {
      this.latestJobId = ++this.workerJobId;
      try {
        if (this.canvas.width !== params.width || this.canvas.height !== params.height) {
          this.canvas.width = params.width;
          this.canvas.height = params.height;
        }
        this._gl.render(params, this.ctx);
      } catch (err) {
        // Lost context, driver bug: give the CPU path the frame and stay there.
        if (typeof console !== "undefined") console.warn("GPU renderer failed, using the CPU path:", err && err.message);
        this._gl = null;
        this.setBackend("cpu");
        return false;
      }
      if (this.transformFrame && (!this.transformActive || this.transformActive())) {
        const imgData = this.ctx.getImageData(0, 0, params.width, params.height);
        this.transformFrame(imgData);
        this.ctx.putImageData(imgData, 0, 0);
      }
      this._measureFps(false);
      return true;
    }

    _onWorkerMessage(e) {
      const { id, width, height, buffer } = e.data;
      this.workerBusy = false;
      if (id < this.latestJobId) return; // stale frame after a newer request

      const imgData = new ImageData(new Uint8ClampedArray(buffer), width, height);
      if (this.transformFrame) this.transformFrame(imgData);

      if (this.canvas.width !== width || this.canvas.height !== height) {
        this.canvas.width = width;
        this.canvas.height = height;
      }
      this.ctx.putImageData(imgData, 0, 0);
      this._measureFps(false);

      for (let i = this.pendingResolves.length - 1; i >= 0; i--) {
        if (this.pendingResolves[i].id === id) {
          this.pendingResolves[i].resolve();
          this.pendingResolves.splice(i, 1);
        }
      }
    }

    _measureFps(isMain) {
      const now = performance.now();
      if (this.lastFrameTime > 0) {
        const inst = 1000 / (now - this.lastFrameTime);
        this.fpsEMA = this.fpsEMA ? this.fpsEMA * 0.85 + inst * 0.15 : inst;
      }
      this.lastFrameTime = now;
      if (this.onFrame) this.onFrame({ position: this.position, fps: this.fpsEMA, isMain: !!isMain, backend: this._backend });
    }

    /** Stop the loop, terminate the worker, drop pending resolves. */
    destroy() {
      this.pause();
      if (this.worker) { this.worker.terminate(); this.worker = null; }
      if (this._gl) { this._gl.destroy(); this._gl = null; }
      this.pendingResolves = [];
    }
  }

  root.PerlinEngine = PerlinEngine;
})(typeof window !== "undefined" ? window : globalThis);
