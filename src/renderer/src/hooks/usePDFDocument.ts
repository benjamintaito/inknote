import { useRef, useCallback, useState, useEffect } from 'react'
import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import type { PDFDocumentProxy, PDFPageProxy, RenderTask } from 'pdfjs-dist'

// Configure worker — pdfjs-dist v3 uses .js (not .mjs)
// @ts-ignore
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.js?url'
GlobalWorkerOptions.workerSrc = pdfWorkerUrl as string

export const PDF_RENDER_SCALE = 2  // render at 2× for crisp display

export function usePDFDocument() {
  const docRef = useRef<PDFDocumentProxy | null>(null)
  const cacheRef = useRef<Map<number, PDFPageProxy>>(new Map())
  const renderTaskRef = useRef<RenderTask | null>(null)
  const [totalPages, setTotalPages] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPDF = useCallback(async (bytes: Uint8Array) => {
    setIsLoading(true)
    setError(null)
    try {
      if (docRef.current) {
        await docRef.current.destroy()
        docRef.current = null
      }
      cacheRef.current.clear()
      // Defensive: ensure we have a proper Uint8Array (IPC may send a plain object)
      const safeBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(Object.values(bytes as unknown as Record<string, number>))
      const loadingTask = getDocument({ data: safeBytes })
      const doc = await loadingTask.promise
      docRef.current = doc
      setTotalPages(doc.numPages)
    } catch (e) {
      console.error('[InkNote] Failed to load PDF:', e)
      setError(String(e))
    } finally {
      setIsLoading(false)
    }
  }, [])

  const getPage = useCallback(async (pageNum: number): Promise<PDFPageProxy | null> => {
    const doc = docRef.current
    if (!doc) return null
    if (cacheRef.current.has(pageNum)) return cacheRef.current.get(pageNum)!
    if (cacheRef.current.size >= 5) {
      const oldest = cacheRef.current.keys().next().value as number
      cacheRef.current.get(oldest)?.cleanup()
      cacheRef.current.delete(oldest)
    }
    const page = await doc.getPage(pageNum)
    cacheRef.current.set(pageNum, page)
    return page
  }, [])

  const renderPageToCanvas = useCallback(async (
    pageNum: number,
    canvas: HTMLCanvasElement | OffscreenCanvas
  ): Promise<{ width: number; height: number } | null> => {
    const page = await getPage(pageNum)
    if (!page) return null
    const viewport = page.getViewport({ scale: PDF_RENDER_SCALE })
    canvas.width = viewport.width
    canvas.height = viewport.height
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D
    if (!ctx) return null
    // Cancel any in-progress render before starting a new one
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel()
      renderTaskRef.current = null
    }
    const renderTask = page.render({ canvasContext: ctx, viewport })
    renderTaskRef.current = renderTask
    try {
      await renderTask.promise
    } catch (e: unknown) {
      // RenderingCancelledException is thrown when cancelled — treat as non-fatal
      if (e instanceof Error && e.name === 'RenderingCancelledException') return null
      throw e
    } finally {
      renderTaskRef.current = null
    }
    return { width: viewport.width, height: viewport.height }
  }, [getPage])

  const getPageSizePt = useCallback(async (pageNum: number): Promise<{ width: number; height: number } | null> => {
    const page = await getPage(pageNum)
    if (!page) return null
    const vp = page.getViewport({ scale: 1 })
    return { width: vp.width, height: vp.height }
  }, [getPage])

  const cleanup = useCallback(async () => {
    if (renderTaskRef.current) {
      renderTaskRef.current.cancel()
      renderTaskRef.current = null
    }
    cacheRef.current.forEach(p => p.cleanup())
    cacheRef.current.clear()
    if (docRef.current) {
      await docRef.current.destroy()
      docRef.current = null
    }
  }, [])

  // Destroy the PDF document when the hook's owner unmounts
  useEffect(() => {
    return () => {
      if (renderTaskRef.current) {
        renderTaskRef.current.cancel()
        renderTaskRef.current = null
      }
      void docRef.current?.destroy()
      docRef.current = null
    }
  }, [])

  return { totalPages, isLoading, error, loadPDF, renderPageToCanvas, getPageSizePt, cleanup, docRef }
}
