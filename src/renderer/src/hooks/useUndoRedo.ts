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
    (id: string, after: Partial<PageImage>) => {
      const existing = images.current.find((i) => i.id === id)
      if (!existing) return
      const before: Partial<PageImage> = {}
      for (const k of Object.keys(after) as (keyof PageImage)[]) {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ;(before as any)[k] = existing[k]
      }
      images.current = images.current.map((i) => (i.id === id ? { ...i, ...after } : i))
      pushUndo({ type: 'image-update', id, before, after })
      onImagesChanged?.(images.current)
    },
    [onImagesChanged]
  )

  const resetImages = useCallback((newImages: PageImage[]) => {
    images.current = newImages
  }, [])

  // ── Undo ─────────────────────────────────────────────────────────────────────

  const undo = useCallback(() => {
    const action = undoStack.current.pop()
    if (!action) return
    switch (action.type) {
      case 'add':
        strokes.current = strokes.current.filter((s) => s.id !== action.stroke.id)
        redoStack.current.push({ type: 'remove', stroke: action.stroke })
        onStrokesChanged(strokes.current)
        break
      case 'remove':
        strokes.current = [...strokes.current, action.stroke]
        redoStack.current.push({ type: 'add', stroke: action.stroke })
        onStrokesChanged(strokes.current)
        break
      case 'bulk-replace': {
        const addedIds = new Set(action.added.map((s) => s.id))
        strokes.current = [...strokes.current.filter((s) => !addedIds.has(s.id)), ...action.removed]
        redoStack.current.push({ type: 'bulk-replace', removed: action.added, added: action.removed })
        onStrokesChanged(strokes.current)
        break
      }
      case 'image-add':
        images.current = images.current.filter((i) => i.id !== action.image.id)
        redoStack.current.push({ type: 'image-remove', image: action.image })
        onImagesChanged?.(images.current)
        break
      case 'image-remove':
        images.current = [...images.current, action.image]
        redoStack.current.push({ type: 'image-add', image: action.image })
        onImagesChanged?.(images.current)
        break
      case 'image-update':
        images.current = images.current.map((i) => i.id === action.id ? { ...i, ...action.before } : i)
        redoStack.current.push({ type: 'image-update', id: action.id, before: action.after, after: action.before })
        onImagesChanged?.(images.current)
        break
    }
  }, [onStrokesChanged, onImagesChanged])

  // ── Redo ─────────────────────────────────────────────────────────────────────

  const redo = useCallback(() => {
    const action = redoStack.current.pop()
    if (!action) return
    switch (action.type) {
      case 'add':
        strokes.current = [...strokes.current, action.stroke]
        undoStack.current.push({ type: 'remove', stroke: action.stroke })
        onStrokesChanged(strokes.current)
        break
      case 'remove':
        strokes.current = strokes.current.filter((s) => s.id !== action.stroke.id)
        undoStack.current.push({ type: 'add', stroke: action.stroke })
        onStrokesChanged(strokes.current)
        break
      case 'bulk-replace': {
        const removedIds = new Set(action.removed.map((s) => s.id))
        strokes.current = [...strokes.current.filter((s) => !removedIds.has(s.id)), ...action.added]
        undoStack.current.push({ type: 'bulk-replace', removed: action.added, added: action.removed })
        onStrokesChanged(strokes.current)
        break
      }
      case 'image-add':
        images.current = [...images.current, action.image]
        undoStack.current.push({ type: 'image-remove', image: action.image })
        onImagesChanged?.(images.current)
        break
      case 'image-remove':
        images.current = images.current.filter((i) => i.id !== action.image.id)
        undoStack.current.push({ type: 'image-add', image: action.image })
        onImagesChanged?.(images.current)
        break
      case 'image-update':
        images.current = images.current.map((i) => i.id === action.id ? { ...i, ...action.after } : i)
        undoStack.current.push({ type: 'image-update', id: action.id, before: action.before, after: action.after })
        onImagesChanged?.(images.current)
        break
    }
  }, [onStrokesChanged, onImagesChanged])

  // ── Clear ─────────────────────────────────────────────────────────────────────

  const clearAll = useCallback(() => {
    strokes.current = []
    undoStack.current = []
    redoStack.current = []
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
