import { useState, useEffect, useRef } from 'react'
import { X } from 'lucide-react'
import type { PageTemplate } from '@shared/types'
import { useNotebookStore } from '../../stores/notebookStore'
import { renderTemplatePreview } from './PageTemplates'

// ── Constants ─────────────────────────────────────────────────────────────────

const NOTEBOOK_COLORS = [
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899',
  '#64748b', '#0f172a', '#854d0e', '#166534',
]

const TEMPLATES: { id: PageTemplate; label: string }[] = [
  { id: 'blank',  label: 'En blanco' },
  { id: 'lined',  label: 'Rayado' },
  { id: 'grid',   label: 'Cuadriculado' },
  { id: 'dotted', label: 'Punteado' },
]

// ── Types ─────────────────────────────────────────────────────────────────────

export interface NotebookCreateData {
  name: string
  subject?: string
  folderId?: string | null
  color: string
  defaultTemplate: PageTemplate
}

interface Props {
  onClose: () => void
  onCreate: (data: NotebookCreateData) => void
}

// ── Template preview canvas ────────────────────────────────────────────────────

function TemplatePreview({ template }: { template: PageTemplate }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const c = canvasRef.current
    if (!c) return
    const ctx = c.getContext('2d')
    if (!ctx) return
    renderTemplatePreview(ctx, template, c.width, c.height)
  }, [template])
  return (
    <canvas
      ref={canvasRef}
      width={48}
      height={64}
      className="rounded border border-surface-200"
    />
  )
}

// ── Category autocomplete input ────────────────────────────────────────────────

function CategoryInput({
  value,
  onChange,
  suggestions,
}: {
  value: string
  onChange: (v: string) => void
  suggestions: string[]
}) {
  const [open, setOpen] = useState(false)
  const filtered = suggestions.filter(
    (s) => s.toLowerCase().includes(value.toLowerCase()) && s !== value
  )
  const showDropdown = open && filtered.length > 0

  return (
    <div className="relative">
      <input
        value={value}
        onChange={(e) => { onChange(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 120)}
        placeholder="Ej. Matemáticas"
        className="w-full border border-surface-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
      />
      {showDropdown && (
        <ul className="absolute z-50 mt-1 w-full bg-white border border-surface-200 rounded-lg shadow-lg max-h-40 overflow-y-auto">
          {filtered.map((s) => (
            <li key={s}>
              <button
                type="button"
                onMouseDown={() => { onChange(s); setOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-sm hover:bg-surface-50 transition-colors"
              >
                {s}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function NotebookManager({ onClose, onCreate }: Props) {
  const [name, setName]       = useState('')
  const [subject, setSubject] = useState('')
  const [folderId, setFolderId] = useState<string | null>(null)
  const [color, setColor]     = useState(NOTEBOOK_COLORS[5])
  const [template, setTemplate] = useState<PageTemplate>('blank')

  const folders         = useNotebookStore((s) => s.folders)
  const categories      = useNotebookStore((s) => s.categories)
  const fetchCategories = useNotebookStore((s) => s.fetchCategories)

  useEffect(() => {
    void fetchCategories()
  }, [fetchCategories])

  const handleSubmit = () => {
    if (!name.trim()) return
    onCreate({
      name:            name.trim(),
      subject:         subject.trim() || undefined,
      folderId:        folderId,
      color,
      defaultTemplate: template,
    })
    onClose()
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl w-[380px] max-h-[90vh] overflow-y-auto p-6 flex flex-col gap-5"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-ink">Nuevo cuaderno</h2>
          <button
            onClick={onClose}
            className="text-ink-soft hover:text-ink transition-colors"
          >
            <X size={16} />
          </button>
        </div>

        {/* Name */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-ink-soft">Nombre *</label>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
            placeholder="Ej. Cálculo I"
            className="border border-surface-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          />
        </div>

        {/* Category (was "Asignatura") — free text with autocomplete */}
        <div className="flex flex-col gap-1.5">
          <label className="text-xs font-medium text-ink-soft">Categoría</label>
          <CategoryInput
            value={subject}
            onChange={setSubject}
            suggestions={categories}
          />
        </div>

        {/* Folder */}
        {folders.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-ink-soft">Carpeta</label>
            <select
              value={folderId ?? ''}
              onChange={(e) => setFolderId(e.target.value || null)}
              className="border border-surface-200 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 bg-white"
            >
              <option value="">Sin carpeta</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>{f.name}</option>
              ))}
            </select>
          </div>
        )}

        {/* Color palette */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-ink-soft">Color</label>
          <div className="flex flex-wrap gap-2">
            {NOTEBOOK_COLORS.map((c) => (
              <button
                key={c}
                onClick={() => setColor(c)}
                className={`w-7 h-7 rounded-full transition-all ${
                  color === c
                    ? 'ring-2 ring-offset-2 ring-blue-500 scale-110'
                    : 'hover:scale-105'
                }`}
                style={{ backgroundColor: c }}
              />
            ))}
          </div>
        </div>

        {/* Template */}
        <div className="flex flex-col gap-2">
          <label className="text-xs font-medium text-ink-soft">Plantilla de página</label>
          <div className="grid grid-cols-4 gap-2">
            {TEMPLATES.map((t) => (
              <button
                key={t.id}
                onClick={() => setTemplate(t.id)}
                className={`flex flex-col items-center gap-1 p-2 rounded-lg border-2 transition-colors ${
                  template === t.id
                    ? 'border-blue-400 bg-blue-50'
                    : 'border-surface-200 hover:border-surface-300'
                }`}
              >
                <TemplatePreview template={t.id} />
                <span className="text-[10px] text-ink-soft leading-tight">{t.label}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm rounded-lg text-ink-soft hover:bg-surface-100 transition-colors"
          >
            Cancelar
          </button>
          <button
            onClick={handleSubmit}
            disabled={!name.trim()}
            className="px-4 py-2 text-sm rounded-lg bg-blue-500 text-white hover:bg-blue-600 disabled:opacity-40 transition-colors"
          >
            Crear
          </button>
        </div>
      </div>
    </div>
  )
}
