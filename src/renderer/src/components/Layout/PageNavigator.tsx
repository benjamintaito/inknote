import { useRef, useEffect } from 'react'
import { Plus, Trash2 } from 'lucide-react'
import { useNotebookStore } from '../../stores/notebookStore'
import { useFileImage } from '../../hooks/useFileImage'
import type { PageMeta } from '@shared/types'

// ── Page card ─────────────────────────────────────────────────────────────────

function PageCard({
  page,
  index,
  isActive,
  onClick,
  onDelete,
}: {
  page: PageMeta
  index: number
  isActive: boolean
  onClick: () => void
  onDelete: () => void
}) {
  const ref = useRef<HTMLButtonElement>(null)
  const thumbUrl = useFileImage(page.thumbnailPath)

  // Scroll active page into view when it changes
  useEffect(() => {
    if (isActive) {
      ref.current?.scrollIntoView({ behavior: 'smooth', inline: 'center', block: 'nearest' })
    }
  }, [isActive])

  return (
    <li className="group relative shrink-0">
      <button
        ref={ref}
        onClick={onClick}
        className={[
          'flex flex-col items-center gap-1 p-1.5 rounded-lg border-2 transition-all select-none',
          isActive
            ? 'border-blue-400 bg-blue-50'
            : 'border-surface-200 hover:border-surface-300 bg-white',
        ].join(' ')}
        title={`Página ${index + 1}`}
      >
        {thumbUrl ? (
          <img
            src={thumbUrl}
            alt=""
            className="w-10 h-14 object-cover rounded"
          />
        ) : (
          <div className="w-10 h-14 rounded bg-surface-100 flex items-center justify-center text-xs text-ink-soft">
            {index + 1}
          </div>
        )}
        <span className="text-[10px] text-ink-soft leading-none">{index + 1}</span>
      </button>

      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center rounded-full bg-white border border-surface-200 text-red-400 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
        title="Eliminar página"
      >
        <Trash2 size={9} />
      </button>
    </li>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PageNavigator() {
  const { pages, activePage, activeNotebook, selectPage, createPage, deletePage } =
    useNotebookStore()

  const handleDelete = async (pageId: string) => {
    if (!confirm('¿Eliminar esta página?')) return
    await deletePage(pageId)
  }

  if (!activeNotebook) return null

  return (
    <nav className="shrink-0 h-24 bg-white border-t border-surface-200 flex items-center px-3 gap-2">
      {/* Scrollable page list */}
      <ul className="flex items-center gap-2 overflow-x-auto flex-1 h-full py-2">
        {pages.map((p, i) => (
          <PageCard
            key={p.id}
            page={p}
            index={i}
            isActive={activePage?.id === p.id}
            onClick={() => void selectPage(p)}
            onDelete={() => void handleDelete(p.id)}
          />
        ))}
      </ul>

      {/* Add page button */}
      <button
        onClick={() => void createPage()}
        className="shrink-0 flex flex-col items-center justify-center gap-1 w-16 h-[72px] rounded-lg border-2 border-dashed border-surface-200 text-ink-soft hover:border-blue-300 hover:text-blue-500 transition-colors"
        title="Nueva página"
      >
        <Plus size={16} />
        <span className="text-[10px] leading-none">Añadir</span>
      </button>
    </nav>
  )
}
