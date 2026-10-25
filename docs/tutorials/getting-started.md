# Getting started

By the end of this walk-through you will have run Perlin Studio, shaped a noise animation of your own, and saved it as a looping video and as a preset file. It takes about ten minutes and needs nothing but a browser.

## 1. Open the studio

Either open the hosted copy at <https://pages.jkaindl.de/perlin-studio/> or run it from a clone of the repository: double-click `index.html`, or serve the folder (`python3 -m http.server 8000`, then open `http://localhost:8000`). There is nothing to install and nothing to build.

You should see a sidebar of numbered sections on the left and a large canvas on the right, already drawing an image.

## 2. Pick a look and let it move

In section **01 · Presets**, click the **lava** chip. The whole parameter set loads and the canvas redraws. Press the **▶** button (or **Space**) under the canvas: the picture starts to move, and the corner tag changes from PAUSED to LIVE.

Press **▶** again to stop. The slider next to it is the time position; drag it to scrub through the animation.

## 3. Change something

Open section **03 · Noise** and change **scale x** and **scale y** to `0.05`. The structures get finer. Set them back to `0.02`, then raise **octaves** from 6 to 8 and watch fine detail appear. Every change shows on the canvas straight away.

Now open **04 · Color mode** and switch the dropdown from *Gradient* to *Cosine*. Pick the **Neon** palette. The same noise now has a different colour ramp.

To see what the noise looks like as a lit surface, switch on **Relief lighting** below the colour controls.

## 4. Make it faster (optional)

In section **02 · Resolution & tile**, set **Renderer** to **GPU · WebGL2**. The image stays the same, but large sizes and heavy settings draw much faster. If the option is greyed out, your browser has no WebGL2; stay on CPU.

## 5. Check that it loops

In section **05 · Loop**, **Seamless loop** is on. Set **Loop duration** to `4` seconds. Press **▶** and watch the canvas: after the duration the animation arrives exactly where it started. That is what makes the video you will record a clean loop.

## 6. Record a looping video

In section **09 · Export**:

1. Leave **resolution** on *Match canvas* (or pick *1920×1080 · landscape*).
2. Set **fps** to `30` and **frames** to `120` (the loop duration of 4 s × 30 fps).
3. Press **Record animation**. A progress bar fills while the frames render; the corner tag says REC.
4. When it finishes, the canvas shows the video. Press **Download video**.

You now have an MP4 (Safari, Chrome 126+) or WebM (Firefox) that repeats without a jump.

## 7. Keep your look

Back in section **01 · Presets**, press **Save JSON**. The file holds every setting; **Load JSON** brings it back later, and the embeddable `<perlin-noise>` element can read it too.

## Where to go from here

- Do a specific job: the [how-to guides](../README.md#how-to-guides).
- Look up a control: the [control reference](../reference/controls.md).
- Understand why the parameters behave as they do: [How the parameters shape the image](../explanation/how-the-parameters-shape-the-image.md).
- Stuck? [Troubleshooting](../how-to/troubleshooting.md).
