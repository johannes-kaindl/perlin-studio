# Perlin Studio documentation

Perlin Studio makes seamless looping noise animations in the browser: images, loop videos, textures and an embeddable element. The documentation follows the [Diátaxis](https://diataxis.fr/) split: learn, do, look up, understand.

Start here if you are new: **[Getting started](tutorials/getting-started.md)**. Something not working: **[Troubleshooting](how-to/troubleshooting.md)**.

## Tutorials

- [Getting started](tutorials/getting-started.md) — from opening the studio to a looping video and a saved preset.

## How-to guides

- [Export a looping video](how-to/export-a-looping-video.md)
- [Export an image or a tileable texture](how-to/export-an-image-or-texture.md)
- [Match a brand palette](how-to/match-a-brand-palette.md)
- [Cut noise out with a mask](how-to/cut-noise-out-with-a-mask.md)
- [Get a specific look](how-to/get-a-specific-look.md)
- [Use the GPU renderer](how-to/use-the-gpu-renderer.md)
- [Embed in a web page](how-to/embed-in-a-web-page.md)
- [Install as an app (PWA)](how-to/install-the-pwa.md)
- [Install the macOS app](how-to/install-the-macos-app.md)
- [Troubleshooting](how-to/troubleshooting.md)

## Reference

- [Control reference](reference/controls.md) — every control, range and default.
- [Colour modes and relief lighting](reference/colour-modes.md)
- [Preset format](reference/preset-format.md) — every key of the JSON file.
- [The `<perlin-noise>` element](reference/web-component.md) — attributes, properties, behaviour.

## Explanation

- [How the parameters shape the image](explanation/how-the-parameters-shape-the-image.md)
- [Design choices](explanation/design-choices.md)
- [Architecture](explanation/architecture.md) — layering, the maths, the worker pipeline, the GPU renderer.

## For contributors and agents

The [`internal/`](internal/) folder holds orientation and decisions for people working on the code: [`architecture.md`](internal/architecture.md) (layout and glossary), [`decisions.md`](internal/decisions.md) (why things are as they are), [`ui-spec.md`](internal/ui-spec.md) (element ids of every control) and [`web-component-spec.md`](internal/web-component-spec.md) (design of the element). See also [CONTRIBUTING.md](../CONTRIBUTING.md) and [AGENTS.md](../AGENTS.md).

Images used by these pages are in [`images/`](images/); rendered example loops are in [`examples/`](examples/).
