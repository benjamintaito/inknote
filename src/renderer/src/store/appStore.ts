/**
 * appStore — UI-only state (sidebar open/closed, theme, etc.)
 * Notebook and page data lives in notebookStore.ts
 */
import { create } from 'zustand'

interface AppState {
  isSidebarOpen: boolean
  toggleSidebar: () => void
  isDark: boolean
  toggleTheme: () => void
}

export const useAppStore = create<AppState>((set) => ({
  isSidebarOpen: true,
  toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),

  isDark: false,
  toggleTheme: () =>
    set((s) => {
      const next = !s.isDark
      if (next) {
        document.documentElement.classList.add('dark')
      } else {
        document.documentElement.classList.remove('dark')
      }
      return { isDark: next }
    }),
}))
