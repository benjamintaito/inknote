import type { Point } from '@shared/types'

// ── Moving average pressure smoothing ──────────────────────────────────────────

function smoothPressure(points: Point[], window = 3): Point[] {
  if (points.length < 2) return points
  const half = Math.floor(window / 2)
  return points.map((p, i) => {
    let sum = 0
    let count = 0
    for (let j = Math.max(0, i - half); j <= Math.min(points.length - 1, i + half); j++) {
      sum += points[j].pressure
      count++
    }
    return { ...p, pressure: sum / count }
  })
}

// ── Catmull-Rom spline ─────────────────────────────────────────────────────────
//
// Standard uniform Catmull-Rom with configurable tension (tau).
// Basis functions for segment from p1→p2 (t ∈ [0,1]):
//   b0(t) = τ(-t³ + 2t² - t)
//   b1(t) = (2-τ)t³ + (τ-3)t² + 1
//   b2(t) = (τ-2)t³ + (3-2τ)t² + τt
//   b3(t) = τ(t³ - t²)

function catmullRomPoint(
  p0: Point,
  p1: Point,
  p2: Point,
  p3: Point,
  t: number,
  tau: number
): Point {
  const t2 = t * t
  const t3 = t2 * t

  const b0 = tau * (-t3 + 2 * t2 - t)
  const b1 = (2 - tau) * t3 + (tau - 3) * t2 + 1
  const b2 = (tau - 2) * t3 + (3 - 2 * tau) * t2 + tau * t
  const b3 = tau * (t3 - t2)

  return {
    x: b0 * p0.x + b1 * p1.x + b2 * p2.x + b3 * p3.x,
    y: b0 * p0.y + b1 * p1.y + b2 * p2.y + b3 * p3.y,
    pressure: b0 * p0.pressure + b1 * p1.pressure + b2 * p2.pressure + b3 * p3.pressure,
    tiltX: lerp(p1.tiltX ?? 0, p2.tiltX ?? 0, t),
    tiltY: lerp(p1.tiltY ?? 0, p2.tiltY ?? 0, t),
    timestamp: lerp(p1.timestamp, p2.timestamp, t),
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

function segmentLength(p1: Point, p2: Point): number {
  const dx = p2.x - p1.x
  const dy = p2.y - p1.y
  return Math.sqrt(dx * dx + dy * dy)
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Smooth an array of raw input points using Catmull-Rom spline interpolation
 * and a 3-point moving average on pressure.
 *
 * @param points  Raw points from the digitizer
 * @param tension 0–1, default 0.5. Higher = more curvature/"swing".
 * @returns       Smoothed points suitable for rendering
 */
export function smoothPoints(points: Point[], tension = 0.5): Point[] {
  if (points.length < 2) return points

  // First pass: smooth pressure with moving average
  const pp = smoothPressure(points, 3)

  if (pp.length === 2) return pp

  const result: Point[] = [pp[0]]

  for (let i = 0; i < pp.length - 1; i++) {
    const p0 = pp[Math.max(0, i - 1)]
    const p1 = pp[i]
    const p2 = pp[i + 1]
    const p3 = pp[Math.min(pp.length - 1, i + 2)]

    // Adaptive number of interpolated points based on segment length.
    // One extra point per 4px keeps curves smooth without over-sampling.
    const dist = segmentLength(p1, p2)
    const steps = Math.max(1, Math.ceil(dist / 4))

    for (let s = 1; s <= steps; s++) {
      result.push(catmullRomPoint(p0, p1, p2, p3, s / steps, tension))
    }
  }

  return result
}

/**
 * Lightweight smoothing for the live preview: only smooth the last N points
 * instead of re-computing the entire stroke on every move event.
 *
 * @param points  Full stroke point array (mutated in place for performance)
 * @param lookback How many tail points to re-smooth (default 6)
 */
export function smoothTail(points: Point[], lookback = 6): Point[] {
  if (points.length < 4) return smoothPoints(points)
  const head = points.slice(0, Math.max(0, points.length - lookback))
  const tail = points.slice(Math.max(0, points.length - lookback))
  return [...head, ...smoothPoints(tail)]
}
