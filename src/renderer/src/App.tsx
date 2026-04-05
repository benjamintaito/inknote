import { useRef, useEffect, useState } from 'react'
import { Pen } from 'lucide-react'
import Toolbar from './components/Layout/Toolbar'
import Sidebar from './components/Layout/Sidebar'
import PageNavigator from './components/Layout/PageNavigator'
import MainArea from './components/MainArea'
import { useToolStore, resolveInkSettings } from './stores/toolStore'
import { useAppStore } from './store/appStore'
import type { InkToolSettings } from './hooks/useInkCanvas'

// ── Splash screen ─────────────────────────────────────────────────────────────

function SplashScreen() {
  return (
    <div
      className="fixed inset-0 z-50 flex flex-col items-center justify-center bg-surface-50 text-ink"
      style={{ animation: 'ink-fade-in 0.3s ease-out' }}
    >
      <div className="flex flex-col items-center gap-4" style={{ animation: 'ink-fade-in 0.4s ease-out' }}>
        <div className="w-16 h-16 rounded-2xl bg-ink flex items-center justify-center shadow-lg">
          <Pen size={32} className="text-paper" />
        </div>
        <div className="flex flex-col items-center gap-1">
          <h1 className="text-2xl font-semibold tracking-tight">InkNote</h1>
          <div className="flex items-center gap-1 mt-1">
            <span
              className="w-1.5 h-1.5 rounded-full bg-ink-soft animate-pulse"
              style={{ animationDelay: '0ms' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-ink-soft animate-pulse"
              style={{ animationDelay: '150ms' }}
            />
            <span
              className="w-1.5 h-1.5 rounded-full bg-ink-soft animate-pulse"
              style={{ animationDelay: '300ms' }}
            />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  // Stable ref shared with InkCanvas — updated via Zustand subscription (no re-renders)
  const toolRef = useRef<InkToolSettings>(resolveInkSettings(useToolStore.getState()))

  const [showSplash, setShowSplash] = useState(true)

  // Subscribe to tool store changes
  useEffect(() => {
    const unsub = useToolStore.subscribe((state) => {
      toolRef.current = resolveInkSettings(state)
    })
    return unsub
  }, [])

  // Apply theme on mount
  useEffect(() => {
    const { isDark } = useAppStore.getState()
    if (isDark) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [])

  // Hide splash after 400ms
  useEffect(() => {
    const timer = setTimeout(() => setShowSplash(false), 400)
    return () => clearTimeout(timer)
  }, [])

  return (
    <>
      {showSplash && <SplashScreen />}
      <div className="flex flex-col h-full bg-surface-50 text-ink">
        <Toolbar />
        <div className="flex flex-1 overflow-hidden">
          <Sidebar />
          <div className="flex flex-col flex-1 overflow-hidden">
            <MainArea toolRef={toolRef} />
            <PageNavigator />
          </div>
        </div>
      </div>
    </>
  )
}
