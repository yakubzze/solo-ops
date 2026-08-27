import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

const HOME = homedir()

/**
 * Where data lives is chosen, never derived from where this code happens to sit.
 * Move the checkout, clone it elsewhere, rename a parent folder — the store does
 * not follow, because nothing here reads the checkout path.
 *
 * The default is a plain local directory. Syncing is a deliberate choice you make
 * in config.json, not something guessed from the presence of a cloud folder: a
 * default that changes with the weather is worse than one you can read.
 */
const DEFAULT_DATA_DIR = path.join(HOME, 'solo-ops')

function readConfig() {
  const file = path.join(ROOT, 'config.json')
  if (!existsSync(file)) return {}
  try {
    return JSON.parse(readFileSync(file, 'utf8'))
  } catch {
    console.warn('[paths] config.json is not readable JSON — ignoring it')
    return {}
  }
}

const config = readConfig()

/** `~/notes` has to work in a config file — it is the only spelling that is true on every machine. */
function resolveHome(value) {
  if (!value) return value
  return value.startsWith('~/') || value.startsWith('~\\') ? path.join(HOME, value.slice(2)) : value
}

function pick(envKey, configKey, fallback) {
  const fromEnv = process.env[envKey]
  if (fromEnv) return { dir: path.resolve(resolveHome(fromEnv)), source: `env:${envKey}` }
  if (config[configKey]) return { dir: path.resolve(resolveHome(config[configKey])), source: 'config.json' }
  return fallback ? { dir: fallback, source: 'default' } : { dir: null, source: 'not configured' }
}

const dataPick = pick('SOLO_OPS_DATA_DIR', 'dataDir', DEFAULT_DATA_DIR)
const notesPick = pick('SOLO_OPS_NOTES_DIR', 'notesDir', null)

export const DATA_DIR = dataPick.dir
export const DATA_DIR_SOURCE = dataPick.source
export const ISSUES_DIR = path.join(DATA_DIR, 'issues')
export const BACKUP_DIR = path.join(DATA_DIR, 'backups')
export const TRASH_FILE = path.join(DATA_DIR, 'trash.json')
export const WORKSPACE_FILE = path.join(DATA_DIR, 'workspace.json')

export const NOTES_DIR = notesPick.dir && existsSync(notesPick.dir) ? notesPick.dir : null
export const NOTES_DIR_SOURCE = notesPick.dir
  ? existsSync(notesPick.dir)
    ? notesPick.source
    : 'configured, but that folder does not exist'
  : notesPick.source

/**
 * The inbox is wherever loose captures land. `_Inbox` matches the common Obsidian
 * convention, `inbox` covers plain notes folders. Set `notesInbox` to override.
 * The last resort is the notes root itself, which is right for a flat folder.
 */
function resolveInbox() {
  if (!NOTES_DIR) return null
  const configured = config.notesInbox ?? process.env.SOLO_OPS_NOTES_INBOX
  for (const candidate of configured ? [configured] : ['_Inbox', 'inbox', 'Inbox', '00 Inbox']) {
    const dir = path.resolve(NOTES_DIR, candidate)
    if (existsSync(dir)) return dir
  }
  return NOTES_DIR
}

export const NOTES_INBOX = resolveInbox()

/**
 * Optional. Set it to your Obsidian vault name and linked notes become
 * `obsidian://` deep links. Leave it empty and notes are still searchable,
 * linkable and readable — there is just no button that opens an external editor.
 */
export const OBSIDIAN_VAULT = config.obsidianVault ?? process.env.SOLO_OPS_OBSIDIAN_VAULT ?? null

export function ensureDirs() {
  // A configured store that is not on disk almost never means "make me a new one".
  // It means the sync client has not caught up yet, or the folder was renamed on the
  // other machine. Creating it here seeds an example workspace on top of that, and
  // the app then looks perfectly healthy while showing data belonging to nobody.
  // Only the default location may be brought into existence.
  if (DATA_DIR_SOURCE !== 'default' && !existsSync(DATA_DIR)) {
    throw new Error(
      `the configured data folder is not there.\n\n` +
        `      ${DATA_DIR}   [${DATA_DIR_SOURCE}]\n\n` +
        `      Nothing was created. If it lives in a synced folder, let the sync finish;\n` +
        `      if it was renamed or moved, point dataDir at where it is now.\n` +
        `      Starting a new store here is a one-liner: mkdir -p "${DATA_DIR}"`
    )
  }
  for (const dir of [DATA_DIR, ISSUES_DIR, BACKUP_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

export function describePaths() {
  return {
    dataDir: DATA_DIR,
    dataDirSource: DATA_DIR_SOURCE,
    notesDir: NOTES_DIR,
    notesDirSource: NOTES_DIR_SOURCE,
    notesInbox: NOTES_INBOX,
    obsidianVault: OBSIDIAN_VAULT,
    notesConnected: Boolean(NOTES_DIR),
  }
}
