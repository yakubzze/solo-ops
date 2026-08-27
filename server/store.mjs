import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import path from 'node:path'
import {
  BACKUP_DIR,
  DATA_DIR,
  ISSUES_DIR,
  TRASH_FILE,
  WORKSPACE_FILE,
  ensureDirs,
} from './paths.mjs'
import { seedIssues, seedWorkspace } from './seed.mjs'

const BACKUP_KEEP_DAYS = 30

/**
 * snapshots holds what last passed through this process: mtime plus raw content.
 * This is what protects the other machine from a silent overwrite: if the file on disk
 * differs from our snapshot, someone (another machine, sync, an editor) changed it.
 */
const snapshots = new Map()

function readJson(file, fallback) {
  if (!existsSync(file)) return { value: fallback, fresh: true }
  const raw = readFileSync(file, 'utf8')
  snapshots.set(file, { mtimeMs: statSync(file).mtimeMs, raw })
  try {
    return { value: JSON.parse(raw), fresh: false }
  } catch (err) {
    throw new Error(`${path.basename(file)} is not valid JSON: ${err.message}`)
  }
}

/** True when the file changed outside this process. */
function changedOnDisk(file) {
  if (!existsSync(file)) return false
  const snap = snapshots.get(file)
  if (!snap) return true
  if (statSync(file).mtimeMs === snap.mtimeMs) return false
  // Sync can move mtime without touching content; only differing content is a conflict.
  return readFileSync(file, 'utf8') !== snap.raw
}

function writeJsonAtomic(file, value) {
  const raw = JSON.stringify(value, null, 2) + '\n'

  // Writing content identical to what is already on disk changes nothing,
  // but it wakes the file watcher — which is exactly how a write/reload loop forms.
  // The mtime check matters: if the file is moving underneath us, the write must happen.
  const known = snapshots.get(file)
  if (known && known.raw === raw && existsSync(file) && statSync(file).mtimeMs === known.mtimeMs) {
    return
  }

  const tmp = `${file}.tmp`
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(tmp, raw, 'utf8')
  try {
    renameSync(tmp, file)
  } catch {
    // Sync clients on Windows can hold a handle on the destination file.
    // A direct write is less elegant but loses nothing; the tmp file stays as a trace.
    writeFileSync(file, raw, 'utf8')
    try {
      rmSync(tmp, { force: true })
    } catch {
      /* tmp remains — harmless */
    }
  }
  snapshots.set(file, { mtimeMs: statSync(file).mtimeMs, raw })
}

function validationError(message) {
  const err = new Error(message)
  err.code = 'VALIDATION'
  return err
}

/**
 * A client key becomes a filename, so an unvalidated one is a path traversal:
 * `../../escaped` writes JSON outside the store entirely. Constraining the
 * alphabet is what makes issuesFile() safe, and it has to happen in the backend —
 * the browser is not a boundary.
 */
const CLIENT_KEY_RE = /^[A-Z0-9]{1,6}$/

function validateClients(clients) {
  if (!Array.isArray(clients) || clients.length === 0) {
    throw validationError('A workspace needs at least one client')
  }
  const ids = new Set()
  const keys = new Set()
  for (const client of clients) {
    if (!client || typeof client.id !== 'string' || !client.id.trim()) {
      throw validationError('Every client needs a non-empty id')
    }
    if (ids.has(client.id)) throw validationError(`Duplicate client id: ${client.id}`)
    ids.add(client.id)

    if (typeof client.key !== 'string' || !CLIENT_KEY_RE.test(client.key)) {
      throw validationError(
        `Invalid client key "${String(client.key ?? '')}". Use 1-6 capital letters or digits.`
      )
    }
    // Two clients sharing a key share a file, and the second one to save wins.
    // Case-insensitive because Windows and macOS filesystems are.
    const folded = client.key.toLocaleUpperCase('en-US')
    if (keys.has(folded)) throw validationError(`Client keys must be unique: ${client.key}`)
    keys.add(folded)
  }
}

function validateProjects(projects, clients) {
  if (!Array.isArray(projects)) throw validationError('Projects must be an array')
  const clientIds = new Set(clients.map((client) => client.id))
  const ids = new Set()
  for (const project of projects) {
    if (!project || typeof project.id !== 'string' || !project.id.trim()) {
      throw validationError('Every project needs a non-empty id')
    }
    if (ids.has(project.id)) throw validationError(`Duplicate project id: ${project.id}`)
    if (!clientIds.has(project.clientId)) {
      throw validationError(`Project ${project.id} points at an unknown client`)
    }
    ids.add(project.id)
  }
}

/** Rejects an issue pointing at a project that does not exist or belongs elsewhere. */
function validateIssueProject(issue) {
  if (issue.projectId == null) return
  const project = workspace.projects.find((candidate) => candidate.id === issue.projectId)
  if (!project || project.clientId !== issue.clientId) {
    throw validationError('That project does not exist, or belongs to another client')
  }
}

/** On a case-insensitive filesystem, ACME.json and acme.json are one file. */
function findCaseInsensitiveIssuesFile(file) {
  if (!existsSync(ISSUES_DIR)) return null
  const wanted = path.basename(file).toLocaleLowerCase('en-US')
  const hit = readdirSync(ISSUES_DIR).find((name) => name.toLocaleLowerCase('en-US') === wanted)
  return hit ? path.join(ISSUES_DIR, hit) : null
}

/* ------------------------------------------------------------------ backups */

function backupOnce() {
  const stamp = new Date().toISOString().slice(0, 10)
  const dir = path.join(BACKUP_DIR, stamp)
  if (existsSync(dir)) return
  mkdirSync(path.join(dir, 'issues'), { recursive: true })
  if (existsSync(WORKSPACE_FILE)) copyFileSync(WORKSPACE_FILE, path.join(dir, 'workspace.json'))
  if (existsSync(TRASH_FILE)) copyFileSync(TRASH_FILE, path.join(dir, 'trash.json'))
  if (existsSync(ISSUES_DIR)) {
    for (const f of readdirSync(ISSUES_DIR)) {
      if (f.endsWith('.json')) copyFileSync(path.join(ISSUES_DIR, f), path.join(dir, 'issues', f))
    }
  }
  pruneBackups()
}

function pruneBackups() {
  if (!existsSync(BACKUP_DIR)) return
  const cutoff = Date.now() - BACKUP_KEEP_DAYS * 864e5
  for (const name of readdirSync(BACKUP_DIR)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(name)) continue
    if (new Date(name).getTime() < cutoff) {
      // Only our own copies older than 30 days are removed. Never the source data.
      rmSync(path.join(BACKUP_DIR, name), { recursive: true, force: true })
    }
  }
}

/* ---------------------------------------------------------- sync conflicts */

/**
 * Sync clients resolve collisions by writing their copy beside the original — and, as
 * more than one person has learned the hard way, that copy is sometimes the ONLY one.
 *
 * They do not agree on how to spell it. macOS writes `workspace 2.json`; iCloud on
 * Windows writes `workspace(1).json`. Only the first spelling was matched here, so on
 * Windows the file holding the other machine's work was neither reported nor visible
 * anywhere in the app — the canonical file sat there empty and looked authoritative.
 */
const CONFLICT_RE = /^(.+?)(?: \d+|\(\d+\))\.json$/

export function findConflictArtifacts() {
  const found = []
  for (const dir of [DATA_DIR, ISSUES_DIR]) {
    if (!existsSync(dir)) continue
    for (const name of readdirSync(dir)) {
      const m = CONFLICT_RE.exec(name)
      if (!m) continue
      const original = path.join(dir, `${m[1]}.json`)
      found.push({
        file: path.join(dir, name),
        name,
        originalExists: existsSync(original),
        size: statSync(path.join(dir, name)).size,
      })
    }
  }
  return found
}

/* -------------------------------------------------------------------- public */

let workspace = null
/** @type {Map<string, {file: string, issues: any[]}>} */
const issuesByClient = new Map()

function issuesFile(clientKey) {
  return path.join(ISSUES_DIR, `${clientKey}.json`)
}

export function init() {
  ensureDirs()

  const ws = readJson(WORKSPACE_FILE, null)
  if (ws.value) {
    workspace = ws.value
  } else {
    workspace = seedWorkspace()
    writeJsonAtomic(WORKSPACE_FILE, workspace)
  }
  // Fields added by newer versions, when the file comes from an older one.
  validateClients(workspace.clients)
  workspace.projects ??= []
  validateProjects(workspace.projects, workspace.clients)
  workspace.labels ??= seedWorkspace().labels
  workspace.cycles ??= []
  workspace.counters ??= {}
  workspace.settings ??= seedWorkspace().settings
  workspace.settings.showDoneDays ??= 14

  issuesByClient.clear()
  for (const client of workspace.clients) {
    const file = issuesFile(client.key)
    const res = readJson(file, null)
    if (res.value) {
      issuesByClient.set(client.id, { file, issues: res.value })
    } else {
      // A file may exist under a different case on Windows and macOS. Treating
      // that as "missing" and writing a fresh one silently discards its issues.
      const existing = findCaseInsensitiveIssuesFile(file)
      if (existing) {
        const recovered = readJson(existing, [])
        issuesByClient.set(client.id, { file: existing, issues: recovered.value ?? [] })
        continue
      }
      const seeded = client.id === workspace.clients[0].id ? seedIssues(client.id) : []
      if (seeded.length) {
        workspace.counters[client.key] = Math.max(...seeded.map((i) => i.num))
      }
      issuesByClient.set(client.id, { file, issues: seeded })
      writeJsonAtomic(file, seeded)
    }
  }
  writeJsonAtomic(WORKSPACE_FILE, workspace)
  // trash.json is not part of the in-memory state, but trashIssue() checks it for
  // external changes BEFORE it reads it. With no snapshot from this process
  // changedOnDisk() has to assume the worst, so the first delete after every start
  // failed as STALE — and a restart re-armed it. Read it once here to prime the snapshot.
  readJson(TRASH_FILE, [])

  ensureCycleForToday()
  backupOnce()
  return getState()
}

export function getState() {
  const issues = []
  for (const entry of issuesByClient.values()) issues.push(...entry.issues)
  return { workspace, issues }
}

export function watchedFiles() {
  return [WORKSPACE_FILE, ...[...issuesByClient.values()].map((e) => e.file)]
}

/**
 * Whether any data file differs in CONTENT from what this process
 * last wrote or read. The watcher asks this instead of inferring it
 * from a filesystem event alone: sync touches files without changing them,
 * and reporting each touch as "changed on another machine" is a false alarm.
 */
export function hasExternalChange() {
  return watchedFiles().some(changedOnDisk)
}

/** Fails when any of the files changed outside the app. */
function assertNoExternalChange(files) {
  const stale = files.filter(changedOnDisk)
  if (stale.length) {
    const err = new Error(
      `This file changed outside the app (${stale.map((f) => path.basename(f)).join(', ')}). ` +
        'You probably edited it on another machine — reload so that work is not overwritten.'
    )
    err.code = 'STALE'
    err.files = stale
    return err
  }
  return null
}

function persistWorkspace() {
  backupOnce()
  writeJsonAtomic(WORKSPACE_FILE, workspace)
}

function persistClient(clientId) {
  const entry = issuesByClient.get(clientId)
  if (!entry) return
  backupOnce()
  writeJsonAtomic(entry.file, entry.issues)
}

/* ------------------------------------------------------------------- cycles */

function isoWeekStart(date, weekStartsOn = 1) {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  const diff = (d.getDay() - weekStartsOn + 7) % 7
  d.setDate(d.getDate() - diff)
  return d
}

const ymd = (d) => {
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** Cycles are weekly and create themselves — there is no "I forgot to open a sprint". */
export function ensureCycleForToday() {
  const start = isoWeekStart(new Date(), workspace.settings.weekStartsOn ?? 1)
  const startsAt = ymd(start)
  if (workspace.cycles.some((c) => c.startsAt === startsAt)) return
  const end = new Date(start)
  end.setDate(end.getDate() + 6)
  const number = workspace.cycles.length
    ? Math.max(...workspace.cycles.map((c) => c.number)) + 1
    : 1
  workspace.cycles.push({
    id: `cy_${startsAt}`,
    number,
    name: `Week ${number}`,
    startsAt,
    endsAt: ymd(end),
  })
  workspace.cycles.sort((a, b) => a.startsAt.localeCompare(b.startsAt))
  persistWorkspace()
}

export function currentCycle() {
  const today = ymd(new Date())
  return workspace.cycles.find((c) => c.startsAt <= today && today <= c.endsAt) ?? null
}

/* ------------------------------------------------------------------ mutations */

export function nextNum(clientId) {
  const client = workspace.clients.find((c) => c.id === clientId)
  if (!client) throw new Error('Unknown client')
  const known = issuesByClient.get(clientId)?.issues ?? []
  const highest = known.length ? Math.max(...known.map((i) => i.num)) : 0
  const counter = workspace.counters[client.key] ?? 0
  const next = Math.max(highest, counter) + 1
  workspace.counters[client.key] = next
  return next
}

/**
 * What a status transition implies, in one place.
 *
 * These rules were written twice — once in upsertIssue, once in the batch path —
 * and a third writer arriving to add a fourth rule would have had to find both.
 * `statusChangedAt` is what tells you an issue has been Waiting for nine days
 * rather than merely edited nine days ago, so it has to hold on every path a
 * status can change on, including undo and a bulk change across a selection.
 */
function applyStatusChange(previous, merged, now) {
  if (merged.status !== previous.status) merged.statusChangedAt = now
  else merged.statusChangedAt = previous.statusChangedAt ?? previous.createdAt
  if (merged.status === 'done' && previous.status !== 'done') merged.completedAt = now
  if (merged.status !== 'done' && previous.status === 'done') merged.completedAt = null
  return merged
}

export function upsertIssue(issue) {
  const stale = assertNoExternalChange([issuesFile(clientKeyOf(issue.clientId)), WORKSPACE_FILE])
  if (stale) throw stale

  const entry = issuesByClient.get(issue.clientId)
  if (!entry) throw validationError('Unknown client for this issue')
  validateIssueProject(issue)

  const idx = entry.issues.findIndex((i) => i.id === issue.id)
  const now = new Date().toISOString()

  if (idx === -1) {
    const created = {
      ...issue,
      num: issue.num ?? nextNum(issue.clientId),
      createdAt: issue.createdAt ?? now,
      statusChangedAt: issue.statusChangedAt ?? issue.createdAt ?? now,
      updatedAt: now,
    }
    entry.issues.push(created)
    persistClient(issue.clientId)
    persistWorkspace()
    return created
  }

  const previous = entry.issues[idx]
  const merged = applyStatusChange(previous, { ...previous, ...issue, updatedAt: now }, now)
  entry.issues[idx] = merged
  persistClient(issue.clientId)
  return merged
}

/** Moving an issue between clients changes its file and its number. */
export function moveIssueToClient(issueId, fromClientId, toClientId) {
  const from = issuesByClient.get(fromClientId)
  const to = issuesByClient.get(toClientId)
  if (!from || !to) throw validationError('Unknown client')
  const staleMove = assertNoExternalChange([from.file, to.file, WORKSPACE_FILE])
  if (staleMove) throw staleMove
  const idx = from.issues.findIndex((i) => i.id === issueId)
  if (idx === -1) throw new Error('No such issue')
  const [issue] = from.issues.splice(idx, 1)
  const moved = {
    ...issue,
    clientId: toClientId,
    projectId: null,
    num: nextNum(toClientId),
    updatedAt: new Date().toISOString(),
  }
  to.issues.push(moved)
  persistClient(fromClientId)
  persistClient(toClientId)
  persistWorkspace()
  return moved
}

export function updateManyIssues(patches) {
  // The batch path had no guard at all: it returned 200 and overwrote a change
  // made on another machine. Every file the batch will touch has to be checked
  // BEFORE any of them is written, or a partial batch leaves mixed state.
  const targets = new Set([WORKSPACE_FILE])
  for (const patch of patches) {
    const entry = issuesByClient.get(patch.clientId)
    if (entry) targets.add(entry.file)
  }
  const staleBatch = assertNoExternalChange([...targets])
  if (staleBatch) throw staleBatch

  const touched = new Set()
  const now = new Date().toISOString()
  const result = []
  for (const patch of patches) {
    const entry = issuesByClient.get(patch.clientId)
    if (!entry) continue
    const idx = entry.issues.findIndex((i) => i.id === patch.id)
    if (idx === -1) continue
    const previous = entry.issues[idx]
    const merged = applyStatusChange(previous, { ...previous, ...patch, updatedAt: now }, now)
    entry.issues[idx] = merged
    touched.add(patch.clientId)
    result.push(merged)
  }
  for (const clientId of touched) persistClient(clientId)
  return result
}

/** Deleting means moving to trash.json. Nothing leaves the disk. */
export function trashIssue(issueId, clientId) {
  const entry = issuesByClient.get(clientId)
  if (!entry) throw validationError('Unknown client')
  const staleTrash = assertNoExternalChange([entry.file, TRASH_FILE])
  if (staleTrash) throw staleTrash
  const idx = entry.issues.findIndex((i) => i.id === issueId)
  if (idx === -1) return null
  const [issue] = entry.issues.splice(idx, 1)
  const trash = readJson(TRASH_FILE, []).value ?? []
  trash.unshift({ issue, deletedAt: new Date().toISOString() })
  writeJsonAtomic(TRASH_FILE, trash)
  persistClient(clientId)
  return issue
}

export function readTrash() {
  return readJson(TRASH_FILE, []).value ?? []
}

export function restoreFromTrash(issueId) {
  // Assert BEFORE reading: readTrash() refreshes the snapshot, so a check after it
  // could never fail — the guard was dead code.
  const staleRestore = assertNoExternalChange([TRASH_FILE])
  if (staleRestore) throw staleRestore
  const trash = readTrash()
  const idx = trash.findIndex((t) => t.issue.id === issueId)
  if (idx === -1) return null
  const [entry] = trash.splice(idx, 1)
  const target = issuesByClient.get(entry.issue.clientId)
  if (!target) throw new Error('The client of this issue no longer exists')
  target.issues.push(entry.issue)
  writeJsonAtomic(TRASH_FILE, trash)
  persistClient(entry.issue.clientId)
  return entry.issue
}

/* ------------------------------------------------------ clients / projects */

function clientKeyOf(clientId) {
  return workspace.clients.find((c) => c.id === clientId)?.key ?? 'UNKNOWN'
}

export function saveWorkspace(next) {
  const stale = assertNoExternalChange([WORKSPACE_FILE])
  if (stale) throw stale

  const candidate = { ...workspace, ...next, version: 1 }
  // Validate before assigning. Assigning first and validating after leaves the
  // process holding a workspace it just refused to save.
  validateClients(candidate.clients)
  validateProjects(candidate.projects ?? [], candidate.clients)

  const previousKeys = new Map(workspace.clients.map((c) => [c.id, c.key]))
  workspace = candidate

  for (const client of workspace.clients) {
    if (!issuesByClient.has(client.id)) {
      const file = issuesFile(client.key)
      const res = readJson(file, null)
      issuesByClient.set(client.id, { file, issues: res.value ?? [] })
      if (!res.value) writeJsonAtomic(file, [])
      continue
    }
    // Changing a client prefix moves its file, so issue IDs and the filename agree.
    const oldKey = previousKeys.get(client.id)
    if (oldKey && oldKey !== client.key) {
      const entry = issuesByClient.get(client.id)
      const nextFile = issuesFile(client.key)
      writeJsonAtomic(nextFile, entry.issues)
      if (existsSync(entry.file) && entry.file !== nextFile) {
        renameSync(entry.file, `${entry.file}.renamed`)
      }
      entry.file = nextFile
      if (workspace.counters[oldKey] != null) {
        workspace.counters[client.key] = workspace.counters[oldKey]
        delete workspace.counters[oldKey]
      }
    }
  }
  persistWorkspace()
  return workspace
}

export function reloadFromDisk() {
  snapshots.clear()
  return init()
}
