import { useRef, useEffect, useCallback, RefObject } from 'react'
import type { Viewport, PageImage } from '@shared/types'
import { IPC } from '@shared/types'
import type { InkToolSettings } from '../../hooks/useInkCanvas'
import { useInkCanvas } from '../../hooks/useInkCanvas'
import { DEFAULT_TOOL_SETTINGS } from './toolDefaults'
import { TouchGestureHandler } from './TouchGestureHandler'
import { useNotebookStore } from '../../stores/notebookStore'
import { exportAnnotatedPDF } from '../PDF/pdfExport'
import ImageSelectionOverlay from './ImageSelectionOverlay'

function generateThumbnail(canvas: HTMLCanvasElement): string {
  const W = 200
  const offscreen = document.createElement('canvas')
  offscreen.width  = W
  offscreen.height = Math.round(canvas.height * (W / canvas.width))
  const ctx = offscreen.getContext('2d')!
  ctx.drawImage(canvas, 0, 0, offscreen.width, offscreen.height)
  return offscreen.toDataURL('image/jpeg', 0.75)
}

const PAGE_W = 2480
const PAGE_H = 3508
const MIN_SCALE = 0.05
const MAX_SCALE = 8

function clampScale(s: number) {
  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))
}

export interface InkCanvasProps {
  toolSettingsRef?: RefObject<InkToolSettings>
}

export default function InkCanvas({ toolSettingsRef }: InkCanvasProps) {
  const containerRef  = useRef<HTMLDivElement>(null)
  const backgroundRef = useRef<HTMLCanvasElement>(null)
  const overlayRef    = useRef<HTMLCanvasElement>(null)
  const viewportRef = useRef<Viewport>({ scale: 1, offsetX: 0, offsetY: 0 })
  const internalToolRef = useRef<InkToolSettings>(DEFAULT_TOOL_SETTINGS)
  const activeToolRef   = toolSettingsRef ?? internalToolRef

  // Space+drag pan state
  const isSpaceDownRef = useRef(false)
  const spacePanRef = useRef<{ startX: number; startY: number; startOffX: number; startOffY: number } | null>(null)

  const {
    undo, redo, clearCanvas, isDrawingRef,
    loadPageData, addImageToPage, updateImageInPage, removeImageFromPage,
  } = useInkCanvas(
    containerRef,
    backgroundRef,
    overlayRef,
    viewportRef,
    activeToolRef
  )

  const prevPageRef    = useRef<{ id: string; notebookId: string } | null>(null)
  const loadedPageIdRef = useRef<string | null>(null)
  const nullDocRef     = useRef(null)

  useEffect(() => {
    function handleState(state: ReturnType<typeof useNotebookStore.getState>) {
      const page = state.activePage

      // Page switched: snapshot the outgoing page's canvas as its thumbnail
      if (page?.id !== prevPageRef.current?.id) {
        const prev = prevPageRef.current
        if (prev && backgroundRef.current) {
          const thumbnail = generateThumbnail(backgroundRef.current)
          void useNotebookStore.getState().saveThumbnail(thumbnail, {
            notebookId: prev.notebookId,
            pageId:     prev.id,
          })
        }
        prevPageRef.current = page ? { id: page.id, notebookId: page.notebookId } : null
        loadedPageIdRef.current = null
        if (!page) loadPageData([], [], 'blank')
      }

      // Load page content once the async stroke fetch has finished.
      // (selectPage sets activePage first with empty strokes, then fills them in.)
      if (!page || state.isLoading) return
      if (loadedPageIdRef.current === page.id) return
      loadedPageIdRef.current = page.id
      loadPageData(state.strokes, state.images, page.template ?? 'blank')
    }
    const unsub = useNotebookStore.subscribe(handleState)
    handleState(useNotebookStore.getState())
    return unsub
  }, [loadPageData, backgroundRef])

  const applyTransform = useCallback(() => {
    const vp = viewportRef.current
    const t = `translate(${vp.offsetX}px, ${vp.offsetY}px) scale(${vp.scale})`
    if (backgroundRef.current) backgroundRef.current.style.transform = t
    if (overlayRef.current)    overlayRef.current.style.transform    = t
    window.dispatchEvent(new CustomEvent('ink:zoom',     { detail: vp.scale }))
    window.dispatchEvent(new CustomEvent('ink:viewport', { detail: { ...vp } }))
  }, [])

  const zoomAt = useCallback(
    (screenX: number, screenY: number, factor: number) => {
      const vp = viewportRef.current
      const newScale = clampScale(vp.scale * factor)
      const ratio = newScale / vp.scale
      viewportRef.current = {
        scale:   newScale,
        offsetX: screenX - ratio * (screenX - vp.offsetX),
        offsetY: screenY - ratio * (screenY - vp.offsetY),
      }
      applyTransform()
    },
    [applyTransform]
  )

  useEffect(() => {
    const bg = backgroundRef.current
    const ov = overlayRef.current
    const container = containerRef.current
    if (!bg || !ov || !container) return
    bg.width = PAGE_W;  bg.height = PAGE_H
    ov.width = PAGE_W;  ov.height = PAGE_H
    const ctx = bg.getContext('2d')
    if (ctx) { ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, PAGE_W, PAGE_H) }
    const { width, height } = container.getBoundingClientRect()
    const scale = clampScale(Math.min(width / PAGE_W, height / PAGE_H) * 0.92)
    viewportRef.current = {
      scale,
      offsetX: (width - PAGE_W * scale) / 2,
      offsetY: (height - PAGE_H * scale) / 2,
    }
    applyTransform()
  }, [applyTransform])

  // ── Clipboard paste — images ──────────────────────────────────────────────────

  useEffect(() => {
    const onPaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return
      for (const item of Array.from(items)) {
        if (!item.type.startsWith('image/')) continue
        e.preventDefault()
        const blob = item.getAsFile()
        if (!blob) continue
        const { activeNotebook } = useNotebookStore.getState()
        if (!activeNotebook) return

        const ext = item.type === 'image/jpeg' ? 'jpg'
                  : item.type === 'image/gif'  ? 'gif'
                  : item.type === 'image/webp' ? 'webp'
                  : 'png'

        const buffer = Array.from(new Uint8Array(await blob.arrayBuffer()))
        const result = await window.electronAPI.invoke<{ filePath: string }>(
          IPC.IMAGE_PASTE, { notebookId: activeNotebook.id, bytes: buffer, ext }
        )
        if (result?.filePath) {
          // Center on the current viewport
          const container = containerRef.current
          const vp = viewportRef.current
          const cx = container ? (container.clientWidth  / 2 - vp.offsetX) / vp.scale : 1240
          const cy = container ? (container.clientHeight / 2 - vp.offsetY) / vp.scale : 1754
          await addImageToPage(result.filePath, cx, cy)
        }
        break
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [addImageToPage, containerRef, viewportRef])

  // ── Image import from file (triggered by Toolbar) ─────────────────────────────

  useEffect(() => {
    const handler = async () => {
      const { activeNotebook } = useNotebookStore.getState()
      if (!activeNotebook) return
      const result = await window.electronAPI.invoke<{ filePath: string } | null>(
        IPC.IMAGE_IMPORT, { notebookId: activeNotebook.id }
      )
      if (result?.filePath) {
        const container = containerRef.current
        const vp = viewportRef.current
        const cx = container ? (container.clientWidth  / 2 - vp.offsetX) / vp.scale : 1240
        const cy = container ? (container.clientHeight / 2 - vp.offsetY) / vp.scale : 1754
        await addImageToPage(result.filePath, cx, cy)
      }
    }
    window.addEventListener('ink:import-image', handler as EventListener)
    return () => window.removeEventListener('ink:import-image', handler as EventListener)
  }, [addImageToPage, containerRef, viewportRef])

  // ── Wheel zoom/pan ────────────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      if (e.ctrlKey) {
        const factor = e.deltaY < 0 ? 1.08 : 0.93
        // Viewport offsets are container-relative — convert from client coords
        const rect = container.getBoundingClientRect()
        zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor)
      } else {
        const vp = viewportRef.current
        viewportRef.current = { ...vp, offsetX: vp.offsetX - e.deltaX, offsetY: vp.offsetY - e.deltaY }
        applyTransform()
      }
    }
    container.addEventListener('wheel', onWheel, { passive: false })
    return () => container.removeEventListener('wheel', onWheel)
  }, [zoomAt, applyTransform])

  // ── Touch gesture handler ─────────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const handler = new TouchGestureHandler(container, {
      getViewport:       () => viewportRef.current,
      setViewport:       (vp) => { viewportRef.current = vp },
      onViewportChange:  applyTransform,
      clampScale,
      isPenActive:       () => isDrawingRef.current !== null,
      inertiaDecay:      0.93,
      inertiaThreshold:  0.4,
    })
    return () => handler.dispose()
  }, [applyTransform, isDrawingRef])

  // ── Space key handling (cursor changes) ───────────────────────────────────────

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        isSpaceDownRef.current = true
        if (containerRef.current) containerRef.current.style.cursor = 'grab'
      }
    }
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        isSpaceDownRef.current = false
        spacePanRef.current = null
        if (containerRef.current) containerRef.current.style.cursor = 'none'
      }
    }
    window.addEventListener('keydown', onKeyDown)
    window.addEventListener('keyup', onKeyUp)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    }
  }, [])

  // ── Space+drag pointer capture (capture phase) ────────────────────────────────

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const onPointerDown = (e: PointerEvent) => {
      if (!isSpaceDownRef.current) return
      e.stopImmediatePropagation()
      spacePanRef.current = {
        startX:    e.clientX,
        startY:    e.clientY,
        startOffX: viewportRef.current.offsetX,
        startOffY: viewportRef.current.offsetY,
      }
      container.setPointerCapture(e.pointerId)
      container.style.cursor = 'grabbing'
    }

    const onPointerMove = (e: PointerEvent) => {
      if (!spacePanRef.current) return
      e.stopImmediatePropagation()
      const { startX, startY, startOffX, startOffY } = spacePanRef.current
      viewportRef.current = {
        ...viewportRef.current,
        offsetX: startOffX + (e.clientX - startX),
        offsetY: startOffY + (e.clientY - startY),
      }
      applyTransform()
    }

    const onPointerUp = (e: PointerEvent) => {
      if (!spacePanRef.current) return
      e.stopImmediatePropagation()
      spacePanRef.current = null
      container.style.cursor = 'grab'
    }

    container.addEventListener('pointerdown', onPointerDown, { capture: true })
    container.addEventListener('pointermove', onPointerMove, { capture: true })
    container.addEventListener('pointerup',   onPointerUp,   { capture: true })

    return () => {
      container.removeEventListener('pointerdown', onPointerDown, { capture: true })
      container.removeEventListener('pointermove', onPointerMove, { capture: true })
      container.removeEventListener('pointerup',   onPointerUp,   { capture: true })
    }
  }, [applyTransform])

  // ── ink:action event handler ──────────────────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current
    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail
      switch (action) {
        case 'undo':       undo(); break
        case 'redo':       redo(); break
        case 'clear':      clearCanvas(); break
        case 'zoom-in':
        case 'zoom-out': {
          if (!container) break
          const { width, height } = container.getBoundingClientRect()
          zoomAt(width / 2, height / 2, action === 'zoom-in' ? 1.2 : 1 / 1.2)
          break
        }
        case 'zoom-reset': {
          if (!container) break
          const { width, height } = container.getBoundingClientRect()
          const scale = clampScale(Math.min(width / PAGE_W, height / PAGE_H) * 0.92)
          viewportRef.current = {
            scale,
            offsetX: (width - PAGE_W * scale) / 2,
            offsetY: (height - PAGE_H * scale) / 2,
          }
          applyTransform()
          break
        }
        case 'export': {
          const { activeNotebook, pages } = useNotebookStore.getState()
          if (activeNotebook) void exportAnnotatedPDF(activeNotebook.id, activeNotebook.name, pages, nullDocRef)
          break
        }
      }
    }
    window.addEventListener('ink:action', handler)
    return () => window.removeEventListener('ink:action', handler)
  }, [undo, redo, clearCanvas, zoomAt, applyTransform, nullDocRef])

  // ── Duplicate image helper (passed to overlay context menu) ──────────────────

  const onAddDuplicateImage = useCallback(async (src: PageImage) => {
    // Re-add with a new ID, offset by 20px
    await addImageToPage(src.src, src.x + src.width / 2 + 20, src.y + src.height / 2 + 20)
  }, [addImageToPage])

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-surface-100 select-none"
      style={{ touchAction: 'none', cursor: 'none' }}
    >
      <canvas
        ref={backgroundRef}
        className="absolute top-0 left-0 origin-top-left shadow-xl"
        style={{ willChange: 'transform' }}
        aria-label="Ink canvas — confirmed strokes"
      />
      <canvas
        ref={overlayRef}
        className="absolute top-0 left-0 origin-top-left"
        style={{ willChange: 'transform', pointerEvents: 'all' }}
        aria-label="Ink canvas — active stroke"
      />
      <ImageSelectionOverlay
        viewportRef={viewportRef}
        containerRef={containerRef}
        onUpdateImage={updateImageInPage}
        onRemoveImage={removeImageFromPage}
        onAddDuplicateImage={onAddDuplicateImage}
      />
    </div>
  )
}
