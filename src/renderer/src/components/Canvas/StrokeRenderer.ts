import type { Stroke, PageTemplate } from '@shared/types'
import { getWidth } from './PressureEngine'
import { renderTemplate } from '../Notebook/PageTemplates'

// ── Deterministic pseudo-random (consistent across redraws) ────────────────────

function hashStr(str: string): number {
  let h = 0
  for (let i = 0; i < Math.min(str.length, 16); i++) {
    h = (Math.imul(31, h) + str.charCodeAt(i)) | 0
  }
  return h
}

function rng(seed: number): number {
  const x = Math.sin(seed) * 43758.5453123
  return x - Math.floor(x)
}

// ── Pen (solid, pressure-sensitive) ───────────────────────────────────────────

function renderDot(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const p = stroke.points[0]
  const r = getWidth(p.pressure, stroke.baseWidth, stroke.pressureCurve) / 2
  ctx.beginPath()
  ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
  ctx.fillStyle = stroke.color
  ctx.fill()
}

function renderPenStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  fromIndex = 0
): void {
  const { points, color, baseWidth, pressureCurve } = stroke
  if (points.length === 0) return
  if (points.length === 1) { renderDot(ctx, stroke); return }

  ctx.strokeStyle = color
  const n = points.length
  const start = Math.max(0, fromIndex)

  // Midpoint quadratic bezier: each point is a control point, endpoints are
  // midpoints between consecutive points. This eliminates angular joints.
  for (let i = start; i < n; i++) {
    const p = points[i]
    const startX = i === 0 ? p.x : (points[i - 1].x + p.x) / 2
    const startY = i === 0 ? p.y : (points[i - 1].y + p.y) / 2
    const endX   = i === n - 1 ? p.x : (p.x + points[i + 1].x) / 2
    const endY   = i === n - 1 ? p.y : (p.y + points[i + 1].y) / 2

    ctx.lineWidth = getWidth(p.pressure, baseWidth, pressureCurve)
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    ctx.quadraticCurveTo(p.x, p.y, endX, endY)
    ctx.stroke()
  }
}

// ── Pencil (grainy, pressure-driven opacity) ───────────────────────────────────

function renderPencilStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points, color, baseWidth, pressureCurve, opacity } = stroke
  if (points.length === 0) return

  const seed = hashStr(stroke.id)
  ctx.strokeStyle = color
  ctx.lineCap = 'round'

  if (points.length === 1) {
    const p = points[0]
    const r = getWidth(p.pressure, baseWidth * 0.8, pressureCurve) / 2
    ctx.globalAlpha = (0.5 + p.pressure * 0.4) * opacity
    ctx.fillStyle = color
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.fill()
    return
  }

  const n = points.length
  for (let i = 0; i < n; i++) {
    const p = points[i]
    const pressure = p.pressure
    const w = getWidth(pressure, baseWidth * 0.85, pressureCurve)
    const noise = rng(seed + i * 7) * 0.2 - 0.1

    const startX = i === 0 ? p.x : (points[i - 1].x + p.x) / 2
    const startY = i === 0 ? p.y : (points[i - 1].y + p.y) / 2
    const endX   = i === n - 1 ? p.x : (p.x + points[i + 1].x) / 2
    const endY   = i === n - 1 ? p.y : (p.y + points[i + 1].y) / 2

    // Main stroke segment — pressure-dependent opacity + bezier smoothing
    ctx.globalAlpha = Math.min(1, (0.45 + pressure * 0.45 + noise)) * opacity
    ctx.lineWidth = w * (0.65 + rng(seed + i * 3 + 1) * 0.55)
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    ctx.quadraticCurveTo(p.x, p.y, endX, endY)
    ctx.stroke()

    // Occasional grain fiber
    if (rng(seed + i * 13 + 5) < 0.3) {
      const gx = (rng(seed + i * 17) - 0.5) * w * 1.8
      const gy = (rng(seed + i * 17 + 1) - 0.5) * w * 1.8
      ctx.globalAlpha = (0.04 + rng(seed + i * 19) * 0.1) * opacity
      ctx.lineWidth = 0.3 + rng(seed + i * 23) * 0.5
      ctx.beginPath()
      ctx.moveTo(p.x, p.y)
      ctx.lineTo(p.x + gx, p.y + gy)
      ctx.stroke()
    }
  }
}

// ── Fountain pen (calligraphic, angle-dependent width) ─────────────────────────

function renderFountainStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points, color, baseWidth, pressureCurve } = stroke
  if (points.length === 0) return
  if (points.length === 1) { renderDot(ctx, stroke); return }

  ctx.strokeStyle = color
  const NIB_ANGLE = Math.PI / 4  // 45° nib
  const n = points.length

  for (let i = 0; i < n; i++) {
    const p = points[i]
    // Estimate motion direction using neighbouring points
    const prev = i > 0 ? points[i - 1] : p
    const next = i < n - 1 ? points[i + 1] : p
    const dx = next.x - prev.x
    const dy = next.y - prev.y
    const angle = Math.atan2(dy, dx)
    // Vertical strokes → thick, horizontal → thin (calligraphy nib effect)
    const widthFactor = 0.35 + 0.95 * Math.abs(Math.sin(angle - NIB_ANGLE))

    const startX = i === 0 ? p.x : (prev.x + p.x) / 2
    const startY = i === 0 ? p.y : (prev.y + p.y) / 2
    const endX   = i === n - 1 ? p.x : (p.x + next.x) / 2
    const endY   = i === n - 1 ? p.y : (p.y + next.y) / 2

    ctx.lineWidth = getWidth(p.pressure, baseWidth, pressureCurve) * widthFactor
    ctx.beginPath()
    ctx.moveTo(startX, startY)
    ctx.quadraticCurveTo(p.x, p.y, endX, endY)
    ctx.stroke()
  }
}

// ── Highlighter (flat-cap, constant width, multiply blend) ─────────────────────

function renderHighlighterStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  pdfMode: boolean
): void {
  const { points, color, baseWidth } = stroke
  if (points.length === 0) return

  if (pdfMode) {
    ctx.globalCompositeOperation = 'source-over'
    ctx.globalAlpha = 0.35
  } else {
    ctx.globalCompositeOperation = 'multiply'
    ctx.globalAlpha = 0.3
  }
  ctx.strokeStyle = color
  ctx.lineWidth = baseWidth
  ctx.lineCap = 'butt'    // flat ends — real marker look
  ctx.lineJoin = 'miter'

  if (points.length === 1) {
    const p = points[0]
    ctx.fillStyle = color
    ctx.fillRect(p.x - baseWidth / 2, p.y - baseWidth / 2, baseWidth, baseWidth)
    return
  }

  // Single continuous bezier path — smooth corners, no double-darkening
  const n = points.length
  ctx.beginPath()
  ctx.moveTo(points[0].x, points[0].y)
  if (n === 2) {
    ctx.lineTo(points[1].x, points[1].y)
  } else {
    // Line to first midpoint, then bezier through interior points
    ctx.lineTo((points[0].x + points[1].x) / 2, (points[0].y + points[1].y) / 2)
    for (let i = 1; i < n - 1; i++) {
      const p = points[i]
      const midX = (p.x + points[i + 1].x) / 2
      const midY = (p.y + points[i + 1].y) / 2
      ctx.quadraticCurveTo(p.x, p.y, midX, midY)
    }
    ctx.lineTo(points[n - 1].x, points[n - 1].y)
  }
  ctx.stroke()
}

// ── Watercolor (wet brush, multi-pass jitter) ──────────────────────────────────

function renderWatercolorStroke(ctx: CanvasRenderingContext2D, stroke: Stroke): void {
  const { points, color, baseWidth, pressureCurve, opacity } = stroke
  if (points.length === 0) return

  const seed = hashStr(stroke.id)
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'
  ctx.strokeStyle = color

  if (points.length === 1) {
    const p = points[0]
    const r = getWidth(p.pressure, baseWidth * 1.5, pressureCurve) / 2
    ctx.globalAlpha = 0.1 * opacity
    ctx.beginPath()
    ctx.arc(p.x, p.y, r, 0, Math.PI * 2)
    ctx.stroke()
    return
  }

  // 3 passes: each with lower jitter, slightly higher opacity
  const n = points.length
  for (let pass = 0; pass < 3; pass++) {
    const jitterScale = (3 - pass) * 2.0
    for (let i = 0; i < n; i++) {
      const p = points[i]
      const pressure = p.pressure
      const w = getWidth(pressure, baseWidth * 1.4, pressureCurve)

      const s = seed + pass * 8192 + i * 17
      const jx = (rng(s) - 0.5) * jitterScale
      const jy = (rng(s + 1) - 0.5) * jitterScale

      const prevP = i > 0 ? points[i - 1] : p
      const nextP = i < n - 1 ? points[i + 1] : p
      const js2 = seed + pass * 8192 + (i - 1) * 17
      const pjx = i > 0 ? (rng(js2) - 0.5) * jitterScale : jx
      const pjy = i > 0 ? (rng(js2 + 1) - 0.5) * jitterScale : jy
      const njs = seed + pass * 8192 + (i + 1) * 17
      const njx = i < n - 1 ? (rng(njs) - 0.5) * jitterScale : jx
      const njy = i < n - 1 ? (rng(njs + 1) - 0.5) * jitterScale : jy

      const startX = i === 0 ? p.x + jx : ((prevP.x + pjx) + (p.x + jx)) / 2
      const startY = i === 0 ? p.y + jy : ((prevP.y + pjy) + (p.y + jy)) / 2
      const endX   = i === n - 1 ? p.x + jx : ((p.x + jx) + (nextP.x + njx)) / 2
      const endY   = i === n - 1 ? p.y + jy : ((p.y + jy) + (nextP.y + njy)) / 2

      ctx.globalAlpha = (0.06 + pass * 0.025) * (0.7 + rng(s + 4) * 0.6) * opacity
      ctx.lineWidth = w * (0.4 + rng(s + 5) * 1.0)
      ctx.beginPath()
      ctx.moveTo(startX, startY)
      ctx.quadraticCurveTo(p.x + jx, p.y + jy, endX, endY)
      ctx.stroke()
    }
  }
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Render a single stroke onto the given context.
 * Each tool type delegates to its own specialised renderer.
 *
 * @param ctx       Target 2D context (already at 1:1 canvas scale)
 * @param stroke    Stroke data (already smoothed for live preview)
 * @param fromIndex Only render pen/eraser segments from this index onward
 * @param pdfMode   Use source-over instead of multiply for highlighter
 */
export function renderStroke(
  ctx: CanvasRenderingContext2D,
  stroke: Stroke,
  fromIndex = 0,
  pdfMode = false
): void {
  const { tool, opacity } = stroke
  if (stroke.points.length === 0) return

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  switch (tool) {
    case 'pen':
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = opacity
      renderPenStroke(ctx, stroke, fromIndex)
      break

    case 'pencil':
      ctx.globalCompositeOperation = 'source-over'
      // Individual segments control their own globalAlpha inside renderPencilStroke
      renderPencilStroke(ctx, stroke)
      break

    case 'fountain':
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = opacity
      renderFountainStroke(ctx, stroke)
      break

    case 'highlighter':
      renderHighlighterStroke(ctx, stroke, pdfMode)
      break

    case 'watercolor':
      ctx.globalCompositeOperation = 'source-over'
      // Individual passes control their own globalAlpha inside renderWatercolorStroke
      renderWatercolorStroke(ctx, stroke)
      break

    case 'eraser':
      // Legacy eraser strokes stored in old notebooks
      ctx.globalCompositeOperation = 'destination-out'
      ctx.globalAlpha = 1
      renderPenStroke(ctx, stroke, fromIndex)
      break

    default:
      ctx.globalCompositeOperation = 'source-over'
      ctx.globalAlpha = opacity
      renderPenStroke(ctx, stroke, fromIndex)
  }

  ctx.restore()
}

/**
 * Clear the canvas, draw the page template, then re-render every stroke.
 */
export function renderAllStrokes(
  ctx: CanvasRenderingContext2D,
  strokes: Stroke[],
  template: PageTemplate = 'blank'
): void {
  const pdfMode = template === 'pdf'
  renderTemplate(ctx, template, ctx.canvas.width, ctx.canvas.height)
  for (const stroke of strokes) {
    renderStroke(ctx, stroke, 0, pdfMode)
  }
}
