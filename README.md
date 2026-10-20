# FBX Viewer

A lightweight, browser-based 3D viewer for `.fbx` files, built with [three.js](https://threejs.org/).
Drag and drop a model to inspect it — orbit, zoom, pan, play animations, toggle wireframe, and save screenshots. No build step, no framework, just three static files.

## Features

- **Drag & drop** or file-picker loading of `.fbx` files
- **Load textures alongside the model** — drop the `.fbx` with its images (or a whole folder)
- **Tolerant texture matching** — resolves textures even when filenames differ by `.`/`_`/`-`/spaces or extension
- **Orbit / zoom / pan** camera controls (mouse)
- **Lighting** with soft shadows and a ground grid
- **Animation playback** — clip selector, play/pause, speed control
- **Wireframe**, **grid**, **auto-rotate**, and **background color** toggles
- **Model stats** — mesh / vertex / triangle / animation counts
- **Save screenshot** as PNG
- Auto-centers and frames any model regardless of scale

## Requirements

- A modern browser (Chrome, Edge, or Firefox)
- Any tool that can serve static files locally (Python, Node, or a code-editor
  "live server" extension)

> The viewer loads three.js from a CDN via an import map, so an internet
> connection is needed the first time (the browser then caches it).

## Getting started

```bash
git clone https://github.com/<your-username>/fbx-viewer.git
cd fbx-viewer
```

Because the app uses ES modules, it must be served over `http://` — opening
`index.html` directly as a `file://` will not work. Start any static server
from the project folder:

**Python** (no install needed):

```bash
python -m http.server 5500
```

**Node:**

```bash
npx serve -l 5500
```

Then open <http://localhost:5500> in your browser.

## Usage

1. Start the server and open the page.
2. Drag an `.fbx` file onto the window (or click **Choose files…**).
3. Use the mouse to inspect:
   - **Left-drag** — orbit
   - **Right-drag** — pan
   - **Scroll** — zoom
4. Use the right-hand panel for wireframe, grid, animations, and screenshots.

## Loading textures

FBX files reference textures by a file path that was baked in on the machine
that exported the model, which won't exist on yours. Since the browser can't
read your disk on its own, you provide the textures alongside the model:

- **Drag the `.fbx` and its `.png`/`.jpg` textures together** onto the window, or
- **Drag the whole folder** (subfolders are searched too), or
- Click **Choose files…** and multi-select the model + textures.

Textures are matched to the FBX by **filename**, ignoring the baked-in paths.
Matching is tolerant of separator differences (`Model.Diffuse.png` will match
`model_diffuse.png`) and, as a last resort, of a differing extension. Embedded
(base64) textures inside the FBX also work automatically.

Supported image types: PNG, JPG, BMP, TGA, GIF, WebP.

## Troubleshooting

Open the browser console (F12) — the viewer logs what it's doing:

- `[FBX texture] FBX requests "…" → MATCHED ✓ / NOT FOUND ✗` — whether each
  texture the model asks for was found among the files you provided. If you see
  `NOT FOUND`, the log lists the files you dropped so you can compare names.
- `[FBX materials] maps bound: N · … · meshes missing UVs: N` — a summary. If a
  mesh has no UV coordinates, textures physically cannot map onto it (a model
  export issue, not a viewer issue).

**Model appears black:** almost always a texture that didn't load — check the
`NOT FOUND` lines above. The viewer already sets sRGB color space and resets
black base colors automatically.

**Changes not showing up:** browsers cache ES modules aggressively. Hard-refresh
with `Ctrl+Shift+R` (or `Cmd+Shift+R` on macOS).

## Project structure

| File | Purpose |
|------|---------|
| `index.html` | Markup and the three.js CDN import map |
| `style.css`  | UI styling |
| `main.js`    | three.js scene, model/texture loading, and controls |

## How it works

- Rendering, camera controls, and FBX parsing are handled by
  [three.js](https://threejs.org/) (`FBXLoader` + `OrbitControls`), loaded from
  a CDN via an [import map](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap).
- Dropped files are exposed to the loader through a `THREE.LoadingManager` URL
  rewriter, which maps the texture paths baked into the FBX to the image files
  you provide.

## License

MIT
