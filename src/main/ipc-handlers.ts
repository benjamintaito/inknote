/**
 * ipc-handlers.ts — Register all ipcMain.handle() handlers.
 * Call registerIpcHandlers() once from main/index.ts after app.whenReady().
 */

import { ipcMain, dialog } from 'electron'
import { v4 as uuidv4 } from 'uuid'
import { readFileSync, existsSync } from 'fs'
import { extname } from 'path'
import type { FolderMeta, NotebookMeta, PageMeta, PageTemplate, StrokeFile, Stroke, PageImage, PDFImportResult, SearchResult } from '../shared/types.js'
import { IPC } from '../shared/types.js'
import {
  createFolder, getFolders, updateFolder, deleteFolder,
  createNotebook, getNotebooks, getNotebookById,
  updateNotebook, deleteNotebook, moveNotebookToFolder, getNotebookCategories,
  createPage, getPages, deletePage, reorderPages, updatePagePaths,
  saveOCRText, searchPages,
} from './db.js'
import {
  saveStrokeData, loadStrokeData,
  saveThumbnail, importPDF, importImage, saveImageFromBuffer,
  deleteNotebookFiles, deletePageFiles, ensureNotebookDirs,
} from './file-manager.js'
import {
  showOpenPDFDialog, showSavePDFDialog, readFileBytes, writePDFBytes,
} from './pdf-export.js'

// ── Type helpers ───────────────────────────────────────────────────────────────

type Handler<TArg, TReturn> = (arg: TArg) => TReturn | Promise<TReturn>

function handle<TArg, TReturn>(channel: string, fn: Handler<TArg, TReturn>): void {
  ipcMain.handle(channel, (_event, arg: TArg) => fn(arg))
}

// ── Registration ───────────────────────────────────────────────────────────────

export function registerIpcHandlers(): void {

  // ── Folders ────────────────────────────────────────────────────────────────

  handle<void, FolderMeta[]>(
    IPC.FOLDER_LIST,
    () => getFolders()
  )

  handle<{ name: string; color?: string }, FolderMeta>(
    IPC.FOLDER_CREATE,
    ({ name, color }) => createFolder({ id: uuidv4(), name, color: color ?? '#6B7280' })
  )

  handle<{ id: string; name?: string; color?: string }, void>(
    IPC.FOLDER_UPDATE,
    ({ id, name, color }) => updateFolder(id, { name, color })
  )

  handle<{ id: string }, void>(
    IPC.FOLDER_DELETE,
    ({ id }) => deleteFolder(id)
  )

  // ── Notebooks ──────────────────────────────────────────────────────────────

  handle<{ name: string; subject?: string; color?: string; folderId?: string | null }, NotebookMeta>(
    IPC.NOTEBOOK_CREATE,
    ({ name, subject, color, folderId }) => {
      const nb = createNotebook({
        id:       uuidv4(),
        name,
        subject:  subject ?? null,
        color:    color ?? '#1a1a2e',
        folderId: folderId ?? null,
      })
      ensureNotebookDirs(nb.id)
      return nb
    }
  )

  handle<void, NotebookMeta[]>(
    IPC.NOTEBOOK_LIST,
    () => getNotebooks()
  )

  handle<{ id: string }, NotebookMeta | null>(
    IPC.NOTEBOOK_GET,
    ({ id }) => getNotebookById(id)
  )

  handle<{ id: string; name?: string; subject?: string; color?: string; folderId?: string | null }, void>(
    IPC.NOTEBOOK_UPDATE,
    ({ id, ...rest }) => updateNotebook(id, rest)
  )

  handle<{ id: string }, void>(
    IPC.NOTEBOOK_DELETE,
    ({ id }) => {
      deleteNotebook(id)          // cascade-deletes pages in DB
      deleteNotebookFiles(id)     // remove files from disk
    }
  )

  handle<{ notebookId: string; folderId: string | null }, void>(
    IPC.NOTEBOOK_MOVE_FOLDER,
    ({ notebookId, folderId }) => moveNotebookToFolder(notebookId, folderId)
  )

  handle<void, string[]>(
    IPC.NOTEBOOK_CATEGORIES,
    () => getNotebookCategories()
  )

  // ── Pages ──────────────────────────────────────────────────────────────────

  handle<{ notebookId: string; template?: PageTemplate; width?: number; height?: number }, PageMeta>(
    IPC.PAGE_CREATE,
    ({ notebookId, template = 'blank', width = 2480, height = 3508 }) =>
      createPage({ id: uuidv4(), notebookId, template, width, height })
  )

  handle<{ notebookId: string }, PageMeta[]>(
    IPC.PAGE_LIST,
    ({ notebookId }) => getPages(notebookId)
  )

  handle<{ notebookId: string; pageId: string }, StrokeFile | null>(
    IPC.PAGE_LOAD,
    ({ notebookId, pageId }) => loadStrokeData(notebookId, pageId)
  )

  handle<{
    notebookId: string
    pageId: string
    strokes: Stroke[]
    images?: PageImage[]
    metadata: StrokeFile['metadata']
  }, void>(
    IPC.PAGE_SAVE_STROKES,
    ({ notebookId, pageId, strokes, images, metadata }) => {
      const file: StrokeFile = { version: 2, pageId, strokes, images: images ?? [], metadata }
      const path = saveStrokeData(notebookId, pageId, file)
      updatePagePaths(pageId, { strokeDataPath: path })
    }
  )

  handle<{ notebookId: string; pageId: string; base64: string }, { thumbnailPath: string }>(
    IPC.PAGE_SAVE_THUMBNAIL,
    ({ notebookId, pageId, base64 }) => {
      const path = saveThumbnail(notebookId, pageId, base64)
      updatePagePaths(pageId, { thumbnailPath: path })
      return { thumbnailPath: path }
    }
  )

  handle<{ notebookId: string; pageId: string }, void>(
    IPC.PAGE_DELETE,
    ({ notebookId, pageId }) => {
      deletePage(pageId)
      deletePageFiles(notebookId, pageId)
    }
  )

  handle<{ notebookId: string; pageIds: string[] }, void>(
    IPC.PAGE_REORDER,
    ({ notebookId, pageIds }) => reorderPages(notebookId, pageIds)
  )

  // ── Images ─────────────────────────────────────────────────────────────────

  handle<{ notebookId: string }, { filePath: string } | null>(
    IPC.IMAGE_IMPORT,
    async ({ notebookId }) => {
      const result = await dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Imágenes', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'] }],
      })
      if (result.canceled || !result.filePaths[0]) return null
      const filePath = importImage(notebookId, result.filePaths[0])
      return { filePath }
    }
  )

  handle<{ notebookId: string; bytes: number[]; ext: string }, { filePath: string }>(
    IPC.IMAGE_PASTE,
    ({ notebookId, bytes, ext }) => ({
      filePath: saveImageFromBuffer(notebookId, Buffer.from(bytes), ext),
    })
  )

  handle<{ filePath: string }, string | null>(
    IPC.IMAGE_READ,
    ({ filePath }) => {
      if (!existsSync(filePath)) return null
      try {
        const buf = readFileSync(filePath)
        const ext = extname(filePath).slice(1).toLowerCase()
        const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg'
                   : ext === 'gif'  ? 'image/gif'
                   : ext === 'webp' ? 'image/webp'
                   : ext === 'bmp'  ? 'image/bmp'
                   : 'image/png'
        return `data:${mime};base64,${buf.toString('base64')}`
      } catch (e) {
        console.error('[InkNote] image:read failed:', filePath, e)
        return null
      }
    }
  )

  // ── Assets ─────────────────────────────────────────────────────────────────

  handle<{ notebookId: string; sourcePath: string }, { destPath: string }>(
    IPC.PDF_IMPORT,
    ({ notebookId, sourcePath }) => ({
      destPath: importPDF(notebookId, sourcePath),
    })
  )

  // ── PDF workflow ────────────────────────────────────────────────────────────

  handle<void, string | null>(IPC.PDF_OPEN_DIALOG, () => showOpenPDFDialog())

  handle<{ sourcePath: string; name: string }, PDFImportResult>(
    IPC.PDF_IMPORT_FULL,
    async ({ sourcePath, name }) => {
      const { PDFDocument } = await import('pdf-lib')

      // Read source PDF bytes and open with pdf-lib to get page sizes
      const srcBytes = readFileBytes(sourcePath)
      const srcDoc = await PDFDocument.load(srcBytes)
      const pdfPageCount = srcDoc.getPageCount()

      // Create notebook
      const nb = createNotebook({
        id:      uuidv4(),
        name,
        subject: null,
        color:   '#3b82f6',
      })
      ensureNotebookDirs(nb.id)

      // Copy PDF into notebook assets
      const pdfPath = importPDF(nb.id, sourcePath)

      // Create one page per PDF page
      const pages: PageMeta[] = []
      for (let i = 0; i < pdfPageCount; i++) {
        const pdfPage = srcDoc.getPages()[i]
        const { width, height } = pdfPage.getSize()
        const page = createPage({
          id:         uuidv4(),
          notebookId: nb.id,
          template:   'pdf',
          width:      Math.round(width),
          height:     Math.round(height),
        })
        updatePagePaths(page.id, { pdfPath })
        pages.push({ ...page, pdfPath })
      }

      return { notebook: nb, pages, pdfPath }
    }
  )

  handle<{ filePath: string }, Buffer>(
    IPC.PDF_READ_BYTES,
    ({ filePath }) => readFileBytes(filePath)
  )

  handle<{ defaultName: string }, string | null>(
    IPC.PDF_EXPORT_DIALOG,
    ({ defaultName }) => showSavePDFDialog(defaultName)
  )

  handle<{ filePath: string; bytes: number[] }, void>(
    IPC.PDF_EXPORT_SAVE,
    ({ filePath, bytes }) => writePDFBytes(filePath, new Uint8Array(bytes))
  )

  // ── OCR + Search ────────────────────────────────────────────────────────────

  handle<{ pageId: string; text: string }, void>(
    IPC.OCR_SAVE,
    ({ pageId, text }) => saveOCRText(pageId, text)
  )

  handle<{ query: string }, SearchResult[]>(
    IPC.SEARCH_QUERY,
    ({ query }) => searchPages(query)
  )
}
