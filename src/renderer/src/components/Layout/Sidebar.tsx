import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, ChevronDown, ChevronRight, BookOpen, Trash2, FileUp,
  Search, X, FolderPlus, Folder, MoreHorizontal, FolderOpen,
} from 'lucide-react'
import { useAppStore } from '../../store/appStore'
import { useNotebookStore } from '../../stores/notebookStore'
import NotebookManager, { type NotebookCreateData } from '../Notebook/NotebookManager'
import type { FolderMeta, NotebookMeta, PageMeta, PageTemplate, SearchResult } from '@shared/types'
import { IPC } from '@shared/types'

// ── Helpers ────────────────────────────────────────────────────────────────────

function toFileUrl(path: string | null): string | null {
  if (!path) return null
  return 'file:///' + path.replace(/\\/g, '/')
}

const FOLDER_COLORS = [
  '#6B7280', '#ef4444', '#f97316', '#eab308',
  '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899',
]

// ── Page item ─────────────────────────────────────────────────────────────────

function PageItem({
  page, index, isActive, onClick, onDelete,
}: {
  page: PageMeta; index: number; isActive: boolean
  onClick: () => void; onDelete: () => void
}) {
  const thumbUrl = toFileUrl(page.thumbnailPath)
  return (
    <li className="group relative">
      <button
        onClick={onClick}
        draggable={false}
        className={[
          'w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-left transition-colors',
          isActive ? 'bg-blue-50 text-ink font-medium' : 'text-ink-soft hover:bg-surface-50',
        ].join(' ')}
      >
        {thumbUrl ? (
          <img src={thumbUrl} alt="" className="w-7 h-9 object-cover rounded border border-surface-200 shrink-0" />
        ) : (
          <BookOpen size={12} className="shrink-0" />
        )}
        <span className="truncate flex-1">Página {index + 1}</span>
        {isActive && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 shrink-0" />}
      </button>
      <button
        onClick={(e) => { e.stopPropagation(); onDelete() }}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded text-red-400 hover:bg-red-50 transition-colors opacity-0 group-hover:opacity-100"
        title="Eliminar página"
      >
        <Trash2 size={11} />
      </button>
    </li>
  )
}

// ── Move-to-folder dropdown ────────────────────────────────────────────────────

function MoveFolderMenu({
  folders, currentFolderId, onMove, onClose,
}: {
  folders: FolderMeta[]; currentFolderId: string | null
  onMove: (folderId: string | null) => void; onClose: () => void
}) {
  return (
    <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-surface-200 rounded-lg shadow-lg min-w-[140px] py-1">
      <button
        onMouseDown={() => { onMove(null); onClose() }}
        className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-50 ${!currentFolderId ? 'font-medium text-blue-600' : 'text-ink-soft'}`}
      >
        Sin carpeta
      </button>
      {folders.map((f) => (
        <button
          key={f.id}
          onMouseDown={() => { onMove(f.id); onClose() }}
          className={`w-full text-left px-3 py-1.5 text-xs hover:bg-surface-50 flex items-center gap-2 ${currentFolderId === f.id ? 'font-medium text-blue-600' : 'text-ink-soft'}`}
        >
          <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: f.color }} />
          <span className="truncate">{f.name}</span>
        </button>
      ))}
    </div>
  )
}

// ── Notebook section ──────────────────────────────────────────────────────────

function NotebookSection({
  notebook, isActive, pages, activePage, isExpanded, isLoading,
  folders, onSelect, onToggle, onNewPage, onSelectPage, onDeletePage,
  onDelete, onMoveFolder,
}: {
  notebook: NotebookMeta; isActive: boolean; pages: PageMeta[]
  activePage: PageMeta | null; isExpanded: boolean; isLoading: boolean
  folders: FolderMeta[]
  onSelect: () => void; onToggle: () => void
  onNewPage: (template?: PageTemplate) => void
  onSelectPage: (page: PageMeta) => void; onDeletePage: (pageId: string) => void
  onDelete: () => void; onMoveFolder: (folderId: string | null) => void
}) {
  const [showMoveMenu, setShowMoveMenu] = useState(false)

  return (
    <li
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData('notebookId', notebook.id)
        e.dataTransfer.effectAllowed = 'move'
      }}
    >
      {/* Header row */}
      <div className="group flex items-center gap-1 px-1 py-1 rounded-md hover:bg-surface-50 transition-colors">
        <button
          onClick={onToggle}
          className="p-0.5 text-ink-soft hover:text-ink transition-colors shrink-0"
        >
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        <button
          onClick={() => { onSelect(); if (!isExpanded) onToggle() }}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: notebook.color }} />
          <div className="flex flex-col min-w-0">
            <span className={`text-sm truncate leading-tight ${isActive ? 'text-ink font-medium' : 'text-ink-soft'}`}>
              {notebook.name}
            </span>
            {notebook.subject && (
              <span className="text-[10px] text-ink-soft truncate leading-tight">
                {notebook.subject}
              </span>
            )}
          </div>
        </button>

        <div className="flex items-center gap-0.5 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); onNewPage() }}
            className="p-1 rounded text-ink-soft hover:text-ink hover:bg-surface-100 transition-colors"
            title="Nueva página"
          >
            <Plus size={12} />
          </button>
          {/* Move to folder */}
          {folders.length > 0 && (
            <div className="relative">
              <button
                onClick={(e) => { e.stopPropagation(); setShowMoveMenu((v) => !v) }}
                onBlur={() => setTimeout(() => setShowMoveMenu(false), 120)}
                className="p-1 rounded text-ink-soft hover:text-ink hover:bg-surface-100 transition-colors"
                title="Mover a carpeta"
              >
                <Folder size={11} />
              </button>
              {showMoveMenu && (
                <MoveFolderMenu
                  folders={folders}
                  currentFolderId={notebook.folderId}
                  onMove={onMoveFolder}
                  onClose={() => setShowMoveMenu(false)}
                />
              )}
            </div>
          )}
          <button
            onClick={(e) => { e.stopPropagation(); onDelete() }}
            className="p-1 rounded text-red-400 hover:bg-red-50 transition-colors"
            title="Eliminar cuaderno"
          >
            <Trash2 size={11} />
          </button>
        </div>
      </div>

      {/* Pages */}
      {isExpanded && (
        <ul className="ml-5 mt-0.5 flex flex-col gap-0.5">
          {isLoading ? (
            <li className="px-2 py-2 text-xs text-ink-soft">Cargando…</li>
          ) : pages.length === 0 ? (
            <li className="px-2 py-2 text-xs text-ink-soft">Sin páginas</li>
          ) : (
            pages.map((p, i) => (
              <PageItem
                key={p.id} page={p} index={i}
                isActive={activePage?.id === p.id}
                onClick={() => onSelectPage(p)}
                onDelete={() => onDeletePage(p.id)}
              />
            ))
          )}
          <li>
            <button
              onClick={() => onNewPage()}
              className="w-full flex items-center gap-1.5 px-2 py-1.5 rounded-md text-xs text-ink-soft hover:bg-surface-50 transition-colors"
            >
              <Plus size={11} />
              <span>Nueva página</span>
            </button>
          </li>
        </ul>
      )}
    </li>
  )
}

// ── Folder section ─────────────────────────────────────────────────────────────

function FolderSection({
  folder, notebooks, activeNotebook, pages, activePage, isExpanded, isLoading,
  allFolders, expandedNotebookIds,
  onToggleFolder, onSelectNotebook, onToggleNotebook, onNewPage,
  onSelectPage, onDeletePage, onDeleteNotebook, onMoveFolder,
  onRenameFolder, onDeleteFolder, onColorFolder,
}: {
  folder: FolderMeta
  notebooks: NotebookMeta[]
  activeNotebook: NotebookMeta | null
  pages: PageMeta[]; activePage: PageMeta | null
  isExpanded: boolean; isLoading: boolean
  allFolders: FolderMeta[]
  expandedNotebookIds: Set<string>
  onToggleFolder: () => void
  onSelectNotebook: (id: string) => void
  onToggleNotebook: (id: string) => void
  onNewPage: (notebookId: string, template?: PageTemplate) => void
  onSelectPage: (page: PageMeta) => void
  onDeletePage: (pageId: string) => void
  onDeleteNotebook: (id: string) => void
  onMoveFolder: (notebookId: string, folderId: string | null) => void
  onRenameFolder: (id: string, name: string) => void
  onDeleteFolder: (id: string) => void
  onColorFolder: (id: string, color: string) => void
}) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [renameVal, setRenameVal] = useState(folder.name)
  const renameRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (renaming) renameRef.current?.focus()
  }, [renaming])

  const commitRename = () => {
    if (renameVal.trim() && renameVal.trim() !== folder.name) {
      onRenameFolder(folder.id, renameVal.trim())
    }
    setRenaming(false)
  }

  // Drop target for notebooks
  const [dragOver, setDragOver] = useState(false)

  return (
    <li>
      {/* Folder header */}
      <div
        className={`group flex items-center gap-1 px-1 py-1 rounded-md transition-colors ${dragOver ? 'bg-blue-50' : 'hover:bg-surface-50'}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const nbId = e.dataTransfer.getData('notebookId')
          if (nbId) onMoveFolder(nbId, folder.id)
        }}
      >
        <button onClick={onToggleFolder} className="p-0.5 text-ink-soft hover:text-ink transition-colors shrink-0">
          {isExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>

        <button onClick={onToggleFolder} className="flex items-center gap-1.5 flex-1 min-w-0 text-left">
          {isExpanded
            ? <FolderOpen size={13} style={{ color: folder.color }} className="shrink-0" />
            : <Folder     size={13} style={{ color: folder.color }} className="shrink-0" />
          }
          {renaming ? (
            <input
              ref={renameRef}
              value={renameVal}
              onChange={(e) => setRenameVal(e.target.value)}
              onBlur={commitRename}
              onKeyDown={(e) => { if (e.key === 'Enter') commitRename(); if (e.key === 'Escape') { setRenaming(false); setRenameVal(folder.name) } }}
              onClick={(e) => e.stopPropagation()}
              className="flex-1 min-w-0 text-xs bg-transparent outline-none border-b border-blue-400"
            />
          ) : (
            <span className="text-xs font-medium text-ink-soft truncate flex-1">{folder.name}</span>
          )}
          <span className="text-[10px] text-ink-soft shrink-0 ml-1">{notebooks.length}</span>
        </button>

        {/* Folder context menu */}
        <div className="relative shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={(e) => { e.stopPropagation(); setMenuOpen((v) => !v) }}
            onBlur={() => setTimeout(() => setMenuOpen(false), 150)}
            className="p-1 rounded text-ink-soft hover:text-ink hover:bg-surface-100 transition-colors"
          >
            <MoreHorizontal size={12} />
          </button>
          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 z-50 bg-white border border-surface-200 rounded-lg shadow-lg min-w-[140px] py-1">
              <button
                onMouseDown={() => { setRenaming(true); setMenuOpen(false) }}
                className="w-full text-left px-3 py-1.5 text-xs text-ink-soft hover:bg-surface-50"
              >
                Renombrar
              </button>
              {/* Color picker */}
              <div className="px-3 py-2 flex flex-wrap gap-1">
                {FOLDER_COLORS.map((c) => (
                  <button
                    key={c}
                    onMouseDown={() => { onColorFolder(folder.id, c); setMenuOpen(false) }}
                    className={`w-4 h-4 rounded-full transition-all hover:scale-110 ${folder.color === c ? 'ring-1 ring-offset-1 ring-blue-400' : ''}`}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="border-t border-surface-100 mt-1 pt-1">
                <button
                  onMouseDown={() => { onDeleteFolder(folder.id); setMenuOpen(false) }}
                  className="w-full text-left px-3 py-1.5 text-xs text-red-500 hover:bg-red-50"
                >
                  Eliminar carpeta
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Notebooks inside folder */}
      {isExpanded && (
        <ul className="ml-3 mt-0.5 flex flex-col gap-0.5">
          {notebooks.length === 0 ? (
            <li className="px-2 py-1.5 text-[10px] text-ink-soft italic">Arrastra cuadernos aquí</li>
          ) : (
            notebooks.map((nb) => (
              <NotebookSection
                key={nb.id}
                notebook={nb}
                isActive={activeNotebook?.id === nb.id}
                pages={activeNotebook?.id === nb.id ? pages : []}
                activePage={activePage}
                isExpanded={expandedNotebookIds.has(nb.id)}
                isLoading={isLoading && activeNotebook?.id === nb.id}
                folders={allFolders}
                onSelect={() => onSelectNotebook(nb.id)}
                onToggle={() => onToggleNotebook(nb.id)}
                onNewPage={(t) => onNewPage(nb.id, t)}
                onSelectPage={onSelectPage}
                onDeletePage={onDeletePage}
                onDelete={() => onDeleteNotebook(nb.id)}
                onMoveFolder={(fid) => onMoveFolder(nb.id, fid)}
              />
            ))
          )}
        </ul>
      )}
    </li>
  )
}

// ── Search results ─────────────────────────────────────────────────────────────

function SearchResultItem({ result, onClick }: { result: SearchResult; onClick: () => void }) {
  return (
    <li>
      <button onClick={onClick} className="w-full text-left px-2 py-1.5 rounded-md hover:bg-surface-50 transition-colors">
        <div className="text-xs font-medium text-ink truncate">
          {result.notebookName} · Pág. {result.pageOrder + 1}
        </div>
        <div
          className="text-[10px] text-ink-soft leading-snug mt-0.5 line-clamp-2"
          dangerouslySetInnerHTML={{ __html: result.excerpt.replace(/«(.*?)»/g, '<mark class="bg-yellow-100 rounded px-0.5">$1</mark>') }}
        />
      </button>
    </li>
  )
}

// ── New-folder inline form ─────────────────────────────────────────────────────

function NewFolderForm({ onSubmit, onCancel }: { onSubmit: (name: string) => void; onCancel: () => void }) {
  const [name, setName] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => { inputRef.current?.focus() }, [])

  const submit = () => { if (name.trim()) { onSubmit(name.trim()); setName('') } }

  return (
    <div className="flex items-center gap-1 px-2 py-1">
      <Folder size={12} className="text-ink-soft shrink-0" />
      <input
        ref={inputRef}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') submit(); if (e.key === 'Escape') onCancel() }}
        onBlur={() => setTimeout(onCancel, 120)}
        placeholder="Nombre de carpeta"
        className="flex-1 min-w-0 text-xs bg-transparent outline-none border-b border-blue-400 py-0.5"
      />
      <button onMouseDown={submit} className="p-0.5 text-blue-500 hover:text-blue-700">
        <Plus size={12} />
      </button>
    </div>
  )
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

export default function Sidebar() {
  const isSidebarOpen = useAppStore((s) => s.isSidebarOpen)
  const {
    folders, notebooks, activeNotebook, pages, activePage, isLoading,
    fetchNotebooks, createNotebook, deleteNotebook, selectNotebook,
    createPage, selectPage, deletePage, importPDFFull,
    createFolder, updateFolder, deleteFolder, moveNotebookToFolder,
    searchQuery, searchResults, runSearch, clearSearch,
  } = useNotebookStore()

  const [showManager, setShowManager] = useState(false)
  const [showNewFolder, setShowNewFolder] = useState(false)
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(new Set())
  const [expandedNotebookIds, setExpandedNotebookIds] = useState<Set<string>>(new Set())
  const [unfolderExpanded, setUnfolderExpanded] = useState(true)
  const [searchInput, setSearchInput] = useState('')

  // Debounced search
  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null)
  const handleSearchChange = (q: string) => {
    setSearchInput(q)
    if (searchDebounce.current) clearTimeout(searchDebounce.current)
    searchDebounce.current = setTimeout(() => void runSearch(q), 300)
  }

  const handleClearSearch = () => { setSearchInput(''); clearSearch() }

  useEffect(() => { void fetchNotebooks() }, [fetchNotebooks])

  // Keep active notebook and its folder expanded
  useEffect(() => {
    if (activeNotebook) {
      setExpandedNotebookIds((prev) => new Set([...prev, activeNotebook.id]))
      if (activeNotebook.folderId) {
        setExpandedFolderIds((prev) => new Set([...prev, activeNotebook.folderId!]))
      }
    }
  }, [activeNotebook?.id, activeNotebook?.folderId])

  useEffect(() => {
    const handler = () => setShowManager(true)
    window.addEventListener('inknote:new-notebook', handler)
    return () => window.removeEventListener('inknote:new-notebook', handler)
  }, [])

  const toggleFolder   = useCallback((id: string) => {
    setExpandedFolderIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])
  const toggleNotebook = useCallback((id: string) => {
    setExpandedNotebookIds((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  }, [])

  const handleCreate = async (data: NotebookCreateData) => {
    const nb = await createNotebook({
      name: data.name, subject: data.subject,
      color: data.color, folderId: data.folderId ?? null,
    })
    await selectNotebook(nb.id)
    await createPage(data.defaultTemplate)
  }

  const handleNewPage = (notebookId: string, template?: PageTemplate) => {
    if (activeNotebook?.id !== notebookId) {
      void selectNotebook(notebookId).then(() => createPage(template))
    } else {
      void createPage(template)
    }
  }

  const handleDeleteNotebook = async (id: string) => {
    if (!confirm('¿Eliminar el cuaderno y todas sus páginas?')) return
    await deleteNotebook(id)
  }

  const handleDeletePage = async (pageId: string) => {
    if (!confirm('¿Eliminar esta página?')) return
    await deletePage(pageId)
  }

  const handleDeleteFolder = async (id: string) => {
    if (!confirm('¿Eliminar la carpeta? Los cuadernos dentro quedarán sin carpeta.')) return
    await deleteFolder(id)
  }

  const handleSearchNavigate = async (result: SearchResult) => {
    handleClearSearch()
    if (activeNotebook?.id !== result.notebookId) await selectNotebook(result.notebookId)
    const { pages: currentPages } = useNotebookStore.getState()
    const page = currentPages.find((p) => p.id === result.pageId)
    if (page) await selectPage(page)
  }

  const handleImportPDF = async () => {
    const filePath = await window.electronAPI.invoke<string | null>(IPC.PDF_OPEN_DIALOG)
    if (!filePath) return
    const filename = filePath.split(/[\\/]/).pop() ?? 'PDF'
    const name = filename.replace(/\.pdf$/i, '')
    await importPDFFull(filePath, name)
  }

  // Group notebooks
  const notebooksInFolder = (folderId: string) => notebooks.filter((n) => n.folderId === folderId)
  const unfolderedNotebooks = notebooks.filter((n) => !n.folderId)

  // Shared notebook section renderer (reused for folder content and "sin carpeta")
  const renderNotebook = (nb: NotebookMeta) => (
    <NotebookSection
      key={nb.id}
      notebook={nb}
      isActive={activeNotebook?.id === nb.id}
      pages={activeNotebook?.id === nb.id ? pages : []}
      activePage={activePage}
      isExpanded={expandedNotebookIds.has(nb.id)}
      isLoading={isLoading && activeNotebook?.id === nb.id}
      folders={folders}
      onSelect={() => void selectNotebook(nb.id)}
      onToggle={() => toggleNotebook(nb.id)}
      onNewPage={(t) => handleNewPage(nb.id, t)}
      onSelectPage={(page) => void selectPage(page)}
      onDeletePage={(pageId) => void handleDeletePage(pageId)}
      onDelete={() => void handleDeleteNotebook(nb.id)}
      onMoveFolder={(fid) => void moveNotebookToFolder(nb.id, fid)}
    />
  )

  return (
    <>
      <aside
        className={[
          'no-select flex flex-col shrink-0 bg-paper border-r border-surface-200',
          'transition-all duration-300 overflow-hidden',
          isSidebarOpen ? 'w-[240px]' : 'w-0',
        ].join(' ')}
      >
        <div className="flex flex-col h-full min-w-[240px]">

          {/* Header */}
          <div className="flex items-center justify-between px-4 pt-4 pb-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-soft">
              Cuadernos
            </span>
            <div className="flex items-center gap-1">
              <button
                title="Nueva carpeta"
                onClick={() => setShowNewFolder((v) => !v)}
                className="text-ink-soft hover:text-ink transition-colors"
              >
                <FolderPlus size={14} />
              </button>
              <button
                title="Nuevo cuaderno"
                onClick={() => setShowManager(true)}
                className="text-ink-soft hover:text-ink transition-colors"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>

          {/* New folder inline form */}
          {showNewFolder && (
            <div className="px-2 pb-1">
              <NewFolderForm
                onSubmit={async (name) => { await createFolder(name); setShowNewFolder(false) }}
                onCancel={() => setShowNewFolder(false)}
              />
            </div>
          )}

          {/* Search bar */}
          <div className="px-2 pb-2">
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md bg-surface-50 border border-surface-200 focus-within:border-blue-300 transition-colors">
              <Search size={11} className="text-ink-soft shrink-0" />
              <input
                type="text"
                placeholder="Buscar texto…"
                value={searchInput}
                onChange={(e) => handleSearchChange(e.target.value)}
                className="flex-1 text-xs bg-transparent outline-none text-ink placeholder-ink-soft min-w-0"
              />
              {searchInput && (
                <button onClick={handleClearSearch} className="text-ink-soft hover:text-ink transition-colors shrink-0">
                  <X size={10} />
                </button>
              )}
            </div>
          </div>

          {/* List or search results */}
          <ul className="overflow-y-auto px-2 flex-1 flex flex-col gap-0.5 pb-2">
            {searchQuery ? (
              searchResults.length === 0 ? (
                <li className="px-2 py-4 text-center text-xs text-ink-soft">Sin resultados.</li>
              ) : (
                searchResults.map((r) => (
                  <SearchResultItem key={r.pageId} result={r} onClick={() => void handleSearchNavigate(r)} />
                ))
              )
            ) : isLoading && notebooks.length === 0 ? (
              <li className="px-2 py-4 text-center text-xs text-ink-soft">Cargando…</li>
            ) : notebooks.length === 0 && folders.length === 0 ? (
              <li className="px-4 py-6 text-center text-xs text-ink-soft leading-relaxed">
                Sin cuadernos.<br />Usa el botón + para crear uno.
              </li>
            ) : (
              <>
                {/* Folder sections */}
                {folders.map((folder) => (
                  <FolderSection
                    key={folder.id}
                    folder={folder}
                    notebooks={notebooksInFolder(folder.id)}
                    activeNotebook={activeNotebook}
                    pages={pages}
                    activePage={activePage}
                    isExpanded={expandedFolderIds.has(folder.id)}
                    isLoading={isLoading}
                    allFolders={folders}
                    expandedNotebookIds={expandedNotebookIds}
                    onToggleFolder={() => toggleFolder(folder.id)}
                    onSelectNotebook={(id) => void selectNotebook(id)}
                    onToggleNotebook={toggleNotebook}
                    onNewPage={handleNewPage}
                    onSelectPage={(page) => void selectPage(page)}
                    onDeletePage={(pageId) => void handleDeletePage(pageId)}
                    onDeleteNotebook={(id) => void handleDeleteNotebook(id)}
                    onMoveFolder={(nbId, fid) => void moveNotebookToFolder(nbId, fid)}
                    onRenameFolder={(id, name) => void updateFolder(id, { name })}
                    onDeleteFolder={(id) => void handleDeleteFolder(id)}
                    onColorFolder={(id, color) => void updateFolder(id, { color })}
                  />
                ))}

                {/* Sin carpeta section */}
                {unfolderedNotebooks.length > 0 && (
                  <li>
                    {/* Only show "Sin carpeta" header when there are also folders */}
                    {folders.length > 0 && (
                      <div
                        className="flex items-center gap-1 px-1 py-1 rounded-md hover:bg-surface-50 transition-colors cursor-pointer"
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={(e) => {
                          e.preventDefault()
                          const nbId = e.dataTransfer.getData('notebookId')
                          if (nbId) void moveNotebookToFolder(nbId, null)
                        }}
                        onClick={() => setUnfolderExpanded((v) => !v)}
                      >
                        <button className="p-0.5 text-ink-soft shrink-0">
                          {unfolderExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                        </button>
                        <span className="text-xs text-ink-soft font-medium flex-1">Sin carpeta</span>
                        <span className="text-[10px] text-ink-soft">{unfolderedNotebooks.length}</span>
                      </div>
                    )}
                    {(folders.length === 0 || unfolderExpanded) && (
                      <ul className={folders.length > 0 ? 'ml-3 mt-0.5 flex flex-col gap-0.5' : 'flex flex-col gap-0.5'}>
                        {unfolderedNotebooks.map(renderNotebook)}
                      </ul>
                    )}
                  </li>
                )}
              </>
            )}
          </ul>

          {/* Import PDF button */}
          <button
            onClick={() => void handleImportPDF()}
            className="flex items-center gap-2 w-full px-3 py-2 text-xs text-ink-soft hover:bg-surface-50 transition-colors border-t border-surface-100"
            title="Importar PDF"
          >
            <FileUp size={13} />
            <span>Importar PDF</span>
          </button>

          {/* Footer */}
          <div className="px-4 py-3 border-t border-surface-100">
            <p className="text-xs text-ink-soft truncate">
              {activeNotebook
                ? `${pages.length} ${pages.length === 1 ? 'página' : 'páginas'} · ${activeNotebook.name}`
                : 'Selecciona un cuaderno'}
            </p>
          </div>
        </div>
      </aside>

      {showManager && (
        <NotebookManager
          onClose={() => setShowManager(false)}
          onCreate={(data) => void handleCreate(data)}
        />
      )}
    </>
  )
}
