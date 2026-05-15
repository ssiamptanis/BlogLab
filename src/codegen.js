// Generate a Python script from the block array

function pyStr(s) {
  const escaped = String(s ?? '').replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n')
  return `"${escaped}"`
}

function pyList(items) {
  return `[${items.map(pyStr).join(', ')}]`
}

function pyBool(v) { return v ? 'True' : 'False' }

export function codeGen(blocks, meta = {}) {
  const filename  = meta.filename  || 'output.pdf'
  const docTitle  = meta.docTitle  || ''
  const docAuthor = meta.docAuthor || ''

  const lines = [
    '"""',
    'GWI BlogLab — generated script',
    'Run: python3 this_file.py',
    '"""',
    'from builder import PDFBuilder',
    '',
    `pdf = PDFBuilder(`,
    `    ${pyStr(filename)},`,
  ]
  if (docTitle)  lines.push(`    doc_title=${pyStr(docTitle)},`)
  if (docAuthor) lines.push(`    doc_author=${pyStr(docAuthor)},`)
  lines.push(')', '')

  const noCard = new Set(['cover', 'section-page', 'page-break'])

  for (const block of blocks) {
    const useCard = block.card && !noCard.has(block.type)
    if (useCard) {
      const borderArg = block.card_border ? `, border_color=${pyStr(block.card_border)}` : ''
      lines.push(`pdf.begin_card(bg_color=${pyStr(block.card_bg || '#FFFFFF')}${borderArg})`)
    }

    switch (block.type) {
      case 'cover':
        lines.push(
          `pdf.cover(`,
          `    title=${pyStr(block.title || '')},`,
          `    subtitle=${pyStr(block.subtitle || '')},`,
          `    author=${pyStr(block.author || '')},`,
          `    date=${pyStr(block.date || '')},`,
          `    category=${pyStr(block.category || '')},`,
          `)`,
        )
        break

      case 'section-page':
        lines.push(
          `pdf.section_page(`,
          `    title=${pyStr(block.title || '')},`,
          ...(block.description ? [`    description=${pyStr(block.description)},`] : []),
          `)`,
        )
        break

      case 'h1':
      case 'h2':
      case 'h3':
      case 'h4': {
        const level = parseInt(block.type.slice(1))
        lines.push(`pdf.section(${pyStr(block.text || '')}, level=${level})`)
        break
      }

      case 'body':
        if (block.muted) {
          lines.push(`pdf.body(${pyStr(block.text || '')}, muted=True)`)
        } else {
          lines.push(`pdf.body(${pyStr(block.text || '')})`)
        }
        break

      case 'small':
        lines.push(`pdf.small(${pyStr(block.text || '')})`)
        break

      case 'bullets':
        lines.push(`pdf.bullets(${pyList(block.items || [])})`)
        break

      case 'numbered':
        lines.push(`pdf.numbered(${pyList(block.items || [])})`)
        break

      case 'stats': {
        const items = (block.items || []).map(s => {
          const parts = [
            `"value": ${pyStr(s.value || '')}`,
            `"unit": ${pyStr(s.unit || '')}`,
            `"description": ${pyStr(s.description || '')}`,
          ]
          return `{${parts.join(', ')}}`
        })
        lines.push(
          `pdf.stats(`,
          `    items=[${items.join(', ')}],`,
          `    columns=${block.columns || 1},`,
          ...(block.section_num   ? [`    section_num=${pyStr(block.section_num)},`]   : []),
          ...(block.section_title ? [`    section_title=${pyStr(block.section_title)},`] : []),
          ...(block.body          ? [`    body=${pyStr(block.body)},`]                  : []),
          `)`
        )
        break
      }

      case 'stat-cards': {
        const cardDict = (card) => {
          const parts = [
            `"section_num": ${pyStr(card.section_num || '')}`,
            `"section_title": ${pyStr(card.section_title || '')}`,
            `"value": ${pyStr(card.value || '')}`,
            `"unit": ${pyStr(card.unit || '')}`,
            `"description": ${pyStr(card.description || '')}`,
            `"body": ${pyStr(card.body || '')}`,
          ]
          return `{${parts.join(', ')}}`
        }
        lines.push(
          `pdf.stat_cards(`,
          `    left=${cardDict(block.left || {})},`,
          `    right=${cardDict(block.right || {})},`,
          `)`
        )
        break
      }

      case 'table': {
        const headers = pyList(block.headers || [])
        const rowLines = (block.rows || []).map(r => `    ${pyList(r)}`)
        lines.push(
          `pdf.table(`,
          `    headers=${headers},`,
          `    rows=[`,
          rowLines.join(',\n'),
          `    ],`,
          ...(block.caption ? [`    caption=${pyStr(block.caption)},`] : []),
          `)`,
        )
        break
      }

      case 'callout':
        lines.push(`pdf.callout(${pyStr(block.text || '')}, style=${pyStr(block.style || 'brand')})`)
        break

      case 'two-columns':
        lines.push(
          `pdf.two_columns(`,
          `    left=${pyStr(block.left || '')},`,
          `    right=${pyStr(block.right || '')},`,
          `)`,
        )
        break

      case 'divider':
        if (block.thick) {
          lines.push(`pdf.divider(thick=True)`)
        } else {
          lines.push(`pdf.divider()`)
        }
        break

      case 'abx-header':
        lines.push(
          `pdf.abx_header(`,
          `    title=${pyStr(block.title || '')},`,
          ...(block.descriptor              ? [`    descriptor=${pyStr(block.descriptor)},`]                    : []),
          ...(block.image                   ? [`    image=${pyStr(block.image)},`]                              : []),
          ...(block.image_scale != null     ? [`    image_scale=${block.image_scale},`]                        : []),
          ...(block.image_wrap  != null     ? [`    image_wrap=${block.image_wrap},`]                          : []),
          `)`,
        )
        break

      case 'page-break':
        lines.push(`pdf.page_break()`)
        break

      default:
        lines.push(`# [unknown block type: ${block.type}]`)
    }

    if (useCard) lines.push(`pdf.end_card()`)
    lines.push('') // blank line between blocks
  }

  lines.push('pdf.build()')
  return lines.join('\n')
}
