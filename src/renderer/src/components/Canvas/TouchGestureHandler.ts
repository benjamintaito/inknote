import type { Viewport } from '@shared/types'

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TouchGestureHandlerOptions {
  /** Read current viewport state */
  getViewport: () => Viewport
  /** Write new viewport state (does NOT call onViewportChange) */
  setViewport: (vp: Viewport) => void
  /** Called after each viewport update so the caller can apply CSS transforms */
  onViewportChange: () => void
  /** Clamps scale to [min, max] */
  clampScale: (s: number) => number
  /**
   * Return true if the stylus is currently drawing.
   * When true, all touch events are silently ignored to avoid viewport jumps
   * when the user rests their palm while writing.
   */
  isPenActive?: () => boolean
  /**
   * Inertia decay factor per animation frame (0–1).
   * 0.92 (default) gives ~300ms coast; 0.96 is slower/smoother.
   */
  inertiaDecay?: number
  /** Minimum velocity magnitude (px/frame) below which inertia stops. Default: 0.3 */
  inertiaThreshold?: number
}

// ── Internal helpers ───────────────────────────────────────────────────────────

interface TInfo { x: number; y: number }

function mid(a: TInfo, b: TInfo) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }
}

function dist(a: TInfo, b: TInfo) {
  return Math.hypot(b.x - a.x, b.y - a.y)
}

// ── Handler ────────────────────────────────────────────────────────────────────

/**
 * TouchGestureHandler
 *
 * Maps multi-touch gestures to pan + zoom on the canvas viewport:
 *  - 1 finger  → ignored (avoids accidental strokes when resting hand)
 *  - 2 fingers → simultaneous pan AND pinch-zoom, centered on the midpoint
 *  - Release   → inertia with exponential velocity decay (pan only)
 *
 * Uses Pointer Events filtered to pointerType='touch' for compatibility
 * with Electron on Windows (HP Spectre / Surface), where touch input is
 * delivered via the Pointer Events API rather than legacy Touch Events.
 */
export class TouchGestureHandler {
  private readonly el: HTMLElement
  private readonly opts: TouchGestureHandlerOptions
  private readonly decay: number
  private readonly threshold: number

  // Active touch pointers tracked by pointerId
  private readonly pointers = new Map<number, TInfo>()

  // Two-finger gesture state
  private activeMid: TInfo | null = null
  private activeDist = 0

  // Inertia
  private velX = 0
  private velY = 0
  private rafId: number | null = null

  constructor(element: HTMLElement, options: TouchGestureHandlerOptions) {
    this.el = element
    this.opts = options
    this.decay = options.inertiaDecay ?? 0.92
    this.threshold = options.inertiaThreshold ?? 0.3
    this.attach()
  }

  // ── Inertia ────────────────────────────────────────────────────────────────

  private stopInertia() {
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId)
      this.rafId = null
    }
  }

  private startInertia() {
    if (Math.hypot(this.velX, this.velY) < this.threshold) return

    const tick = () => {
      if (Math.hypot(this.velX, this.velY) < this.threshold) {
        this.rafId = null
        return
      }
      const vp = this.opts.getViewport()
      this.opts.setViewport({ ...vp, offsetX: vp.offsetX + this.velX, offsetY: vp.offsetY + this.velY })
      this.opts.onViewportChange()
      this.velX *= this.decay
      this.velY *= this.decay
      this.rafId = requestAnimationFrame(tick)
    }

    this.rafId = requestAnimationFrame(tick)
  }

  // ── Pointer event handlers (touch only) ────────────────────────────────────

  private readonly onPointerDown = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    if (this.opts.isPenActive?.()) { this.reset(); return }

    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (this.pointers.size >= 2) {
      e.preventDefault()
      if (this.activeMid === null) {
        // Starting a new 2-finger gesture
        this.stopInertia()
        const [p0, p1] = [...this.pointers.values()]
        this.activeMid  = mid(p0, p1)
        this.activeDist = dist(p0, p1)
        this.velX = 0
        this.velY = 0
      }
    }
  }

  private readonly onPointerMove = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    if (!this.pointers.has(e.pointerId)) return

    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY })

    if (this.pointers.size < 2 || this.activeMid === null) return
    e.preventDefault()

    const [p0, p1] = [...this.pointers.values()]
    const curMid  = mid(p0, p1)
    const curDist = dist(p0, p1)

    const vp = this.opts.getViewport()

    // Pan: 1:1 midpoint delta
    const dx = curMid.x - this.activeMid.x
    const dy = curMid.y - this.activeMid.y

    // Zoom: distance ratio, pivot = current midpoint
    const zoomFactor = curDist / (this.activeDist || 1)
    const newScale   = this.opts.clampScale(vp.scale * zoomFactor)
    const sRatio     = newScale / vp.scale

    // Combine: apply scale pivot then pan offset atomically
    this.opts.setViewport({
      scale:   newScale,
      offsetX: curMid.x - sRatio * (curMid.x - vp.offsetX) + dx,
      offsetY: curMid.y - sRatio * (curMid.y - vp.offsetY) + dy,
    })
    this.opts.onViewportChange()

    // Store instantaneous velocity for inertia (pan component only)
    this.velX = dx
    this.velY = dy

    this.activeMid  = curMid
    this.activeDist = curDist
  }

  private readonly onPointerUp = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) {
      this.activeMid  = null
      this.activeDist = 0
      this.startInertia()
    }
  }

  private readonly onPointerCancel = (e: PointerEvent): void => {
    if (e.pointerType !== 'touch') return
    this.pointers.delete(e.pointerId)
    if (this.pointers.size < 2) {
      this.reset()
    }
  }

  private reset() {
    this.pointers.clear()
    this.activeMid  = null
    this.activeDist = 0
    this.velX = 0
    this.velY = 0
    this.stopInertia()
  }

  // ── Lifecycle ──────────────────────────────────────────────────────────────

  private attach() {
    const p = { passive: false } as EventListenerOptions
    this.el.addEventListener('pointerdown',   this.onPointerDown,   p)
    this.el.addEventListener('pointermove',   this.onPointerMove,   p)
    this.el.addEventListener('pointerup',     this.onPointerUp)
    this.el.addEventListener('pointercancel', this.onPointerCancel)
  }

  dispose() {
    this.stopInertia()
    this.el.removeEventListener('pointerdown',   this.onPointerDown)
    this.el.removeEventListener('pointermove',   this.onPointerMove)
    this.el.removeEventListener('pointerup',     this.onPointerUp)
    this.el.removeEventListener('pointercancel', this.onPointerCancel)
  }
}
