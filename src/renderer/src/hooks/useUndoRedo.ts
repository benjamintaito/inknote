import { useRef, useCallback } from 'react'
import type { Stroke, PageImage } from '@shared/types'

// ── Action types ───────────────────────────────────────────────────────────────

type AddAction         = { type: 'add';          stroke: Stroke }
type RemoveAction      = { type: 'remove';       stroke: Stroke }
type BulkReplaceAction = { type: 'bulk-replace'; removed: Stroke[]; added: Stroke[] }
type ImageAddAction    = { type: 'image-add';    image: PageImage }
type ImageRemoveAction = { type: 'image-remove'; image: PageImage }
type ImageUpdateAction = { type: 'image-update'; id: string; before: Partial<PageImage>; after: Partial<PageImage> }

type UndoAction =
  | AddAction | RemoveAction | BulkReplaceAction
  | ImageAddAction | ImageRemoveAction | ImageUpdateAction

const MAX_HISTORY = 50

export interface ImageUpdateOptions {
  /** false = apply without recording an undo step (live drag preview). Default true. */
  record?: boolean
  /** Explicit "before" state, e.g. the image at drag start when committing a drag. */
  before?: Partial<PageImage>
}

// ── Hook ───────────────────────────────────────────────────────────────────────

export function useUndoRedo(
  onStrokesChanged: (strokes: Stroke[]) => void,
  onImagesChanged?: (images: PageImage[]) => void
) {
  const strokes   = useRef<Stroke[]>([])
  const images    = useRef<PageImage[]>([])
  const undoStack = useRef<UndoAction[]>([])
  const redoStack = useRef<UndoAction[]>([])

  const pushUndo = (action: UndoAction) => {
    undoStack.current.push(action)
    if (undoStack.current.length > MAX_HISTORY) undoStack.current.shift()
    redoStack.current = []
  }

  // ── Stroke API ───────────────────────────────────────────────────────────────

  const addStroke = useCallback(
    (stroke: Stroke) => {
      strokes.current = [...strokes.current, stroke]
      pushUndo({ type: 'add', stroke })
      onStrokesChanged(strokes.current)
    },
    [onStrokesChanged]
  )

  const recordBulkReplace = useCallback((removed: Stroke[], added: Stroke[]) => {
    if (removed.length === 0 && added.length === 0) return
    pushUndo({ type: 'bulk-replace', removed, added })
  }, [])

  const resetStrokes = useCallback((newStrokes: Stroke[]) => {
    strokes.current = newStrokes
    undoStack.current = []
    redoStack.current = []
  }, [])

  // ── Image API ────────────────────────────────────────────────────────────────

  const addImage = useCallback(
    (image: PageImage) => {
      images.current = [...images.current, image]
      pushUndo({ type: 'image-add', image })
      onImagesChanged?.(images.current)
    },
    [onImagesChanged]
  )

  const removeImage = useCallback(
    (id: string) => {
      const image = images.current.find((i) => i.id === id)
      if (!image) return
      images.current = images.current.filter((i) => i.id !== id)
      pushUndo({ type: 'image-remove', image })
      onImagesChanged?.(images.current)
    },
    [onImagesChanged]
  )

  const updateImage = useCallback(
    (id: string, after: Partial<PageImage>, opts: ImageUpdateOptions = {}) => {
      const existing = images.current.find((i) => i.id === id)
      if (!existing) return
      const before: Partial<PageImage> = { ...opts.before }
      for (const k of Object.keys(after) as (keyof PageImage)[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        if (!(k in before)) (before as any)[k] = existing[k]
      }
      images.current = images.current.map((i) => (i.id === id ? { ...i, ...after } : i))
      if (opts.record !== false) pushUndo({ type: 'image-update', id, before, after })
      onImagesChanged?.(images.current)
    },
    [onImagesChanged]
  )

  const resetImages = useCallback((newImages: PageImage[]) => {
    images.current = newImages
  }, [])

  // ── Undo ─────────────────────────────────────────────────────────────────────

  // Each stack holds actions as originally performed: undo reverts the
  // action and moves it to the redo stack, redo re-applies it and moves it back.
  const undo = useCallback(() => {
    const action = undoStack.current.pop()
    if (!action) return
    redoStack.current.push(action)
    switch (action.type) {
      case 'add':
        strokes.current = strokes.current.filter((s) => s.id !== action.stroke.id)
        onStrokesChanged(strokes.current)
        break
      case 'remove':
        strokes.current = [...strokes.current, action.stroke]
        onStrokesChanged(strokes.current)
        break
      case 'bulk-replace': {
        const addedIds = new Set(action.added.map((s) => s.id))
        strokes.current = [...strokes.current.filter((s) => !addedIds.has(s.id)), ...action.removed]
        onStrokesChanged(strokes.current)
        break
      }
      case 'image-add':
        images.current = images.current.filter((i) => i.id !== action.image.id)
        onImagesChanged?.(images.current)
        break
      case 'image-remove':
        images.current = [...images.current, action.image]
        onImagesChanged?.(images.current)
        break
      case 'image-update':
        images.current = images.current.map((i) => i.id === action.id ? { ...i, ...action.before } : i)
        onImagesChanged?.(images.current)
        break
    }
  }, [onStrokesChanged, onImagesChanged])

  // ── Redo ─────────────────────────────────────────────────────────────────────

  const redo = useCallback(() => {
    const action = redoStack.current.pop()
    if (!action) return
    undoStack.current.push(action)
    switch (action.type) {
      case 'add':
        strokes.current = [...strokes.current, action.stroke]
        onStrokesChanged(strokes.current)
        break
      case 'remove':
        strokes.current = strokes.current.filter((s) => s.id !== action.stroke.id)
        onStrokesChanged(strokes.current)
        break
      case 'bulk-replace': {
        const removedIds = new Set(action.removed.map((s) => s.id))
        strokes.current = [...strokes.current.filter((s) => !removedIds.has(s.id)), ...action.added]
        onStrokesChanged(strokes.current)
        break
      }
      case 'image-add':
        images.current = [...images.current, action.image]
        onImagesChanged?.(images.current)
        break
      case 'image-remove':
        images.current = images.current.filter((i) => i.id !== action.image.id)
        onImagesChanged?.(images.current)
        break
      case 'image-update':
        images.current = images.current.map((i) => i.id === action.id ? { ...i, ...action.after } : i)
        onImagesChanged?.(images.current)
        break
    }
  }, [onStrokesChanged, onImagesChanged])

  // ── Clear ─────────────────────────────────────────────────────────────────────

  const clearAll = useCallback(() => {
    // Recorded as a bulk replace so "clear page" can be undone
    const removed = strokes.current
    strokes.current = []
    if (removed.length > 0) pushUndo({ type: 'bulk-replace', removed, added: [] })
    onStrokesChanged([])
    // Images are intentionally NOT cleared by "clear page" (only ink strokes)
  }, [onStrokesChanged])

  return {
    strokesRef: strokes,
    imagesRef:  images,
    addStroke,
    addImage,
    removeImage,
    updateImage,
    resetStrokes,
    resetImages,
    recordBulkReplace,
    undo,
    redo,
    clearAll,
    canUndo: () => undoStack.current.length > 0,
    canRedo: () => redoStack.current.length > 0,
  }
}
