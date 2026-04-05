import { useRef, useCallback, useEffect, RefObject } from 'react'
import { v4 as uuidv4 } from 'uuid'
import type { Point, Stroke, PageImage, ToolType, PressureCurve, Viewport, PageTemplate } from '@shared/types'
import { PenInputHandler } from '../components/Canvas/PenInputHandler'
import type { RawPoint } from '../components/Canvas/PenInputHandler'
import { PalmRejection } from '../components/Canvas/PalmRejection'
import { smoothPoints } from '../components/Canvas/StrokeSmoothing'
import { renderStroke } from '../components/Canvas/StrokeRenderer'
import { renderTemplate } from '../components/Notebook/PageTemplates'
import { useUndoRedo } from './useUndoRedo'
import { useNotebookStore } from '../stores/notebookStore'
import { useToolStore } from '../stores/toolStore'
import { predictNextPoints } from '../components/Canvas/PredictiveInk'

// ── Eraser helpers ─────────────────────────────────────────────────────────────

/** True if the eraser circle (cx,cy,radius) overlaps any point in the stroke. */
function hitTestStroke(stroke: Stroke, cx: number, cy: number, radius: number): boolean {
  const r2 = (radius + stroke.baseWidth / 2) ** 2
  for (const p of stroke.points) {
    if ((p.x - cx) ** 2 + (p.y - cy) ** 2 <= r2) return true
  }
  return false
}

/**
 * Split a stroke into fragments by removing points inside the eraser circle.
 * Returns [] if the entire stroke is erased, or the unchanged stroke in a
 * single-element array if no points are hit.
 */
function splitStrokeAtPoint(stroke: Stroke, cx: number, cy: number, radius: number): Stroke[] {
  const r2 = radius ** 2
  const fragments: Stroke[] = []
  let segment: Point[] = []

  for (const p of stroke.points) {
    if ((p.x - cx) ** 2 + (p.y - cy) ** 2 <= r2) {
      if (segment.length >= 2) {
        fragments.push({ ...stroke, id: uuidv4(), points: segment })
      }
      segment = []
    } else {
      segment.push(p)
    }
  }
  if (segment.length >= 2) {
    fragments.push({ ...stroke, id: uuidv4(), points: segment })
  }
  return fragments
}

// ── Tool settings ──────────────────────────────────────────────────────────────

export interface InkToolSettings {
  tool: ToolType
  color: string
  baseWidth: number
  pressureCurve: PressureCurve
  opacity: number
}

const DEFAULT_TOOL: InkToolSettings = {
  tool: 'pen',
  color: '#1a1a2e',
  baseWidth: 3,
  pressureCurve: 'smooth',
  opacity: 1,
}

// ── Straight-line helpers ──────────────────────────────────────────────────────

function interpolateLine(
  x1: number, y1: number, p1: number, t1: number,
  x2: number, y2: number, p2: number, t2: number,
  n: number
): Point[] {
  const pts: Point[] = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    pts.push({
      x:         x1 + (x2 - x1) * t,
      y:         y1 + (y2 - y1) * t,
      pressure:  p1 + (p2 - p1) * t,
      tiltX:     0,
      tiltY:     0,
      timestamp: t1 + (t2 - t1) * t,
    })
  }
  return pts
}

function snapAngle(x1: number, y1: number, x2: number, y2: number): [number, number] {
  const dx = x2 - x1
  const dy = y2 - y1
  const dist = Math.sqrt(dx * dx + dy * dy)
  if (dist === 0) return [x2, y2]
  const snapped = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4)
  return [x1 + dist * Math.cos(snapped), y1 + dist * Math.sin(snapped)]
}

// ── Image rendering helper ─────────────────────────────────────────────────────

function drawImagesOnCtx(
  ctx: CanvasRenderingContext2D,
  images: PageImage[],
  cache: Map<string, HTMLImageElement>,
  template: string
): void {
  console.log('[IMG-RENDERER] drawImagesOnCtx llamado, images.length:', images.length, '| cache.size:', cache.size)
  if (images.length === 0) return
  const sorted = [...images].sort((a, b) => a.zIndex - b.zIndex)
  for (const img of sorted) {
    const el = cache.get(img.id)
    const inCache   = el !== undefined
    const isComplete = el?.complete ?? false
    const natW       = el?.naturalWidth ?? -1
    console.log('[IMG-RENDERER] drawImagesOnCtx img', img.id.slice(0, 8), '| inCache:', inCache, '| complete:', isComplete, '| naturalWidth:', natW)
    if (!el || !el.complete || el.naturalWidth === 0) {
      console.warn('[IMG-RENDERER] SKIP imagen', img.id.slice(0, 8), '— inCache:', inCache, 'complete:', isComplete, 'natW:', natW)
      continue
    }
    ctx.save()
    ctx.globalAlpha = img.opacity
    if (template === 'pdf') {
      // On PDF pages keep images fully opaque for readability
      ctx.globalCompositeOperation = 'source-over'
    }
    ctx.translate(img.x + img.width / 2, img.y + img.height / 2)
    ctx.rotate((img.rotation * Math.PI) / 180)
    ctx.drawImage(el, -img.width / 2, -img.height / 2, img.width, img.height)
    ctx.restore()
    console.log('[IMG-RENDERER] drawImagesOnCtx DIBUJADA imagen', img.id.slice(0, 8), 'en pos', img.x.toFixed(0), img.y.toFixed(0), 'size', img.width, 'x', img.height)
  }
}

// ── Bitmap cache constants ─────────────────────────────────────────────────────

const BITMAP_FREEZE_THRESHOLD = 1000
const BITMAP_FREEZE_TAIL = 50

// ── Cursor indicator helper ────────────────────────────────────────────────────

function drawCursorIndicator(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  tool: InkToolSettings
): void {
  const radius = Math.max(2, tool.baseWidth / 2)
  ctx.save()
  ctx.beginPath()
  ctx.arc(x, y, radius, 0, Math.PI * 2)

  if (tool.tool === 'pen') {
    ctx.globalAlpha = 0.65
    ctx.fillStyle = tool.color
    ctx.fill()
  } else if (tool.tool === 'highlighter') {
    ctx.globalAlpha = 0.35
    ctx.fillStyle = tool.color
    ctx.fill()
  } else {
    // eraser
    ctx.globalAlpha = 1
    ctx.strokeStyle = '#9ca3af'
    ctx.lineWidth = 1.5
    ctx.stroke()
  }
  ctx.restore()
}

// ── Hook ──────────────────────────────────────────────────────────────────────

export function useInkCanvas(
  containerRef: RefObject<HTMLElement>,
  backgroundRef: RefObject<HTMLCanvasElement>,
  overlayRef: RefObject<HTMLCanvasElement>,
  viewportRef: RefObject<Viewport>,
  toolRef: RefObject<InkToolSettings>
) {
  const currentStroke = useRef<Stroke | null>(null)
  const rafId = useRef<number | null>(null)
  const handlerRef = useRef<PenInputHandler | null>(null)
  const palmRef = useRef(new PalmRejection({ penCooldownMs: 500, maxTouchSize: 20 }))
  const currentTemplateRef = useRef<PageTemplate>('blank')

  // Bitmap cache
  const frozenCanvasRef = useRef<HTMLCanvasElement | null>(null)
  const frozenCountRef = useRef<number>(0)

  // Predictive ink
  const predictedPointsRef = useRef<Point[]>([])

  // Cursor indicator position (in canvas coords)
  const cursorPosRef = useRef<{ x: number; y: number } | null>(null)

  // Eraser gesture session
  const eraserSessionRef = useRef<{ strokesAtStart: Stroke[] } | null>(null)

  // Straight-line mode
  const lineStartRef = useRef<{ cx: number; cy: number; pressure: number; timestamp: number } | null>(null)
  const shiftHeldRef = useRef<boolean>(false)

  // Image layer: bridge refs break the circular dependency between
  // redrawBackground (defined first) and imagesRef/strokesRef (from useUndoRedo, defined later)
  const imagesBridgeRef  = useRef<PageImage[]>([])
  const strokesBridgeRef = useRef<Stroke[]>([])
  // Cache of loaded HTMLImageElement objects keyed by PageImage.id
  const imageCacheRef = useRef<Map<string, HTMLImageElement>>(new Map())

  // ── Canvas utilities ─────────────────────────────────────────────────────────

  const getBackgroundCtx = () => backgroundRef.current?.getContext('2d') ?? null
  const getOverlayCtx    = () => overlayRef.current?.getContext('2d') ?? null

  const clearOverlay = useCallback(() => {
    const ctx = getOverlayCtx()
    if (ctx) ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
  }, [])

  // ── Coordinate transform ──────────────────────────────────────────────────────

  const toCanvasCoords = useCallback(
    (rawX: number, rawY: number): [number, number] => {
      const vp = viewportRef.current
      if (!vp) return [rawX, rawY]
      return [(rawX - vp.offsetX) / vp.scale, (rawY - vp.offsetY) / vp.scale]
    },
    [viewportRef]
  )

  // ── Bitmap freeze ─────────────────────────────────────────────────────────────

  const tryFreezeBitmap = useCallback((strokes: Stroke[]) => {
    if (strokes.length <= BITMAP_FREEZE_TAIL) return
    const freezeUpTo = strokes.length - BITMAP_FREEZE_TAIL
    const bg = backgroundRef.current
    if (!bg) return
    const frozenCanvas = document.createElement('canvas')
    frozenCanvas.width = bg.width
    frozenCanvas.height = bg.height
    const frozenCtx = frozenCanvas.getContext('2d')
    if (!frozenCtx) return
    // Frozen bitmap includes template + images (images are static during a stroke session)
    const template = currentTemplateRef.current
    renderTemplate(frozenCtx, template, bg.width, bg.height)
    drawImagesOnCtx(frozenCtx, imagesBridgeRef.current, imageCacheRef.current, template)
    const pdfMode = template === 'pdf'
    for (const s of strokes.slice(0, freezeUpTo)) renderStroke(frozenCtx, s, 0, pdfMode)
    frozenCanvasRef.current = frozenCanvas
    frozenCountRef.current = freezeUpTo
  }, [backgroundRef])

  // ── Background redraw (triggered by undo/redo, with cache support) ────────────

  const redrawBackground = useCallback((strokes: Stroke[]) => {
    strokesBridgeRef.current = strokes
    const ctx = getBackgroundCtx()
    if (!ctx) return

    const template = currentTemplateRef.current
    const pdfMode  = template === 'pdf'

    console.log('[PDF-BG] Limpiando canvas de fondo, template:', template, '| strokes:', strokes.length, '| images:', imagesBridgeRef.current.length)

    // Invalidate cache if undo went below frozen count
    if (frozenCanvasRef.current && strokes.length < frozenCountRef.current) {
      frozenCanvasRef.current = null
      frozenCountRef.current = 0
    }

    if (frozenCanvasRef.current) {
      ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)
      ctx.drawImage(frozenCanvasRef.current, 0, 0)
      for (const s of strokes.slice(frozenCountRef.current)) renderStroke(ctx, s, 0, pdfMode)
    } else {
      renderTemplate(ctx, template, ctx.canvas.width, ctx.canvas.height)
      drawImagesOnCtx(ctx, imagesBridgeRef.current, imageCacheRef.current, template)
      for (const s of strokes) renderStroke(ctx, s, 0, pdfMode)
    }
    console.log('[PDF-BG] Re-renderizado completo, pdfMode:', pdfMode)
    useNotebookStore.getState().setStrokes(strokes)
  }, [])

  // ── onImagesChanged — called by useUndoRedo when images change via undo/redo ──

  const onImagesChanged = useCallback((imgs: PageImage[]) => {
    imagesBridgeRef.current = imgs
    useNotebookStore.getState().setImages(imgs)
    // Invalidate frozen bitmap (images are now different)
    frozenCanvasRef.current = null
    frozenCountRef.current  = 0
    redrawBackground(strokesBridgeRef.current)
  }, [redrawBackground])

  const {
    strokesRef, imagesRef,
    addStroke, addImage, removeImage, updateImage,
    undo, redo, clearAll, resetStrokes, resetImages, recordBulkReplace,
  } = useUndoRedo(redrawBackground, onImagesChanged)

  // ── Load page data (called on page switch from InkCanvas) ─────────────────────

  const loadPageData = useCallback(
    (strokes: Stroke[], images: PageImage[], template: PageTemplate) => {
      frozenCanvasRef.current = null
      frozenCountRef.current  = 0
      currentTemplateRef.current = template

      resetStrokes(strokes)
      resetImages(images)
      strokesBridgeRef.current = strokes
      imagesBridgeRef.current  = images
      imageCacheRef.current.clear()

      // Initial render (images load async below)
      const ctx = getBackgroundCtx()
      if (ctx) {
        renderTemplate(ctx, template, ctx.canvas.width, ctx.canvas.height)
        const pdfMode = template === 'pdf'
        for (const s of strokes) renderStroke(ctx, s, 0, pdfMode)
      }
      clearOverlay()

      // Load images asynchronously and redraw when ready
      for (const img of images) {
        void loadImageElement(img)
      }
    },
    [resetStrokes, resetImages, clearOverlay]
  )

  // ── Image element loader ──────────────────────────────────────────────────────

  const loadImageElement = useCallback(async (img: PageImage): Promise<void> => {
    if (imageCacheRef.current.has(img.id)) return
    try {
      const dataUrl = await window.electronAPI.invoke<string | null>('image:read', { filePath: img.src })
      if (!dataUrl) return
      const el = new Image()
      el.onload = () => {
        imageCacheRef.current.set(img.id, el)
        redrawBackground(strokesBridgeRef.current)
      }
      el.src = dataUrl
    } catch {
      // Image file missing or unreadable — skip silently
    }
  }, [redrawBackground])

  // ── Image page operations (called from InkCanvas) ─────────────────────────────

  /** Insert an image already saved to disk. Loads it, caches it, adds to undo. */
  const addImageToPage = useCallback(
    async (filePath: string, viewCenterX?: number, viewCenterY?: number): Promise<void> => {
      console.log('[IMG-RENDERER] 1. addImageToPage llamado, filePath:', filePath)

      // Load data URL via IPC so the renderer can display it without file:// issues
      const dataUrl = await window.electronAPI.invoke<string | null>('image:read', { filePath })
      console.log('[IMG-RENDERER] 2. Respuesta image:read:', dataUrl ? `OK (${dataUrl.length} chars)` : 'null — archivo no encontrado o error IPC')
      if (!dataUrl) {
        console.error('[IMG-RENDERER] FALLO: image:read retornó null para', filePath)
        return
      }

      await new Promise<void>((resolve) => {
        const el = new Image()
        el.onload = () => {
          console.log('[IMG-RENDERER] 3. HTMLImageElement.onload disparado:', el.naturalWidth, 'x', el.naturalHeight, '| complete:', el.complete)
          const ow = el.naturalWidth
          const oh = el.naturalHeight
          // Default size: at most 800px wide (canvas px), preserving aspect ratio
          const maxW = 800
          const w = Math.min(ow, maxW)
          const h = Math.round(oh * (w / ow))
          // Center on the visible area if coordinates provided, else center of canvas
          const cx = viewCenterX ?? 1240
          const cy = viewCenterY ?? 1754
          const img: PageImage = {
            id:             uuidv4(),
            src:            filePath,
            x:              cx - w / 2,
            y:              cy - h / 2,
            width:          w,
            height:         h,
            originalWidth:  ow,
            originalHeight: oh,
            rotation:       0,
            opacity:        1,
            locked:         false,
            zIndex:         imagesRef.current.length,
          }
          console.log('[IMG-RENDERER] 3.5. PageImage creado id:', img.id, '| pos:', img.x.toFixed(0), img.y.toFixed(0), '| size:', img.width, 'x', img.height)
          imageCacheRef.current.set(img.id, el)
          console.log('[IMG-RENDERER] 3.6. Cache actualizada, cache.size:', imageCacheRef.current.size)
          imagesBridgeRef.current = [...imagesBridgeRef.current, img]
          console.log('[IMG-RENDERER] 3.7. imagesBridgeRef actualizado, length:', imagesBridgeRef.current.length)
          addImage(img)   // updates imagesRef + pushes undo + calls onImagesChanged
          console.log('[IMG-RENDERER] 4. addImage() llamado, imagesRef.length:', imagesRef.current.length)
          resolve()
        }
        el.onerror = (e) => {
          console.error('[IMG-RENDERER] ERROR en HTMLImageElement.onerror:', e)
          resolve()
        }
        console.log('[IMG-RENDERER] 2.5. Asignando dataUrl a Image.src (longitud:', dataUrl.length, ')...')
        el.src = dataUrl
        console.log('[IMG-RENDERER] 2.6. Image.src asignado, complete inmediatamente:', el.complete)
      })
      console.log('[IMG-RENDERER] 5. Promise resuelta — fin de addImageToPage')
    },
    [addImage, imagesRef]
  )

  /** Update image properties (position, size, rotation, etc.) with undo support. */
  const updateImageInPage = useCallback(
    (id: string, after: Partial<PageImage>) => {
      imagesBridgeRef.current = imagesBridgeRef.current.map((i) =>
        i.id === id ? { ...i, ...after } : i
      )
      updateImage(id, after)   // updates imagesRef + pushes undo + calls onImagesChanged
    },
    [updateImage]
  )

  /** Remove an image by id with undo support. */
  const removeImageFromPage = useCallback(
    (id: string) => {
      imageCacheRef.current.delete(id)
      imagesBridgeRef.current = imagesBridgeRef.current.filter((i) => i.id !== id)
      removeImage(id)   // updates imagesRef + pushes undo + calls onImagesChanged
    },
    [removeImage]
  )

  // ── RAF render loop (overlay only) ───────────────────────────────────────────

  const renderOverlay = useCallback(() => {
    rafId.current = null
    const ctx = getOverlayCtx()
    if (!ctx) return
    const stroke = currentStroke.current
    ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height)

    if (stroke && stroke.points.length >= 1) {
      // Draw the real stroke
      renderStroke(ctx, { ...stroke, points: smoothPoints(stroke.points) })

      // Draw predictive points with reduced alpha
      const predicted = predictedPointsRef.current
      if (predicted.length > 0) {
        ctx.save()
        ctx.globalAlpha = 0.35
        renderStroke(ctx, { ...stroke, points: predicted })
        ctx.restore()
      }
    } else {
      // Draw cursor indicator when not actively drawing
      const cursorPos = cursorPosRef.current
      if (cursorPos) {
        const tool = toolRef.current ?? DEFAULT_TOOL
        drawCursorIndicator(ctx, cursorPos.x, cursorPos.y, tool)
      }
    }
  }, [toolRef])

  const scheduleRender = useCallback(() => {
    if (rafId.current !== null) return
    rafId.current = requestAnimationFrame(renderOverlay)
  }, [renderOverlay])

  // ── Eraser logic ──────────────────────────────────────────────────────────────

  const applyErase = useCallback(
    (cx: number, cy: number, radius: number) => {
      const { eraserMode } = useToolStore.getState()

      if (eraserMode === 'stroke') {
        // Remove every stroke the eraser circle touches
        const hits = strokesRef.current.filter((s) => hitTestStroke(s, cx, cy, radius))
        if (hits.length > 0) {
          const hitIds = new Set(hits.map((s) => s.id))
          strokesRef.current = strokesRef.current.filter((s) => !hitIds.has(s.id))
          redrawBackground(strokesRef.current)
        }
      } else {
        // Pixel eraser: split strokes at the erased circle
        let changed = false
        const next: Stroke[] = []
        for (const s of strokesRef.current) {
          if (hitTestStroke(s, cx, cy, radius)) {
            next.push(...splitStrokeAtPoint(s, cx, cy, radius))
            changed = true
          } else {
            next.push(s)
          }
        }
        if (changed) {
          strokesRef.current = next
          redrawBackground(strokesRef.current)
        }
      }
    },
    [strokesRef, redrawBackground]
  )

  const handleEraserStart = useCallback(
    (raw: RawPoint) => {
      eraserSessionRef.current = { strokesAtStart: [...strokesRef.current] }
      const [cx, cy] = toCanvasCoords(raw.x, raw.y)
      const tool = toolRef.current ?? DEFAULT_TOOL
      applyErase(cx, cy, tool.baseWidth / 2)
      cursorPosRef.current = { x: cx, y: cy }
      scheduleRender()
    },
    [toCanvasCoords, toolRef, applyErase, strokesRef, scheduleRender]
  )

  const handleEraserMove = useCallback(
    (raw: RawPoint) => {
      if (!eraserSessionRef.current) return
      const [cx, cy] = toCanvasCoords(raw.x, raw.y)
      const tool = toolRef.current ?? DEFAULT_TOOL
      applyErase(cx, cy, tool.baseWidth / 2)
      cursorPosRef.current = { x: cx, y: cy }
      scheduleRender()
    },
    [toCanvasCoords, toolRef, applyErase, scheduleRender]
  )

  const handleEraserEnd = useCallback(
    (_raw: RawPoint) => {
      const session = eraserSessionRef.current
      eraserSessionRef.current = null
      if (!session) return

      const startIds = new Set(session.strokesAtStart.map((s) => s.id))
      const endIds   = new Set(strokesRef.current.map((s) => s.id))
      const removed  = session.strokesAtStart.filter((s) => !endIds.has(s.id))
      const added    = strokesRef.current.filter((s) => !startIds.has(s.id))

      if (removed.length > 0 || added.length > 0) {
        recordBulkReplace(removed, added)
        // Sync store so auto-save picks up the change
        useNotebookStore.getState().setStrokes(strokesRef.current)
      }
      scheduleRender()
    },
    [strokesRef, recordBulkReplace, scheduleRender]
  )

  // ── Stroke lifecycle ─────────────────────────────────────────────────────────

  const handleStrokeStart = useCallback(
    (raw: RawPoint) => {
      const tool = toolRef.current ?? DEFAULT_TOOL
      if (tool.tool === 'eraser') { handleEraserStart(raw); return }
      // Select and pan tools must not create strokes
      if (tool.tool === 'select' || tool.tool === 'pan') return

      const [cx, cy] = toCanvasCoords(raw.x, raw.y)

      // Straight-line mode: capture start, show single-point preview
      if (useToolStore.getState().straightLine) {
        lineStartRef.current = { cx, cy, pressure: raw.pressure, timestamp: raw.timestamp }
        predictedPointsRef.current = []
        currentStroke.current = {
          id: uuidv4(),
          points: [{ x: cx, y: cy, pressure: raw.pressure, tiltX: raw.tiltX ?? 0, tiltY: raw.tiltY ?? 0, timestamp: raw.timestamp }],
          tool: tool.tool, color: tool.color, baseWidth: tool.baseWidth,
          pressureCurve: tool.pressureCurve, opacity: tool.opacity,
          timestamp: raw.timestamp,
        }
        scheduleRender()
        return
      }

      predictedPointsRef.current = []
      currentStroke.current = {
        id: uuidv4(),
        points: [{ x: cx, y: cy, pressure: raw.pressure, tiltX: raw.tiltX, tiltY: raw.tiltY, timestamp: raw.timestamp }],
        tool: tool.tool, color: tool.color, baseWidth: tool.baseWidth,
        pressureCurve: tool.pressureCurve, opacity: tool.opacity,
        timestamp: raw.timestamp,
      }
      scheduleRender()
    },
    [toCanvasCoords, toolRef, scheduleRender, handleEraserStart]
  )

  const handleStrokeMove = useCallback(
    (raw: RawPoint) => {
      if (eraserSessionRef.current) { handleEraserMove(raw); return }

      // Straight-line mode: replace preview with interpolated line
      if (lineStartRef.current && currentStroke.current) {
        const ls = lineStartRef.current
        const [rawCx, rawCy] = toCanvasCoords(raw.x, raw.y)
        const [endX, endY] = shiftHeldRef.current
          ? snapAngle(ls.cx, ls.cy, rawCx, rawCy)
          : [rawCx, rawCy]
        const previewPts = interpolateLine(ls.cx, ls.cy, ls.pressure, ls.timestamp,
          endX, endY, raw.pressure, raw.timestamp, 20)
        currentStroke.current = { ...currentStroke.current, points: previewPts }
        predictedPointsRef.current = []
        scheduleRender()
        return
      }

      const stroke = currentStroke.current
      if (!stroke) return
      const [cx, cy] = toCanvasCoords(raw.x, raw.y)
      stroke.points.push({ x: cx, y: cy, pressure: raw.pressure, tiltX: raw.tiltX, tiltY: raw.tiltY, timestamp: raw.timestamp })
      predictedPointsRef.current = predictNextPoints(stroke.points)
      scheduleRender()
    },
    [toCanvasCoords, scheduleRender, handleEraserMove]
  )

  const handleStrokeEnd = useCallback(
    (raw: RawPoint) => {
      if (eraserSessionRef.current) { handleEraserEnd(raw); return }

      // Straight-line mode: commit final interpolated stroke
      if (lineStartRef.current && currentStroke.current) {
        const ls = lineStartRef.current
        const [rawCx, rawCy] = toCanvasCoords(raw.x, raw.y)
        const [endX, endY] = shiftHeldRef.current
          ? snapAngle(ls.cx, ls.cy, rawCx, rawCy)
          : [rawCx, rawCy]
        const finalPts = interpolateLine(ls.cx, ls.cy, ls.pressure, ls.timestamp,
          endX, endY, raw.pressure, raw.timestamp, 30)
        if (rafId.current !== null) { cancelAnimationFrame(rafId.current); rafId.current = null }
        clearOverlay()
        predictedPointsRef.current = []
        lineStartRef.current = null
        if (finalPts.length >= 2) {
          const finalStroke: Stroke = { ...currentStroke.current, points: finalPts }
          const bgCtx = getBackgroundCtx()
          if (bgCtx) renderStroke(bgCtx, finalStroke)
          addStroke(finalStroke)
          const allStrokes = strokesRef.current
          useNotebookStore.getState().setStrokes(allStrokes)
          if (allStrokes.length > BITMAP_FREEZE_THRESHOLD) tryFreezeBitmap(allStrokes)
        }
        currentStroke.current = null
        scheduleRender()
        return
      }

      const stroke = currentStroke.current
      if (!stroke) return
      if (rafId.current !== null) { cancelAnimationFrame(rafId.current); rafId.current = null }
      clearOverlay()
      predictedPointsRef.current = []

      if (stroke.points.length >= 1) {
        const finalStroke: Stroke = { ...stroke, points: smoothPoints(stroke.points) }
        const ctx = getBackgroundCtx()
        if (ctx) renderStroke(ctx, finalStroke)
        addStroke(finalStroke)
        const allStrokes = strokesRef.current
        useNotebookStore.getState().setStrokes(allStrokes)

        if (allStrokes.length > BITMAP_FREEZE_THRESHOLD) {
          tryFreezeBitmap(allStrokes)
        }
      }
      currentStroke.current = null
      scheduleRender()
    },
    [clearOverlay, addStroke, strokesRef, tryFreezeBitmap, scheduleRender, handleEraserEnd, toCanvasCoords]
  )

  // ── Pointer move/leave for cursor indicator ───────────────────────────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onPointerMove = (e: PointerEvent) => {
      const rect = el.getBoundingClientRect()
      const [cx, cy] = toCanvasCoords(e.clientX - rect.left, e.clientY - rect.top)
      cursorPosRef.current = { x: cx, y: cy }
      if (!currentStroke.current) {
        scheduleRender()
      }
    }

    const onPointerLeave = () => {
      cursorPosRef.current = null
      if (!currentStroke.current) {
        scheduleRender()
      }
    }

    el.addEventListener('pointermove', onPointerMove)
    el.addEventListener('pointerleave', onPointerLeave)
    return () => {
      el.removeEventListener('pointermove', onPointerMove)
      el.removeEventListener('pointerleave', onPointerLeave)
    }
  }, [containerRef, toCanvasCoords, scheduleRender])

  // ── Input handler ─────────────────────────────────────────────────────────────

  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    handlerRef.current?.dispose()
    handlerRef.current = new PenInputHandler(
      el,
      { onStrokeStart: handleStrokeStart, onStrokeMove: handleStrokeMove, onStrokeEnd: handleStrokeEnd },
      palmRef.current
    )
    return () => { handlerRef.current?.dispose(); handlerRef.current = null }
  }, [containerRef, handleStrokeStart, handleStrokeMove, handleStrokeEnd])

  // ── Keyboard shortcuts ────────────────────────────────────────────────────────

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey) {
        if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo(); return }
        if (e.key === 'y' || (e.key === 'z' && e.shiftKey)) { e.preventDefault(); redo(); return }
        if (e.key === 's') { e.preventDefault(); void useNotebookStore.getState().saveCurrentPage(); return }
        if (e.key === 'n') { e.preventDefault(); window.dispatchEvent(new CustomEvent('inknote:new-notebook')); return }
        if (e.key === 'e') { e.preventDefault(); window.dispatchEvent(new CustomEvent('ink:action', { detail: 'export' })); return }
        return
      }
      // Non-ctrl tool shortcuts
      if (e.key === 'p') { useToolStore.getState().setActiveTool('pen');       return }
      if (e.key === 'h') { useToolStore.getState().setActiveTool('highlighter'); return }
      if (e.key === 'e') { useToolStore.getState().setActiveTool('eraser');    return }
      if (e.key === 'v' && !e.ctrlKey) { useToolStore.getState().setActiveTool('select'); return }
      if (e.key === 'l' || e.key === 'L') {
        const s = useToolStore.getState()
        s.setStraightLine(!s.straightLine)
        return
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [undo, redo])

  // ── Shift key tracking for straight-line angle snap ───────────────────────────

  useEffect(() => {
    const down = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeldRef.current = true }
    const up   = (e: KeyboardEvent) => { if (e.key === 'Shift') shiftHeldRef.current = false }
    window.addEventListener('keydown', down)
    window.addEventListener('keyup',   up)
    return () => {
      window.removeEventListener('keydown', down)
      window.removeEventListener('keyup',   up)
    }
  }, [])

  // ── Cleanup ───────────────────────────────────────────────────────────────────

  useEffect(() => () => {
    palmRef.current.dispose()
    if (rafId.current !== null) cancelAnimationFrame(rafId.current)
  }, [])

  // ── Public API ────────────────────────────────────────────────────────────────

  return {
    strokesRef,
    imagesRef,
    isDrawingRef: currentStroke,
    toCanvasCoords,
    loadPageData,
    addImageToPage,
    updateImageInPage,
    removeImageFromPage,
    undo,
    redo,
    clearCanvas: () => {
      clearAll()
      frozenCanvasRef.current = null
      frozenCountRef.current  = 0
      clearOverlay()
      // Redraw template + images (only strokes are cleared)
      const ctx = getBackgroundCtx()
      if (ctx) {
        const template = currentTemplateRef.current
        renderTemplate(ctx, template, ctx.canvas.width, ctx.canvas.height)
        drawImagesOnCtx(ctx, imagesBridgeRef.current, imageCacheRef.current, template)
      }
    },
  }
}
