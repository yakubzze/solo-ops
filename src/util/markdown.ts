/**
 * A small Markdown renderer — as much syntax as actually lands in an issue body.
 * It exists instead of a library for one reason: [[wikilink]] has to be a
 * first-class citizen that opens a note, rather than plain text.
 *
 * Raw HTML from content never passes through — everything goes via escape().
 */

const escape = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function inline(text: string): string {
  let out = escape(text)

  // Inline code is protected first, so asterisks inside it survive.
  const codes: string[] = []
  out = out.replace(/`([^`]+)`/g, (_m, code: string) => {
    codes.push(code)
    return `\u0000${codes.length - 1}\u0000`
  })

  out = out
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, (_m, target: string, label: string) =>
      wikilink(target.trim(), label.trim())
    )
    .replace(/\[\[([^\]]+)\]\]/g, (_m, target: string) => wikilink(target.trim(), target.trim()))
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (_m, label: string, href: string) =>
      /^(https?:|obsidian:|mailto:)/i.test(href)
        ? `<a href="${href}" target="_blank" rel="noreferrer">${label}</a>`
        : `${label}`
    )
    .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2" target="_blank" rel="noreferrer">$2</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<em>$2</em>')
    .replace(/~~([^~]+)~~/g, '<del>$1</del>')

  return out.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => `<code>${codes[Number(i)]}</code>`)
}

function wikilink(target: string, label: string): string {
  return `<a class="wikilink" data-wikilink="${target}" href="#">${label}</a>`
}

export function renderMarkdown(source: string): string {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const html: string[] = []
  let list: 'ul' | 'ol' | null = null
  let inCode = false
  let codeBuffer: string[] = []
  let paragraph: string[] = []

  const closeList = () => {
    if (list) {
      html.push(`</${list}>`)
      list = null
    }
  }
  const closeParagraph = () => {
    if (paragraph.length) {
      html.push(`<p>${inline(paragraph.join(' '))}</p>`)
      paragraph = []
    }
  }
  const closeAll = () => {
    closeParagraph()
    closeList()
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (line.trim().startsWith('```')) {
      if (inCode) {
        html.push(`<pre><code>${escape(codeBuffer.join('\n'))}</code></pre>`)
        codeBuffer = []
        inCode = false
      } else {
        closeAll()
        inCode = true
      }
      continue
    }
    if (inCode) {
      codeBuffer.push(raw)
      continue
    }

    if (!line.trim()) {
      closeAll()
      continue
    }

    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    if (heading) {
      closeAll()
      const level = Math.min(heading[1].length + 2, 6)
      html.push(`<h${level}>${inline(heading[2])}</h${level}>`)
      continue
    }

    if (/^(---|___|\*\*\*)\s*$/.test(line)) {
      closeAll()
      html.push('<hr />')
      continue
    }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      closeAll()
      html.push(`<blockquote>${inline(quote[1])}</blockquote>`)
      continue
    }

    const task = /^\s*[-*]\s+\[([ xX])\]\s+(.*)$/.exec(line)
    if (task) {
      closeParagraph()
      if (list !== 'ul') {
        closeList()
        html.push('<ul class="md-tasks">')
        list = 'ul'
      }
      const done = task[1].toLowerCase() === 'x'
      html.push(
        `<li class="md-task${done ? ' is-done' : ''}"><span class="md-box">${done ? '✓' : ''}</span>${inline(task[2])}</li>`
      )
      continue
    }

    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    if (bullet) {
      closeParagraph()
      if (list !== 'ul') {
        closeList()
        html.push('<ul>')
        list = 'ul'
      }
      html.push(`<li>${inline(bullet[1])}</li>`)
      continue
    }

    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (numbered) {
      closeParagraph()
      if (list !== 'ol') {
        closeList()
        html.push('<ol>')
        list = 'ol'
      }
      html.push(`<li>${inline(numbered[1])}</li>`)
      continue
    }

    closeList()
    paragraph.push(line.trim())
  }

  if (inCode && codeBuffer.length) html.push(`<pre><code>${escape(codeBuffer.join('\n'))}</code></pre>`)
  closeAll()
  return html.join('\n')
}

/** The opening of a body — the preview shown in a list row. */
export function excerpt(source: string, max = 120): string {
  const flat = source
    .replace(/```[\s\S]*?```/g, ' ')
    /* List markers and checkboxes leaked into the preview as "- [x] done",
       which read as a bug rather than as content. */
    .replace(/^[ \t]*[-*+]\s+\[[ xX]\]\s*/gm, '')
    .replace(/^[ \t]*[-*+]\s+/gm, '')
    .replace(/^[ \t]*\d+[.)]\s+/gm, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/\[\[([^\]|]+)(\|[^\]]+)?\]\]/g, '$1')
    .replace(/[#>*_`~]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat
}
