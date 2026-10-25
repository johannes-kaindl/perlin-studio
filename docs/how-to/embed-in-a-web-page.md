# Embed in a web page

Put the live animation on any page with the `<perlin-noise>` element: a renderer without controls, no build step, no dependencies. All options and behaviours are in the [element reference](../reference/web-component.md).

## Add the scripts

Copy either the four source files from the repository root, in this order:

```html
<script src="perlin.js"></script>
<script src="perlin-presets.js"></script>
<script src="perlin-engine.js"></script>
<script src="perlin-element.js"></script>
```

or the single bundle `dist/perlin-noise.js`, which holds the same four:

```html
<script src="perlin-noise.js"></script>
```

The hosted site also serves the bundle: `https://pages.jkaindl.de/perlin-studio/dist/perlin-noise.js`.

Then use the tag:

```html
<perlin-noise preset="aurora" autoplay></perlin-noise>
```

It runs straight from `file://`. Only the `src` attribute (loading a saved preset file) needs an HTTP server.

## Recipe: a full-bleed hero background

```html
<section class="hero">
  <perlin-noise preset="aurora" autoplay max-resolution="1280"></perlin-noise>
  <h1>Your headline</h1>
</section>
```

```css
.hero { position: relative; min-height: 70vh; display: grid; place-items: center; overflow: hidden; }
.hero perlin-noise { position: absolute; inset: 0; z-index: 0; }
.hero h1 { position: relative; z-index: 1; text-shadow: 0 2px 16px rgba(0,0,0,.6); }
```

## Recipe: your own look, designed in the studio

Dial in a look, press **Save JSON**, put the file next to your page and point `src` at it (this needs an HTTP server):

```html
<perlin-noise src="my-look.json" autoplay></perlin-noise>
```

The file round-trips exactly, including a custom gradient, a cosine palette, a noise type and relief lighting.

## Recipe: drive it from JavaScript

```js
const el = document.querySelector("perlin-noise");
el.params = { colorMode: "gradient", gradientName: "fire",
              scaleX: 0.02, scaleY: 0.02, octaves: 5,
              loop: true, loopDuration: 6, loopRadius: 1 };
el.play();   // or el.pause(); el.playing is a boolean
```

`gradientName` and `cosineName` are expanded to concrete values for you.

## Recipe: keep the cost down

- `max-resolution` is the main dial: halving it quarters the work.
- The octaves in the preset are the other big lever.
- Each element starts its own worker. One hero is ideal; for a grid of many, use one larger element or exported video thumbnails.
- The element draws on the CPU; the GPU renderer is a studio setting only.

A runnable demo: [examples/embed.html](../../examples/embed.html) ([live](https://pages.jkaindl.de/perlin-studio/examples/embed.html)).

## A video instead

For a page that should not run any script, export a loop and use a `<video autoplay muted loop playsinline>`: [Export a looping video](export-a-looping-video.md).
