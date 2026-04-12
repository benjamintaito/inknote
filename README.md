# inknote

> A digital ink note-taking app built for HP Spectre and other Windows touch/pen devices.

[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178c6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Electron](https://img.shields.io/badge/Electron-31-47848F?logo=electron&logoColor=white)](https://www.electronjs.org/)
[![React](https://img.shields.io/badge/React-18.3-61dafb?logo=react&logoColor=black)](https://react.dev/)

Pressure-sensitive ink rendering, PDF annotation, on-device OCR, and a full notebook/folder system — all local, no cloud required.

---

## Features

- **Ink rendering** — pressure-sensitive pen input with 6 brush types (pen, pencil, fountain, highlighter, watercolor, eraser), Catmull-Rom stroke smoothing, and predictive ink for low latency
- **Palm rejection** — contact-area filters + cooldown window after pen liftoff
- **PDF workflow** — import any PDF, annotate it with ink, export back to PDF
- **On-device OCR** — Tesseract.js v7, Spanish + English, indexes text for full-text search
- **Auto-save** — 3 s debounce after stroke changes; strokes stored as gzip JSON
- **Notebook system** — folders → notebooks → pages, with color-coding, templates, and thumbnails
- **Page templates** — blank, lined, dotted, grid, PDF (A4 @ 300 DPI: 2480×3508 px)

---

## Tech Stack

| Layer | Tech | Notes |
|---|---|---|
| Framework | Electron 31 | Main + renderer process isolation |
| UI | React 18.3 + TypeScript 5.5 | Strict mode enabled |
| Styling | Tailwind CSS 3.4 | |
| State | Zustand 4.5 | 3 stores: app, tool, notebook |
| Database | sql.js 1.14.1 (SQLite/WASM) | Atomically persisted to disk |
| PDF render | pdfjs-dist 3.11 | 5-page LRU cache |
| PDF write | pdf-lib 1.17.1 | Export + annotation |
| OCR | tesseract.js 7.0 | Singleton worker, on-device |
| Build | electron-vite 2.3 + Vite 5 | ESM output for main/preload |
| Packaging | electron-builder 24 | |

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
│   │   ├── toolStore.ts       # Active tool, color, width, zoom
│   │   └── appStore.ts        # Sidebar open/close, dark mode
│   ├── components/
│   │   ├── Canvas/            # Ink rendering pipeline
│   │   │   ├── InkCanvas.tsx
│   │   │   ├── PenInputHandler.ts
│   │   │   ├── PressureEngine.ts
│   │   │   ├── StrokeRenderer.ts
│   │   │   ├── StrokeSmoothing.ts
│   │   │   ├── PredictiveInk.ts
│   │   │   ├── PalmRejection.ts
│   │   │   └── TouchGestureHandler.ts
│   │   ├── PDF/               # PDF annotation + export
│   │   ├── Layout/            # Toolbar, Sidebar, PageNavigator
│   │   └── Notebook/          # NotebookManager, PageTemplates
│   ├── hooks/
│   │   ├── useInkCanvas.ts    # Canvas state + eraser logic
│   │   ├── usePDFDocument.ts  # PDF.js loading + page caching
│   │   └── useUndoRedo.ts     # 50-item history stack
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

Everything is local. No network calls.

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
tags        (id, name)
notebook_tags (notebook_id, tag_id)
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

## Dev Setup

**Prerequisites:** Node.js 20+, npm

```bash
git clone https://github.com/benjataito/inknote
cd inknote
npm install

# Dev (hot reload for renderer, restarts main on changes)
npm run dev

# Type check
npx tsc --noEmit

# Build
npm run build

# Package (creates distributable in dist/)
npm run package
```

The app expects to run on Windows with a pen/touch device. Palm rejection and pressure curves are tuned for the HP Spectre x360 digitizer, but any WinTab-compatible stylus should work.

---

## Known Limitations

- **PDF export** embeds strokes as a PNG overlay (rasterized). Vector stroke export via pdf-lib is not yet implemented.
- **Tool preferences** (color, brush size) reset on app restart — not persisted.
- **OCR results** are indexed for search but not surfaced in a UI panel.
- **Keyboard shortcuts** not yet bound.
- UI text is in Spanish.

---

## Project Status

`v0.1.0` — functional for daily use, actively developed.

Core ink pipeline and notebook management are solid. PDF annotation works. OCR search works. Open items tracked inline via `// TODO` comments throughout the source.
