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
  saveThumbnail:   (base64: string) => Promise<void>

  // ── PDF import ────────────────────────────────────────────────────────────────
  importPDFFull: (sourcePath: string, name: string) => Promise<PDFImportResult>

  // ── OCR ───────────────────────────────────────────────────────────────────────
  runOCR:    () => Promise<void>
  dismissOCR: () => void

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

    set({ activeNotebook: nb, isLoading: true, activePage: null, strokes: [], images: [] })
    try {
      const pages = await ipc<PageMeta[]>(IPC.PAGE_LIST, { notebookId: id })
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
    // Save current page before switching if dirty
    if (get().isDirty) await get().saveCurrentPage()

    set({ activePage: page, isLoading: true, strokes: [], images: [], isDirty: false })
    clearSaveTimer()

    const { activeNotebook } = get()
    if (!activeNotebook) { set({ isLoading: false }); return }

    try {
      const file = await ipc<StrokeFile | null>(IPC.PAGE_LOAD, {
        notebookId: activeNotebook.id,
        pageId: page.id,
      })
      set({ strokes: file?.strokes ?? [], images: file?.images ?? [], isLoading: false })
    } catch (e) {
      set({ error: String(e), isLoading: false })
    }
  },

  deletePage: async (pageId) => {
    const { activeNotebook, activePage } = get()
    if (!activeNotebook) return
    await ipc(IPC.PAGE_DELETE, { notebookId: activeNotebook.id, pageId })
    set((s) => {
      const pages = s.pages.filter((p) => p.id !== pageId)
      return {
        pages,
        activePage: activePage?.id === pageId ? (pages[0] ?? null) : activePage,
        strokes:    activePage?.id === pageId ? [] : s.strokes,
        images:     activePage?.id === pageId ? [] : s.images,
        isDirty:    activePage?.id === pageId ? false : s.isDirty,
      }
    })
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
    set({ strokes, isDirty: true })
    clearSaveTimer()
    saveTimer = setTimeout(() => void get().saveCurrentPage(), 3000)
  },

  setImages: (images) => {
    set({ images, isDirty: true })
    clearSaveTimer()
    saveTimer = setTimeout(() => void get().saveCurrentPage(), 3000)
  },

  saveCurrentPage: async () => {
    clearSaveTimer()
    const { activeNotebook, activePage, strokes, images, isSaving } = get()
    if (!activeNotebook || !activePage || isSaving) return

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
      set({ isDirty: false })
    } catch (e) {
      set({ error: String(e) })
    } finally {
      set({ isSaving: false })
    }
  },

  saveThumbnail: async (base64) => {
    const { activeNotebook, activePage } = get()
    if (!activeNotebook || !activePage) return
    await ipc(IPC.PAGE_SAVE_THUMBNAIL, {
      notebookId: activeNotebook.id,
      pageId:     activePage.id,
      base64,
    })
  },

  // ── PDF import ─────────────────────────────────────────────────────────────────

  importPDFFull: async (sourcePath, name) => {
    const result = await ipc<PDFImportResult>(IPC.PDF_IMPORT_FULL, { sourcePath, name })
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

  dismissOCR: () => set({ ocrText: null, ocrProgress: 0, ocrStatus: '' }),

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

window.addEventListener('beforeunload', () => {
  clearSaveTimer()
  const { isDirty, saveCurrentPage } = useNotebookStore.getState()
  if (isDirty) void saveCurrentPage()
})
