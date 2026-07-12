import { useState, useEffect } from 'react'
import { IPC } from '@shared/types'

/**
 * Load an image file from disk as a data URL via IPC.
 *
 * `file:///` URLs are blocked by the renderer's CSP (and by webSecurity when
 * the app is served over http in dev), so thumbnails and other local images
 * must go through the `image:read` channel instead.
 */
export function useFileImage(filePath: string | null): string | null {
  const [dataUrl, setDataUrl] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    if (!filePath) {
      setDataUrl(null)
      return
    }
    window.electronAPI
      .invoke<string | null>(IPC.IMAGE_READ, { filePath })
      .then((url) => { if (!cancelled) setDataUrl(url) })
      .catch(() => { if (!cancelled) setDataUrl(null) })
    return () => { cancelled = true }
  }, [filePath])

  return dataUrl
}
