import { useRef, useEffect, useCallback, RefObject } from 'react'
import { ChevronLeft, ChevronRight, Download, Loader2 } from 'lucide-react'
import { useNotebookStore } from '../../stores/notebookStore'
import { useInkCanvas } from '../../hooks/useInkCanvas'
import { usePDFDocument } from '../../hooks/usePDFDocument'
import { TouchGestureHandler } from '../Canvas/TouchGestureHandler'
import { DEFAULT_TOOL_SETTINGS } from '../Canvas/toolDefaults'
import { exportAnnotatedPDF } from './pdfExport'
import ImageSelectionOverlay from '../Canvas/ImageSelectionOverlay'
import type { InkToolSettings } from '../../hooks/useInkCanvas'
import type { Viewport, PageImage } from '@shared/types'
import { IPC } from '@shared/types'

// ── IPC helper ─────────────────────────────────────────────────────────────────

function ipc<T>(channel: string, data?: unknown): Promise<T> {
  return window.electronAPI.invoke<T>(channel, data)
}

// ── Thumbnail generation ───────────────────────────────────────────────────────

function generateCompositeThumbnail(pdfCanvas: HTMLCanvasElement, strokeCanvas: HTMLCanvasElement): string {
  const W = 200
  const h = Math.round(pdfCanvas.height * W / pdfCanvas.width)
  const off = document.createElement('canvas')
  off.width = W; off.height = h
  const ctx = off.getContext('2d')!
  ctx.drawImage(pdfCanvas, 0, 0, W, h)
  ctx.drawImage(strokeCanvas, 0, 0, W, h)
  return off.toDataURL('image/jpeg', 0.75)
}

// ── Constants ──────────────────────────────────────────────────────────────────

const MIN_SCALE = 0.05
const MAX_SCALE = 8

function clampScale(s: number) { return Math.min(MAX_SCALE, Math.max(MIN_SCALE, s)) }

// ── Props ──────────────────────────────────────────────────────────────────────

export interface PDFAnnotatorProps {
  toolSettingsRef?: RefObject<InkToolSettings>
}

// ── Component ──────────────────────────────────────────────────────────────────

export default function PDFAnnotator({ toolSettingsRef }: PDFAnnotatorProps) {
  const containerRef    = useRef<HTMLDivElement>(null)
  const pdfCanvasRef    = useRef<HTMLCanvasElement>(null)
  const bgCanvasRef     = useRef<HTMLCanvasElement>(null)
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null)

  // Viewport state in a ref — zero re-renders on pan/zoom
  const viewportRef = useRef<Viewport>({ scale: 1, offsetX: 0, offsetY: 0 })

  // Fallback tool ref when no external ref is provided
  const internalToolRef = useRef<InkToolSettings>(DEFAULT_TOOL_SETTINGS)
  const activeToolRef   = toolSettingsRef ?? internalToolRef

  const {
    undo, redo, clearCanvas, isDrawingRef,
    loadPageData, addImageToPage, updateImageInPage, removeImageFromPage,
  } = useInkCanvas(
    containerRef,
    bgCanvasRef,
    overlayCanvasRef,
    viewportRef,
    activeToolRef
  )

  const { loadPDF, renderPageToCanvas, isLoading, cleanup, docRef } = usePDFDocument()

  // Track the currently loaded PDF path to avoid reloading the same PDF
  const currentPdfPathRef = useRef<string | null>(null)
  const prevPageRef       = useRef<{ id: string; notebookId: string } | null>(null)
  const pdfReadyPageIdRef = useRef<string | null>(null)   // PDF layer rendered for this page
  const renderingPageIdRef = useRef<string | null>(null)  // PDF render in progress for this page
  const loadedPageIdRef   = useRef<string | null>(null)   // strokes/images applied for this page

  // ── Apply CSS transform ───────────────────────────────────────────────────

  const applyTransform = useCallback(() => {
    const vp = viewportRef.current
    const t = `translate(${vp.offsetX}px, ${vp.offsetY}px) scale(${vp.scale})`
    if (pdfCanvasRef.current)     pdfCanvasRef.current.style.transform     = t
    if (bgCanvasRef.current)      bgCanvasRef.current.style.transform      = t
    if (overlayCanvasRef.current) overlayCanvasRef.current.style.transform = t
    window.dispatchEvent(new CustomEvent('ink:zoom',     { detail: vp.scale }))
    window.dispatchEvent(new CustomEvent('ink:viewport', { detail: { ...vp } }))
  }, [])

  // ── Zoom centered on a screen point ──────────────────────────────────────

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

  // ── Recenter viewport based on canvas dimensions ──────────────────────────

  const recenterViewport = useCallback((canvasW: number, canvasH: number) => {
    const container = containerRef.current
    if (!container) return
    const { width, height } = container.getBoundingClientRect()
    const scale = clampScale(Math.min(width / canvasW, height / canvasH) * 0.92)
    viewportRef.current = {
      scale,
      offsetX: (width - canvasW * scale) / 2,
      offsetY: (height - canvasH * scale) / 2,
    }
    applyTransform()
  }, [applyTransform])

  // ── Page switching ────────────────────────────────────────────────────────

  useEffect(() => {
    // Apply strokes/images once both the PDF layer and the async stroke fetch
    // are ready. selectPage sets activePage first with empty strokes and fills
    // them in later, so this may be reached from several subscribe callbacks.
    function applyPageData(state: ReturnType<typeof useNotebookStore.getState>, pageId: string) {
      if (state.activePage?.id !== pageId) return
      if (state.isLoading) return
      if (pdfReadyPageIdRef.current !== pageId) return
      if (loadedPageIdRef.current === pageId) return
      loadedPageIdRef.current = pageId
      loadPageData(state.strokes, state.images, 'pdf')
    }

    async function handleState(state: ReturnType<typeof useNotebookStore.getState>) {
      const page = state.activePage

      // Page switched: snapshot the outgoing page's canvas as its thumbnail
      if (page?.id !== prevPageRef.current?.id) {
        const prev = prevPageRef.current
        if (prev && pdfCanvasRef.current && bgCanvasRef.current) {
          try {
            const thumbnail = generateCompositeThumbnail(pdfCanvasRef.current, bgCanvasRef.current)
            void useNotebookStore.getState().saveThumbnail(thumbnail, {
              notebookId: prev.notebookId,
              pageId:     prev.id,
            })
          } catch {
            // ignore thumbnail errors
          }
        }
        prevPageRef.current = page ? { id: page.id, notebookId: page.notebookId } : null
        pdfReadyPageIdRef.current = null
        loadedPageIdRef.current = null
      }

      if (!page || page.template !== 'pdf' || !page.pdfPath) return
      const pdfPath = page.pdfPath

      // Render the PDF layer once per page
      if (pdfReadyPageIdRef.current !== page.id && renderingPageIdRef.current !== page.id) {
        renderingPageIdRef.current = page.id
        try {
          // Load PDF bytes only if the source file changed
          if (pdfPath !== currentPdfPathRef.current) {
            currentPdfPathRef.current = pdfPath
            try {
              const raw = await ipc<Uint8Array>(IPC.PDF_READ_BYTES, { filePath: pdfPath })
              // Normalise: IPC may deliver Buffer as a plain object on some Electron versions
              const bytes = raw instanceof Uint8Array ? raw : new Uint8Array(Object.values(raw as unknown as Record<string, number>))
              await loadPDF(bytes)
            } catch (e) {
              console.error('[InkNote] Failed to load PDF bytes:', e)
              currentPdfPathRef.current = null
              return
            }
          }

          // Render the PDF page (pageOrder is 0-based, pdfjs is 1-based)
          const pdfCanvas = pdfCanvasRef.current
          if (!pdfCanvas) return
          const result = await renderPageToCanvas(page.pageOrder + 1, pdfCanvas)
          if (!result) return

          // Abort if the user already navigated elsewhere during the async render
          if (useNotebookStore.getState().activePage?.id !== page.id) return

          const { width: canvasW, height: canvasH } = result

          // Sync stroke canvas dimensions to match PDF canvas
          if (bgCanvasRef.current) {
            bgCanvasRef.current.width  = canvasW
            bgCanvasRef.current.height = canvasH
          }
          if (overlayCanvasRef.current) {
            overlayCanvasRef.current.width  = canvasW
            overlayCanvasRef.current.height = canvasH
          }

          recenterViewport(canvasW, canvasH)
          pdfReadyPageIdRef.current = page.id
        } finally {
          renderingPageIdRef.current = null
        }

        // The stroke fetch may have finished while the PDF was rendering
        applyPageData(useNotebookStore.getState(), page.id)
        return
      }

      applyPageData(state, page.id)
    }

    const unsub = useNotebookStore.subscribe((state) => void handleState(state))
    // Process the current state immediately — the component may mount
    // after activePage is already set (subscribe only fires on future changes).
    void handleState(useNotebookStore.getState())

    return () => { unsub(); void cleanup() }
  }, [loadPDF, renderPageToCanvas, loadPageData, recenterViewport, cleanup])

  // ── Initial canvas setup ─────────────────────────────────────────────────

  useEffect(() => {
    const pdfCanvas = pdfCanvasRef.current
    const bgCanvas  = bgCanvasRef.current
    const ov        = overlayCanvasRef.current
    const container = containerRef.current
    if (!pdfCanvas || !bgCanvas || !ov || !container) return

    // Set default sizes (will be overwritten when PDF loads)
    pdfCanvas.width  = 800;  pdfCanvas.height  = 1000
    bgCanvas.width   = 800;  bgCanvas.height   = 1000
    ov.width         = 800;  ov.height         = 1000

    recenterViewport(800, 1000)
  }, [recenterViewport])

  // ── Image import from file (triggered by Toolbar) ────────────────────────

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
        const cx = container ? (container.clientWidth  / 2 - vp.offsetX) / vp.scale : 400
        const cy = container ? (container.clientHeight / 2 - vp.offsetY) / vp.scale : 600
        await addImageToPage(result.filePath, cx, cy)
      }
    }
    window.addEventListener('ink:import-image', handler as EventListener)
    return () => window.removeEventListener('ink:import-image', handler as EventListener)
  }, [addImageToPage, containerRef, viewportRef])

  // ── Clipboard paste — images (Bug 4) ─────────────────────────────────────

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
          const container = containerRef.current
          const vp = viewportRef.current
          const cx = container ? (container.clientWidth  / 2 - vp.offsetX) / vp.scale : 400
          const cy = container ? (container.clientHeight / 2 - vp.offsetY) / vp.scale : 600
          await addImageToPage(result.filePath, cx, cy)
        }
        break
      }
    }
    document.addEventListener('paste', onPaste)
    return () => document.removeEventListener('paste', onPaste)
  }, [addImageToPage, containerRef, viewportRef])

  // ── Wheel: Ctrl+scroll → zoom, scroll → pan ───────────────────────────────

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

  // ── Two-finger touch: pan + pinch-zoom + inertia ──────────────────────────

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const handler = new TouchGestureHandler(container, {
      getViewport:      () => viewportRef.current,
      setViewport:      (vp) => { viewportRef.current = vp },
      onViewportChange: applyTransform,
      clampScale,
      isPenActive:      () => isDrawingRef.current !== null,
      inertiaDecay:     0.93,
      inertiaThreshold: 0.4,
    })

    return () => handler.dispose()
  }, [applyTransform, isDrawingRef])

  // ── Toolbar actions via window events ────────────────────────────────────

  useEffect(() => {
    const container = containerRef.current

    const handler = (e: Event) => {
      const action = (e as CustomEvent<string>).detail
      const pdfCanvas = pdfCanvasRef.current
      switch (action) {
        case 'undo':     undo(); break
        case 'redo':     redo(); break
        case 'clear':    clearCanvas(); break
        case 'zoom-in':
        case 'zoom-out': {
          if (!container) break
          const { width, height } = container.getBoundingClientRect()
          zoomAt(width / 2, height / 2, action === 'zoom-in' ? 1.2 : 1 / 1.2)
          break
        }
        case 'zoom-reset': {
          if (!container || !pdfCanvas) break
          recenterViewport(pdfCanvas.width, pdfCanvas.height)
          break
        }
        case 'export': {
          const { activeNotebook: nb, pages: ps } = useNotebookStore.getState()
          if (nb) void exportAnnotatedPDF(nb.id, nb.name, ps, docRef)
          break
        }
      }
    }

    window.addEventListener('ink:action', handler)
    return () => window.removeEventListener('ink:action', handler)
  }, [undo, redo, clearCanvas, zoomAt, applyTransform, recenterViewport, docRef])

  // ── Page navigation ───────────────────────────────────────────────────────

  const pages          = useNotebookStore((s) => s.pages)
  const activePage     = useNotebookStore((s) => s.activePage)
  const activeNotebook = useNotebookStore((s) => s.activeNotebook)
  const selectPage     = useNotebookStore((s) => s.selectPage)

  const currentIdx = pages.findIndex((p) => p.id === activePage?.id)

  const prevPage = useCallback(() => {
    if (currentIdx > 0) void selectPage(pages[currentIdx - 1])
  }, [currentIdx, pages, selectPage])

  const nextPage = useCallback(() => {
    if (currentIdx < pages.length - 1) void selectPage(pages[currentIdx + 1])
  }, [currentIdx, pages, selectPage])

  const handleExport = useCallback(() => {
    if (!activeNotebook) return
    void exportAnnotatedPDF(activeNotebook.id, activeNotebook.name, pages, docRef)
  }, [activeNotebook, pages, docRef])

  const onAddDuplicateImage = useCallback(async (src: PageImage) => {
    await addImageToPage(src.src, src.x + src.width / 2 + 20, src.y + src.height / 2 + 20)
  }, [addImageToPage])

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div
      ref={containerRef}
      className="relative flex-1 overflow-hidden bg-surface-100 select-none"
      style={{ touchAction: 'none', cursor: 'crosshair' }}
    >
      {/* PDF layer — bottom, no pointer events */}
      <canvas
        ref={pdfCanvasRef}
        className="absolute top-0 left-0 origin-top-left shadow-xl"
        style={{ pointerEvents: 'none' }}
        aria-label="PDF page"
      />

      {/* Confirmed strokes — transparent bg for PDF pages */}
      <canvas
        ref={bgCanvasRef}
        className="absolute top-0 left-0 origin-top-left"
        style={{ willChange: 'transform', pointerEvents: 'none' }}
        aria-label="Ink canvas — confirmed strokes"
      />

      {/* Live overlay — redrawn every rAF tick during drawing */}
      <canvas
        ref={overlayCanvasRef}
        className="absolute top-0 left-0 origin-top-left"
        style={{ willChange: 'transform', pointerEvents: 'all' }}
        aria-label="Ink canvas — active stroke"
      />

      {/* Image selection overlay — select tool: move / resize / rotate images */}
      <ImageSelectionOverlay
        viewportRef={viewportRef}
        containerRef={containerRef}
        onUpdateImage={updateImageInPage}
        onRemoveImage={removeImageFromPage}
        onAddDuplicateImage={onAddDuplicateImage}
      />

      {/* Loading indicator */}
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-white/60 z-10">
          <Loader2 size={32} className="animate-spin text-blue-500" />
        </div>
      )}

      {/* Navigation UI */}
      <div className="absolute bottom-4 left-1/2 -translate-x-1/2 z-20 flex items-center gap-2 bg-white/90 backdrop-blur-sm border border-surface-200 rounded-full shadow-lg px-3 py-1.5">
        <button
          onClick={prevPage}
          disabled={currentIdx <= 0}
          className="p-1 rounded-full text-ink-soft hover:text-ink hover:bg-surface-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Página anterior"
        >
          <ChevronLeft size={16} />
        </button>

        <span className="text-xs text-ink font-medium px-1 min-w-[60px] text-center">
          {currentIdx + 1} / {pages.length}
        </span>

        <button
          onClick={nextPage}
          disabled={currentIdx >= pages.length - 1}
          className="p-1 rounded-full text-ink-soft hover:text-ink hover:bg-surface-100 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
          title="Página siguiente"
        >
          <ChevronRight size={16} />
        </button>

        <div className="w-px h-4 bg-surface-200 mx-1" />

        <button
          onClick={handleExport}
          className="flex items-center gap-1.5 px-2 py-0.5 text-xs text-blue-600 hover:bg-blue-50 rounded-full transition-colors font-medium"
          title="Exportar PDF anotado"
        >
          <Download size={13} />
          <span>Exportar</span>
        </button>
      </div>
    </div>
  )
}
