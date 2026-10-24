import { app, BrowserWindow, dialog, ipcMain, shell } from 'electron'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { initDb, closeDb } from './db.js'
import { registerIpcHandlers } from './ipc-handlers.js'
import { IPC } from '../shared/types.js'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    frame: true,
    backgroundColor: '#f8f8f8',
    webPreferences: {
      preload: join(__dirname, '../preload/index.cjs'),
      sandbox: false,
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  mainWindow.on('ready-to-show', () => mainWindow.show())

  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  // Dropping a file on the window would otherwise navigate away from the app
  // (losing unsaved strokes). The app is a single page: block all navigation.
  mainWindow.webContents.on('will-navigate', (e) => e.preventDefault())

  // Give the renderer a chance to flush pending auto-saves before closing.
  // Falls back to closing anyway if it doesn't answer (e.g. it crashed).
  let closeConfirmed = false
  let closeRequested = false
  mainWindow.on('close', (e) => {
    if (closeConfirmed) return
    e.preventDefault()
    if (closeRequested) return
    closeRequested = true

    const finish = () => {
      clearTimeout(timer)
      ipcMain.removeListener(IPC.APP_CLOSE_READY, onReady)
      closeConfirmed = true
      if (!mainWindow.isDestroyed()) mainWindow.close()
    }
    const onReady = (ev: Electron.IpcMainEvent) => {
      if (ev.sender === mainWindow.webContents) finish()
    }
    const timer = setTimeout(finish, 4000)
    ipcMain.on(IPC.APP_CLOSE_READY, onReady)
    mainWindow.webContents.send(IPC.APP_BEFORE_CLOSE)
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  // Init DB and IPC before creating the window so handlers are ready
  try {
    await initDb()
  } catch (e) {
    dialog.showErrorBox('InkNote', `No se pudo inicializar la base de datos:\n${String(e)}`)
    app.quit()
    return
  }
  registerIpcHandlers()
  createWindow()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('will-quit', () => {
  closeDb()
})
