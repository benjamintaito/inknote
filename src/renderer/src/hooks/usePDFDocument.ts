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
  const loadSeqRef = useRef(0)
  const [totalPages, setTotalPages] = useState(0)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const loadPDF = useCallback(async (bytes: Uint8Array) => {
    const seq = ++loadSeqRef.current
    setIsLoading(true)
    setError(null)
    try {
      if (docRef.current) {
        const old = docRef.current
        docRef.current = null
        await old.destroy()
      }
      cacheRef.current.clear()
      // Defensive: ensure we have a proper Uint8Array (IPC may send a plain object)
      const safeBytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(Object.values(bytes as unknown as Record<string, number>))
      // isEvalSupported: false — never compile font programs with eval
      // (mitigates CVE-2024-4367 in pdf.js < 4.2)
      const loadingTask = getDocument({ data: safeBytes, isEvalSupported: false })
      const doc = await loadingTask.promise
      // A newer loadPDF call superseded this one
      if (seq !== loadSeqRef.current) { void doc.destroy(); return }
      docRef.current = doc
      setTotalPages(doc.numPages)
    } catch (e) {
      if (seq !== loadSeqRef.current) return
      console.error('[InkNote] Failed to load PDF:', e)
      setError(String(e))
      throw e
    } finally {
      if (seq === loadSeqRef.current) setIsLoading(false)
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
