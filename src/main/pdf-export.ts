import { dialog } from 'electron'
import { readFileSync, writeFileSync } from 'fs'

export async function showOpenPDFDialog(): Promise<string | null> {
  const { canceled, filePaths } = await dialog.showOpenDialog({
    title: 'Importar PDF',
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
    properties: ['openFile'],
  })
  return canceled || filePaths.length === 0 ? null : filePaths[0]
}

export async function showSavePDFDialog(defaultName: string): Promise<string | null> {
  const { canceled, filePath } = await dialog.showSaveDialog({
    title: 'Exportar PDF anotado',
    defaultPath: defaultName,
    filters: [{ name: 'PDF', extensions: ['pdf'] }],
  })
  return canceled || !filePath ? null : filePath
}

export function readFileBytes(filePath: string): Buffer {
  return readFileSync(filePath)
}

export function writePDFBytes(filePath: string, bytes: Uint8Array): void {
  writeFileSync(filePath, Buffer.from(bytes))
}
