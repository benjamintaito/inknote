import { useState, useEffect } from 'react'
import {
  Pen,
  Pencil,
  PenTool,
  Highlighter,
  Paintbrush,
  Eraser,
  Undo2,
  Redo2,
  Trash2,
  ZoomIn,
  ZoomOut,
  Check,
  X,
  ScanText,
  Loader2,
  Moon,
  Sun,
  PanelLeft,
  Download,
  Ruler,
  MousePointer,
  Image as ImageIcon,
} from 'lucide-react'
import {
  useToolStore,
  PALETTE,
  PEN_WIDTHS,
  PENCIL_WIDTHS,
  FOUNTAIN_WIDTHS,
  HIGHLIGHTER_WIDTHS,
  WATERCOLOR_WIDTHS,
  ERASER_WIDTHS,
  type ActiveTool,
  type EraserMode,
} from '../../stores/toolStore'
import { useNotebookStore } from '../../stores/notebookStore'
import { useAppStore } from '../../stores/appStore'

// ── Ink dispatch helper ────────────────────────────────────────────────────────

function inkAction(action: string) {
  window.dispatchEvent(new CustomEvent('ink:action', { detail: action }))
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function Separator() {
  return <div className="w-px h-6 bg-surface-200 shrink-0 mx-1" />
}

interface ToolBtnProps {
  active: boolean
  title: string
  onClick: () => void
  children: React.ReactNode
  accentColor?: string
}

function ToolBtn({ active, title, onClick, children, accentColor }: ToolBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={[
        'flex items-center justify-center w-9 h-9 rounded-lg transition-all shrink-0',
        active
          ? 'shadow-sm text-white'
          : 'text-ink-soft hover:bg-surface-100 hover:text-ink',
      ].join(' ')}
      style={active ? { backgroundColor: accentColor ?? '#1a1a2e' } : undefined}
    >
      {children}
    </button>
  )
}

interface IconBtnProps {
  title: string
  onClick: () => void
  children: React.ReactNode
  danger?: boolean
  disabled?: boolean
  active?: boolean
}

function IconBtn({ title, onClick, children, danger, disabled, active }: IconBtnProps) {
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={[
        'flex items-center justify-center w-8 h-8 rounded-md transition-colors shrink-0',
        danger
          ? 'text-red-500 hover:bg-red-50'
          : active
            ? 'bg-blue-100 text-blue-600'
            : 'text-ink-soft hover:bg-surface-100 hover:text-ink',
        disabled ? 'opacity-30 cursor-default' : '',
      ].join(' ')}
    >
      {children}
    </button>
  )
}

// ── Color palette ──────────────────────────────────────────────────────────────

interface ColorPaletteProps {
  activeColor: string
  onChange: (hex: string) => void
}

function ColorPalette({ activeColor, onChange }: ColorPaletteProps) {
  return (
    <div className="flex items-center gap-1 shrink-0">
      {PALETTE.map(({ hex, label }) => {
        const isActive = activeColor.toLowerCase() === hex.toLowerCase()
        const isWhite = hex === '#ffffff'
        return (
          <button
            key={hex}
            title={label}
            onClick={() => onChange(hex)}
            className={[
              'w-5 h-5 rounded-full transition-all shrink-0',
              isActive ? 'ring-2 ring-offset-1 ring-ink scale-110' : 'hover:scale-110',
              isWhite ? 'border border-surface-200' : '',
            ].join(' ')}
            style={{ backgroundColor: hex }}
          />
        )
      })}
    </div>
  )
}

// ── Width presets ──────────────────────────────────────────────────────────────

interface WidthPresetsProps {
  presets: readonly { label: string; value: number }[]
  activeWidth: number
  activeColor: string
  onChange: (width: number) => void
}

function WidthPresets({ presets, activeWidth, activeColor, onChange }: WidthPresetsProps) {
  const displaySizes: Record<string, number> = { S: 7, M: 11, L: 16, XL: 22 }

  return (
    <div className="flex items-center gap-1 shrink-0">
      {presets.map(({ label, value }) => {
        const isActive = activeWidth === value
        const dotSize = displaySizes[label] ?? 10
        return (
          <button
            key={value}
            title={`${label} — ${value}px`}
            onClick={() => onChange(value)}
            className={[
              'flex items-center justify-center w-9 h-9 rounded-lg transition-all shrink-0',
              isActive
                ? 'bg-surface-100 ring-1 ring-ink/20'
                : 'hover:bg-surface-50',
            ].join(' ')}
          >
            <span
              className="rounded-full block transition-all"
              style={{
                width:  dotSize,
                height: dotSize,
                backgroundColor: isActive ? activeColor : '#6b7280',
              }}
            />
          </button>
        )
      })}
    </div>
  )
}

// ── Eraser mode toggle ─────────────────────────────────────────────────────────

interface EraserModeToggleProps {
  mode: EraserMode
  onChange: (mode: EraserMode) => void
}

function EraserModeToggle({ mode, onChange }: EraserModeToggleProps) {
  return (
    <div className="flex items-center gap-0.5 shrink-0 bg-surface-100 rounded-lg p-0.5">
      <button
        onClick={() => onChange('stroke')}
        title="Borrador de trazo — elimina el trazo completo"
        className={[
          'px-2.5 py-1 text-xs rounded-md transition-colors',
          mode === 'stroke'
            ? 'bg-white text-ink shadow-sm font-medium'
            : 'text-ink-soft hover:text-ink',
        ].join(' ')}
      >
        Trazo
      </button>
      <button
        onClick={() => onChange('pixel')}
        title="Borrador de área — divide el trazo en la zona borrada"
        className={[
          'px-2.5 py-1 text-xs rounded-md transition-colors',
          mode === 'pixel'
            ? 'bg-white text-ink shadow-sm font-medium'
            : 'text-ink-soft hover:text-ink',
        ].join(' ')}
      >
        Área
      </button>
    </div>
  )
}

// ── Zoom display ───────────────────────────────────────────────────────────────

function ZoomControls() {
  const zoom = useToolStore((s) => s.zoom)

  return (
    <div className="flex items-center gap-0.5 shrink-0">
      <IconBtn title="Reducir zoom (Ctrl+−)" onClick={() => inkAction('zoom-out')}>
        <ZoomOut size={15} />
      </IconBtn>

      <button
        title="Restablecer zoom (Ctrl+0)"
        onClick={() => inkAction('zoom-reset')}
        className="w-12 h-7 text-xs font-mono text-ink-soft hover:text-ink hover:bg-surface-100 rounded transition-colors"
      >
        {zoom}%
      </button>

      <IconBtn title="Aumentar zoom (Ctrl+=)" onClick={() => inkAction('zoom-in')}>
        <ZoomIn size={15} />
      </IconBtn>
    </div>
  )
}

// ── Clear confirmation inline ──────────────────────────────────────────────────

function ClearButton() {
  const [confirming, setConfirming] = useState(false)

  const handleClear = () => {
    inkAction('clear')
    setConfirming(false)
  }

  if (confirming) {
    return (
      <div className="flex items-center gap-1 bg-red-50 rounded-lg px-1 py-0.5 border border-red-100 shrink-0">
        <span className="text-xs text-red-600 px-1 whitespace-nowrap">¿Borrar todo?</span>
        <button
          onClick={handleClear}
          className="flex items-center justify-center w-6 h-6 rounded bg-red-500 text-white hover:bg-red-600 transition-colors"
          title="Confirmar"
        >
          <Check size={12} />
        </button>
        <button
          onClick={() => setConfirming(false)}
          className="flex items-center justify-center w-6 h-6 rounded hover:bg-red-100 text-red-400 transition-colors"
          title="Cancelar"
        >
          <X size={12} />
        </button>
      </div>
    )
  }

  return (
    <IconBtn title="Borrar página" onClick={() => setConfirming(true)} danger>
      <Trash2 size={15} />
    </IconBtn>
  )
}

// ── OCR button (results are shown in <OcrPanel />) ─────────────────────────────

function OCRControl() {
  const activePage   = useNotebookStore((s) => s.activePage)
  const strokes      = useNotebookStore((s) => s.strokes)
  const isOCRRunning = useNotebookStore((s) => s.isOCRRunning)
  const ocrProgress  = useNotebookStore((s) => s.ocrProgress)
  const runOCR       = useNotebookStore((s) => s.runOCR)

  const hasStrokes = strokes.some((s) => s.tool !== 'eraser')
  const disabled   = !activePage || !hasStrokes || isOCRRunning

  return (
    <button
      onClick={() => { if (!isOCRRunning) void runOCR() }}
      disabled={disabled}
      title="Reconocer texto (OCR)"
      className={[
        'flex items-center gap-1.5 px-2.5 h-8 rounded-md text-xs font-medium transition-colors shrink-0',
        isOCRRunning
          ? 'bg-blue-50 text-blue-600 cursor-wait'
          : disabled
            ? 'text-ink-soft opacity-40 cursor-default'
            : 'text-ink-soft hover:bg-surface-100 hover:text-ink',
      ].join(' ')}
    >
      {isOCRRunning ? (
        <>
          <Loader2 size={13} className="animate-spin" />
          <span className="hidden sm:inline">{Math.round(ocrProgress * 100)}%</span>
        </>
      ) : (
        <>
          <ScanText size={13} />
          <span className="hidden sm:inline">OCR</span>
        </>
      )}
    </button>
  )
}

// ── Export button ──────────────────────────────────────────────────────────────

function ExportButton() {
  const activeNotebook = useNotebookStore((s) => s.activeNotebook)
  if (!activeNotebook) return null
  return (
    <IconBtn title="Exportar PDF (Ctrl+E)" onClick={() => inkAction('export')}>
      <Download size={15} />
    </IconBtn>
  )
}

// ── Theme toggle ───────────────────────────────────────────────────────────────

function ThemeToggle() {
  const { isDark, toggleTheme } = useAppStore()
  return (
    <IconBtn title={isDark ? 'Modo claro' : 'Modo oscuro'} onClick={toggleTheme}>
      {isDark ? <Sun size={15} /> : <Moon size={15} />}
    </IconBtn>
  )
}

// ── Sidebar toggle ─────────────────────────────────────────────────────────────

function SidebarToggle() {
  const { toggleSidebar } = useAppStore()
  return (
    <IconBtn title="Alternar barra lateral" onClick={toggleSidebar}>
      <PanelLeft size={15} />
    </IconBtn>
  )
}

// ── Main Toolbar ───────────────────────────────────────────────────────────────

const TOOL_ACCENT: Record<ActiveTool, string> = {
  pen:         '#1a1a2e',
  pencil:      '#374151',
  fountain:    '#1e3a5f',
  highlighter: '#ca8a04',
  watercolor:  '#0369a1',
  eraser:      '#6b7280',
  select:      '#1d4ed8',
  pan:         '#1d4ed8',
}

export default function Toolbar() {
  const {
    activeTool,       straightLine,
    penColor,         penWidth,
    pencilColor,      pencilWidth,
    fountainColor,    fountainWidth,
    highlighterColor, highlighterWidth,
    watercolorColor,  watercolorWidth,
    eraserWidth,      eraserMode,
    setActiveTool,    setStraightLine,
    setPenColor,      setPenWidth,
    setPencilColor,   setPencilWidth,
    setFountainColor, setFountainWidth,
    setHighlighterColor, setHighlighterWidth,
    setWatercolorColor,  setWatercolorWidth,
    setEraserWidth,   setEraserMode,
    setZoom,
  } = useToolStore()

  // Listen for zoom changes dispatched by InkCanvas
  useEffect(() => {
    const onZoom = (e: Event) => {
      const scale = (e as CustomEvent<number>).detail
      setZoom(Math.round(scale * 100))
    }
    window.addEventListener('ink:zoom', onZoom)
    return () => window.removeEventListener('ink:zoom', onZoom)
  }, [setZoom])

  // ── Derived state ─────────────────────────────────────────────────────────────
  const isEraserTool  = activeTool === 'eraser'
  const isSelectTool  = activeTool === 'select'
  const isDrawingTool = !isEraserTool && !isSelectTool && activeTool !== 'pan'

  const activeColor = (() => {
    switch (activeTool) {
      case 'pen':         return penColor
      case 'pencil':      return pencilColor
      case 'fountain':    return fountainColor
      case 'highlighter': return highlighterColor
      case 'watercolor':  return watercolorColor
      default:            return penColor
    }
  })()

  const activeWidth = (() => {
    switch (activeTool) {
      case 'pen':         return penWidth
      case 'pencil':      return pencilWidth
      case 'fountain':    return fountainWidth
      case 'highlighter': return highlighterWidth
      case 'watercolor':  return watercolorWidth
      case 'eraser':      return eraserWidth
      default:            return penWidth
    }
  })()

  const activePresets = (() => {
    switch (activeTool) {
      case 'pen':         return PEN_WIDTHS
      case 'pencil':      return PENCIL_WIDTHS
      case 'fountain':    return FOUNTAIN_WIDTHS
      case 'highlighter': return HIGHLIGHTER_WIDTHS
      case 'watercolor':  return WATERCOLOR_WIDTHS
      case 'eraser':      return ERASER_WIDTHS
      default:            return PEN_WIDTHS
    }
  })()

  const handleColorChange = (hex: string) => {
    switch (activeTool) {
      case 'pen':         setPenColor(hex);          break
      case 'pencil':      setPencilColor(hex);       break
      case 'fountain':    setFountainColor(hex);     break
      case 'highlighter': setHighlighterColor(hex);  break
      case 'watercolor':  setWatercolorColor(hex);   break
    }
  }

  const handleWidthChange = (width: number) => {
    switch (activeTool) {
      case 'pen':         setPenWidth(width);         break
      case 'pencil':      setPencilWidth(width);      break
      case 'fountain':    setFountainWidth(width);    break
      case 'highlighter': setHighlighterWidth(width); break
      case 'watercolor':  setWatercolorWidth(width);  break
      case 'eraser':      setEraserWidth(width);      break
    }
  }

  const accentForDot = isEraserTool ? '#6b7280' : activeColor

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <header className="no-select flex items-center gap-1.5 px-3 h-[48px] bg-paper border-b border-surface-200 shrink-0 overflow-hidden">

      {/* ── 0. Sidebar toggle ─────────────────────────────────────────────── */}
      <SidebarToggle />
      <Separator />

      {/* ── 1. Select tool ────────────────────────────────────────────────── */}
      <ToolBtn active={isSelectTool} accentColor={TOOL_ACCENT.select} title="Seleccionar imagen (V)" onClick={() => setActiveTool('select')}>
        <MousePointer size={16} />
      </ToolBtn>

      <Separator />

      {/* ── 1b. Drawing tools (5) ─────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 shrink-0">
        <ToolBtn active={activeTool === 'pen'}         accentColor={TOOL_ACCENT.pen}         title="Bolígrafo (P)"   onClick={() => setActiveTool('pen')}>
          <Pen size={16} />
        </ToolBtn>
        <ToolBtn active={activeTool === 'pencil'}      accentColor={TOOL_ACCENT.pencil}      title="Lápiz grafito"   onClick={() => setActiveTool('pencil')}>
          <Pencil size={16} />
        </ToolBtn>
        <ToolBtn active={activeTool === 'fountain'}    accentColor={TOOL_ACCENT.fountain}    title="Pluma fuente"    onClick={() => setActiveTool('fountain')}>
          <PenTool size={16} />
        </ToolBtn>
        <ToolBtn active={activeTool === 'highlighter'} accentColor={TOOL_ACCENT.highlighter} title="Marcador (H)"    onClick={() => setActiveTool('highlighter')}>
          <Highlighter size={16} />
        </ToolBtn>
        <ToolBtn active={activeTool === 'watercolor'}  accentColor={TOOL_ACCENT.watercolor}  title="Pincel acuarela" onClick={() => setActiveTool('watercolor')}>
          <Paintbrush size={16} />
        </ToolBtn>
      </div>

      <Separator />

      {/* ── 1b. Eraser ────────────────────────────────────────────────────── */}
      <ToolBtn active={isEraserTool} accentColor={TOOL_ACCENT.eraser} title="Borrador (E)" onClick={() => setActiveTool('eraser')}>
        <Eraser size={16} />
      </ToolBtn>

      <Separator />

      {/* ── 2. Color palette (drawing tools only) ─────────────────────────── */}
      {isDrawingTool && (
        <>
          <ColorPalette activeColor={activeColor} onChange={handleColorChange} />
          <Separator />
        </>
      )}

      {/* ── 2b. Eraser mode toggle ────────────────────────────────────────── */}
      {isEraserTool && (
        <>
          <EraserModeToggle mode={eraserMode} onChange={setEraserMode} />
          <Separator />
        </>
      )}

      {/* ── 3. Width presets ──────────────────────────────────────────────── */}
      <WidthPresets
        presets={activePresets}
        activeWidth={activeWidth}
        activeColor={accentForDot}
        onChange={handleWidthChange}
      />

      <Separator />

      {/* ── 4. Straight-line toggle ───────────────────────────────────────── */}
      <IconBtn
        title="Línea recta (L) · Shift para ángulos de 45°"
        onClick={() => setStraightLine(!straightLine)}
        active={straightLine}
      >
        <Ruler size={15} />
      </IconBtn>

      <Separator />

      {/* ── 4b. Image import ─────────────────────────────────────────────── */}
      <IconBtn
        title="Insertar imagen desde archivo"
        onClick={() => window.dispatchEvent(new CustomEvent('ink:import-image'))}
      >
        <ImageIcon size={15} />
      </IconBtn>

      <Separator />

      {/* ── 5. Actions ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-0.5 shrink-0">
        <IconBtn title="Deshacer (Ctrl+Z)" onClick={() => inkAction('undo')}>
          <Undo2 size={15} />
        </IconBtn>
        <IconBtn title="Rehacer (Ctrl+Y)" onClick={() => inkAction('redo')}>
          <Redo2 size={15} />
        </IconBtn>
        <ClearButton />
      </div>

      {/* ── Spacer ────────────────────────────────────────────────────────── */}
      <div className="flex-1 min-w-0" />

      {/* ── Export ────────────────────────────────────────────────────────── */}
      <ExportButton />

      <Separator />

      {/* ── Theme ─────────────────────────────────────────────────────────── */}
      <ThemeToggle />

      <Separator />

      {/* ── OCR ───────────────────────────────────────────────────────────── */}
      <OCRControl />

      <Separator />

      {/* ── 6. Zoom ───────────────────────────────────────────────────────── */}
      <ZoomControls />
    </header>
  )
}
