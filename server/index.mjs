import { createReadStream, existsSync, statSync, watch } from 'node:fs'
import http from 'node:http'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { DATA_DIR, ISSUES_DIR, ROOT, describePaths } from './paths.mjs'
import * as store from './store.mjs'
import * as notes from './notes.mjs'

const DEV = process.argv.includes('--dev')
const NO_OPEN = process.argv.includes('--no-open')
const PORT = Number(process.env.PORT ?? 4321)
const DIST = path.join(ROOT, 'dist')

/* ------------------------------------------------------------------- helpers */

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.woff': 'font/woff',
  '.otf': 'font/otf',
  '.ttf': 'font/ttf',
}

function send(res, status, payload) {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  })
  res.end(body)
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]'])

/**
 * Binding to 127.0.0.1 is not on its own a boundary. A page open in your browser
 * can still POST to localhost, and DNS rebinding can point a hostile name at it.
 * So: the Host header must be this loopback service, mutations must come from an
 * Origin that is also this service, and they must be JSON — which a simple
 * cross-origin form cannot send without a preflight.
 */
function allowedAuthority(authority) {
  if (typeof authority !== 'string') return false
  try {
    const parsed = new URL(`http://${authority}`)
    const port = Number(parsed.port || 80)
    return LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) && port === PORT
  } catch {
    return false
  }
}

function allowedOrigin(origin) {
  // No Origin at all means curl or a local script, not a page acting on your behalf.
  if (origin === undefined) return true
  if (typeof origin !== 'string' || origin === 'null') return false
  try {
    const parsed = new URL(origin)
    const port = Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80))
    return parsed.protocol === 'http:' && LOOPBACK_HOSTS.has(parsed.hostname.toLowerCase()) && port === PORT
  } catch {
    return false
  }
}

async function readBody(req) {
  const chunks = []
  for await (const chunk of req) chunks.push(chunk)
  if (!chunks.length) return {}
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    const error = new Error('Request body is not valid JSON')
    error.code = 'VALIDATION'
    throw error
  }
}

/* -------------------------------------------------------------------- events */

const clients = new Set()
let muteUntil = 0

function broadcast(event, data = {}) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
  for (const res of clients) {
    try {
      res.write(frame)
    } catch {
      clients.delete(res)
    }
  }
}

/** Every write of our own mutes the watcher, so the app does not wake itself. */
function mute() {
  muteUntil = Date.now() + 1200
}

function startWatcher() {
  let timer = null

  const onChange = (_event, filename) => {
    if (Date.now() < muteUntil) return
    // Temp files and backups are not data; their movement concerns nobody.
    const name = String(filename ?? '')
    if (name && (!name.endsWith('.json') || name.endsWith('.tmp'))) return

    clearTimeout(timer)
    timer = setTimeout(() => {
      // A filesystem event only means "something touched a file". Only differing CONTENT
      // means "someone changed it elsewhere" — otherwise the app wakes itself in a loop.
      if (!store.hasExternalChange()) return
      broadcast('external-change', { at: new Date().toISOString() })
    }, 400)
  }

  for (const dir of [DATA_DIR, ISSUES_DIR]) {
    if (!existsSync(dir)) continue
    try {
      watch(dir, { persistent: false }, onChange)
    } catch {
      // fs.watch does not work on some synced volumes; the app keeps running,
      // just without auto-detecting changes made on another machine.
      console.warn(`[watch] cannot watch ${dir} — auto-refresh disabled`)
    }
  }
}

/* ----------------------------------------------------------------------- API */

const routes = {
  'GET /api/health': () => ({
    ok: true,
    dev: DEV,
    paths: describePaths(),
    notes: notes.notesStatus(),
    conflicts: store.findConflictArtifacts(),
  }),

  'GET /api/state': () => {
    store.ensureCycleForToday()
    return { ...store.getState(), currentCycleId: store.currentCycle()?.id ?? null }
  },

  'POST /api/state/reload': () => {
    mute() // a reload may touch files; that is not an external change
    const state = store.reloadFromDisk()
    return { ...state, currentCycleId: store.currentCycle()?.id ?? null }
  },

  'PUT /api/issues': (body) => {
    mute()
    return { issue: store.upsertIssue(body) }
  },

  'POST /api/issues/batch': (body) => {
    mute()
    return { issues: store.updateManyIssues(body.patches ?? []) }
  },

  'POST /api/issues/move': (body) => {
    mute()
    return { issue: store.moveIssueToClient(body.issueId, body.fromClientId, body.toClientId) }
  },

  'POST /api/issues/trash': (body) => {
    mute()
    return { issue: store.trashIssue(body.id, body.clientId) }
  },

  'GET /api/trash': () => ({ trash: store.readTrash() }),

  'POST /api/trash/restore': (body) => {
    mute()
    return { issue: store.restoreFromTrash(body.id) }
  },

  'PUT /api/workspace': (body) => {
    mute()
    return { workspace: store.saveWorkspace(body) }
  },

  'GET /api/notes/inbox': () => ({ entries: notes.listInbox() }),

  'POST /api/notes/inbox/archive': (body) => ({ movedTo: notes.archiveInboxEntry(body.relPath) }),

  'GET /api/notes/search': (_body, url) => ({
    results: notes.searchNotes(url.searchParams.get('q') ?? '', 12),
  }),

  'GET /api/notes/resolve': (_body, url) => ({
    file: notes.resolveWikilink(url.searchParams.get('target') ?? ''),
  }),

  'GET /api/notes/note': (_body, url) => ({
    content: notes.readNote(url.searchParams.get('path') ?? ''),
  }),

  'POST /api/notes/note': (body) => ({ relPath: notes.writeNote(body) }),
}

async function handleApi(req, res, url) {
  if (!allowedAuthority(req.headers.host)) {
    return send(res, 403, { error: 'Host not allowed', code: 'FORBIDDEN' })
  }

  const mutating = !['GET', 'HEAD', 'OPTIONS'].includes(req.method ?? '')
  if (mutating) {
    if (!allowedOrigin(req.headers.origin) || req.headers['sec-fetch-site'] === 'cross-site') {
      return send(res, 403, { error: 'Request origin not allowed', code: 'FORBIDDEN' })
    }
    const contentType = String(req.headers['content-type'] ?? '')
    if (!/^application\/json(?:\s*;|$)/i.test(contentType)) {
      return send(res, 415, { error: 'Content-Type: application/json is required', code: 'CONTENT_TYPE' })
    }
  }

  if (url.pathname === '/api/events') {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache',
      connection: 'keep-alive',
    })
    res.write('retry: 3000\n\n')
    clients.add(res)
    const ping = setInterval(() => {
      try {
        res.write(': ping\n\n')
      } catch {
        /* zamkniete polaczenie sprzatnie handler ponizej */
      }
    }, 25_000)
    req.on('close', () => {
      clearInterval(ping)
      clients.delete(res)
    })
    return
  }

  const key = `${req.method} ${url.pathname}`
  const handler = routes[key]
  if (!handler) return send(res, 404, { error: `Unknown endpoint: ${key}` })

  try {
    const body = req.method === 'GET' ? null : await readBody(req)
    const result = await handler(body, url)
    send(res, 200, result)
  } catch (err) {
    const status = err.code === 'STALE' ? 409 : err.code === 'VALIDATION' ? 400 : 500
    if (status === 500) console.error(`[api] ${key}:`, err)
    send(res, status, { error: err.message, code: err.code ?? null })
  }
}

/* ------------------------------------------------------------- static files */

function serveStatic(req, res, url) {
  // Malformed percent-encoding throws here; unguarded it takes the server down.
  let decodedPath
  try {
    decodedPath = decodeURIComponent(url.pathname)
  } catch {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end('Badly encoded URL path')
    return
  }

  // Resolve first, then check containment. Checking the raw string for ".."
  // misses encodings and backslashes; comparing resolved paths does not.
  const requested = decodedPath.replace(/^[/\\]+/, '')
  let candidate = path.resolve(DIST, requested)
  const relativeToDist = path.relative(DIST, candidate)
  if (relativeToDist.startsWith('..') || path.isAbsolute(relativeToDist)) {
    res.writeHead(400, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' })
    res.end('Path escapes the application directory')
    return
  }

  if (!existsSync(DIST)) {
    res.writeHead(503, { 'content-type': 'text/html; charset=utf-8' })
    res.end(
      '<pre style="font:14px ui-monospace,monospace;padding:32px;color:#E8E9EC;background:#0E0F11">' +
        'Nothing is built yet.\n\nRun:  npm run build   (or work in npm run dev)</pre>'
    )
    return
  }
  let filePath = candidate
  if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
    filePath = path.join(DIST, 'index.html') // SPA — every path falls back to the app
  }
  const ext = path.extname(filePath).toLowerCase()
  const immutable = url.pathname.startsWith('/assets/')
  res.writeHead(200, {
    'content-type': MIME[ext] ?? 'application/octet-stream',
    'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  })
  createReadStream(filePath).pipe(res)
}

function openBrowser(url) {
  if (NO_OPEN) return
  const cmd =
    process.platform === 'win32' ? ['cmd', ['/c', 'start', '', url]]
    : process.platform === 'darwin' ? ['open', [url]]
    : ['xdg-open', [url]]
  try {
    spawn(cmd[0], cmd[1], { detached: true, stdio: 'ignore' }).unref()
  } catch {
    /* no browser is no reason not to start */
  }
}

/* -------------------------------------------------------------------- start */

const banner = (paths, notesStatus) => {
  const line = '─'.repeat(52)
  return [
    '',
    `  ${line}`,
    `   solo-ops  ·  http://localhost:${PORT}${DEV ? '   (dev, HMR)' : ''}`,
    `  ${line}`,
    `   data   ${paths.dataDir}  [${paths.dataDirSource}]`,
    `   notes  ${notesStatus.connected ? paths.notesDir : 'not connected'}`,
    `  ${line}`,
    '',
  ].join('\n')
}

async function main() {
  store.init()
  const paths = describePaths()
  const notesStatus = notes.notesStatus()

  const conflicts = store.findConflictArtifacts()
  if (conflicts.length) {
    console.warn(
      `\n  ⚠  Sync conflict artefacts (${conflicts.length}): ` +
        conflicts.map((c) => c.name).join(', ') +
        '\n     They are not deleted. Review them in Settings before removing anything.\n'
    )
  }

  let vite = null
  if (DEV) {
    const { createServer } = await import('vite')
    vite = await createServer({
      root: ROOT,
      server: { middlewareMode: true },
      appType: 'spa',
    })
  }

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://localhost:${PORT}`)
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url)
    if (vite) return vite.middlewares(req, res)
    return serveStatic(req, res, url)
  })

  server.listen(PORT, '127.0.0.1', () => {
    console.log(banner(paths, notesStatus))
    openBrowser(`http://localhost:${PORT}`)
  })

  server.on('error', (err) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`\n  Port ${PORT} is busy. It is probably already running: http://localhost:${PORT}`)
      console.error(`  Another port:  PORT=4322 npm run dev\n`)
      process.exit(1)
    }
    throw err
  })

  startWatcher()
}

main().catch((err) => {
  console.error('\n  Cannot start:', err.message, '\n')
  process.exit(1)
})
