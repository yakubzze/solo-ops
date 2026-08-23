#!/usr/bin/env node
/**
 * Write one issue into the inbox over the HTTP API, without focusing the app.
 * Intended for a system-wide shortcut.
 *
 *   node scripts/capture.mjs "call the accountant about the invoice"
 *   node scripts/capture.mjs -c ACME "they still owe us the brief"
 *
 * The title is stored verbatim, `@client !1 ~friday #ship` included. That
 * grammar is parsed in QuickAdd and is not re-implemented here: -c routes to a
 * client, the rest is triaged in the app. No num is sent, so the server stays
 * the only allocator of issue numbers.
 *
 * Exit codes: 0 written · 1 usage or unknown client · 2 no server on that port.
 */

const args = process.argv.slice(2)
const flag = (name) => {
  const i = args.indexOf(name)
  if (i === -1) return null
  const value = args[i + 1]
  args.splice(i, 2)
  return value ?? null
}

const clientKey = flag('-c') ?? flag('--client')
const port = flag('-p') ?? flag('--port') ?? process.env.SOLO_OPS_PORT ?? '4321'
const title = args.join(' ').trim()

if (!title || title === '-h' || title === '--help') {
  console.error('usage: capture.mjs [-c CLIENT_KEY] [-p PORT] <text>')
  process.exit(1)
}

const base = `http://localhost:${port}`
// Mutations require a loopback Host, a loopback Origin and a JSON content type.
const headers = { 'Content-Type': 'application/json', Origin: base }

let state
try {
  const res = await fetch(`${base}/api/state`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  state = await res.json()
} catch {
  console.error(`solo-ops is not answering on ${base} — start it with \`npm start\`.`)
  process.exit(2)
}

const clients = state.workspace.clients.filter((c) => !c.archived)
const client = clientKey
  ? clients.find((c) => c.key.toUpperCase() === clientKey.toUpperCase())
  : clients.find((c) => c.kind === 'own') ?? clients[0]

if (!client) {
  const known = clients.map((c) => c.key).join(', ')
  console.error(clientKey ? `No client with key "${clientKey}". Known: ${known}` : 'This workspace has no clients.')
  process.exit(1)
}

const now = new Date().toISOString()
const issue = {
  id: `i_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`,
  // No num: the server assigns it. Sending one would add a third allocator.
  clientId: client.id,
  projectId: null,
  title,
  body: '',
  status: 'inbox',
  priority: 0,
  labels: [],
  checklist: [],
  noteLinks: [],
  cycleId: null,
  dueDate: null,
  order: Date.now(),
  createdAt: now,
  updatedAt: now,
  completedAt: null,
}

const res = await fetch(`${base}/api/issues`, { method: 'PUT', headers, body: JSON.stringify(issue) })
if (!res.ok) {
  console.error(`Refused with HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`)
  process.exit(1)
}

const { issue: saved } = await res.json()
console.log(`${client.key}-${saved.num}  ${saved.title}`)
