/**
 * Regression tests for the ways this server can lose or leak data.
 *
 * Every case here failed once. They run against a throwaway store and a throwaway
 * notes folder created under the OS temp directory — never a real one — and the
 * run refuses to start if the configured paths look like somebody's actual data.
 *
 * Usage: npm run integrity
 */
import { spawn, spawnSync } from 'node:child_process'
import http from 'node:http'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.INTEGRITY_PORT ?? 4487)
const BASE = `http://127.0.0.1:${PORT}`

const sandbox = mkdtempSync(path.join(tmpdir(), 'solo-ops-integrity-'))
const DATA_DIR = path.join(sandbox, 'store')
const NOTES_DIR = path.join(sandbox, 'notes')
const OUTSIDE = path.join(sandbox, 'outside')

// A test that can reach real data is not a test worth running.
if (!sandbox.startsWith(tmpdir())) {
  console.error('refusing to run: sandbox is not under the temp directory')
  process.exit(1)
}

// A store that has been used before already has a trash file on disk. The first-delete
// bug only reproduces then: an empty sandbox has no trash.json, and the guard skips
// files that do not exist. Without this line the regression test below passes on the
// broken code too.
mkdirSync(DATA_DIR, { recursive: true })
writeFileSync(path.join(DATA_DIR, 'trash.json'), '[]\n')

mkdirSync(path.join(NOTES_DIR, '_Inbox'), { recursive: true })
mkdirSync(OUTSIDE, { recursive: true })
writeFileSync(path.join(OUTSIDE, 'secret.md'), 'must never be reachable\n')
writeFileSync(path.join(ROOT, 'dist', '..', 'NEIGHBOUR.txt'), 'adjacent to dist\n')

let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${name}`)
    passed += 1
  } else {
    console.log(`  FAIL  ${name}${detail ? `\n        ${detail}` : ''}`)
    failed += 1
  }
}

const json = (body) => ({
  'content-type': 'application/json',
  origin: BASE,
})

async function call(method, url, { body, headers = {} } = {}) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: { ...(body === undefined ? {} : json()), ...headers },
    body: body === undefined ? undefined : typeof body === 'string' ? body : JSON.stringify(body),
  })
  const text = await res.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    /* not every response is JSON, and that is part of what we assert */
  }
  return { status: res.status, text, json: parsed }
}

/** Collects `event:` names off the SSE stream. Node has no EventSource to lean on. */
function openEventStream(sink) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: '/api/events', headers: { accept: 'text/event-stream' } },
      (res) => {
        res.setEncoding('utf8')
        res.on('data', (chunk) => {
          for (const line of chunk.split('\n')) {
            if (line.startsWith('event: ')) sink.push(line.slice(7).trim())
          }
        })
        resolve(req)
      }
    )
    req.on('error', reject)
    req.end()
  })
}

async function waitFor(condition, ms) {
  const until = Date.now() + ms
  while (Date.now() < until) {
    if (condition()) return true
    await new Promise((r) => setTimeout(r, 100))
  }
  return condition()
}

function rawRequest(pathname, headers) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { host: '127.0.0.1', port: PORT, path: pathname, method: 'GET', headers },
      (res) => {
        res.resume()
        res.on('end', () => resolve(res.statusCode))
      }
    )
    req.on('error', reject)
    req.end()
  })
}

/* --------------------------------------------------------------------- boot */

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs'), '--no-open'], {
  env: {
    ...process.env,
    PORT: String(PORT),
    SOLO_OPS_DATA_DIR: DATA_DIR,
    SOLO_OPS_NOTES_DIR: NOTES_DIR,
    // The fallback check runs every 20 s in real use. The suite cannot wait that long.
    SOLO_OPS_WATCH_POLL_MS: '400',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
})

let serverDied = null
server.on('exit', (code) => {
  if (code !== 0 && code !== null) serverDied = code
})

async function waitForBoot() {
  for (let i = 0; i < 60; i += 1) {
    try {
      const res = await fetch(`${BASE}/api/health`)
      if (res.ok) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 250))
  }
  return false
}

function stop() {
  try {
    server.kill()
  } catch {
    /* already gone */
  }
  rmSync(sandbox, { recursive: true, force: true })
  rmSync(path.join(ROOT, 'dist', '..', 'NEIGHBOUR.txt'), { force: true })
}

/* -------------------------------------------------------------------- cases */

async function run() {
  if (!(await waitForBoot())) {
    console.error('server never answered')
    stop()
    process.exit(1)
  }

  console.log('\nHTTP boundary\n')

  // fetch() refuses to set Host, so this one needs the raw client.
  const foreignHost = await rawRequest('/api/state', { Host: 'evil.example.com' })
  check('a foreign Host header is rejected', foreignHost === 403, `got ${foreignHost}`)

  const foreignOrigin = await call('POST', '/api/notes/note', {
    body: { title: 'from-a-hostile-page', body: 'x' },
    headers: { origin: 'http://evil.example.com' },
  })
  check('a cross-origin write is rejected', foreignOrigin.status === 403, `got ${foreignOrigin.status}`)

  const plainText = await call('POST', '/api/notes/note', {
    body: JSON.stringify({ title: 'simple-request', body: 'x' }),
    headers: { 'content-type': 'text/plain;charset=UTF-8', origin: BASE },
  })
  check('a text/plain write is rejected', plainText.status === 415, `got ${plainText.status}`)

  const inboxAfter = readdirSync(path.join(NOTES_DIR, '_Inbox'))
  check('no note was created by any of those', inboxAfter.length === 0, inboxAfter.join(', '))

  console.log('\nPath containment\n')

  const state = (await call('GET', '/api/state')).json
  const workspace = state.workspace

  const escaped = await call('PUT', '/api/workspace', {
    body: {
      ...workspace,
      clients: [{ ...workspace.clients[0], key: '../../ESCAPED' }, ...workspace.clients.slice(1)],
    },
  })
  check('a traversing client key is rejected', escaped.status === 400, `got ${escaped.status}`)
  check(
    'nothing was written outside the store',
    !existsSync(path.join(sandbox, 'ESCAPED.json')) && !existsSync(path.join(DATA_DIR, '..', 'ESCAPED.json'))
  )

  const duplicate = await call('PUT', '/api/workspace', {
    body: {
      ...workspace,
      clients: [
        { ...workspace.clients[0], key: 'DUP' },
        { ...workspace.clients[1], key: 'dup' },
        ...workspace.clients.slice(2),
      ],
    },
  })
  check('two clients cannot share a key, ignoring case', duplicate.status === 400, `got ${duplicate.status}`)

  const traversal = await fetch(`${BASE}/../NEIGHBOUR.txt`)
  const traversalBody = await traversal.text()
  check(
    'a file next to dist is not served',
    !traversalBody.includes('adjacent to dist'),
    `status ${traversal.status}`
  )

  const malformed = await fetch(`${BASE}/%E0%A4%A`)
  check('malformed percent-encoding does not crash the server', malformed.status === 400, `got ${malformed.status}`)

  const stillAlive = await fetch(`${BASE}/api/health`)
  check('the server is still answering afterwards', stillAlive.ok)

  console.log('\nNotes: symlinks and collisions\n')

  // A link inside the notes folder pointing anywhere else.
  let linkMade = true
  try {
    symlinkSync(OUTSIDE, path.join(NOTES_DIR, 'escape'), 'junction')
  } catch {
    linkMade = false
  }
  if (linkMade) {
    const throughLink = await call('GET', '/api/notes/note?path=escape/secret.md')
    check('reading through a symlink is refused', throughLink.status >= 400, `got ${throughLink.status}`)

    const writeThroughLink = await call('POST', '/api/notes/note', {
      body: { title: 'planted', body: 'x', folder: 'escape' },
    })
    check('writing through a symlink is refused', writeThroughLink.status >= 400, `got ${writeThroughLink.status}`)
    check('nothing landed outside the notes folder', !existsSync(path.join(OUTSIDE, 'planted.md')))
  } else {
    console.log('  skip  symlink cases (no permission to create links here)')
  }

  const names = []
  for (let i = 0; i < 3; i += 1) {
    const res = await call('POST', '/api/notes/note', { body: { title: 'same name', body: `copy ${i}` } })
    if (res.json?.relPath) names.push(res.json.relPath)
  }
  check('three notes with one title produce three files', new Set(names).size === 3, names.join(' | '))
  const bodies = names.map((rel) => readFileSync(path.join(NOTES_DIR, rel), 'utf8'))
  check('none of them overwrote another', new Set(bodies).size === 3)

  console.log('\nFirst delete after a fresh start\n')

  // trash.json is checked for external changes before it is ever read. Without a
  // snapshot taken at startup the check had to assume the file had changed, so the
  // FIRST delete in every process was refused as stale and a restart only re-armed it.
  // Nothing above this line touches /api/trash, so the process is still "trash unread".
  const firstState = (await call('GET', '/api/state')).json
  const doomed = {
    id: 'i_first_delete',
    num: 899,
    clientId: firstState.workspace.clients[0].id,
    projectId: null,
    title: 'deleted before the trash was ever opened',
    body: '',
    status: 'todo',
    priority: 0,
    labels: [],
    checklist: [],
    noteLinks: [],
    cycleId: null,
    dueDate: null,
    order: 0,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  }
  await call('PUT', '/api/issues', { body: doomed })
  const firstDelete = await call('POST', '/api/issues/trash', { body: { id: doomed.id, clientId: doomed.clientId } })
  check('the first delete of a run is not refused as stale', firstDelete.status === 200, `got ${firstDelete.status}: ${firstDelete.text.slice(0, 120)}`)
  const trashed = (await call('GET', '/api/trash')).json
  check(
    'it actually landed in the trash',
    (trashed?.trash ?? []).some((t) => t.issue.id === doomed.id),
    (trashed?.trash ?? []).map((t) => t.issue.id).join(', ')
  )

  console.log('\nStale-write guard\n')

  const before = (await call('GET', '/api/state')).json
  const issue = {
    id: 'i_integrity',
    num: 900,
    clientId: before.workspace.clients[0].id,
    projectId: null,
    title: 'written by the test',
    body: '',
    status: 'todo',
    priority: 0,
    labels: [],
    checklist: [],
    noteLinks: [],
    cycleId: null,
    dueDate: null,
    order: 1,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    completedAt: null,
  }
  const created = await call('PUT', '/api/issues', { body: issue })
  check('a normal write still succeeds', created.status === 200, `got ${created.status}`)

  // Change the file underneath the server, the way another machine would.
  const clientKey = before.workspace.clients[0].key
  const issuesFile = path.join(DATA_DIR, 'issues', `${clientKey}.json`)
  const onDisk = JSON.parse(readFileSync(issuesFile, 'utf8'))
  onDisk.push({ ...issue, id: 'i_from_elsewhere', num: 901, title: 'written on another machine' })
  writeFileSync(issuesFile, JSON.stringify(onDisk, null, 2) + '\n', 'utf8')

  const stale = await call('PUT', '/api/issues', { body: { ...issue, title: 'overwrite attempt' } })
  check('a stale single write is refused with 409', stale.status === 409, `got ${stale.status}`)

  const staleBatch = await call('POST', '/api/issues/batch', {
    body: { patches: [{ ...issue, title: 'overwrite attempt via batch' }] },
  })
  check('a stale batch write is refused too', staleBatch.status === 409, `got ${staleBatch.status}`)

  const survivor = JSON.parse(readFileSync(issuesFile, 'utf8'))
  check(
    'the external change survived',
    survivor.some((i) => i.id === 'i_from_elsewhere'),
    survivor.map((i) => i.id).join(', ')
  )

  console.log('\nSync resilience\n')

  // A folder renamed on the other machine is, from here, simply gone. Creating it and
  // seeding an example workspace is how the app once came up looking perfectly healthy
  // with nobody's data in it.
  const neverSynced = path.join(sandbox, 'never-synced')
  const refused = spawnSync(process.execPath, [path.join(ROOT, 'server', 'index.mjs'), '--no-open'], {
    env: { ...process.env, PORT: String(PORT + 1), SOLO_OPS_DATA_DIR: neverSynced, SOLO_OPS_NOTES_DIR: NOTES_DIR },
    encoding: 'utf8',
    timeout: 20_000,
  })
  check(
    'a configured store that is not on disk stops the server',
    refused.status === 1 && refused.signal === null,
    `status ${refused.status}, signal ${refused.signal}`
  )
  check('nothing was created in its place', !existsSync(neverSynced))

  // fs.watch follows the directory it was armed on, so a replaced folder stops producing
  // events without saying so. Only the poll can see this change; the reload first puts the
  // server back in step with the disk, so nothing left over from the case above counts.
  await call('POST', '/api/state/reload')
  const events = []
  const stream = await openEventStream(events)

  const issuesDir = path.dirname(issuesFile)
  const parked = `${issuesDir}.parked`
  renameSync(issuesDir, parked)
  mkdirSync(issuesDir)
  for (const name of readdirSync(parked)) {
    writeFileSync(path.join(issuesDir, name), readFileSync(path.join(parked, name), 'utf8'))
  }
  const afterSwap = JSON.parse(readFileSync(issuesFile, 'utf8'))
  afterSwap.push({ ...issue, id: 'i_after_swap', num: 902, title: 'written after the folder was replaced' })
  writeFileSync(issuesFile, JSON.stringify(afterSwap, null, 2) + '\n', 'utf8')

  const noticed = await waitFor(() => events.includes('external-change'), 6000)
  check('a change survives the issues folder being replaced', noticed, events.join(', ') || 'no events arrived')
  stream.destroy()

  console.log(
    `\n${failed ? `${failed} failed, ` : ''}${passed} passed` + (serverDied ? ` (server exited with ${serverDied})` : '')
  )
  stop()
  process.exit(failed || serverDied ? 1 : 0)
}

run().catch((err) => {
  console.error('\nthe suite itself failed:', err)
  stop()
  process.exit(1)
})
