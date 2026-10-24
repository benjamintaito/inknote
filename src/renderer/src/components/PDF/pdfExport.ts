import { IPC } from '@shared/types'
import type { PageMeta, PageImage, StrokeFile } from '@shared/types'
import type { PDFDocument, PDFPage } from 'pdf-lib'
import { renderStroke } from '../Canvas/StrokeRenderer'
import { renderTemplate } from '../Notebook/PageTemplates'
import { PDF_RENDER_SCALE } from '../../hooks/usePDFDocument'
import { useNotebookStore } from '../../stores/notebookStore'

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

/** Rasterize template + images + strokes into PNG bytes. */
async function renderAnnotationPng(
  width: number,
  height: number,
  template: PageMeta['template'],
  strokes: StrokeFile['strokes'],
  images: PageImage[]
): Promise<Uint8Array> {
  const offscreen = new OffscreenCanvas(width, height)
  const ctx = offscreen.getContext('2d') as unknown as CanvasRenderingContext2D
  renderTemplate(ctx, template, width, height)
  await drawImages(ctx, images)
  const pdfMode = template === 'pdf'
  for (const stroke of strokes) renderStroke(ctx, stroke, 0, pdfMode)
  const blob = await offscreen.convertToBlob({ type: 'image/png' })
  return new Uint8Array(await blob.arrayBuffer())
}

// ── PDF page geometry ──────────────────────────────────────────────────────────

/**
 * Overlay an annotation image onto a (possibly rotated) PDF page.
 *
 * Annotations were drawn on the page as pdf.js displays it: crop box, with
 * /Rotate applied. pdf-lib draws in unrotated user space, so the image has
 * to be counter-rotated and anchored at the corner that ends up top-left.
 */
function displaySize(page: PDFPage): { width: number; height: number; rotation: number } {
  const box = page.getCropBox()
  const rotation = ((page.getRotation().angle % 360) + 360) % 360
  const swap = rotation === 90 || rotation === 270
  return {
    width:  swap ? box.height : box.width,
    height: swap ? box.width  : box.height,
    rotation,
  }
}

async function drawOverlay(doc: PDFDocument, page: PDFPage, png: Uint8Array): Promise<void> {
  const { degrees } = await import('pdf-lib')
  const image = await doc.embedPng(png)
  const box = page.getCropBox()
  const { width, height, rotation } = displaySize(page)
  // Bottom-left corner of the displayed page, expressed in user space
  const origin =
    rotation === 90  ? { x: box.x + box.width, y: box.y } :
    rotation === 180 ? { x: box.x + box.width, y: box.y + box.height } :
    rotation === 270 ? { x: box.x,             y: box.y + box.height } :
                       { x: box.x,             y: box.y }
  page.drawImage(image, { ...origin, width, height, rotate: degrees(rotation) })
}

// ── Export ─────────────────────────────────────────────────────────────────────

let exportInProgress = false

/**
 * Export a notebook as a PDF with all annotations (strokes + inserted images)
 * rasterized as a PNG overlay per page.
 *
 * Pages are exported in notebook order:
 * - PDF-backed pages copy their source PDF page and get the overlay on top.
 * - Regular pages are created from scratch with their template.
 *
 * Errors are reported through the notebook store's `error` field.
 */
export async function exportAnnotatedPDF(
  notebookId: string,
  notebookName: string,
  pages: PageMeta[]
): Promise<void> {
  if (exportInProgress) return
  exportInProgress = true
  try {
    if (pages.length === 0) {
      throw new Error('el cuaderno no tiene páginas.')
    }

    const savePath = await ipc<string | null>(IPC.PDF_EXPORT_DIALOG, { defaultName: `${notebookName}-anotado.pdf` })
    if (!savePath) return

    // Flush any unsaved strokes so the export reflects what's on screen
    await useNotebookStore.getState().saveCurrentPage()

    const { PDFDocument: PDFDoc } = await import('pdf-lib')
    const outputDoc = await PDFDoc.create()
    const sourceDocs = new Map<string, PDFDocument>()

    const loadSource = async (path: string): Promise<PDFDocument> => {
      let doc = sourceDocs.get(path)
      if (!doc) {
        const bytes = await ipc<Uint8Array>(IPC.PDF_READ_BYTES, { filePath: path })
        doc = await PDFDoc.load(bytes, { ignoreEncryption: true })
        sourceDocs.set(path, doc)
      }
      return doc
    }

    for (const page of pages) {
      const strokeFile = await ipc<StrokeFile | null>(IPC.PAGE_LOAD, { notebookId, pageId: page.id })
      const strokes = strokeFile?.strokes ?? []
      const images  = strokeFile?.images ?? []
      const hasAnnotations = strokes.length > 0 || images.length > 0

      if (page.pdfPath) {
        const src = await loadSource(page.pdfPath)
        const index = page.pdfPageIndex ?? page.pageOrder
        if (index < 0 || index >= src.getPageCount()) {
          throw new Error(`la página ${index + 1} no existe en el PDF original.`)
        }
        const [copied] = await outputDoc.copyPages(src, [index])
        outputDoc.addPage(copied)

        // Keep pages without annotations untouched
        if (!hasAnnotations) continue

        // Same canvas size the annotator used (pdf.js viewport at PDF_RENDER_SCALE)
        const { width, height } = displaySize(copied)
        const png = await renderAnnotationPng(
          Math.floor(width * PDF_RENDER_SCALE),
          Math.floor(height * PDF_RENDER_SCALE),
          'pdf', strokes, images
        )
        await drawOverlay(outputDoc, copied, png)
      } else {
        // Non-PDF page: stored dimensions are 300 DPI pixels
        const ptW = Math.round(page.width * 72 / 300)
        const ptH = Math.round(page.height * 72 / 300)
        const outputPage = outputDoc.addPage([ptW, ptH])
        const png = await renderAnnotationPng(page.width, page.height, page.template, strokes, images)
        await drawOverlay(outputDoc, outputPage, png)
      }
    }

    const outputBytes = await outputDoc.save()
    await ipc(IPC.PDF_EXPORT_SAVE, { filePath: savePath, bytes: outputBytes })
  } catch (e) {
    console.error('[InkNote] PDF export failed:', e)
    const msg = e instanceof Error ? e.message : String(e)
    useNotebookStore.setState({ error: `No se pudo exportar el PDF: ${msg}` })
  } finally {
    exportInProgress = false
  }
}
