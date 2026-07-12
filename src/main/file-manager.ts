/**
 * file-manager.ts — Filesystem operations for InkNote.
 *
 * Directory layout (under app.getPath('userData')):
 *
 *   data/
 *     notebooks/
 *       {notebook-id}/
 *         pages/
 *           page-{page-id}.json    ← stroke data (atomic write)
 *         thumbnails/
 *           thumb-{page-id}.png
 *         assets/
 *           {uuid}.pdf
 */

import { app } from 'electron'
import { join, extname } from 'path'
import {
  mkdirSync,
  existsSync,
  writeFileSync,
  readFileSync,
  renameSync,
  copyFileSync,
  rmSync,
} from 'fs'
import { randomUUID } from 'crypto'
import { gzipSync, gunzipSync } from 'zlib'
import type { StrokeFile } from '../shared/types.js'

// ── Base directory (lazy — only after app is ready) ────────────────────────────

let _baseDir: string | null = null

function baseDir(): string {
  if (!_baseDir) {
    _baseDir = join(app.getPath('userData'), 'data', 'notebooks')
    mkdirSync(_baseDir, { recursive: true })
  }
  return _baseDir
}

// ── Directory helpers ──────────────────────────────────────────────────────────

const nbDir         = (nbId: string) => join(baseDir(), nbId)
const pagesDir      = (nbId: string) => join(nbDir(nbId), 'pages')
const thumbnailsDir = (nbId: string) => join(nbDir(nbId), 'thumbnails')
const assetsDir     = (nbId: string) => join(nbDir(nbId), 'assets')

export function ensureNotebookDirs(notebookId: string): void {
  mkdirSync(pagesDir(notebookId),      { recursive: true })
  mkdirSync(thumbnailsDir(notebookId), { recursive: true })
  mkdirSync(assetsDir(notebookId),     { recursive: true })
}

// ── Atomic write ───────────────────────────────────────────────────────────────
//
// Write to a .tmp file first, then rename() to the target.
// rename() is atomic on the same filesystem, so a crash mid-write
// leaves the old file intact.

function atomicWrite(targetPath: string, data: string | Buffer): void {
  const tmpPath = `${targetPath}.tmp`
  if (typeof data === 'string') {
    writeFileSync(tmpPath, data, 'utf8')
  } else {
    writeFileSync(tmpPath, data)
  }
  renameSync(tmpPath, targetPath)
}

// ── Stroke data ────────────────────────────────────────────────────────────────

export function saveStrokeData(
  notebookId: string,
  pageId: string,
  file: StrokeFile
): string {
  ensureNotebookDirs(notebookId)
  const filePath = join(pagesDir(notebookId), `page-${pageId}.json.gz`)
  const compressed = gzipSync(Buffer.from(JSON.stringify(file), 'utf8'))
  atomicWrite(filePath, compressed)
  return filePath
}

export function loadStrokeData(notebookId: string, pageId: string): StrokeFile | null {
  // Try compressed format first
  const gzPath = join(pagesDir(notebookId), `page-${pageId}.json.gz`)
  if (existsSync(gzPath)) {
    try {
      const compressed = readFileSync(gzPath)
      const json = gunzipSync(compressed).toString('utf8')
      return JSON.parse(json) as StrokeFile
    } catch (e) {
      console.error('[InkNote] Failed to read gzipped stroke file', gzPath, e)
    }
  }
  // Fall back to plain JSON
  const filePath = join(pagesDir(notebookId), `page-${pageId}.json`)
  if (!existsSync(filePath)) return null
  try {
    return JSON.parse(readFileSync(filePath, 'utf8')) as StrokeFile
  } catch (e) {
    console.error('[InkNote] Failed to parse stroke file', filePath, e)
    return null
  }
}

// ── Thumbnails ─────────────────────────────────────────────────────────────────

export function saveThumbnail(notebookId: string, pageId: string, base64: string): string {
  ensureNotebookDirs(notebookId)
  const filePath = join(thumbnailsDir(notebookId), `thumb-${pageId}.jpg`)
  const raw = base64.includes(',') ? base64.split(',')[1] : base64
  const buffer = Buffer.from(raw, 'base64')
  atomicWrite(filePath, buffer)
  return filePath
}

export function getThumbnailPath(notebookId: string, pageId: string): string {
  return join(thumbnailsDir(notebookId), `thumb-${pageId}.jpg`)
}

// ── PDF import ─────────────────────────────────────────────────────────────────

export function importPDF(notebookId: string, sourcePath: string): string {
  ensureNotebookDirs(notebookId)
  const filename = `${randomUUID()}.pdf`
  const destPath = join(assetsDir(notebookId), filename)
  copyFileSync(sourcePath, destPath)
  return destPath
}

// ── Image import ───────────────────────────────────────────────────────────────

/** Copy an image file into a notebook's assets folder. Returns the absolute dest path. */
export function importImage(notebookId: string, sourcePath: string): string {
  ensureNotebookDirs(notebookId)
  const ext = extname(sourcePath).toLowerCase() || '.png'
  const filename = `img-${randomUUID()}${ext}`
  const destPath = join(assetsDir(notebookId), filename)
  copyFileSync(sourcePath, destPath)
  return destPath
}

/** Save a raw image buffer (from clipboard) into a notebook's assets folder. */
export function saveImageFromBuffer(notebookId: string, buffer: Buffer, ext: string): string {
  ensureNotebookDirs(notebookId)
  const filename = `img-${randomUUID()}.${ext}`
  const destPath = join(assetsDir(notebookId), filename)
  atomicWrite(destPath, buffer)
  return destPath
}

// ── Page deletion ──────────────────────────────────────────────────────────────

/** Remove a page's stroke data and thumbnail from disk (assets are shared, kept). */
export function deletePageFiles(notebookId: string, pageId: string): void {
  const candidates = [
    join(pagesDir(notebookId), `page-${pageId}.json.gz`),
    join(pagesDir(notebookId), `page-${pageId}.json`),
    join(thumbnailsDir(notebookId), `thumb-${pageId}.jpg`),
  ]
  for (const path of candidates) {
    if (existsSync(path)) rmSync(path, { force: true })
  }
}

// ── Notebook deletion ──────────────────────────────────────────────────────────

export function deleteNotebookFiles(notebookId: string): void {
  const dir = nbDir(notebookId)
  if (!existsSync(dir)) return
  rmSync(dir, { recursive: true, force: true })
}
