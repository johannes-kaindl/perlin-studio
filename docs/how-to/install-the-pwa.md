# Install Perlin Studio as an app (PWA)

The studio is an installable web app. Installing gives it its own window and an icon; it does not change what it can do.

## Install

- **Chrome, Edge (desktop):** open <https://pages.jkaindl.de/perlin-studio/>, then use the install icon at the right of the address bar, or the browser menu → *Install Perlin Studio*.
- **Safari on iOS / iPadOS:** open the site, tap **Share**, then **Add to Home Screen**.
- **Safari on macOS 14+:** **File → Add to Dock**.
- **Android Chrome:** menu → *Install app* / *Add to Home screen*.

The app opens in a standalone window (`display: standalone`) and starts at the studio.

## What to expect

- **It needs a connection to load.** There is deliberately no service worker and no offline cache, so the installed app fetches its files from the site like a normal page. Once loaded, the studio itself needs no network; exporting works offline in that session.
- **Updates need no action.** Files are fetched with normal validation (ETag), so the installed app picks up a new release the next time it starts or reloads. There is no cache version to clear.
- **Your settings stay.** The theme and the renderer choice are kept in the browser's local storage for this site.

## Prefer a file?

You can also open `index.html` from a clone of the repository directly, or run it from a local server; see [Getting started](../tutorials/getting-started.md). For a live desktop background there is a native app: [Install the macOS app](install-the-macos-app.md).
