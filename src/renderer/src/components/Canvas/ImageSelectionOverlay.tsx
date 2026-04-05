/**
 * ImageSelectionOverlay — DOM-based image selection, move, resize, and rotate UI.
 *
 * Sits above the ink canvases (z-index wise). When activeTool === 'select':
 *   - Pointer events are captured on images and handles.
 *   - Empty-space clicks pass through to deselect.
 * When any other tool is active the overlay is fully pointer-events: none.
 *
 * Coordinate conversions:
 *   screenX = canvasX * scale + offsetX   (relative to container)
 *   canvasX = (screenX - offsetX) / scale
 */

import { useState, useRef, useCallback, useEffect, RefObject } from 'react'
import type { PageImage, Viewport } from '@shared/types'
import { useNotebookStore } from '../../stores/notebookStore'
import { useToolStore } from '../../stores/toolStore'

// ── Handle positions (8 resize + 1 rotate) ────────────────────────────────────

type HandleType = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate'

interface Handle {
  id: HandleType
  xFrac: number  // 0=left, 0.5=center, 1=right of bounding box
  yFrac: number  // 0=top,  0.5=center, 1=bottom
  cursor: string
}

const HANDLES: Handle[] = [
  { id: 'nw',     xFrac: 0,   yFrac: 0,    cursor: 'nwse-resize' },
  { id: 'n',      xFrac: 0.5, yFrac: 0,    cursor: 'ns-resize'   },
  { id: 'ne',     xFrac: 1,   yFrac: 0,    cursor: 'nesw-resize' },
  { id: 'e',      xFrac: 1,   yFrac: 0.5,  cursor: 'ew-resize'   },
  { id: 'se',     xFrac: 1,   yFrac: 1,    cursor: 'nwse-resize' },
  { id: 's',      xFrac: 0.5, yFrac: 1,    cursor: 'ns-resize'   },
  { id: 'sw',     xFrac: 0,   yFrac: 1,    cursor: 'nesw-resize' },
  { id: 'w',      xFrac: 0,   yFrac: 0.5,  cursor: 'ew-resize'   },
  { id: 'rotate', xFrac: 0.5, yFrac: -0.18, cursor: 'grab'       },
]

const HANDLE_SIZE = 10  // px in screen space

// ── Context menu ──────────────────────────────────────────────────────────────

interface CtxMenuProps {
  x: number; y: number
  image: PageImage
  onClose: () => void
  onBringToFront: () => void
  onSendToBack:   () => void
  onToggleLock:   () => void
  onDuplicate:    () => void
  onDelete:       () => void
  onSetOpacity:   (v: number) => void
}

function ContextMenu({ x, y, image, onClose, onBringToFront, onSendToBack, onToggleLock, onDuplicate, onDelete, onSetOpacity }: CtxMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const item = (label: string, action: () => void, danger?: boolean) => (
    <button
      key={label}
      onMouseDown={(e) => { e.stopPropagation(); action(); onClose() }}
      className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-100 transition-colors ${danger ? 'text-red-500' : 'text-ink'}`}
    >
      {label}
    </button>
  )

  return (
    <div
      ref={ref}
      className="absolute z-50 bg-white border border-surface-200 rounded-lg shadow-lg py-1 min-w-[160px] select-none"
      style={{ left: x, top: y }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {item('Traer al frente', onBringToFront)}
      {item('Enviar al fondo', onSendToBack)}
      <div className="my-1 border-t border-surface-100" />
      {item(image.locked ? 'Desbloquear' : 'Bloquear', onToggleLock)}
      {item('Duplicar', onDuplicate)}
      <div className="my-1 border-t border-surface-100" />
      <div className="px-3 py-1 text-xs text-ink-soft">Opacidad</div>
      {[100, 75, 50, 25].map((pct) => item(
        `${pct}%`,
        () => onSetOpacity(pct / 100),
        false
      ))}
      <div className="my-1 border-t border-surface-100" />
      {item('Eliminar', onDelete, true)}
    </div>
  )
}

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  viewportRef:        RefObject<Viewport>
  containerRef:       RefObject<HTMLElement>
  onUpdateImage:      (id: string, updates: Partial<PageImage>) => void
  onRemoveImage:      (id: string) => void
  onAddDuplicateImage?: (img: PageImage) => void
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ImageSelectionOverlay({
  viewportRef,
  containerRef,
  onUpdateImage,
  onRemoveImage,
  onAddDuplicateImage,
}: Props) {
  const activeTool = useToolStore((s) => s.activeTool)
  const images     = useNotebookStore((s) => s.images)

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [viewport, setViewport]     = useState<Viewport>({ scale: 1, offsetX: 0, offsetY: 0 })
  const [ctxMenu, setCtxMenu]       = useState<{ x: number; y: number } | null>(null)

  // Drag state (all in refs to avoid re-renders during drag)
  const dragRef = useRef<{
    mode:    'move' | HandleType
    startSX: number; startSY: number          // screen coords at drag start
    origImg: PageImage                         // image state at drag start
  } | null>(null)

  // Sync viewport from the applyTransform events in InkCanvas
  useEffect(() => {
    const onViewport = (e: Event) => {
      const vp = (e as CustomEvent<Viewport>).detail
      setViewport(vp)
    }
    window.addEventListener('ink:viewport', onViewport)
    // Also init from ref
    if (viewportRef.current) setViewport({ ...viewportRef.current })
    return () => window.removeEventListener('ink:viewport', onViewport)
  }, [viewportRef])

  // Deselect when switching away from select tool
  useEffect(() => {
    if (activeTool !== 'select') setSelectedId(null)
  }, [activeTool])

  // Keyboard: Delete/Backspace removes selected image; Escape deselects
  useEffect(() => {
    if (activeTool !== 'select') return
    const onKey = (e: KeyboardEvent) => {
      if (!selectedId) return
      if (e.key === 'Delete' || e.key === 'Backspace') {
        onRemoveImage(selectedId)
        setSelectedId(null)
      } else if (e.key === 'Escape') {
        setSelectedId(null)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeTool, selectedId, onRemoveImage])

  // ── Coordinate helpers ──────────────────────────────────────────────────────

  const toScreen = (cx: number, cy: number) => ({
    sx: cx * viewport.scale + viewport.offsetX,
    sy: cy * viewport.scale + viewport.offsetY,
  })

  const toCanvas = (sx: number, sy: number) => ({
    cx: (sx - viewport.offsetX) / viewport.scale,
    cy: (sy - viewport.offsetY) / viewport.scale,
  })

  // ── Hit test ───────────────────────────────────────────────────────────────

  const hitTestImages = useCallback(
    (sx: number, sy: number): PageImage | null => {
      const { cx, cy } = toCanvas(sx, sy)
      // Check highest zIndex first
      const sorted = [...images].sort((a, b) => b.zIndex - a.zIndex)
      for (const img of sorted) {
        if (cx >= img.x && cx <= img.x + img.width && cy >= img.y && cy <= img.y + img.height) {
          return img
        }
      }
      return null
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [images, viewport]
  )

  // ── Pointer handlers on the transparent backdrop ────────────────────────────

  const onBackdropDown = useCallback(
    (e: React.PointerEvent) => {
      if (activeTool !== 'select') return
      e.stopPropagation()
      const rect = containerRef.current?.getBoundingClientRect()
      if (!rect) return
      const sx = e.clientX - rect.left
      const sy = e.clientY - rect.top
      const hit = hitTestImages(sx, sy)
      if (hit && !hit.locked) {
        setSelectedId(hit.id)
        dragRef.current = { mode: 'move', startSX: e.clientX, startSY: e.clientY, origImg: { ...hit } }
        ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
      } else {
        setSelectedId(null)
      }
    },
    [activeTool, containerRef, hitTestImages]
  )

  const onBackdropMove = useCallback((e: React.PointerEvent) => {
    const dr = dragRef.current
    if (!dr) return
    const img = images.find((i) => i.id === selectedId)
    if (!img) return

    const dsx = e.clientX - dr.startSX
    const dsy = e.clientY - dr.startSY
    const dcx = dsx / viewport.scale
    const dcy = dsy / viewport.scale

    if (dr.mode === 'move') {
      onUpdateImage(img.id, {
        x: dr.origImg.x + dcx,
        y: dr.origImg.y + dcy,
      })
    } else if (dr.mode === 'rotate') {
      const cx = dr.origImg.x + dr.origImg.width  / 2
      const cy = dr.origImg.y + dr.origImg.height / 2
      const { sx: cxS, sy: cyS } = toScreen(cx, cy)
      const angle = Math.atan2(e.clientY - cyS, e.clientX - cxS) * (180 / Math.PI) + 90
      const snapped = e.shiftKey ? Math.round(angle / 15) * 15 : angle
      onUpdateImage(img.id, { rotation: snapped })
    } else {
      // Resize handle
      const { origImg } = dr
      let { x, y, width, height } = origImg
      const keepRatio = !e.shiftKey
      const ratio = origImg.width / origImg.height

      switch (dr.mode) {
        case 'se': width  = Math.max(20, origImg.width  + dcx); if (keepRatio) height = width / ratio;  break
        case 'sw': width  = Math.max(20, origImg.width  - dcx); x = origImg.x + origImg.width - width; if (keepRatio) height = width / ratio; break
        case 'ne': width  = Math.max(20, origImg.width  + dcx); if (keepRatio) { height = width / ratio; y = origImg.y + origImg.height - height } break
        case 'nw': {
          width  = Math.max(20, origImg.width  - dcx)
          height = keepRatio ? width / ratio : Math.max(20, origImg.height - dcy)
          x = origImg.x + origImg.width  - width
          y = origImg.y + origImg.height - height
          break
        }
        case 'e': width  = Math.max(20, origImg.width  + dcx); if (keepRatio) height = width / ratio;  break
        case 'w': width  = Math.max(20, origImg.width  - dcx); x = origImg.x + origImg.width - width;  break
        case 's': height = Math.max(20, origImg.height + dcy); if (keepRatio) width  = height * ratio; break
        case 'n': height = Math.max(20, origImg.height - dcy); y = origImg.y + origImg.height - height; if (keepRatio) width = height * ratio; break
      }
      onUpdateImage(img.id, { x, y, width, height })
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images, selectedId, viewport, onUpdateImage])

  const onBackdropUp = useCallback((_e: React.PointerEvent) => {
    dragRef.current = null
  }, [])

  // ── Handle pointer down (resize / rotate) ───────────────────────────────────

  const onHandleDown = useCallback(
    (e: React.PointerEvent, handleId: HandleType) => {
      e.stopPropagation()
      const img = images.find((i) => i.id === selectedId)
      if (!img) return
      dragRef.current = { mode: handleId, startSX: e.clientX, startSY: e.clientY, origImg: { ...img } }
      ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    },
    [images, selectedId]
  )

  // ── Context menu ───────────────────────────────────────────────────────────

  const onImgContextMenu = useCallback(
    (e: React.MouseEvent, img: PageImage) => {
      e.preventDefault()
      e.stopPropagation()
      setSelectedId(img.id)
      const rect = containerRef.current?.getBoundingClientRect()
      setCtxMenu({ x: e.clientX - (rect?.left ?? 0), y: e.clientY - (rect?.top ?? 0) })
    },
    [containerRef]
  )

  // ── Render ─────────────────────────────────────────────────────────────────

  if (activeTool !== 'select') return null

  const selectedImg = images.find((i) => i.id === selectedId)

  return (
    <div
      className="absolute inset-0 overflow-hidden"
      style={{ pointerEvents: 'none', zIndex: 10 }}
    >
      {/* Full-area backdrop: captures pointer events for move & deselect */}
      <div
        className="absolute inset-0"
        style={{ pointerEvents: 'auto', cursor: 'default' }}
        onPointerDown={onBackdropDown}
        onPointerMove={onBackdropMove}
        onPointerUp={onBackdropUp}
        onContextMenu={(e) => {
          const rect = containerRef.current?.getBoundingClientRect()
          const sx = e.clientX - (rect?.left ?? 0)
          const sy = e.clientY - (rect?.top ?? 0)
          const hit = hitTestImages(sx, sy)
          if (hit) onImgContextMenu(e as unknown as React.MouseEvent, hit)
        }}
      />

      {/* Image hover outlines */}
      {images.map((img) => {
        if (img.id === selectedId) return null
        const { sx, sy } = toScreen(img.x, img.y)
        return (
          <div
            key={img.id}
            className="absolute border border-transparent hover:border-blue-300 transition-colors"
            style={{
              left:             sx,
              top:              sy,
              width:            img.width  * viewport.scale,
              height:           img.height * viewport.scale,
              transform:        `rotate(${img.rotation}deg)`,
              transformOrigin:  'center',
              pointerEvents:    'none',
            }}
          />
        )
      })}

      {/* Selected image: dashed border + handles */}
      {selectedImg && (() => {
        const { sx, sy } = toScreen(selectedImg.x, selectedImg.y)
        const sw = selectedImg.width  * viewport.scale
        const sh = selectedImg.height * viewport.scale

        return (
          <div
            key="selection"
            style={{
              position:        'absolute',
              left:             sx,
              top:              sy,
              width:            sw,
              height:           sh,
              transform:        `rotate(${selectedImg.rotation}deg)`,
              transformOrigin:  'center',
              pointerEvents:    'none',
            }}
          >
            {/* Dashed border */}
            <div
              className="absolute inset-0 border-2 border-blue-500"
              style={{ borderStyle: 'dashed', pointerEvents: 'none' }}
            />

            {/* Resize/rotate handles */}
            {HANDLES.map((h) => {
              const hx = h.xFrac * sw - HANDLE_SIZE / 2
              const hy = h.yFrac * sh - HANDLE_SIZE / 2
              const isRotate = h.id === 'rotate'
              return (
                <div
                  key={h.id}
                  style={{
                    position:     'absolute',
                    left:          hx,
                    top:           hy,
                    width:         HANDLE_SIZE,
                    height:        HANDLE_SIZE,
                    cursor:        h.cursor,
                    pointerEvents: 'auto',
                    zIndex:        20,
                  }}
                  className={
                    isRotate
                      ? 'rounded-full bg-blue-500 border-2 border-white shadow-sm'
                      : 'bg-white border-2 border-blue-500 shadow-sm rounded-sm'
                  }
                  onPointerDown={(e) => onHandleDown(e, h.id)}
                />
              )
            })}
          </div>
        )
      })()}

      {/* Context menu */}
      {ctxMenu && selectedImg && (
        <ContextMenu
          x={ctxMenu.x} y={ctxMenu.y}
          image={selectedImg}
          onClose={() => setCtxMenu(null)}
          onBringToFront={() => {
            const maxZ = Math.max(0, ...images.map((i) => i.zIndex))
            onUpdateImage(selectedImg.id, { zIndex: maxZ + 1 })
          }}
          onSendToBack={() => {
            const minZ = Math.min(0, ...images.map((i) => i.zIndex))
            onUpdateImage(selectedImg.id, { zIndex: minZ - 1 })
          }}
          onToggleLock={() => onUpdateImage(selectedImg.id, { locked: !selectedImg.locked })}
          onDuplicate={() => {
            if (onAddDuplicateImage) onAddDuplicateImage({ ...selectedImg, x: selectedImg.x + 20, y: selectedImg.y + 20 })
          }}
          onDelete={() => { onRemoveImage(selectedImg.id); setSelectedId(null) }}
          onSetOpacity={(v) => onUpdateImage(selectedImg.id, { opacity: v })}
        />
      )}
    </div>
  )
}
