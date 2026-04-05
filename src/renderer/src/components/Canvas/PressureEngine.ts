import type { PressureCurve } from '@shared/types'

const MIN_FACTOR = 0.15
const MAX_FACTOR = 2.0

/**
 * Map a raw pressure value (0–1) to a rendered line width.
 *
 * Curves:
 *  - linear : width = base × p              (1:1 mapping)
 *  - smooth  : width = base × p^0.7         (default, feels natural)
 *  - firm    : width = base × p^1.3         (needs more force for thick lines)
 *
 * Width is clamped to [base × 0.15, base × 2.0] so the stroke never
 * disappears and never grows unboundedly.
 */
export function getWidth(
  pressure: number,
  baseWidth: number,
  curve: PressureCurve = 'smooth'
): number {
  const p = Math.max(0, Math.min(1, pressure))

  let factor: number
  switch (curve) {
    case 'linear':
      factor = p
      break
    case 'smooth':
      factor = Math.pow(p, 0.7)
      break
    case 'firm':
      factor = Math.pow(p, 1.3)
      break
  }

  return baseWidth * Math.min(MAX_FACTOR, Math.max(MIN_FACTOR, factor))
}

/** Linearly interpolate between two pressure-derived widths. */
export function lerpWidth(
  p1: number,
  p2: number,
  t: number,
  baseWidth: number,
  curve: PressureCurve = 'smooth'
): number {
  const w1 = getWidth(p1, baseWidth, curve)
  const w2 = getWidth(p2, baseWidth, curve)
  return w1 + (w2 - w1) * t
}
