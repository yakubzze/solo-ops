import type { Issue, NoteEntry, NoteRef, Workspace } from './types'

export class StaleError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'StaleError'
  }
}

async function call<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    headers: body === undefined ? undefined : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const payload = text ? JSON.parse(text) : {}
  if (!res.ok) {
    if (res.status === 409) throw new StaleError(payload.error ?? 'The data changed outside the app')
    throw new Error(payload.error ?? `Request failed with ${res.status}`)
  }
  return payload as T
}

export interface ServerState {
  workspace: Workspace
  issues: Issue[]
  currentCycleId: string | null
}

export interface HealthInfo {
  ok: boolean
  dev: boolean
  paths: {
    dataDir: string
    dataDirSource: string
    notesDir: string | null
    notesDirSource: string
    notesInbox: string | null
    obsidianVault: string | null
    notesConnected: boolean
  }
  sync: {
    dataDirPresent: boolean
    watching: string[]
    pollMs: number
    lastPollAt: string | null
  }
  notes: {
    connected: boolean
    dir: string | null
    inbox: string | null
    obsidianVault: string | null
    inboxExists: boolean
  }
  conflicts: { file: string; name: string; originalExists: boolean; size: number }[]
}

export const api = {
  health: () => call<HealthInfo>('GET', '/api/health'),
  state: () => call<ServerState>('GET', '/api/state'),
  reload: () => call<ServerState>('POST', '/api/state/reload', {}),

  saveIssue: (issue: Issue) => call<{ issue: Issue }>('PUT', '/api/issues', issue),
  saveIssues: (patches: Partial<Issue>[]) =>
    call<{ issues: Issue[] }>('POST', '/api/issues/batch', { patches }),
  moveIssue: (issueId: string, fromClientId: string, toClientId: string) =>
    call<{ issue: Issue }>('POST', '/api/issues/move', { issueId, fromClientId, toClientId }),
  trashIssue: (id: string, clientId: string) =>
    call<{ issue: Issue | null }>('POST', '/api/issues/trash', { id, clientId }),

  trash: () => call<{ trash: { issue: Issue; deletedAt: string }[] }>('GET', '/api/trash'),
  restore: (id: string) => call<{ issue: Issue }>('POST', '/api/trash/restore', { id }),

  saveWorkspace: (workspace: Workspace) =>
    call<{ workspace: Workspace }>('PUT', '/api/workspace', workspace),

  notesInbox: () => call<{ entries: NoteEntry[] }>('GET', '/api/notes/inbox'),
  notesArchive: (relPath: string) =>
    call<{ movedTo: string }>('POST', '/api/notes/inbox/archive', { relPath }),
  notesSearch: (q: string) =>
    call<{ results: NoteRef[] }>('GET', `/api/notes/search?q=${encodeURIComponent(q)}`),
  notesResolve: (target: string) =>
    call<{ file: NoteRef | null }>('GET', `/api/notes/resolve?target=${encodeURIComponent(target)}`),
  notesRead: (relPath: string) =>
    call<{ content: string }>('GET', `/api/notes/note?path=${encodeURIComponent(relPath)}`),
  notesWrite: (payload: { title: string; body?: string; folder?: string; source?: string }) =>
    call<{ relPath: string }>('POST', '/api/notes/note', payload),
}

/**
 * Deep link into Obsidian. Returns null when no vault name is configured, which is
 * the honest answer for a plain notes folder — there is no external app to open.
 */
export function obsidianUrl(vaultName: string | null, relPath: string) {
  if (!vaultName) return null
  const file = relPath.replace(/\.md$/i, '')
  return `obsidian://open?vault=${encodeURIComponent(vaultName)}&file=${encodeURIComponent(file)}`
}
