/**
 * perlin-element.js — <perlin-noise> custom element.
 *
 * Renderer-only embeddable Perlin animation. Wraps a PerlinEngine pointed at a
 * shadow-DOM canvas. Configure via attributes (preset, src, autoplay,
 * max-resolution, static) or the `params` JS property.
 *
 * Load order (before this script): perlin.js, perlin-presets.js,
 * perlin-engine.js. Plain script: registers the element on load.
 *
 * file://-safe except `src` — fetch() is CORS-restricted under file://, so use
 * `preset` or the `params` property when embedding from the local filesystem.
 *
 * Defaults tuned for decorative use: respects prefers-reduced-motion (renders a
 * single still frame instead of animating) and pauses while fully off-screen.
 * The render resolution tracks the element's displayed size × devicePixelRatio,
 * capped at `max-resolution` (default 1280) so a full-bleed hero can't saturate
 * the CPU. The preset's declared width/height act as a reference composition:
 * scaleX/scaleY are rescaled so the look is preserved across resolutions.
 *
 * @license AGPL-3.0-or-later
 */
(function (root) {
  "use strict";
  if (!root.customElements) return;

  const DEFAULT_MAX_RES = 1280;

  class PerlinNoiseElement extends HTMLElement {
    static get observedAttributes() {
      return ["preset", "src", "autoplay", "max-resolution", "static"];
    }

    constructor() {
      super();
      const shadow = this.attachShadow({ mode: "open" });
      const style = document.createElement("style");
      style.textContent = ":host{display:block} canvas{display:block;width:100%;height:100%}";
      this._canvas = document.createElement("canvas");
      shadow.append(style, this._canvas);

      this._engine = null;
      this._params = null;          // resolved params; width/height = reference composition
      this._paramsExplicit = false; // true once the .params setter is used
      this._ro = null;
      this._io = null;
      this._mql = null;
      this._connected = false;
      this._wantPlay = false;       // intent (autoplay attr or .play()); gated by motion/visibility
      this._visible = undefined;    // set by the IntersectionObserver
    }

    // ---- properties ----
    get params() { return this._params; }
    set params(p) {
      this._paramsExplicit = true;
      this._params = p ? root.MTPerlinPresets.resolveParams(p) : null;
      this._resize();
    }
    get playing() { return this._engine ? this._engine.playing : false; }
    play() { this._wantPlay = true; this._applyMotion(); }
    pause() { this._wantPlay = false; if (this._engine) this._engine.pause(); }

    // ---- lifecycle ----
    connectedCallback() {
      if (this._connected) return;
      this._connected = true;
      this._engine = new PerlinEngine(this._canvas);

      this._ro = new ResizeObserver(() => this._resize());
      this._ro.observe(this);

      this._io = new IntersectionObserver((entries) => {
        for (const en of entries) {
          this._visible = en.isIntersecting;
          if (en.isIntersecting) this._applyMotion();
          else if (this._engine.playing) this._engine.pause();
        }
      });
      this._io.observe(this);

      this._mql = matchMedia("(prefers-reduced-motion: reduce)");
      this._mql.addEventListener("change", () => this._applyMotion());

      this._wantPlay = this.hasAttribute("autoplay");
      this._loadParams().then(() => this._resize());
    }

    disconnectedCallback() {
      if (this._ro) this._ro.disconnect();
      if (this._io) this._io.disconnect();
      if (this._engine) this._engine.destroy();
      this._connected = false;
    }

    attributeChangedCallback(name, oldV, newV) {
      if (!this._connected || oldV === newV) return;
      if ((name === "preset" || name === "src") && !this._paramsExplicit) {
        this._loadParams().then(() => this._resize());
      } else if (name === "autoplay") {
        this._wantPlay = this.hasAttribute("autoplay");
        this._applyMotion();
      } else if (name === "max-resolution") {
        this._resize();
      } else if (name === "static") {
        this._applyMotion();
      }
    }

    // ---- params resolution ----
    // Precedence: explicit .params (skips this) > src JSON > preset built-in >
    // the `default` built-in. On a failed src fetch, falls back to default.
    async _loadParams() {
      if (this._paramsExplicit) return;
      const P = root.MTPerlinPresets;
      const src = this.getAttribute("src");
      if (src) {
        try {
          const res = await fetch(src);
          this._params = P.resolveParams(await res.json());
          return;
        } catch (e) {
          console.warn("[perlin-noise] src load failed, using default:", e);
        }
      }
      const name = this.getAttribute("preset");
      const base = (name && P.BUILTIN_PRESETS[name]) || P.BUILTIN_PRESETS.default;
      this._params = P.resolveParams(base);
    }

    // ---- sizing ----
    _maxRes() {
      const v = parseInt(this.getAttribute("max-resolution"), 10);
      return Number.isFinite(v) && v > 0 ? v : DEFAULT_MAX_RES;
    }

    _resize() {
      if (!this._engine || !this._params) return;
      const rect = this.getBoundingClientRect();
      const dpr = root.devicePixelRatio || 1;
      const cap = this._maxRes();
      let renderW = Math.max(1, Math.round(Math.max(1, rect.width) * dpr));
      let renderH = Math.max(1, Math.round(Math.max(1, rect.height) * dpr));
      const longest = Math.max(renderW, renderH);
      if (longest > cap) {
        const k = cap / longest;
        renderW = Math.max(1, Math.round(renderW * k));
        renderH = Math.max(1, Math.round(renderH * k));
      }
      // Keep the preset's composition resolution-independent: its declared
      // width/height is the reference, and scaleX/scaleY are rescaled to the
      // actual render buffer so feature size tracks the look, not pixel count.
      const refW = this._params.width || renderW;
      const refH = this._params.height || renderH;
      const scaled = Object.assign({}, this._params, {
        width: renderW,
        height: renderH,
        scaleX: (this._params.scaleX || 0.02) * (refW / renderW),
        scaleY: (this._params.scaleY || 0.02) * (refH / renderH),
      });
      this._engine.setParams(scaled);
      this._applyMotion();
    }

    // ---- motion / reduced-motion / visibility ----
    _applyMotion() {
      if (!this._engine || !this._params) return;
      const blocked =
        (this._mql && this._mql.matches) ||
        this.hasAttribute("static") ||
        !this._wantPlay ||
        this._visible === false;
      if (blocked) {
        this._engine.pause();
        this._engine.renderOnce();
      } else {
        this._engine.play();
      }
    }
  }

  customElements.define("perlin-noise", PerlinNoiseElement);
})(typeof window !== "undefined" ? window : globalThis);
