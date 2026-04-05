import { useAppStore } from '../store/appStore'

export default function Toolbar() {
  const { isSidebarOpen, toggleSidebar } = useAppStore()

  return (
    <header className="no-select flex items-center gap-2 px-3 h-[48px] bg-white border-b border-surface-200 shrink-0">
      {/* Sidebar toggle */}
      <button
        onClick={toggleSidebar}
        title={isSidebarOpen ? 'Cerrar panel' : 'Abrir panel'}
        className="p-1.5 rounded hover:bg-surface-100 transition-colors text-ink-soft"
      >
        <svg
          width="18"
          height="18"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <line x1="9" y1="3" x2="9" y2="21" />
        </svg>
      </button>

      <div className="w-px h-5 bg-surface-200" />

      {/* App title */}
      <span className="text-sm font-semibold text-ink tracking-tight">
        InkNote
      </span>

      <div className="flex-1" />

      {/* Placeholder actions */}
      <button
        title="Nueva nota"
        className="flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-md bg-ink text-white hover:bg-ink-soft transition-colors"
      >
        <svg
          width="14"
          height="14"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          strokeLinecap="round"
        >
          <line x1="12" y1="5" x2="12" y2="19" />
          <line x1="5" y1="12" x2="19" y2="12" />
        </svg>
        Nueva nota
      </button>
    </header>
  )
}
