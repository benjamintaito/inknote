/**
 * PalmRejection — filters out accidental palm/finger touches when using a stylus.
 *
 * Rules (in evaluation order):
 *  1. If pointerType === "pen" is active, reject ALL "touch" events.
 *  2. If a touch contact is wider/taller than maxTouchSize, reject (palm).
 *  3. If a touch arrives within penCooldownMs after the last pen event, reject.
 *  4. If more than 1 simultaneous touch exists while pen is/was active, reject all touch.
 */
export interface PalmRejectionOptions {
  /** ms to consider pen "still active" after liftoff. Default: 500 */
  penCooldownMs?: number
  /** px threshold for contact size. Default: 20 */
  maxTouchSize?: number
}

export class PalmRejection {
  private isPenDown = false
  private lastPenEventMs = 0
  private activeTouchIds = new Set<number>()
  private readonly cooldown: number
  private readonly maxSize: number
  private cooldownTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: PalmRejectionOptions = {}) {
    this.cooldown = options.penCooldownMs ?? 500
    this.maxSize = options.maxTouchSize ?? 20
  }

  /**
   * Returns true if this event should be PROCESSED (not rejected).
   * Must be called for EVERY pointer event — including pointerup — to keep state consistent.
   */
  shouldProcess(e: PointerEvent): boolean {
    const { pointerType, type, pointerId, width, height, timeStamp } = e

    // ── Pen events: always process, update state ──────────────────────────────
    if (pointerType === 'pen') {
      this.lastPenEventMs = timeStamp
      if (type === 'pointerdown') {
        this.isPenDown = true
        if (this.cooldownTimer !== null) {
          clearTimeout(this.cooldownTimer)
          this.cooldownTimer = null
        }
      } else if (type === 'pointerup' || type === 'pointercancel') {
        this.isPenDown = false
        // Keep pen "active" for cooldown period to reject phantom touches
        if (this.cooldownTimer !== null) clearTimeout(this.cooldownTimer)
        this.cooldownTimer = setTimeout(() => {
          this.cooldownTimer = null
        }, this.cooldown)
      }
      return true
    }

    // ── Mouse events: always process ──────────────────────────────────────────
    if (pointerType === 'mouse') return true

    // ── Touch events: apply all rejection rules ────────────────────────────────
    if (type === 'pointerdown') this.activeTouchIds.add(pointerId)
    else if (type === 'pointerup' || type === 'pointercancel') this.activeTouchIds.delete(pointerId)

    // Rule 1: pen is currently down
    if (this.isPenDown) return false

    // Rule 2: large contact area → palm
    if (width > this.maxSize || height > this.maxSize) return false

    // Rule 3: too soon after pen liftoff
    if (timeStamp - this.lastPenEventMs < this.cooldown) return false

    // Rule 4: multiple simultaneous touches while pen was recently active
    if (this.activeTouchIds.size > 1 && this.cooldownTimer !== null) return false

    return true
  }

  dispose() {
    if (this.cooldownTimer !== null) clearTimeout(this.cooldownTimer)
  }
}
