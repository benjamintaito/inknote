/**
 * notebookStore.ts — Zustand store for notebooks, pages, and stroke persistence.
 *
 * Auto-save: strokes are flushed to disk 3 seconds after the last change.
 * All IPC calls are forwarded to the main process via window.electronAPI.invoke.
 */

import { create } from 'zustand'
import type { FolderMeta, NotebookMeta, PageMeta, Stroke, PageImage, StrokeFile, PageTemplate, PDFImportResult, SearchResult } from '@shared/types'
import { IPC } from '@shared/types'

// ── Typed IPC helper ───────────────────────────────────────────────────────────

function ipc<T>(channel: string, data?: unknown): Promise<T> {
  return window.electronAPI.invoke<T>(channel, data)
}

// ── Auto-save debounce ─────────────────────────────────────────────────────────

let saveTimer: ReturnType<typeof setTimeout> | null = null
/** The save currently being written, so later saves can wait for it. */
let inFlightSave: Promise<void> | null = null

function clearSaveTimer() {
  if (saveTimer !== null) { clearTimeout(saveTimer); saveTimer = null }
}

// ── Store ──────────────────────────────────────────────────────────────────────

interface NotebookState {
  // ── Data ────────────────────────────────────────────────────────────────────
  folders:        FolderMeta[]
  notebooks:      NotebookMeta[]
  activeNotebook: NotebookMeta | null
  pages:          PageMeta[]
  activePage:     PageMeta | null
  strokes:        Stroke[]
  images:         PageImage[]
  categories:     string[]   // distinct subject values from all notebooks

  // ── Status ──────────────────────────────────────────────────────────────────
  isDirty:   boolean    // unsaved stroke changes
  isSaving:  boolean
  isLoading: boolean
  error:     string | null

  // ── OCR ─────────────────────────────────────────────────────────────────────
  isOCRRunning: boolean
  ocrProgress:  number   // 0–1
  ocrStatus:    string
  ocrText:      string | null

  // ── Search ──────────────────────────────────────────────────────────────────
  searchQuery:   string
  searchResults: SearchResult[]

  // ── Folder actions ────────────────────────────────────────────────────────────
  fetchFolders:          () => Promise<void>
  createFolder:          (name: string, color?: string) => Promise<FolderMeta>
  updateFolder:          (id: string, data: { name?: string; color?: string }) => Promise<void>
  deleteFolder:          (id: string) => Promise<void>
  moveNotebookToFolder:  (notebookId: string, folderId: string | null) => Promise<void>

  // ── Notebook actions ─────────────────────────────────────────────────────────
  fetchNotebooks: () => Promise<void>
  createNotebook: (data: { name: string; subject?: string; color?: string; folderId?: string | null }) => Promise<NotebookMeta>
  deleteNotebook: (id: string) => Promise<void>
  selectNotebook: (id: string) => Promise<void>
  fetchCategories: () => Promise<void>

  // ── Page actions ──────────────────────────────────────────────────────────────
  createPage:   (template?: PageTemplate) => Promise<PageMeta>
  selectPage:   (page: PageMeta) => Promise<void>
  deletePage:   (pageId: string) => Promise<void>
  reorderPages: (pageIds: string[]) => Promise<void>

  // ── Stroke / image actions (called from canvas) ───────────────────────────────
  setStrokes:      (strokes: Stroke[]) => void
  setImages:       (images: PageImage[]) => void
  saveCurrentPage: () => Promise<void>
  /** Save a page thumbnail. `target` defaults to the active page — pass it
   *  explicitly when capturing the page being navigated away from. */
  saveThumbnail:   (base64: string, target?: { notebookId: string; pageId: string }) => Promise<void>

  // ── PDF import ────────────────────────────────────────────────────────────────
  importPDFFull: (sourcePath: string, name: string) => Promise<PDFImportResult>

  // ── OCR ───────────────────────────────────────────────────────────────────────
  runOCR:       () => Promise<void>
  clearOcrText: () => void

  // ── Search ────────────────────────────────────────────────────────────────────
  runSearch:   (query: string) => Promise<void>
  clearSearch: () => void

  // ── Helpers ───────────────────────────────────────────────────────────────────
  clearError: () => void
}

export const useNotebookStore = create<NotebookState>((set, get) => ({
  folders:        [],
  notebooks:      [],
  activeNotebook: null,
  pages:          [],
  activePage:     null,
  strokes:        [],
  images:         [],
  categories:     [],
  isDirty:        false,
  isSaving:       false,
  isLoading:      false,
  error:          null,
  isOCRRunning:   false,
  ocrProgress:    0,
  ocrStatus:      '',
  ocrText:        null,
  searchQuery:    '',
  searchResults:  [],

  // ── Folders ───────────────────────────────────────────────────────────────────

  fetchFolders: async () => {
    try {
      const folders = await ipc<FolderMeta[]>(IPC.FOLDER_LIST)
      set({ folders })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  createFolder: async (name, color) => {
    const folder = await ipc<FolderMeta>(IPC.FOLDER_CREATE, { name, color })
    set((s) => ({ folders: [...s.folders, folder] }))
    return folder
  },

  updateFolder: async (id, data) => {
    await ipc(IPC.FOLDER_UPDATE, { id, ...data })
    set((s) => ({
      folders: s.folders.map((f) => f.id === id ? { ...f, ...data } : f),
    }))
  },

  deleteFolder: async (id) => {
    await ipc(IPC.FOLDER_DELETE, { id })
    set((s) => ({
      folders:   s.folders.filter((f) => f.id !== id),
      // Detach notebooks that were in this folder
      notebooks: s.notebooks.map((n) => n.folderId === id ? { ...n, folderId: null } : n),
    }))
  },

  moveNotebookToFolder: async (notebookId, folderId) => {
    await ipc(IPC.NOTEBOOK_MOVE_FOLDER, { notebookId, folderId })
    set((s) => ({
      notebooks: s.notebooks.map((n) =>
        n.id === notebookId ? { ...n, folderId } : n
      ),
      // Update activeNotebook if it was moved
      activeNotebook: s.activeNotebook?.id === notebookId
        ? { ...s.activeNotebook, folderId }
        : s.activeNotebook,
    }))
  },

  // ── Notebooks ─────────────────────────────────────────────────────────────────

  fetchNotebooks: async () => {
    try {
      set({ isLoading: true, error: null })
      const [notebooks, folders] = await Promise.all([
        ipc<NotebookMeta[]>(IPC.NOTEBOOK_LIST),
        ipc<FolderMeta[]>(IPC.FOLDER_LIST),
      ])
      set({ notebooks, folders, isLoading: false })
    } catch (e) {
      set({ error: String(e), isLoading: false })
    }
  },

  createNotebook: async (data) => {
    const nb = await ipc<NotebookMeta>(IPC.NOTEBOOK_CREATE, data)
    set((s) => ({ notebooks: [nb, ...s.notebooks] }))
    return nb
  },

  deleteNotebook: async (id) => {
    await ipc(IPC.NOTEBOOK_DELETE, { id })
    if (get().activeNotebook?.id === id) {
      clearSaveTimer()
      set({ isDirty: false })
    }
    set((s) => ({
      notebooks:      s.notebooks.filter((n) => n.id !== id),
      activeNotebook: s.activeNotebook?.id === id ? null : s.activeNotebook,
      pages:          s.activeNotebook?.id === id ? [] : s.pages,
      activePage:     s.activeNotebook?.id === id ? null : s.activePage,
      strokes:        s.activeNotebook?.id === id ? [] : s.strokes,
      images:         s.activeNotebook?.id === id ? [] : s.images,
    }))
  },

  selectNotebook: async (id) => {
    const nb = get().notebooks.find((n) => n.id === id) ?? null
    if (!nb) return

    // Flush the outgoing page: its pending auto-save would otherwise be
    // dropped once activePage is cleared below.
    await get().saveCurrentPage()

    set({ activeNotebook: nb, isLoading: true, activePage: null, strokes: [], images: [], isDirty: false })
    clearSaveTimer()
    try {
      const pages = await ipc<PageMeta[]>(IPC.PAGE_LIST, { notebookId: id })
      // Another notebook was selected while this one was loading
      if (get().activeNotebook?.id !== id) return
      set({ pages, isLoading: false })

      // Auto-select first page if available
      if (pages.length > 0) {
        await get().selectPage(pages[0])
      }
    } catch (e) {
      set({ error: String(e), isLoading: false })
    }
  },

  fetchCategories: async () => {
    try {
      const categories = await ipc<string[]>(IPC.NOTEBOOK_CATEGORIES)
      set({ categories })
    } catch {
      // non-critical, ignore
    }
  },

  // ── Pages ─────────────────────────────────────────────────────────────────────

  createPage: async (template = 'blank') => {
    const { activeNotebook } = get()
    if (!activeNotebook) throw new Error('No active notebook')

    const page = await ipc<PageMeta>(IPC.PAGE_CREATE, {
      notebookId: activeNotebook.id,
      template,
    })
    set((s) => ({ pages: [...s.pages, page] }))
    await get().selectPage(page)
    return page
  },

  selectPage: async (page) => {
    // Save current page before switching (also waits for an in-flight save)
    await get().saveCurrentPage()

    set({ activePage: page, isLoading: true, strokes: [], images: [], isDirty: false })
    clearSaveTimer()

    const { activeNotebook } = get()
    if (!activeNotebook) { set({ isLoading: false }); return }

    try {
      const file = await ipc<StrokeFile | null>(IPC.PAGE_LOAD, {
        notebookId: activeNotebook.id,
        pageId: page.id,
      })
      // A later selectPage won the race: don't put this page's strokes on it
      if (get().activePage?.id !== page.id) return
      set({ strokes: file?.strokes ?? [], images: file?.images ?? [], isLoading: false })
    } catch (e) {
      if (get().activePage?.id !== page.id) return
      set({ error: String(e), isLoading: false })
    }
  },

  deletePage: async (pageId) => {
    const { activeNotebook, activePage } = get()
    if (!activeNotebook) return
    await ipc(IPC.PAGE_DELETE, { notebookId: activeNotebook.id, pageId })

    const remaining = get().pages.filter((p) => p.id !== pageId)
    if (activePage?.id === pageId) {
      // The deleted page must not be re-saved by the pending auto-save
      clearSaveTimer()
      set({ pages: remaining, activePage: null, strokes: [], images: [], isDirty: false })
      // selectPage loads the next page's strokes from disk
      if (remaining.length > 0) await get().selectPage(remaining[0])
    } else {
      set({ pages: remaining })
    }
  },

  reorderPages: async (pageIds) => {
    const { activeNotebook } = get()
    if (!activeNotebook) return
    await ipc(IPC.PAGE_REORDER, { notebookId: activeNotebook.id, pageIds })
    // Reorder local pages array to match
    set((s) => {
      const map = new Map(s.pages.map((p) => [p.id, p]))
      const pages = pageIds.map((id) => map.get(id)).filter(Boolean) as PageMeta[]
      return { pages }
    })
  },

  // ── Strokes + images + auto-save ──────────────────────────────────────────────

  setStrokes: (strokes) => {
    // While a page is loading the canvas may still hold the previous page's
    // data; never let it leak into the incoming page.
    if (get().isLoading) return
    set({ strokes, isDirty: true })
    clearSaveTimer()
    saveTimer = setTimeout(() => void get().saveCurrentPage(), 3000)
  },

  setImages: (images) => {
    if (get().isLoading) return
    set({ images, isDirty: true })
    clearSaveTimer()
    saveTimer = setTimeout(() => void get().saveCurrentPage(), 3000)
  },

  saveCurrentPage: async () => {
    clearSaveTimer()
    // Serialize saves: wait for the one in flight, then write the latest state
    while (inFlightSave) await inFlightSave

    const { activeNotebook, activePage, strokes, images, isDirty } = get()
    if (!activeNotebook || !activePage || !isDirty) return

    const save = (async () => {
      set({ isSaving: true })
      try {
        await ipc(IPC.PAGE_SAVE_STROKES, {
          notebookId: activeNotebook.id,
          pageId:     activePage.id,
          strokes,
          images,
          metadata: {
            template: activePage.template,
            width:    activePage.width,
            height:   activePage.height,
          },
        })
        // Only mark clean if nothing changed while the write was in flight
        const s = get()
        if (s.activePage?.id === activePage.id && s.strokes === strokes && s.images === images) {
          set({ isDirty: false })
        }
      } catch (e) {
        set({ error: `No se pudo guardar la página: ${String(e)}` })
      } finally {
        set({ isSaving: false })
      }
    })()
    inFlightSave = save
    try {
      await save
    } finally {
      if (inFlightSave === save) inFlightSave = null
    }
  },

  saveThumbnail: async (base64, target) => {
    const { activeNotebook, activePage } = get()
    const notebookId = target?.notebookId ?? activeNotebook?.id
    const pageId     = target?.pageId     ?? activePage?.id
    if (!notebookId || !pageId) return
    try {
      const result = await ipc<{ thumbnailPath: string; updatedAt: string } | null>(
        IPC.PAGE_SAVE_THUMBNAIL, { notebookId, pageId, base64 }
      )
      if (!result) return  // page was deleted meanwhile
      // Refresh locally so sidebar/navigator previews update (updatedAt
      // changes even when the path doesn't, which forces a reload)
      set((s) => ({
        pages: s.pages.map((p) => (p.id === pageId ? { ...p, ...result } : p)),
      }))
    } catch (e) {
      console.error('[InkNote] Failed to save thumbnail:', e)
    }
  },

  // ── PDF import ─────────────────────────────────────────────────────────────────

  importPDFFull: async (sourcePath, name) => {
    const result = await ipc<PDFImportResult>(IPC.PDF_IMPORT_FULL, { sourcePath, name })
    // Flush the outgoing page before replacing the active notebook
    await get().saveCurrentPage()
    clearSaveTimer()
    set((s) => ({ notebooks: [result.notebook, ...s.notebooks] }))
    set({ activeNotebook: result.notebook, pages: result.pages, activePage: null, strokes: [], images: [], isDirty: false, isLoading: false })
    if (result.pages.length > 0) {
      await get().selectPage(result.pages[0])
    }
    return result
  },

  // ── OCR ────────────────────────────────────────────────────────────────────────

  runOCR: async () => {
    const { activePage, strokes, activeNotebook, isOCRRunning } = get()
    if (!activePage || !activeNotebook || isOCRRunning) return

    set({ isOCRRunning: true, ocrProgress: 0, ocrStatus: 'Iniciando…', ocrText: null })
    try {
      const { recognizeText } = await import('../utils/ocr')
      const text = await recognizeText(
        strokes,
        activePage.width,
        activePage.height,
        ({ status, progress }) => set({ ocrStatus: status, ocrProgress: progress })
      )
      set({ ocrText: text, ocrProgress: 1, ocrStatus: 'Listo' })

      // Persist to DB for search indexing
      if (text) {
        await ipc(IPC.OCR_SAVE, { pageId: activePage.id, text })
      }
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ isOCRRunning: false })
    }
  },

  clearOcrText: () => set({ ocrText: null, ocrProgress: 0, ocrStatus: '' }),

  // ── Search ─────────────────────────────────────────────────────────────────────

  runSearch: async (query) => {
    set({ searchQuery: query })
    if (!query.trim()) {
      set({ searchResults: [] })
      return
    }
    try {
      const results = await ipc<SearchResult[]>(IPC.SEARCH_QUERY, { query })
      set({ searchResults: results })
    } catch {
      set({ searchResults: [] })
    }
  },

  clearSearch: () => set({ searchQuery: '', searchResults: [] }),

  // ── Helpers ────────────────────────────────────────────────────────────────────

  clearError: () => set({ error: null }),
}))

// ── Save on window close (flush any pending auto-save) ────────────────────────

// The main process keeps the window open until we confirm the flush is done.
window.electronAPI.on(IPC.APP_BEFORE_CLOSE, () => {
  void useNotebookStore.getState().saveCurrentPage()
    .finally(() => window.electronAPI.send(IPC.APP_CLOSE_READY))
})

// Reloads don't go through the close handshake, so this is best effort only.
window.addEventListener('beforeunload', () => {
  const { isDirty, saveCurrentPage } = useNotebookStore.getState()
  if (isDirty) void saveCurrentPage()
})
