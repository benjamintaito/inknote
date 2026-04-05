import { useEffect, useCallback } from 'react'
import { useToolStore } from '../stores/toolStore'
import { useNotebookStore } from '../stores/notebookStore'

// ── Types ──────────────────────────────────────────────────────────────────────

interface KeyboardShortcutsOptions {
  /** Called on Ctrl+Z */
  undo?: () => void
  /** Called on Ctrl+Shift+Z and Ctrl+Y */
  redo?: () => void
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * Attaches global keyboard shortcuts to the window.
 *
 * Undo/redo are owned by the canvas component (via useUndoRedo), so pass
 * those callbacks in via options rather than pulling from a store.
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions = {}): void {
  const { undo, redo } = options

  const setActiveTool    = useToolStore((s) => s.setActiveTool)
  const saveCurrentPage  = useNotebookStore((s) => s.saveCurrentPage)
  const createPage       = useNotebookStore((s) => s.createPage)

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target  = e.target as HTMLElement
      const tagName = target.tagName

      // ── Ctrl combos ─────────────────────────────────────────────────────────
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase()

        if (key === 'z' && e.shiftKey) {
          e.preventDefault()
          redo?.()
          return
        }

        if (key === 'z') {
          e.preventDefault()
          undo?.()
          return
        }

        if (key === 'y') {
          e.preventDefault()
          redo?.()
          return
        }

        if (key === 's') {
          e.preventDefault()
          void saveCurrentPage()
          return
        }

        if (key === 'n') {
          e.preventDefault()
          void createPage()
          return
        }

        return
      }

      // ── Single-key shortcuts (skip when typing in inputs) ────────────────────
      if (tagName === 'INPUT' || tagName === 'TEXTAREA') return

      switch (e.key) {
        case 'p':
        case 'P':
          setActiveTool('pen')
          break
        case 'e':
        case 'E':
          setActiveTool('eraser')
          break
        case 'h':
        case 'H':
          setActiveTool('highlighter')
          break
        case ' ':
          e.preventDefault()
          setActiveTool('pan')
          break
        case 'Escape':
          setActiveTool('pen')
          break
      }
    },
    [undo, redo, setActiveTool, saveCurrentPage, createPage]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}
