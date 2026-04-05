import type { PalmRejection } from './PalmRejection'

export interface RawPoint {
  x: number
  y: number
  pressure: number
  tiltX: number
  tiltY: number
  pointerType: string
  width: number
  height: number
  pointerId: number
  timestamp: number
}

export interface PenInputHandlerOptions {
  /** Container-relative coordinates of the stroke start */
  onStrokeStart: (point: RawPoint) => void
  onStrokeMove: (point: RawPoint) => void
  onStrokeEnd: (point: RawPoint) => void
  /** Optional: two-finger pan gestures (for touch) */
  onPanStart?: (e: PointerEvent) => void
  onPanMove?: (e: PointerEvent) => void
  onPanEnd?: (e: PointerEvent) => void
}

/**
 * PenInputHandler — low-latency Pointer Events capture.
 *
 * Attaches to a container element (no CSS transform expected on it).
 * Uses getCoalescedEvents() where available for maximum fidelity.
 * Integrates PalmRejection before emitting callbacks.
 */
export class PenInputHandler {
  private readonly el: HTMLElement
  private readonly opts: PenInputHandlerOptions
  private readonly palm: PalmRejection | null
  private activePointerId: number | null = null

  constructor(
    element: HTMLElement,
    options: PenInputHandlerOptions,
    palmRejection?: PalmRejection
  ) {
    this.el = element
    this.opts = options
    this.palm = palmRejection ?? null
    this.attach()
  }

  // ── Coordinate extraction ──────────────────────────────────────────────────

  private toRaw(e: PointerEvent): RawPoint {
    const rect = this.el.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
      // Some digitizers report 0 for pressure until first move — default to 0.5
      pressure: e.pressure > 0 ? e.pressure : 0.5,
      tiltX: e.tiltX ?? 0,
      tiltY: e.tiltY ?? 0,
      pointerType: e.pointerType,
      width: e.width,
      height: e.height,
      pointerId: e.pointerId,
      timestamp: e.timeStamp,
    }
  }

  // ── Event handlers ─────────────────────────────────────────────────────────

  private readonly onDown = (e: PointerEvent): void => {
    // Only pen/mouse can start strokes — touch is handled by TouchGestureHandler
    if (e.pointerType === 'touch') return
    // Only start a new stroke when idle
    if (this.activePointerId !== null) return
    if (this.palm && !this.palm.shouldProcess(e)) return

    e.preventDefault()
    this.activePointerId = e.pointerId
    // Capture so we keep receiving events even if pointer leaves the element
    this.el.setPointerCapture(e.pointerId)
    this.opts.onStrokeStart(this.toRaw(e))
  }

  private readonly onMove = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return
    if (this.palm && !this.palm.shouldProcess(e)) return

    e.preventDefault()

    // getCoalescedEvents gives us intermediate samples the OS batched together,
    // reducing perceived latency for fast stylus movements.
    const events: PointerEvent[] =
      typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [e]

    for (const ev of events) {
      this.opts.onStrokeMove(this.toRaw(ev))
    }
  }

  private readonly onUp = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return
    this.palm?.shouldProcess(e) // update palm state even on up
    e.preventDefault()
    this.activePointerId = null
    this.opts.onStrokeEnd(this.toRaw(e))
  }

  private readonly onCancel = (e: PointerEvent): void => {
    if (e.pointerId !== this.activePointerId) return
    this.palm?.shouldProcess(e)
    this.activePointerId = null
    this.opts.onStrokeEnd(this.toRaw(e))
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  private attach(): void {
    const opt = { passive: false } as EventListenerOptions
    this.el.addEventListener('pointerdown', this.onDown, opt)
    this.el.addEventListener('pointermove', this.onMove, opt)
    this.el.addEventListener('pointerup', this.onUp, opt)
    this.el.addEventListener('pointercancel', this.onCancel, opt)
  }

  dispose(): void {
    this.el.removeEventListener('pointerdown', this.onDown)
    this.el.removeEventListener('pointermove', this.onMove)
    this.el.removeEventListener('pointerup', this.onUp)
    this.el.removeEventListener('pointercancel', this.onCancel)
    if (this.activePointerId !== null) {
      try { this.el.releasePointerCapture(this.activePointerId) } catch { /* noop */ }
    }
  }
}
