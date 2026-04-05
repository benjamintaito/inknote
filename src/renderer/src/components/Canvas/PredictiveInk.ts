import type { Point } from '@shared/types'

/**
 * Extrapolates `count` predicted points beyond the current stroke.
 *
 * Algorithm:
 * 1. Take the last (up to) 4 points.
 * 2. Compute weighted average velocity across consecutive pairs —
 *    more weight given to more-recent pairs.
 * 3. Estimate the time-step from recent intervals (clamped 8–33 ms).
 * 4. Extrapolate `count` points forward, damping velocity by 0.55 each step.
 */
export function predictNextPoints(recentPoints: Point[], count = 2): Point[] {
  if (recentPoints.length < 2) return []

  // Work with the last 4 points
  const pts = recentPoints.slice(-4)
  const n = pts.length

  // Build weighted velocity from consecutive pairs
  // Weight increases for more-recent pairs: pair at index i gets weight (i+1)
  let totalWeight = 0
  let vxWeighted = 0
  let vyWeighted = 0
  let totalDt = 0
  let dtCount = 0

  for (let i = 0; i < n - 1; i++) {
    const a = pts[i]
    const b = pts[i + 1]
    const dt = b.timestamp - a.timestamp
    if (dt <= 0) continue

    const weight = i + 1 // more weight for recent pairs
    vxWeighted += ((b.x - a.x) / dt) * weight
    vyWeighted += ((b.y - a.y) / dt) * weight
    totalWeight += weight
    totalDt += dt
    dtCount++
  }

  if (totalWeight === 0 || dtCount === 0) return []

  const vx = vxWeighted / totalWeight
  const vy = vyWeighted / totalWeight

  // Estimate step duration (ms), clamped to 8–33 ms
  const avgDt = Math.min(33, Math.max(8, totalDt / dtCount))

  const last = pts[n - 1]
  const results: Point[] = []
  let curVx = vx
  let curVy = vy
  let curX = last.x
  let curY = last.y
  let curTime = last.timestamp

  for (let i = 0; i < count; i++) {
    curX += curVx * avgDt
    curY += curVy * avgDt
    curTime += avgDt
    curVx *= 0.55
    curVy *= 0.55

    results.push({
      x: curX,
      y: curY,
      pressure: last.pressure,
      tiltX: last.tiltX,
      tiltY: last.tiltY,
      timestamp: curTime,
    })
  }

  return results
}
