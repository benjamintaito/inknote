/**
 * db.ts — SQLite via sql.js (WebAssembly, no native compilation required).
 *
 * sql.js keeps the database in memory and persists it to disk manually.
 * We write after every mutation using atomic write (tmp → rename) to
 * avoid corruption on crash.
 */

import { app } from 'electron'
import { join, dirname } from 'path'
import { mkdirSync, existsSync, readFileSync, writeFileSync, renameSync } from 'fs'
import { createRequire } from 'module'
import type { Database, SqlValue } from 'sql.js'
import type { FolderMeta, NotebookMeta, PageMeta, PageTemplate, SearchResult } from '../shared/types.js'

// ── sql.js WASM location ───────────────────────────────────────────────────────
// createRequire lets us resolve CommonJS packages from an ESM context.

const _require = createRequire(import.meta.url)
const sqlJsDist = dirname(_require.resolve('sql.js'))

// ── Internal state ─────────────────────────────────────────────────────────────

let db: Database | null = null
let dbPath = ''

// ── Query helpers ──────────────────────────────────────────────────────────────

type Row = Record<string, SqlValue>

function assertDb(): Database {
  if (!db) throw new Error('Database not initialised — call initDb() first')
  return db
}

/** SELECT → array of row objects */
function all(sql: string, params: SqlValue[] = []): Row[] {
  const stmt = assertDb().prepare(sql)
  stmt.bind(params)
  const rows: Row[] = []
  while (stmt.step()) rows.push(stmt.getAsObject() as Row)
  stmt.free()
  return rows
}

/** SELECT → first row or null */
function one(sql: string, params: SqlValue[] = []): Row | null {
  const stmt = assertDb().prepare(sql)
  stmt.bind(params)
  const row = stmt.step() ? (stmt.getAsObject() as Row) : null
  stmt.free()
  return row
}

/** INSERT / UPDATE / DELETE */
function run(sql: string, params: SqlValue[] = []): void {
  assertDb().run(sql, params)
  persist()
}

/** Run multiple statements (DDL) without persisting on each */
function exec(sql: string): void {
  assertDb().exec(sql)
}

/** Wrap several run() calls in a transaction */
function transaction(fn: (r: (sql: string, p?: SqlValue[]) => void) => void): void {
  const d = assertDb()
  d.run('BEGIN')
  try {
    fn((sql, p) => d.run(sql, p))
    d.run('COMMIT')
    persist()
  } catch (e) {
    d.run('ROLLBACK')
    throw e
  }
}

// ── Atomic persistence ─────────────────────────────────────────────────────────

function persist(): void {
  if (!db || !dbPath) return
  const tmp = `${dbPath}.tmp`
  writeFileSync(tmp, Buffer.from(db.export()))
  renameSync(tmp, dbPath)
}

// ── Schema ─────────────────────────────────────────────────────────────────────

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS folders (
    id         TEXT PRIMARY KEY,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '#6B7280',
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS notebooks (
    id          TEXT PRIMARY KEY,
    name        TEXT NOT NULL,
    subject     TEXT,
    color       TEXT NOT NULL DEFAULT '#1a1a2e',
    folder_id   TEXT REFERENCES folders(id),
    created_at  TEXT NOT NULL,
    updated_at  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS pages (
    id                TEXT PRIMARY KEY,
    notebook_id       TEXT NOT NULL REFERENCES notebooks(id) ON DELETE CASCADE,
    page_order        INTEGER NOT NULL DEFAULT 0,
    width             INTEGER NOT NULL DEFAULT 2480,
    height            INTEGER NOT NULL DEFAULT 3508,
    template          TEXT NOT NULL DEFAULT 'blank',
    pdf_path          TEXT,
    stroke_data_path  TEXT,
    thumbnail_path    TEXT,
    created_at        TEXT NOT NULL,
    updated_at        TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_pages_notebook
    ON pages (notebook_id, page_order);
`

// ── Migrations ─────────────────────────────────────────────────────────────────

function runMigrations(): void {
  // Add ocr_text column if missing
  const pageCols = all('PRAGMA table_info(pages)')
  if (!pageCols.some((c) => c['name'] === 'ocr_text')) {
    exec('ALTER TABLE pages ADD COLUMN ocr_text TEXT')
  }

  // Add folder_id to notebooks if missing (for DBs created before folders feature)
  const nbCols = all('PRAGMA table_info(notebooks)')
  if (!nbCols.some((c) => c['name'] === 'folder_id')) {
    exec('ALTER TABLE notebooks ADD COLUMN folder_id TEXT REFERENCES folders(id)')
  }
}

// ── Lifecycle ──────────────────────────────────────────────────────────────────

export async function initDb(): Promise<void> {
  const { default: initSqlJs } = await import('sql.js')

  // Locate the WASM binary — in packaged app it lives in resources/
  const SQL = await initSqlJs({
    locateFile: (file: string) =>
      app.isPackaged
        ? join(process.resourcesPath, file)
        : join(sqlJsDist, file),
  })

  const userDataPath = app.getPath('userData')
  mkdirSync(userDataPath, { recursive: true })
  dbPath = join(userDataPath, 'inknote.db')

  if (existsSync(dbPath)) {
    db = new SQL.Database(readFileSync(dbPath))
    console.log('[InkNote] Database loaded from', dbPath)
  } else {
    db = new SQL.Database()
    console.log('[InkNote] New database created at', dbPath)
  }

  db.run('PRAGMA foreign_keys = ON')
  exec(SCHEMA)
  runMigrations()
  persist() // write schema immediately
}

export function closeDb(): void {
  if (!db) return
  persist()
  db.close()
  db = null
}

// ── Row ↔ Meta helpers ─────────────────────────────────────────────────────────

function toFolder(r: Row): FolderMeta {
  return {
    id:        r['id'] as string,
    name:      r['name'] as string,
    color:     r['color'] as string,
    sortOrder: r['sort_order'] as number,
    createdAt: r['created_at'] as string,
  }
}

function toNb(r: Row): NotebookMeta {
  return {
    id:        r['id'] as string,
    name:      r['name'] as string,
    subject:   r['subject'] as string | null,
    color:     r['color'] as string,
    folderId:  (r['folder_id'] as string | null) ?? null,
    createdAt: r['created_at'] as string,
    updatedAt: r['updated_at'] as string,
  }
}

function toPage(r: Row): PageMeta {
  return {
    id:              r['id'] as string,
    notebookId:      r['notebook_id'] as string,
    pageOrder:       r['page_order'] as number,
    width:           r['width'] as number,
    height:          r['height'] as number,
    template:        r['template'] as PageTemplate,
    pdfPath:         r['pdf_path'] as string | null,
    strokeDataPath:  r['stroke_data_path'] as string | null,
    thumbnailPath:   r['thumbnail_path'] as string | null,
    createdAt:       r['created_at'] as string,
    updatedAt:       r['updated_at'] as string,
  }
}

// ── Folders ────────────────────────────────────────────────────────────────────

export function createFolder(
  data: Pick<FolderMeta, 'id' | 'name' | 'color'>
): FolderMeta {
  const now = new Date().toISOString()
  const maxRow = one('SELECT MAX(sort_order) AS m FROM folders')
  const sortOrder = ((maxRow?.['m'] as number | null) ?? -1) + 1
  run(
    'INSERT INTO folders (id, name, color, sort_order, created_at) VALUES (?, ?, ?, ?, ?)',
    [data.id, data.name, data.color, sortOrder, now]
  )
  return { id: data.id, name: data.name, color: data.color, sortOrder, createdAt: now }
}

export function getFolders(): FolderMeta[] {
  return all('SELECT * FROM folders ORDER BY sort_order, created_at').map(toFolder)
}

export function updateFolder(
  id: string,
  data: Partial<Pick<FolderMeta, 'name' | 'color'>>
): void {
  const sets: string[] = []
  const vals: SqlValue[] = []
  if (data.name  !== undefined) { sets.push('name = ?');  vals.push(data.name) }
  if (data.color !== undefined) { sets.push('color = ?'); vals.push(data.color) }
  if (sets.length === 0) return
  vals.push(id)
  run(`UPDATE folders SET ${sets.join(', ')} WHERE id = ?`, vals)
}

export function deleteFolder(id: string): void {
  // Detach notebooks first (SQLite doesn't support ON DELETE SET NULL easily)
  run('UPDATE notebooks SET folder_id = NULL WHERE folder_id = ?', [id])
  run('DELETE FROM folders WHERE id = ?', [id])
}

// ── Notebooks ──────────────────────────────────────────────────────────────────

export function createNotebook(
  data: Pick<NotebookMeta, 'id' | 'name' | 'subject' | 'color'> & { folderId?: string | null }
): NotebookMeta {
  const now = new Date().toISOString()
  run(
    'INSERT INTO notebooks (id, name, subject, color, folder_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    [data.id, data.name, data.subject ?? null, data.color, data.folderId ?? null, now, now]
  )
  return { ...data, subject: data.subject ?? null, folderId: data.folderId ?? null, createdAt: now, updatedAt: now }
}

export function getNotebooks(): NotebookMeta[] {
  return all('SELECT * FROM notebooks ORDER BY created_at DESC').map(toNb)
}

export function getNotebookById(id: string): NotebookMeta | null {
  const r = one('SELECT * FROM notebooks WHERE id = ?', [id])
  return r ? toNb(r) : null
}

export function updateNotebook(
  id: string,
  data: Partial<Pick<NotebookMeta, 'name' | 'subject' | 'color' | 'folderId'>>
): void {
  const now = new Date().toISOString()
  const sets: string[] = []
  const vals: SqlValue[] = []
  if (data.name     !== undefined) { sets.push('name = ?');      vals.push(data.name) }
  if (data.subject  !== undefined) { sets.push('subject = ?');   vals.push(data.subject) }
  if (data.color    !== undefined) { sets.push('color = ?');     vals.push(data.color) }
  if (data.folderId !== undefined) { sets.push('folder_id = ?'); vals.push(data.folderId) }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  vals.push(now, id)
  run(`UPDATE notebooks SET ${sets.join(', ')} WHERE id = ?`, vals)
}

export function deleteNotebook(id: string): void {
  run('DELETE FROM notebooks WHERE id = ?', [id])
}

export function moveNotebookToFolder(notebookId: string, folderId: string | null): void {
  updateNotebook(notebookId, { folderId })
}

export function getNotebookCategories(): string[] {
  return all(
    'SELECT DISTINCT subject FROM notebooks WHERE subject IS NOT NULL ORDER BY subject'
  ).map((r) => r['subject'] as string)
}

// ── Pages ──────────────────────────────────────────────────────────────────────

export function createPage(data: {
  id: string; notebookId: string; template: PageTemplate; width: number; height: number
}): PageMeta {
  const now = new Date().toISOString()
  const r = one('SELECT MAX(page_order) AS m FROM pages WHERE notebook_id = ?', [data.notebookId])
  const order = ((r?.['m'] as number | null) ?? -1) + 1

  run(
    `INSERT INTO pages
       (id, notebook_id, page_order, width, height, template,
        pdf_path, stroke_data_path, thumbnail_path, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, NULL, ?, ?)`,
    [data.id, data.notebookId, order, data.width, data.height, data.template, now, now]
  )

  return {
    id: data.id, notebookId: data.notebookId, pageOrder: order,
    width: data.width, height: data.height, template: data.template,
    pdfPath: null, strokeDataPath: null, thumbnailPath: null,
    createdAt: now, updatedAt: now,
  }
}

export function getPages(notebookId: string): PageMeta[] {
  return all(
    'SELECT * FROM pages WHERE notebook_id = ? ORDER BY page_order',
    [notebookId]
  ).map(toPage)
}

export function deletePage(id: string): void {
  run('DELETE FROM pages WHERE id = ?', [id])
}

export function reorderPages(notebookId: string, pageIds: string[]): void {
  const now = new Date().toISOString()
  transaction((r) => {
    pageIds.forEach((id, i) =>
      r('UPDATE pages SET page_order = ?, updated_at = ? WHERE id = ? AND notebook_id = ?',
        [i, now, id, notebookId])
    )
  })
}

export function updatePagePaths(
  id: string,
  paths: Partial<{ strokeDataPath: string; thumbnailPath: string; pdfPath: string }>
): void {
  const now = new Date().toISOString()
  const sets: string[] = []
  const vals: SqlValue[] = []
  if (paths.strokeDataPath !== undefined) { sets.push('stroke_data_path = ?'); vals.push(paths.strokeDataPath) }
  if (paths.thumbnailPath  !== undefined) { sets.push('thumbnail_path = ?');   vals.push(paths.thumbnailPath) }
  if (paths.pdfPath        !== undefined) { sets.push('pdf_path = ?');         vals.push(paths.pdfPath) }
  if (sets.length === 0) return
  sets.push('updated_at = ?')
  vals.push(now, id)
  run(`UPDATE pages SET ${sets.join(', ')} WHERE id = ?`, vals)
}

// ── OCR + Search ────────────────────────────────────────────────────────────────

export function saveOCRText(pageId: string, text: string): void {
  const now = new Date().toISOString()
  run('UPDATE pages SET ocr_text = ?, updated_at = ? WHERE id = ?', [text, now, pageId])
}

/** Extract a short excerpt showing the match with surrounding context. */
function buildExcerpt(text: string, query: string, maxLen = 120): string {
  const lower = text.toLowerCase()
  const idx   = lower.indexOf(query.toLowerCase())
  if (idx === -1) return text.slice(0, maxLen) + (text.length > maxLen ? '…' : '')
  const start  = Math.max(0, idx - 30)
  const end    = Math.min(text.length, idx + query.length + 60)
  const before = start > 0 ? '…' : ''
  const after  = end < text.length ? '…' : ''
  const raw    = text.slice(start, end)
  // Mark the match with guillemets for the renderer to highlight
  const marked = raw.replace(
    new RegExp(query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'),
    (m) => `«${m}»`
  )
  return before + marked + after
}

export function searchPages(query: string): SearchResult[] {
  const q = query.trim()
  if (!q) return []

  try {
    const rows = all(
      `SELECT
         p.id          AS page_id,
         p.notebook_id,
         n.name        AS notebook_name,
         p.page_order,
         p.ocr_text
       FROM pages     p
       JOIN notebooks n ON n.id = p.notebook_id
       WHERE p.ocr_text LIKE ? ESCAPE '\'
       LIMIT 30`,
      [`%${q.replace(/[%_\\]/g, '\\$&')}%`]
    )
    return rows.map((r) => ({
      pageId:       r['page_id']       as string,
      notebookId:   r['notebook_id']   as string,
      notebookName: r['notebook_name'] as string,
      pageOrder:    r['page_order']    as number,
      excerpt:      buildExcerpt(r['ocr_text'] as string ?? '', q),
    }))
  } catch {
    return []
  }
}
