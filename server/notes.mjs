import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import { NOTES_DIR, NOTES_INBOX, OBSIDIAN_VAULT } from './paths.mjs'

/**
 * Bridge to a folder of Markdown — an Obsidian vault, a plain notes directory,
 * or an agent-ops memory store. Reads the inbox, searches, resolves [[wikilinks]],
 * and appends new notes.
 *
 * It never deletes and never overwrites an existing file. The only two writes are
 * creating a new note and, on an explicit click, moving an inbox entry to _archive.
 */

const IGNORED_DIRS = new Set(['.obsidian', '.git', 'node_modules', '.trash', '_Trash', '.smart-env'])
const NOTE_EXT = new Set(['.md', '.txt'])

/** macOS writes filenames in NFD, Windows in NFC — without this the same word does not equal itself. */
const nfc = (s) => s.normalize('NFC')

function insideNotes(absolute) {
  if (!NOTES_DIR) return false
  const rel = path.relative(NOTES_DIR, absolute)
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel)
}

/**
 * Two checks, not one. The lexical check catches `../`; the realpath check catches
 * a symlink or junction sitting inside the notes folder and pointing anywhere else.
 * Only the first is obvious, and only the second stops a link named `inbox`.
 */
function resolveInNotes(relative) {
  if (!NOTES_DIR) throw new Error('No notes folder is connected')
  const absolute = path.resolve(NOTES_DIR, relative)
  if (!insideNotes(absolute)) throw new Error('That path escapes the notes folder')

  const rootReal = realpathSync(NOTES_DIR)
  // Walk up to the nearest existing ancestor: a file being created does not exist yet,
  // but the directory it lands in does, and that is what has to be contained.
  let probe = absolute
  while (!existsSync(probe)) {
    const parent = path.dirname(probe)
    if (parent === probe) break
    probe = parent
  }
  if (existsSync(probe)) {
    const probeReal = realpathSync(probe)
    const rel = path.relative(rootReal, probeReal)
    if (rel !== '' && (rel.startsWith('..') || path.isAbsolute(rel))) {
      throw new Error('That path resolves outside the notes folder')
    }
  }
  return absolute
}

/** Finds a free filename instead of assuming one suffix is enough. */
function uniquePath(dir, base, ext) {
  let candidate = path.join(dir, `${base}${ext}`)
  if (!existsSync(candidate)) return candidate
  const stamp = new Date().toISOString().slice(0, 10)
  candidate = path.join(dir, `${base} (${stamp})${ext}`)
  // The dated name collides on the second file of the same day, so keep counting.
  for (let n = 2; existsSync(candidate) && n < 1000; n += 1) {
    candidate = path.join(dir, `${base} (${stamp}-${n})${ext}`)
  }
  return candidate
}

const toRel = (absolute) => nfc(path.relative(NOTES_DIR, absolute).split(path.sep).join('/'))

export function notesStatus() {
  return {
    connected: Boolean(NOTES_DIR),
    dir: NOTES_DIR,
    inbox: NOTES_INBOX,
    obsidianVault: OBSIDIAN_VAULT,
    inboxExists: Boolean(NOTES_INBOX && existsSync(NOTES_INBOX)),
  }
}

/* -------------------------------------------------------------------- inbox */

export function listInbox() {
  if (!NOTES_INBOX || !existsSync(NOTES_INBOX)) return []
  const out = []
  for (const name of readdirSync(NOTES_INBOX)) {
    if (name.startsWith('.') || name.startsWith('_')) continue // _archive, _templates
    const absolute = path.join(NOTES_INBOX, name)
    const stat = statSync(absolute)
    if (stat.isDirectory()) continue

    const ext = path.extname(name).toLowerCase()
    // Sweeping only `.md` misses captures: text files, PDFs and images land here too.
    const isNote = NOTE_EXT.has(ext)
    let preview = ''
    if (isNote && stat.size < 200_000) {
      preview = nfc(readFileSync(absolute, 'utf8')).replace(/\r\n/g, '\n').slice(0, 600)
    }
    out.push({
      name: nfc(name),
      relPath: toRel(absolute),
      ext,
      kind: isNote ? 'note' : 'file',
      size: stat.size,
      modifiedAt: new Date(stat.mtimeMs).toISOString(),
      preview,
      lines: preview ? preview.split('\n').length : 0,
    })
  }
  return out.sort((a, b) => b.modifiedAt.localeCompare(a.modifiedAt))
}

export function archiveInboxEntry(relPath) {
  const absolute = resolveInNotes(relPath)
  if (!existsSync(absolute)) throw new Error('That file no longer exists')
  const archive = path.join(NOTES_INBOX, '_archive')
  mkdirSync(archive, { recursive: true })

  const ext = path.extname(absolute)
  const target = uniquePath(archive, path.basename(absolute, ext), ext)
  renameSync(absolute, target)
  return toRel(target)
}

/* -------------------------------------------------------------------- index */

let index = { builtAt: 0, files: [] }

function walk(dir, acc, depth = 0) {
  if (depth > 8) return
  let entries
  try {
    entries = readdirSync(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (entry.name.startsWith('.') || IGNORED_DIRS.has(entry.name)) continue
    const absolute = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walk(absolute, acc, depth + 1)
    } else if (path.extname(entry.name).toLowerCase() === '.md') {
      acc.push({ name: nfc(path.basename(entry.name, '.md')), relPath: toRel(absolute) })
    }
  }
}

function ensureIndex(maxAgeMs = 60_000) {
  if (!NOTES_DIR) return []
  if (Date.now() - index.builtAt < maxAgeMs && index.files.length) return index.files
  const files = []
  walk(NOTES_DIR, files)
  index = { builtAt: Date.now(), files }
  return files
}

export function searchNotes(query, limit = 12) {
  const files = ensureIndex()
  const q = nfc(query).toLowerCase().trim()
  if (!q) return files.slice(0, limit)

  const scored = []
  for (const file of files) {
    const name = file.name.toLowerCase()
    let score = -1
    if (name === q) score = 0
    else if (name.startsWith(q)) score = 1
    else if (name.includes(q)) score = 2
    else if (file.relPath.toLowerCase().includes(q)) score = 3
    if (score >= 0) scored.push({ ...file, score })
  }
  scored.sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
  return scored.slice(0, limit)
}

/** Resolves [[wikilink]] to a path by filename, the way Obsidian does. */
export function resolveWikilink(target) {
  const files = ensureIndex()
  const clean = nfc(target).split('|')[0].split('#')[0].trim()
  const lower = clean.toLowerCase()
  return (
    files.find((f) => f.relPath.toLowerCase() === `${lower}.md`) ??
    files.find((f) => f.name.toLowerCase() === lower) ??
    null
  )
}

/* -------------------------------------------------------------------- write */

const ILLEGAL = /[\\/:*?"<>|]/g

/**
 * No date prefix in the filename — the date goes at the end of the content as
 * `*Captured: YYYY-MM-DD*`, so notes sort by meaning rather than by when you had them.
 */
export function writeNote({ title, body, folder, source }) {
  if (!NOTES_DIR) throw new Error('No notes folder is connected')
  const safeTitle = nfc(String(title || 'Untitled')).replace(ILLEGAL, '-').trim().slice(0, 120)
  const dir = folder ? resolveInNotes(folder) : (NOTES_INBOX ?? NOTES_DIR)
  mkdirSync(dir, { recursive: true })

  // A name collision is never permission to overwrite someone's note.
  const file = uniquePath(dir, safeTitle, '.md')

  const parts = [`# ${safeTitle}`, '']
  if (body) parts.push(nfc(body).trim(), '')
  if (source) parts.push(`> From solo-ops: ${source}`, '')
  parts.push('---', '', `*Captured: ${new Date().toISOString().slice(0, 10)}*`, '')

  // `wx` fails instead of overwriting if the name was taken between the check
  // above and this line. Losing a note to a race is worse than failing loudly.
  writeFileSync(file, parts.join('\n'), { encoding: 'utf8', flag: 'wx' })
  index = { builtAt: 0, files: [] }
  return toRel(file)
}

export function readNote(relPath) {
  const absolute = resolveInNotes(relPath)
  if (!existsSync(absolute)) throw new Error('No such file')
  return nfc(readFileSync(absolute, 'utf8')).replace(/\r\n/g, '\n')
}
