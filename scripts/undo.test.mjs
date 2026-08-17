/**
 * Undo, checked in a real browser against its own server and its own
 * data directory — never against real data.
 *
 * Every case checks both directions: that the change LANDED and that the undo
 * removed it. A test that only looks at the end state also passes when the
 * operation never happened at all.
 */
import { spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const PORT = Number(process.env.UNDO_PORT ?? 4392)
const BASE = `http://127.0.0.1:${PORT}`

const sandbox = mkdtempSync(path.join(tmpdir(), 'solo-ops-undo-'))
mkdirSync(path.join(sandbox, 'store'), { recursive: true })

const server = spawn(process.execPath, [path.join(ROOT, 'server', 'index.mjs'), '--no-open'], {
  env: { ...process.env, PORT: String(PORT), SOLO_OPS_DATA_DIR: path.join(sandbox, 'store') },
  stdio: ['ignore', 'pipe', 'pipe'],
})

const wait = (ms) => new Promise((r) => setTimeout(r, ms))
let passed = 0
let failed = 0

function check(name, condition, detail = '') {
  if (condition) {
    console.log(`  ok    ${name}`)
    passed += 1
  } else {
    console.log(`  FAIL  ${name}${detail ? ` — ${detail}` : ''}`)
    failed += 1
  }
}

async function boot() {
  for (let i = 0; i < 60; i += 1) {
    try {
      if ((await fetch(`${BASE}/api/health`)).ok) return true
    } catch {
      /* not yet */
    }
    await wait(250)
  }
  return false
}

const stop = () => {
  try {
    server.kill()
  } catch {
    /* already gone */
  }
  rmSync(sandbox, { recursive: true, force: true })
}

async function run() {
  if (!(await boot())) {
    console.error('the server never came up')
    stop()
    process.exit(1)
  }

  const browser = await chromium.launch()
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
  const errors = []
  page.on('pageerror', (err) => errors.push(err.message))
  await page.goto(BASE, { waitUntil: 'networkidle' })
  /* The seeded issues sit in the Inbox while the default view is Today, so
   without this the locator waits for a row that this view simply does not have. */
  await page.keyboard.press('g')
  await page.keyboard.press('a')
  await wait(600)

  /** Issue state straight from the server, not from whatever is on screen. */
  const fromServer = async (id) => {
    const state = await (await fetch(`${BASE}/api/state`)).json()
    return state.issues.find((i) => i.id === id) ?? null
  }
  const anyIssueId = async () => (await (await fetch(`${BASE}/api/state`)).json()).issues[0]?.id

  const undo = async () => {
    await page.keyboard.press('Control+z')
    await wait(700)
  }

  console.log('\nUndo\n')

  const id = await anyIssueId()
  const before = await fromServer(id)

  /* --- priority */
  await page.locator(`[data-issue-id="${id}"]`).first().hover()
  await page.keyboard.press('1')
  await wait(700)
  const afterPriority = await fromServer(id)
  check('priority changed', afterPriority.priority === 1, `got ${afterPriority.priority}`)
  await undo()
  const undonePriority = await fromServer(id)
  check(
    'undo restored the previous priority',
    undonePriority.priority === before.priority,
    `got ${undonePriority.priority}, was ${before.priority}`
  )

  /* --- status */
  await page.locator(`[data-issue-id="${id}"]`).first().hover()
  await page.keyboard.press('d')
  await wait(700)
  const afterDone = await fromServer(id)
  check('issue was closed', afterDone.status === 'done', `got ${afterDone.status}`)
  await undo()
  const undoneDone = await fromServer(id)
  check(
    'undo restored the status',
    undoneDone.status === before.status,
    `got ${undoneDone.status}, was ${before.status}`
  )

  /* --- trash */
  await page.locator(`[data-issue-id="${id}"]`).first().hover()
  await page.keyboard.press('Backspace')
  await wait(800)
  check('issue went to the trash', (await fromServer(id)) === null)
  await undo()
  const restored = await fromServer(id)
  check('undo brought it back from the trash', restored !== null)

  /* --- moving between clients */
  const beforeMove = await fromServer(id)
  const workspace = (await (await fetch(`${BASE}/api/state`)).json()).workspace
  const from = workspace.clients.find((c) => c.id === beforeMove.clientId)
  const target = workspace.clients.find((c) => c.id !== beforeMove.clientId && !c.archived)
  await page.locator(`[data-issue-id="${id}"]`).first().click()
  await wait(500)
  /* The panel has seven pickers and the client one is not first — it is picked by
     the name it currently shows, so a reordered panel does not silently retarget
     this test at the status field. */
  await page.locator('.picker').filter({ hasText: from.name }).first().click()
  await wait(300)
  await page.locator('[role="menuitem"]').filter({ hasText: target.name }).first().click()
  await wait(900)
  const afterMove = await fromServer(id)
  check('issue moved to the other client', afterMove.clientId === target.id, `got ${afterMove.clientId}`)
  await page.keyboard.press('Escape')
  await wait(300)
  await undo()
  const undoneMove = await fromServer(id)
  check(
    'undo brought it back to its client',
    undoneMove.clientId === beforeMove.clientId,
    `got ${undoneMove.clientId}, was ${beforeMove.clientId}`
  )

  /* --- an empty stack must not break anything */
  for (let i = 0; i < 5; i += 1) await page.keyboard.press('Control+z')
  await wait(600)
  check('undo on an empty stack does not break the app', errors.length === 0, errors.join(' | '))
  check('the app still answers', (await (await fetch(`${BASE}/api/health`)).json()).ok)

  /* --- Ctrl+Z inside a text field belongs to the browser, not to us */
  await page.locator(`[data-issue-id="${restored?.id ?? id}"]`).first().click()
  await wait(500)
  const title = page.locator('.panel-title-input')
  if (await title.count()) {
    const stateBefore = await fromServer(id)
    await title.click()
    await page.keyboard.type('XYZ')
    await page.keyboard.press('Control+z')
    await wait(600)
    const stateAfter = await fromServer(id)
    check(
      'Ctrl+Z in the title field does not undo an issue change',
      stateAfter.status === stateBefore.status && stateAfter.priority === stateBefore.priority
    )
  }

  await browser.close()
  stop()
  console.log(`\n${failed ? `${failed}  failed, ` : ''}${passed} passed`)
  process.exit(failed ? 1 : 0)
}

run().catch((err) => {
  console.error('the suite itself failed:', err.message)
  stop()
  process.exit(1)
})
