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
 * Attaches all global keyboard shortcuts to the window. This is the single
 * place shortcuts are registered — components dispatch/receive `ink:action`
 * events instead of adding their own key listeners.
 *
 * Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y  undo / redo
 * Ctrl+S                          save current page
 * Ctrl+E                          export annotated PDF
 * Ctrl+N                          new notebook dialog
 * P / E / H / V                   pen / eraser / highlighter / select
 * L                               toggle straight-line mode
 * Escape                          back to pen
 */
export function useKeyboardShortcuts(options: KeyboardShortcutsOptions = {}): void {
  const { undo, redo } = options

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      const target = e.target as HTMLElement
      const isTyping =
        target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.tagName === 'SELECT' ||
        target.isContentEditable

      // ── Ctrl combos ─────────────────────────────────────────────────────────
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase()

        if (key === 'z') {
          e.preventDefault()
          if (e.shiftKey) redo?.()
          else undo?.()
          return
        }

        if (key === 'y') {
          e.preventDefault()
          redo?.()
          return
        }

        if (key === 's') {
          e.preventDefault()
          void useNotebookStore.getState().saveCurrentPage()
          return
        }

        if (key === 'e') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('ink:action', { detail: 'export' }))
          return
        }

        if (key === 'n') {
          e.preventDefault()
          window.dispatchEvent(new CustomEvent('inknote:new-notebook'))
          return
        }

        return
      }

      // ── Single-key shortcuts (skip while typing in form fields) ──────────────
      if (isTyping) return

      const { setActiveTool, setStraightLine, straightLine } = useToolStore.getState()

      switch (e.key.toLowerCase()) {
        case 'p':
          setActiveTool('pen')
          break
        case 'e':
          setActiveTool('eraser')
          break
        case 'h':
          setActiveTool('highlighter')
          break
        case 'v':
          setActiveTool('select')
          break
        case 'l':
          setStraightLine(!straightLine)
          break
        case 'escape':
          setActiveTool('pen')
          break
      }
    },
    [undo, redo]
  )

  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleKeyDown])
}
