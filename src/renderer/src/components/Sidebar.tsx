import { useEffect } from 'react'
import { BookOpen, Plus } from 'lucide-react'
import { useAppStore } from '../store/appStore'
import { useNotebookStore } from '../stores/notebookStore'

export default function Sidebar() {
  const isSidebarOpen = useAppStore((s) => s.isSidebarOpen)
  const {
    notebooks,
    activeNotebook,
    pages,
    activePage,
    fetchNotebooks,
    createNotebook,
    selectNotebook,
    createPage,
    selectPage,
    isLoading,
  } = useNotebookStore()

  useEffect(() => {
    void fetchNotebooks()
  }, [fetchNotebooks])

  const handleNewNotebook = async () => {
    const name = prompt('Nombre del cuaderno:')
    if (!name?.trim()) return
    const nb = await createNotebook({ name: name.trim() })
    await selectNotebook(nb.id)
  }

  return (
    <aside
      className={[
        'no-select flex flex-col shrink-0 bg-white border-r border-surface-200',
        'transition-all duration-300 overflow-hidden',
        isSidebarOpen ? 'w-[240px]' : 'w-0',
      ].join(' ')}
    >
      <div className="flex flex-col h-full min-w-[240px]">

        {/* ── Notebooks ──────────────────────────────────────────────────── */}
        <section className="flex flex-col overflow-hidden" style={{ maxHeight: '50%' }}>
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Cuadernos
            </span>
            <button
              title="Nuevo cuaderno"
              onClick={() => void handleNewNotebook()}
              className="text-ink-soft hover:text-ink transition-colors"
            >
              <Plus size={14} />
            </button>
          </div>

          <ul className="overflow-y-auto px-2 flex-1">
            {isLoading && notebooks.length === 0 ? (
              <li className="px-2 py-4 text-center text-xs text-ink-soft">Cargando…</li>
            ) : notebooks.length === 0 ? (
              <li className="px-2 py-6 text-center text-xs text-ink-soft">
                Sin cuadernos aún
              </li>
            ) : (
              notebooks.map((nb) => (
                <li key={nb.id}>
                  <button
                    onClick={() => void selectNotebook(nb.id)}
                    className={[
                      'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors',
                      activeNotebook?.id === nb.id
                        ? 'bg-surface-100 text-ink font-medium'
                        : 'text-ink-soft hover:bg-surface-50',
                    ].join(' ')}
                  >
                    <span
                      className="w-2 h-2 rounded-full shrink-0"
                      style={{ backgroundColor: nb.color }}
                    />
                    <span className="truncate">{nb.name}</span>
                  </button>
                </li>
              ))
            )}
          </ul>
        </section>

        {/* ── Pages ──────────────────────────────────────────────────────── */}
        {activeNotebook && (
          <section className="flex flex-col flex-1 overflow-hidden border-t border-surface-100">
            <div className="flex items-center justify-between px-4 pt-3 pb-2">
              <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
                Páginas
              </span>
              <button
                title="Nueva página"
                onClick={() => void createPage()}
                className="text-ink-soft hover:text-ink transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>

            <ul className="overflow-y-auto px-2 flex-1">
              {pages.length === 0 ? (
                <li className="px-2 py-4 text-center text-xs text-ink-soft">
                  Sin páginas
                </li>
              ) : (
                pages.map((p, i) => (
                  <li key={p.id}>
                    <button
                      onClick={() => void selectPage(p)}
                      className={[
                        'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors',
                        activePage?.id === p.id
                          ? 'bg-surface-100 text-ink font-medium'
                          : 'text-ink-soft hover:bg-surface-50',
                      ].join(' ')}
                    >
                      <BookOpen size={12} className="shrink-0" />
                      <span className="truncate">Página {i + 1}</span>
                    </button>
                  </li>
                ))
              )}
            </ul>
          </section>
        )}

        {/* ── Footer ─────────────────────────────────────────────────────── */}
        <div className="px-4 py-3 border-t border-surface-100">
          <p className="text-xs text-ink-soft">
            {pages.length} {pages.length === 1 ? 'página' : 'páginas'}
            {activeNotebook ? ` · ${activeNotebook.name}` : ''}
          </p>
        </div>
      </div>
    </aside>
  )
}
