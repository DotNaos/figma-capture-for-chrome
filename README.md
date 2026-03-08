# Figma Capture for Chrome

A Chrome extension (Manifest V3) that captures the current page into Figma from the Chrome toolbar.

## Features

- Toolbar popup to start a capture
- Configured mode: send capture to Figma using a `captureId` and `endpoint`
- Manual / clipboard mode: run capture with empty `captureId` and `endpoint`
- Config persisted in Chrome extension storage
- URL hash params `#figmacapture=…&figmaendpoint=…` override stored config for that page session

## Project structure

```
manifest.json          Extension manifest (MV3)
src/
  popup.html           Popup UI
  popup.css            Popup styles
  popup.ts             Popup logic
  content.ts           Content script (injector + message bridge)
  injected.ts          Page-context script (loads capture.js, calls window.figma)
scripts/
  build.js             esbuild-based build script
  package.js           Zip packaging script
.github/workflows/
  build.yml            CI – build on push to main, publish artifact on release
```

## Local development

**Prerequisites:** Node.js ≥ 18, npm

```bash
# Install dependencies
npm install

# Build the extension into dist/
npm run build

# Type-check without emitting files
npm run typecheck
```

Load the extension in Chrome:

1. Open `chrome://extensions`
2. Enable **Developer mode** (top-right toggle)
3. Click **Load unpacked**
4. Select the `dist/` folder

After making code changes, run `npm run build` again and click the refresh icon on the extension card.

## Configuration

Open the popup by clicking the extension icon in the Chrome toolbar.

| Field | Description |
|-------|-------------|
| **Capture ID** | The `captureId` to pass to `window.figma.captureForDesign`. Leave empty for clipboard mode. |
| **Endpoint** | The `endpoint` URL for Figma. Leave empty for clipboard mode. |

Click **Save config** to persist the values in Chrome sync storage.

You can also override these values temporarily via the page URL hash:

```
https://example.com/page#figmacapture=my-id&figmaendpoint=https://...
```

Hash params take precedence over stored config for that capture only.

## Release

GitHub Actions builds and packages the extension automatically.

### Automatic (recommended)

1. Create a new GitHub Release and publish it.
2. The [Build workflow](.github/workflows/build.yml) runs, builds the extension, and attaches `figma-capture.zip` to the release.
3. Download `figma-capture.zip` from the release assets and upload it to the Chrome Web Store.

### Manual

```bash
npm run package
```

This produces `figma-capture.zip` in the repository root, ready to upload to the Chrome Web Store.
