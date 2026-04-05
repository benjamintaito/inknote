/**
 * Type declarations for the Electron API exposed via contextBridge in preload/index.ts.
 * Augments the global Window interface so TypeScript knows about window.electronAPI.
 */

import type {
  NotebookMeta,
  PageMeta,
  PageTemplate,
  StrokeFile,
  Stroke,
} from '@shared/types'

export interface ElectronAPI {
  platform: string
  send: (channel: string, data?: unknown) => void
  on: (channel: string, callback: (...args: unknown[]) => void) => () => void
  invoke: <T = unknown>(channel: string, data?: unknown) => Promise<T>
}

// Typed wrappers for each IPC channel
export interface InkNoteAPI {
  // Notebooks
  notebookList():                                             Promise<NotebookMeta[]>
  notebookGet(id: string):                                   Promise<NotebookMeta | null>
  notebookCreate(data: { name: string; subject?: string; color?: string }): Promise<NotebookMeta>
  notebookUpdate(data: { id: string; name?: string; subject?: string; color?: string }): Promise<void>
  notebookDelete(id: string):                                Promise<void>

  // Pages
  pageList(notebookId: string):                              Promise<PageMeta[]>
  pageCreate(data: { notebookId: string; template?: PageTemplate }): Promise<PageMeta>
  pageLoad(notebookId: string, pageId: string):              Promise<StrokeFile | null>
  pageSaveStrokes(data: {
    notebookId: string
    pageId: string
    strokes: Stroke[]
    metadata: StrokeFile['metadata']
  }): Promise<void>
  pageSaveThumbnail(data: {
    notebookId: string
    pageId: string
    base64: string
  }): Promise<void>
  pageDelete(notebookId: string, pageId: string):            Promise<void>
  pageReorder(notebookId: string, pageIds: string[]):        Promise<void>

  // Assets
  pdfImport(notebookId: string, sourcePath: string):         Promise<{ destPath: string }>
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
