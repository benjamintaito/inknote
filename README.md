# InkNote

> A digital ink note-taking app for Windows pen/touch devices, built with Electron.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.3-61dafb?logo=react&logoColor=black)](https://react.dev/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

Pressure-sensitive ink rendering, PDF annotation, on-device OCR, and a full notebook/folder system — everything stored locally.

---

## Features

- **Ink rendering** — pressure-sensitive pen input with 5 brush types (pen, pencil, fountain, highlighter, watercolor) plus stroke/area eraser, Catmull-Rom stroke smoothing, and predictive ink for low latency
- **Palm rejection** — contact-area filters + cooldown window after pen liftoff
- **PDF workflow** — import any PDF as a notebook, annotate it with ink and images, export back to PDF
- **Images** — insert from file or paste from clipboard; move, resize, rotate, reorder, lock, and set opacity with the select tool
- **OCR** — Tesseract.js v7 (Spanish + English) recognizes handwriting on-device and indexes it for full-text search across notebooks
- **Auto-save** — 3 s debounce after stroke changes; strokes stored as gzipped JSON
- **Notebook system** — folders → notebooks → pages, with color-coding, categories, templates, and thumbnails
- **Page templates** — blank, lined, dotted, grid (A4 @ 300 DPI: 2480×3508 px), plus PDF pages
- **Touch gestures** — two-finger pan and pinch-zoom with inertia; Space+drag pan with the mouse
- **Dark mode** — persisted across sessions, along with tool preferences

### Keyboard shortcuts

| Shortcut | Action |
|---|---|
| `Ctrl+Z` / `Ctrl+Shift+Z` / `Ctrl+Y` | Undo / redo |
| `Ctrl+S` | Save current page |
| `Ctrl+E` | Export annotated PDF |
| `Ctrl+N` | New notebook |
| `P` / `E` / `H` / `V` | Pen / eraser / highlighter / select |
| `L` | Toggle straight-line mode (`Shift` snaps to 45°) |
| `Ctrl+scroll` | Zoom · `Space+drag` pan |

---

## Tech Stack

| Layer | Tech | Notes |
|---|---|---|
| Framework | Electron 31 | Main + renderer process isolation, `contextIsolation` on |
| UI | React 18.3 + TypeScript 5.5 | Strict mode enabled |
| Styling | Tailwind CSS 3.4 | CSS variables for light/dark theming |
| State | Zustand 4.5 | 3 stores: app, tool, notebook |
| Database | sql.js 1.14 (SQLite/WASM) | Atomically persisted to disk, no native compilation |
| PDF render | pdfjs-dist 3.11 | 5-page LRU cache |
| PDF write | pdf-lib 1.17 | Export + annotation |
| OCR | tesseract.js 7.0 | Singleton worker, runs on-device |
| Build | electron-vite 2.3 + Vite 5 | ESM main, CJS preload |
| Packaging | electron-builder 24 | NSIS installer for Windows |

---

## Architecture

```
src/
├── main/                      # Node.js process (Electron main)
│   ├── index.ts               # App lifecycle, window creation
│   ├── db.ts                  # SQLite via sql.js — schema, queries, migrations
│   ├── ipc-handlers.ts        # ~30 IPC channels registered here
│   ├── file-manager.ts        # Reads/writes gzip stroke data, thumbnails, assets
│   └── pdf-export.ts          # Save dialogs + PDF byte I/O
│
├── preload/
│   └── index.ts               # contextBridge → window.electronAPI
│
├── renderer/src/              # React app (sandboxed renderer process)
│   ├── App.tsx
│   ├── stores/
│   │   ├── notebookStore.ts   # Main data store — async IPC actions, auto-save
│   │   ├── toolStore.ts       # Active tool, color, width, zoom (persisted)
│   │   └── appStore.ts        # Sidebar open/close, dark mode (persisted)
│   ├── components/
│   │   ├── Canvas/            # Ink rendering pipeline
│   │   │   ├── InkCanvas.tsx
│   │   │   ├── PenInputHandler.ts
│   │   │   ├── PressureEngine.ts
│   │   │   ├── StrokeRenderer.ts
│   │   │   ├── StrokeSmoothing.ts
│   │   │   ├── PredictiveInk.ts
│   │   │   ├── PalmRejection.ts
│   │   │   ├── TouchGestureHandler.ts
│   │   │   └── ImageSelectionOverlay.tsx
│   │   ├── PDF/               # PDF annotation + export
│   │   ├── Layout/            # Toolbar, Sidebar, PageNavigator
│   │   ├── Notebook/          # NotebookManager, PageTemplates
│   │   └── OcrPanel.tsx       # OCR progress + results panel
│   ├── hooks/
│   │   ├── useInkCanvas.ts    # Canvas state + eraser logic
│   │   ├── usePDFDocument.ts  # PDF.js loading + page caching
│   │   ├── useUndoRedo.ts     # 50-item history stack (strokes + images)
│   │   ├── useKeyboardShortcuts.ts  # All global shortcuts, single source
│   │   └── useFileImage.ts    # Local image → data URL (CSP-safe)
│   └── utils/
│       └── ocr.ts             # Tesseract.js singleton + binarization
│
└── shared/
    └── types.ts               # Shared types + IPC channel registry
```

**Data flow:**

```
Pointer Event (stylus)
  → PenInputHandler  (pressure normalization, palm filter)
  → PressureEngine   (width + opacity curves: linear / smooth / firm)
  → StrokeSmoothing  (Catmull-Rom, lookback window)
  → PredictiveInk    (low-latency preview point)
  → StrokeRenderer   (Canvas 2D composite draw)
  → notebookStore    (isDirty = true → 3 s autosave timer)
  → IPC: page:save-strokes
  → file-manager     (gzip JSON → userData/data/notebooks/{id}/pages/page-{id}.json.gz)
```

---

## Data Storage

All notes stay on your machine. The only network access is a one-time download
of the OCR language data (Spanish + English, ~15 MB) the first time you run OCR.

```
%APPDATA%/inknote/
├── inknote.db                            ← sql.js snapshot (binary SQLite)
└── data/notebooks/{notebook-id}/
    ├── pages/
    │   └── page-{page-id}.json.gz        ← gzipped {strokes[], images[]}
    ├── thumbnails/
    │   └── thumb-{page-id}.jpg
    └── assets/
        ├── {uuid}.pdf
        └── img-{uuid}.{ext}
```

**SQLite schema (simplified):**

```sql
folders     (id, name, color, sort_order, created_at)
notebooks   (id, name, subject, color, folder_id, created_at, updated_at)
pages       (id, notebook_id, page_order, width, height, template,
             pdf_path, stroke_data_path, thumbnail_path, ocr_text,
             created_at, updated_at)
```

Foreign keys enabled. Atomic writes via temp→rename. `ocr_text` added via migration if missing.

---

## IPC Channels

All renderer↔main communication goes through `contextBridge`. Channels are typed via `Handler<TArg, TReturn>` in `src/shared/types.ts`.

| Namespace | Channels |
|---|---|
| `folder:*` | list, create, update, delete |
| `notebook:*` | list, get, create, update, delete, move-folder, categories |
| `page:*` | list, create, load, save-strokes, save-thumbnail, delete, reorder |
| `image:*` | import (file dialog), paste (clipboard), read (→ data URL) |
| `pdf:*` | open-dialog, import-full, import, read-bytes, export-dialog, export-save |
| `ocr:*` | save |
| `search:*` | query (full-text on ocr_text) |

---

## Development

**Prerequisites:** Node.js 20+, npm

```bash
git clone https://github.com/benjamintaito/inknote
cd inknote
npm install

# Dev (hot reload for renderer, restarts main on changes)
npm run dev

# Type check
npm run typecheck

# Build bundles into out/
npm run build

# Build + package the Windows installer into dist/
npm run package
```

The app targets Windows with a pen/touch device. Palm rejection and pressure
curves are tuned for the HP Spectre x360 digitizer, but any stylus that reports
through the Pointer Events API should work; a mouse works too.

---

## Known Limitations

- **PDF export** embeds annotations as a rasterized PNG overlay per page (vector export is not implemented).
- **OCR language data** (spa/eng) is downloaded from a CDN on first OCR run and cached by the browser layer afterwards.
- **UI text is in Spanish** — i18n is not wired up yet.
- No cloud sync — this is by design, but there's also no built-in backup beyond copying `%APPDATA%/inknote`.

Contributions are welcome — feel free to open an issue or PR.

---

## License

[MIT](LICENSE) © Benjamín Taito
