import { IPC } from '@shared/types'
import type { PageMeta, StrokeFile } from '@shared/types'
import { renderAllStrokes } from '../Canvas/StrokeRenderer'
import { PDF_RENDER_SCALE } from '../../hooks/usePDFDocument'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { RefObject } from 'react'

function ipc<T>(channel: string, data?: unknown): Promise<T> {
  return window.electronAPI.invoke<T>(channel, data)
}

export async function exportAnnotatedPDF(
  notebookId: string,
  notebookName: string,
  pages: PageMeta[],
  pdfDocRef: RefObject<PDFDocumentProxy | null>
): Promise<void> {
  const savePath = await ipc<string | null>(IPC.PDF_EXPORT_DIALOG, { defaultName: `${notebookName}-anotado.pdf` })
  if (!savePath) return

  const { PDFDocument } = await import('pdf-lib')
  const isPDFNotebook = pages.length > 0 && pages[0].pdfPath !== null

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

    let canvasW: number, canvasH: number, outputPage: import('pdf-lib').PDFPage

    if (isPDFNotebook && pdfDocRef.current) {
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

    // Render strokes to OffscreenCanvas (transparent bg for PDF, white for others)
    const offscreen = new OffscreenCanvas(canvasW, canvasH)
    const ctx = offscreen.getContext('2d') as unknown as CanvasRenderingContext2D
    const template = isPDFNotebook ? 'pdf' as const : page.template
    renderAllStrokes(ctx, strokes, template)

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
