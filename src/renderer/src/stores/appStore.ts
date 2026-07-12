/**
 * appStore — UI-only state (sidebar open/closed, theme, etc.)
 * Notebook and page data lives in notebookStore.ts
 */
import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AppState {
  isSidebarOpen: boolean
  toggleSidebar: () => void
  isDark: boolean
  toggleTheme: () => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      isSidebarOpen: true,
      toggleSidebar: () => set((s) => ({ isSidebarOpen: !s.isSidebarOpen })),

      isDark: false,
      toggleTheme: () =>
        set((s) => {
          const next = !s.isDark
          document.documentElement.classList.toggle('dark', next)
          return { isDark: next }
        }),
    }),
    { name: 'inknote-app-prefs' }
  )
)
