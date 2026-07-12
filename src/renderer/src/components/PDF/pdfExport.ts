import { IPC } from '@shared/types'
import type { PageMeta, PageImage, StrokeFile } from '@shared/types'
import { renderStroke } from '../Canvas/StrokeRenderer'
import { renderTemplate } from '../Notebook/PageTemplates'
import { PDF_RENDER_SCALE } from '../../hooks/usePDFDocument'
import { useNotebookStore } from '../../stores/notebookStore'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { RefObject } from 'react'

function ipc<T>(channel: string, data?: unknown): Promise<T> {
  return window.electronAPI.invoke<T>(channel, data)
}

// ── Image embedding ────────────────────────────────────────────────────────────

/** Load a page image from disk (via IPC) into an HTMLImageElement, or null. */
function loadImage(filePath: string): Promise<HTMLImageElement | null> {
  return ipc<string | null>(IPC.IMAGE_READ, { filePath }).then((dataUrl) => {
    if (!dataUrl) return null
    return new Promise<HTMLImageElement | null>((resolve) => {
      const el = new Image()
      el.onload = () => resolve(el)
      el.onerror = () => resolve(null)
      el.src = dataUrl
    })
  })
}

/** Draw the page's inserted images (same transforms as the live canvas). */
async function drawImages(ctx: CanvasRenderingContext2D, images: PageImage[]): Promise<void> {
  const sorted = [...images].sort((a, b) => a.zIndex - b.zIndex)
  for (const img of sorted) {
    const el = await loadImage(img.src)
    if (!el) continue
    ctx.save()
    ctx.globalAlpha = img.opacity
    ctx.translate(img.x + img.width / 2, img.y + img.height / 2)
    ctx.rotate((img.rotation * Math.PI) / 180)
    ctx.drawImage(el, -img.width / 2, -img.height / 2, img.width, img.height)
    ctx.restore()
  }
}

// ── Export ─────────────────────────────────────────────────────────────────────

/**
 * Export a notebook as a PDF with all annotations (strokes + inserted images)
 * rasterized as a PNG overlay per page.
 *
 * - PDF notebooks: annotations are drawn on top of the original PDF pages.
 * - Regular notebooks: pages are created from scratch with their templates.
 */
export async function exportAnnotatedPDF(
  notebookId: string,
  notebookName: string,
  pages: PageMeta[],
  pdfDocRef: RefObject<PDFDocumentProxy | null>
): Promise<void> {
  const savePath = await ipc<string | null>(IPC.PDF_EXPORT_DIALOG, { defaultName: `${notebookName}-anotado.pdf` })
  if (!savePath) return

  if (pages.length === 0) {
    throw new Error('No se pudo exportar: el cuaderno no tiene páginas.')
  }

  // Flush any unsaved strokes so the export reflects what's on screen
  await useNotebookStore.getState().saveCurrentPage()

  const { PDFDocument } = await import('pdf-lib')
  const isPDFNotebook = pages[0].pdfPath !== null

  let outputDoc: import('pdf-lib').PDFDocument
  if (isPDFNotebook && pages[0].pdfPath) {
    const srcBytes = await ipc<Uint8Array>(IPC.PDF_READ_BYTES, { filePath: pages[0].pdfPath })
    outputDoc = await PDFDocument.load(srcBytes)
  } else {
    outputDoc = await PDFDocument.create()
  }

  for (const [i, page] of pages.entries()) {
    const strokeFile = await ipc<StrokeFile | null>(IPC.PAGE_LOAD, { notebookId, pageId: page.id })
    const strokes = strokeFile?.strokes ?? []
    const images  = strokeFile?.images ?? []

    let canvasW: number, canvasH: number, outputPage: import('pdf-lib').PDFPage

    if (isPDFNotebook) {
      if (!pdfDocRef.current) {
        throw new Error('No se pudo exportar: el documento PDF no está cargado.')
      }
      // Use PDF dimensions from pdfjs document
      const pdfPage = await pdfDocRef.current.getPage(i + 1)
      const vp = pdfPage.getViewport({ scale: PDF_RENDER_SCALE })
      canvasW = Math.round(vp.width)
      canvasH = Math.round(vp.height)
      outputPage = outputDoc.getPages()[i]
    } else {
      // Non-PDF page: use stored dimensions (in 300DPI pixels)
      canvasW = page.width
      canvasH = page.height
      const ptW = Math.round(page.width * 72 / 300)
      const ptH = Math.round(page.height * 72 / 300)
      outputPage = outputDoc.addPage([ptW, ptH])
    }

    // Skip pages with nothing to overlay (keeps the original PDF page clean)
    if (strokes.length === 0 && images.length === 0 && isPDFNotebook) continue

    // Render template + images + strokes to an OffscreenCanvas
    // (transparent background for PDF pages, template for others)
    const offscreen = new OffscreenCanvas(canvasW, canvasH)
    const ctx = offscreen.getContext('2d') as unknown as CanvasRenderingContext2D
    const template = isPDFNotebook ? 'pdf' as const : page.template
    renderTemplate(ctx, template, canvasW, canvasH)
    await drawImages(ctx, images)
    const pdfMode = template === 'pdf'
    for (const stroke of strokes) renderStroke(ctx, stroke, 0, pdfMode)

    // Export as PNG and embed
    const blob = await (offscreen as unknown as { convertToBlob(opts?: unknown): Promise<Blob> })
      .convertToBlob({ type: 'image/png' })
    const pngBytes = new Uint8Array(await blob.arrayBuffer())
    const pngImage = await outputDoc.embedPng(pngBytes)
    const { width: outW, height: outH } = outputPage.getSize()
    outputPage.drawImage(pngImage, { x: 0, y: 0, width: outW, height: outH })
  }

  const outputBytes = await outputDoc.save()
  await ipc(IPC.PDF_EXPORT_SAVE, { filePath: savePath, bytes: Array.from(outputBytes) })
}
