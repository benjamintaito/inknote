import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { InkToolSettings } from '../hooks/useInkCanvas'
import { DEFAULT_TOOL_SETTINGS } from '../components/Canvas/toolDefaults'

// ── Types ──────────────────────────────────────────────────────────────────────

export type ActiveTool =
  | 'pen' | 'pencil' | 'fountain' | 'highlighter' | 'watercolor'
  | 'eraser' | 'select' | 'pan'

export type EraserMode = 'stroke' | 'pixel'

export const PEN_WIDTHS = [
  { label: 'S',  value: 1.5 },
  { label: 'M',  value: 3   },
  { label: 'L',  value: 6   },
  { label: 'XL', value: 12  },
] as const

export const PENCIL_WIDTHS = [
  { label: 'S',  value: 1.5 },
  { label: 'M',  value: 3   },
  { label: 'L',  value: 5   },
  { label: 'XL', value: 8   },
] as const

export const FOUNTAIN_WIDTHS = [
  { label: 'S',  value: 2  },
  { label: 'M',  value: 4  },
  { label: 'L',  value: 7  },
  { label: 'XL', value: 12 },
] as const

export const HIGHLIGHTER_WIDTHS = [
  { label: 'S',  value: 8  },
  { label: 'M',  value: 14 },
  { label: 'L',  value: 20 },
  { label: 'XL', value: 28 },
] as const

export const WATERCOLOR_WIDTHS = [
  { label: 'S',  value: 10 },
  { label: 'M',  value: 20 },
  { label: 'L',  value: 35 },
  { label: 'XL', value: 55 },
] as const

export const ERASER_WIDTHS = [
  { label: 'S',  value: 10 },
  { label: 'M',  value: 20 },
  { label: 'L',  value: 40 },
  { label: 'XL', value: 80 },
] as const

export const PALETTE = [
  { label: 'Negro',   hex: '#1a1a2e' },
  { label: 'Azul',    hex: '#1d4ed8' },
  { label: 'Rojo',    hex: '#dc2626' },
  { label: 'Verde',   hex: '#16a34a' },
  { label: 'Naranja', hex: '#ea580c' },
  { label: 'Púrpura', hex: '#7c3aed' },
  { label: 'Gris',    hex: '#6b7280' },
  { label: 'Blanco',  hex: '#ffffff' },
] as const

// ── Store ──────────────────────────────────────────────────────────────────────

interface ToolState {
  activeTool:       ActiveTool
  straightLine:     boolean

  penColor:         string
  penWidth:         number
  pencilColor:      string
  pencilWidth:      number
  fountainColor:    string
  fountainWidth:    number
  highlighterColor: string
  highlighterWidth: number
  watercolorColor:  string
  watercolorWidth:  number
  eraserWidth:      number
  eraserMode:       EraserMode
  zoom:             number

  setActiveTool:       (tool: ActiveTool) => void
  setStraightLine:     (v: boolean) => void
  setPenColor:         (c: string) => void
  setPenWidth:         (w: number) => void
  setPencilColor:      (c: string) => void
  setPencilWidth:      (w: number) => void
  setFountainColor:    (c: string) => void
  setFountainWidth:    (w: number) => void
  setHighlighterColor: (c: string) => void
  setHighlighterWidth: (w: number) => void
  setWatercolorColor:  (c: string) => void
  setWatercolorWidth:  (w: number) => void
  setEraserWidth:      (w: number) => void
  setEraserMode:       (m: EraserMode) => void
  setZoom:             (z: number) => void
}

export const useToolStore = create<ToolState>()(
  persist(
    (set) => ({
      activeTool:       'pen',
      straightLine:     false,
      penColor:         '#1a1a2e',
      penWidth:         3,
      pencilColor:      '#374151',
      pencilWidth:      3,
      fountainColor:    '#1a1a2e',
      fountainWidth:    4,
      highlighterColor: '#facc15',
      highlighterWidth: 14,
      watercolorColor:  '#1d4ed8',
      watercolorWidth:  20,
      eraserWidth:      20,
      eraserMode:       'stroke',
      zoom:             100,

      setActiveTool:       (tool) => set({ activeTool: tool }),
      setStraightLine:     (v)    => set({ straightLine: v }),
      setPenColor:         (c)    => set({ penColor: c }),
      setPenWidth:         (w)    => set({ penWidth: w }),
      setPencilColor:      (c)    => set({ pencilColor: c }),
      setPencilWidth:      (w)    => set({ pencilWidth: w }),
      setFountainColor:    (c)    => set({ fountainColor: c }),
      setFountainWidth:    (w)    => set({ fountainWidth: w }),
      setHighlighterColor: (c)    => set({ highlighterColor: c }),
      setHighlighterWidth: (w)    => set({ highlighterWidth: w }),
      setWatercolorColor:  (c)    => set({ watercolorColor: c }),
      setWatercolorWidth:  (w)    => set({ watercolorWidth: w }),
      setEraserWidth:      (w)    => set({ eraserWidth: w }),
      setEraserMode:       (m)    => set({ eraserMode: m }),
      setZoom:             (z)    => set({ zoom: z }),
    }),
    { name: 'inknote-tool-prefs' }
  )
)

// ── Derived: toolStore state → InkCanvas tool settings ────────────────────────

export function resolveInkSettings(state: ToolState): InkToolSettings {
  switch (state.activeTool) {
    case 'pen':
      return {
        tool: 'pen',
        color: state.penColor,
        baseWidth: state.penWidth,
        pressureCurve: 'smooth',
        opacity: 1,
      }
    case 'pencil':
      return {
        tool: 'pencil',
        color: state.pencilColor,
        baseWidth: state.pencilWidth,
        pressureCurve: 'smooth',
        opacity: 1,
      }
    case 'fountain':
      return {
        tool: 'fountain',
        color: state.fountainColor,
        baseWidth: state.fountainWidth,
        pressureCurve: 'smooth',
        opacity: 1,
      }
    case 'highlighter':
      return {
        tool: 'highlighter',
        color: state.highlighterColor,
        baseWidth: state.highlighterWidth,
        pressureCurve: 'linear',
        opacity: 0.5,
      }
    case 'watercolor':
      return {
        tool: 'watercolor',
        color: state.watercolorColor,
        baseWidth: state.watercolorWidth,
        pressureCurve: 'linear',
        opacity: 1,
      }
    case 'eraser':
      return {
        tool: 'eraser',
        color: '#000000',
        baseWidth: state.eraserWidth,
        pressureCurve: 'linear',
        opacity: 1,
      }
    default:
      return DEFAULT_TOOL_SETTINGS
  }
}
