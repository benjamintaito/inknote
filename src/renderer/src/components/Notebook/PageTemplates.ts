import type { PageTemplate } from '@shared/types'

// ── Template constants (canvas is 2480×3508, i.e. A4 at 300 DPI) ──────────────
//
// All measurements are in canvas pixels.
// 1 mm = 300/25.4 ≈ 11.81 px at 300 DPI
// 5 mm ≈ 59 px  → rounded to 60 px for spacing

const LINE_COLOR   = '#C0C0C0'   // visible mid-grey
const MARGIN_COLOR = '#E8A0A0'   // soft red
const DOT_RADIUS   = 3           // 3 px dot, clearly visible
const SPACING      = 60          // ~5 mm between grid lines / dots
const LINED_SPACING = 64         // ~5.4 mm between ruled lines
const LINE_WIDTH   = 1.5         // visible line thickness
const HEADER_H     = SPACING * 2 // blank space above first ruled line
const MARGIN_X     = 160         // red margin position (≈13.5 mm from left)

/**
 * Draw a page template onto a 2D context.
 * Always fills white first so it can be called on a dirty canvas.
 */
export function renderTemplate(
  ctx: CanvasRenderingContext2D,
  template: PageTemplate,
  width: number,
  height: number
): void {
  ctx.clearRect(0, 0, width, height)
  if (template === 'pdf') return   // transparent, no white fill
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  if (template === 'blank') return

  ctx.save()

  switch (template) {
    case 'lined': {
      ctx.strokeStyle = LINE_COLOR
      ctx.lineWidth = LINE_WIDTH
      for (let y = HEADER_H; y < height; y += LINED_SPACING) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(width, y)
        ctx.stroke()
      }
      // Red vertical margin line
      ctx.strokeStyle = MARGIN_COLOR
      ctx.lineWidth = 1.5
      ctx.beginPath()
      ctx.moveTo(MARGIN_X, 0)
      ctx.lineTo(MARGIN_X, height)
      ctx.stroke()
      break
    }

    case 'grid': {
      ctx.strokeStyle = LINE_COLOR
      ctx.lineWidth = LINE_WIDTH
      for (let x = SPACING; x < width; x += SPACING) {
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke()
      }
      for (let y = SPACING; y < height; y += SPACING) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
      }
      break
    }

    case 'dotted': {
      ctx.fillStyle = LINE_COLOR
      for (let x = SPACING; x < width; x += SPACING) {
        for (let y = SPACING; y < height; y += SPACING) {
          ctx.beginPath()
          ctx.arc(x, y, DOT_RADIUS, 0, Math.PI * 2)
          ctx.fill()
        }
      }
      break
    }
  }

  ctx.restore()
}

/** Tiny visual preview of a template drawn into a small canvas element */
export function renderTemplatePreview(
  ctx: CanvasRenderingContext2D,
  template: PageTemplate,
  width: number,
  height: number
): void {
  // Scale spacings down to fit the preview canvas (base width = 2480)
  const scale = width / 2480
  const sp    = Math.max(4, SPACING * scale)
  const lsp   = Math.max(4, LINED_SPACING * scale)

  ctx.clearRect(0, 0, width, height)
  ctx.fillStyle = '#ffffff'
  ctx.fillRect(0, 0, width, height)

  ctx.save()
  ctx.strokeStyle = LINE_COLOR
  ctx.fillStyle   = LINE_COLOR
  ctx.lineWidth   = 0.5

  switch (template) {
    case 'lined':
      for (let y = lsp * 2; y < height; y += lsp) {
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke()
      }
      ctx.strokeStyle = MARGIN_COLOR
      ctx.beginPath(); ctx.moveTo(sp, 0); ctx.lineTo(sp, height); ctx.stroke()
      break

    case 'grid':
      for (let x = sp; x < width; x += sp) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke() }
      for (let y = sp; y < height; y += sp) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke() }
      break

    case 'dotted':
      for (let x = sp; x < width; x += sp)
        for (let y = sp; y < height; y += sp) {
          ctx.beginPath(); ctx.arc(x, y, 1.5, 0, Math.PI * 2); ctx.fill()
        }
      break

    case 'pdf': break

    default: break
  }

  ctx.restore()
}
