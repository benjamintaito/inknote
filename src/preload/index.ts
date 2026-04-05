import { contextBridge, ipcRenderer } from 'electron'

// Expose a safe API from the main process to the renderer
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  send: (channel: string, data?: unknown) => ipcRenderer.send(channel, data),
  on: (channel: string, callback: (...args: unknown[]) => void) => {
    const subscription = (_: Electron.IpcRendererEvent, ...args: unknown[]) =>
      callback(...args)
    ipcRenderer.on(channel, subscription)
    return () => ipcRenderer.removeListener(channel, subscription)
  },
  invoke: (channel: string, data?: unknown) => ipcRenderer.invoke(channel, data)
})
