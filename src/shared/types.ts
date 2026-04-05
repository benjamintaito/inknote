// ─── Images ───────────────────────────────────────────────────────────────────

export interface PageImage {
  id: string
  src: string              // absolute path to the asset file on disk
  x: number                // canvas-space top-left position
  y: number
  width: number            // current rendered size (may differ from original)
  height: number
  originalWidth: number    // natural image dimensions (for aspect-ratio reset)
  originalHeight: number
  rotation: number         // degrees clockwise (0 by default)
  opacity: number          // 0–1
  locked: boolean          // when true, move/resize are blocked
  zIndex: number           // stacking order among images (higher = on top)
}

// ─── Canvas / Ink ─────────────────────────────────────────────────────────────

export interface Point {
  x: number
  y: number
  pressure: number
  tiltX?: number
  tiltY?: number
  timestamp: number
}

export type ToolType = 'pen' | 'pencil' | 'fountain' | 'highlighter' | 'watercolor' | 'eraser'
export type PressureCurve = 'linear' | 'smooth' | 'firm'
export type PageTemplate = 'blank' | 'lined' | 'dotted' | 'grid' | 'pdf'

export interface Stroke {
  id: string
  points: Point[]
  tool: ToolType
  color: string
  baseWidth: number
  opacity: number
  pressureCurve: PressureCurve
  timestamp: number
}

export interface Viewport {
  scale: number
  offsetX: number
  offsetY: number
}

// ─── Stroke file format (page-{id}.json) ─────────────────────────────────────

export interface StrokeFile {
  version: number          // 1 = strokes only, 2 = strokes + images
  pageId: string
  strokes: Stroke[]
  images?: PageImage[]     // added in version 2
  metadata: {
    template: PageTemplate
    width: number
    height: number
  }
}

// ─── API types (IPC-safe: no Date objects, ISO strings instead) ───────────────

export interface FolderMeta {
  id: string
  name: string
  color: string
  sortOrder: number
  createdAt: string
}

export interface NotebookMeta {
  id: string
  name: string
  subject: string | null   // shown as "Categoría" in UI; kept as "subject" internally
  color: string
  folderId: string | null  // null = no folder
  createdAt: string        // ISO 8601
  updatedAt: string
}

export interface PageMeta {
  id: string
  notebookId: string
  pageOrder: number
  width: number
  height: number
  template: PageTemplate
  pdfPath: string | null
  strokeDataPath: string | null
  thumbnailPath: string | null
  createdAt: string
  updatedAt: string
}

// ─── IPC channel names (main ↔ renderer) ─────────────────────────────────────

export const IPC = {
  // Notebooks
  NOTEBOOK_LIST:        'notebook:list',
  NOTEBOOK_GET:         'notebook:get',
  NOTEBOOK_CREATE:      'notebook:create',
  NOTEBOOK_UPDATE:      'notebook:update',
  NOTEBOOK_DELETE:      'notebook:delete',
  NOTEBOOK_CATEGORIES:  'notebook:categories',
  NOTEBOOK_MOVE_FOLDER: 'notebook:move-folder',

  // Folders
  FOLDER_LIST:   'folder:list',
  FOLDER_CREATE: 'folder:create',
  FOLDER_UPDATE: 'folder:update',
  FOLDER_DELETE: 'folder:delete',

  // Pages
  PAGE_LIST:           'page:list',
  PAGE_CREATE:         'page:create',
  PAGE_LOAD:           'page:load',
  PAGE_SAVE_STROKES:   'page:save-strokes',
  PAGE_SAVE_THUMBNAIL: 'page:save-thumbnail',
  PAGE_DELETE:         'page:delete',
  PAGE_REORDER:        'page:reorder',

  // Images
  IMAGE_IMPORT: 'image:import',   // open file dialog, copy to assets
  IMAGE_PASTE:  'image:paste',    // receive buffer from clipboard, save to assets
  IMAGE_READ:   'image:read',     // read image file → base64 data URL

  // Assets
  PDF_IMPORT: 'pdf:import',

  // PDF workflow
  PDF_OPEN_DIALOG:   'pdf:open-dialog',
  PDF_IMPORT_FULL:   'pdf:import-full',
  PDF_READ_BYTES:    'pdf:read-bytes',
  PDF_EXPORT_DIALOG: 'pdf:export-dialog',
  PDF_EXPORT_SAVE:   'pdf:export-save',

  // OCR + Search
  OCR_SAVE:     'ocr:save',
  SEARCH_QUERY: 'search:query',
} as const

export type IpcChannel = (typeof IPC)[keyof typeof IPC]

export interface PDFImportResult {
  notebook: NotebookMeta
  pages: PageMeta[]
  pdfPath: string
}

export interface SearchResult {
  pageId: string
  notebookId: string
  notebookName: string
  pageOrder: number
  excerpt: string
}
