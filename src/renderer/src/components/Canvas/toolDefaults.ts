import type { InkToolSettings } from '../../hooks/useInkCanvas'

export const DEFAULT_TOOL_SETTINGS: InkToolSettings = {
  tool: 'pen',
  color: '#1a1a2e',
  baseWidth: 3,
  pressureCurve: 'smooth',
  opacity: 1,
}

export const TOOL_PRESETS: Record<string, InkToolSettings> = {
  pen: DEFAULT_TOOL_SETTINGS,
  pencil: {
    tool: 'pencil',
    color: '#374151',
    baseWidth: 3,
    pressureCurve: 'smooth',
    opacity: 1,
  },
  fountain: {
    tool: 'fountain',
    color: '#1a1a2e',
    baseWidth: 4,
    pressureCurve: 'smooth',
    opacity: 1,
  },
  highlighter: {
    tool: 'highlighter',
    color: '#facc15',
    baseWidth: 14,
    pressureCurve: 'linear',
    opacity: 0.5,
  },
  watercolor: {
    tool: 'watercolor',
    color: '#1d4ed8',
    baseWidth: 20,
    pressureCurve: 'linear',
    opacity: 1,
  },
  eraser: {
    tool: 'eraser',
    color: '#000000',
    baseWidth: 20,
    pressureCurve: 'linear',
    opacity: 1,
  },
}
