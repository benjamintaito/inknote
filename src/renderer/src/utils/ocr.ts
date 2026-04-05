/**
 * ocr.ts — Tesseract.js v7 wrapper for on-device handwriting recognition.
 *
 * Design:
 * - Singleton worker (lazy-init, reused across calls to avoid reload overhead)
 * - Pre-processes strokes to a high-contrast black-on-white bitmap
 * - Progress is reported via an optional callback
 * - Does NOT block the main thread for recognition (Tesseract runs in its own worker)
 */

import { createWorker, type Worker } from 'tesseract.js'
import type { Stroke } from '@shared/types'
import { renderAllStrokes } from '../components/Canvas/StrokeRenderer'

// ── Worker singleton ────────────────────────────────────────────────────────────

let _workerPromise: Promise<Worker> | null = null
let _progressCb: ((p: OCRProgress) => void) | null = null

function getWorker(): Promise<Worker> {
  if (!_workerPromise) {
    _workerPromise = createWorker(['spa', 'eng'], 1, {
      logger: (m: { status: string; progress: number }) => {
        if (m.status === 'recognizing text') {
          _progressCb?.({
            status: 'Reconociendo texto…',
            progress: 0.15 + m.progress * 0.85,
          })
        }
      },
    }).catch((err) => {
      _workerPromise = null // Allow retry on next call
      throw err
    })
  }
  return _workerPromise
}

// ── Image pre-processing ────────────────────────────────────────────────────────

/** Render strokes to a full-res canvas (white bg + ink strokes), then downscale. */
function renderStrokesToCanvas(
  strokes: Stroke[],
  width: number,
  height: number
): HTMLCanvasElement {
  // Render at full page resolution using the existing StrokeRenderer
  const full = document.createElement('canvas')
  full.width  = width
  full.height = height
  const ctx = full.getContext('2d')!
  // 'blank' template → white background, then all strokes in their colors
  renderAllStrokes(ctx, strokes, 'blank')

  // Downscale to ~half for faster OCR (still well above Tesseract's 300 DPI recommendation)
  const scale  = 0.5
  const small  = document.createElement('canvas')
  small.width  = Math.round(width  * scale)
  small.height = Math.round(height * scale)
  const sCtx   = small.getContext('2d', { willReadFrequently: true })!
  sCtx.drawImage(full, 0, 0, small.width, small.height)
  return small
}

/**
 * Binarize canvas: any pixel that is "not white" becomes pure black.
 * This normalises all ink colors (even faint highlighter) to solid black,
 * which dramatically improves Tesseract recognition accuracy.
 */
function binarize(canvas: HTMLCanvasElement): void {
  const ctx  = canvas.getContext('2d', { willReadFrequently: true })!
  const img  = ctx.getImageData(0, 0, canvas.width, canvas.height)
  const data = img.data
  for (let i = 0; i < data.length; i += 4) {
    const isWhite = data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240
    const val = isWhite ? 255 : 0
    data[i]     = val
    data[i + 1] = val
    data[i + 2] = val
    data[i + 3] = 255
  }
  ctx.putImageData(img, 0, 0)
}

// ── Public API ──────────────────────────────────────────────────────────────────

export interface OCRProgress {
  status: string
  progress: number // 0–1
}

/**
 * Recognise handwritten text in the given strokes.
 *
 * @param strokes    Stroke data for the page
 * @param width      Page width in canvas units
 * @param height     Page height in canvas units
 * @param onProgress Optional progress callback (0–1)
 * @returns          Recognised text (may be empty)
 */
export async function recognizeText(
  strokes: Stroke[],
  width: number,
  height: number,
  onProgress?: (p: OCRProgress) => void
): Promise<string> {
  const inkStrokes = strokes.filter((s) => s.tool !== 'eraser')
  if (inkStrokes.length === 0) return ''

  onProgress?.({ status: 'Preparando imagen…', progress: 0 })
  const canvas = renderStrokesToCanvas(strokes, width, height)
  binarize(canvas)

  onProgress?.({ status: 'Cargando motor OCR…', progress: 0.1 })
  _progressCb = onProgress ?? null

  try {
    const worker = await getWorker()
    const { data } = await worker.recognize(canvas)
    return data.text.trim()
  } finally {
    _progressCb = null
  }
}

/** Release the singleton worker (call on app unload if needed). */
export async function terminateOCRWorker(): Promise<void> {
  if (_workerPromise) {
    const w = await _workerPromise.catch(() => null)
    await w?.terminate()
    _workerPromise = null
  }
}
