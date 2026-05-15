// ─────────────────────────────────────────────────────────────────────────────
// GWI BlogLab App
// ─────────────────────────────────────────────────────────────────────────────
import html2canvas             from 'html2canvas'
import { BlockEditor, cardSectionHTML } from './block-editor.js'
import { codeGen }     from './codegen.js'
import { BRAND }       from './brand.js'
import { titlebarHTML, bindTitlebarEvents, addTab, updateTabName, getTabs, replaceTabId } from './titlebar.js'
import { LUCIDE_ICON_NAMES, lucideSVG, lucideToDataURL } from './lucide-icons.js'
import { apiFetch as _authFetch, supabase } from './supabase.js'
import logoMonoUrl from '../assets/gwi-logo-mono.svg?url'
import logoUrl from '../assets/gwi-logo.svg?url'

const API_BASE = import.meta.env.VITE_API_URL || ''

/** Authenticated fetch wrapper used throughout app.js */
async function apiFetch(url, opts = {}) {
  const res = await _authFetch(url, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res
}

// JSON-parsed variant — mirrors dashboard.js apiFetch
async function apiFetchJSON(url, opts = {}) {
  const res = await _authFetch(url, opts)
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  return res.json()
}

let blocks = []          // array of block objects
let selectedId = null    // currently selected block id
let activeTab = 'edit'   // 'edit'
let container = null
let currentTemplateId = null
let currentTemplateType = null  // e.g. 'insight-report'
let _autosaveTimer = null       // debounced autosave handle
let _lastSavedBlocks = null     // JSON snapshot of last successfully saved blocks
let _currentUser = null         // { name, avatarUrl } cached from Supabase session
let _currentUserId = null       // logged-in user's UUID
let _viewOnly = false           // true when viewing someone else's file

// Template cache — avoids re-fetching when switching tabs or navigating back
const _templateCache = new Map()  // templateId → full template object

let _isLoading = false  // true while fetching template — shows ghost page + spinner

// ── Undo / Redo ────────────────────────────────────────────────────────────
const MAX_HISTORY = 60
let _undoStack = []   // each entry: JSON string snapshot of blocks
let _redoStack = []

function _snapshotBlocks() {
  return JSON.stringify(blocks)
}

function pushUndo() {
  _undoStack.push(_snapshotBlocks())
  if (_undoStack.length > MAX_HISTORY) _undoStack.shift()
  _redoStack = []           // new action clears redo branch
  _updateUndoButtons()
}

function _undoRedoRestore(snapshot) {
  blocks = JSON.parse(snapshot)
  render()
}

function undo() {
  if (!_undoStack.length) return
  _redoStack.push(_snapshotBlocks())
  _undoRedoRestore(_undoStack.pop())
  _updateUndoButtons()
}

function redo() {
  if (!_redoStack.length) return
  _undoStack.push(_snapshotBlocks())
  _undoRedoRestore(_redoStack.pop())
  _updateUndoButtons()
}

function resetHistory() {
  _undoStack = []
  _redoStack = []
  _updateUndoButtons()
}

function _updateUndoButtons() {
  const canUndo = _undoStack.length > 0
  const canRedo = _redoStack.length > 0
  document.querySelectorAll('#btn-undo, #rp-btn-undo').forEach(b => { b.disabled = !canUndo })
  document.querySelectorAll('#btn-redo, #rp-btn-redo').forEach(b => { b.disabled = !canRedo })
}

// Debounced undo push for text field changes.
// Snapshot is taken BEFORE the first mutation in a burst; committed after 600ms silence.
let _undoTextTimer    = null
let _pendingUndoSnap  = null   // pre-burst snapshot

function pushUndoDebounced() {
  // Capture pre-edit state on the FIRST call of each typing burst
  if (_pendingUndoSnap === null) {
    _pendingUndoSnap = _snapshotBlocks()
  }
  clearTimeout(_undoTextTimer)
  _undoTextTimer = setTimeout(() => {
    if (_pendingUndoSnap !== null) {
      _undoStack.push(_pendingUndoSnap)
      if (_undoStack.length > MAX_HISTORY) _undoStack.shift()
      _redoStack = []
      _updateUndoButtons()
    }
    _pendingUndoSnap = null
    _undoTextTimer   = null
  }, 600)
}

const TEMPLATE_TYPE_NAMES = {
  'insight-report':  'One pager PDF',
  'infographic':     'Infographic',
}
let _navigate = null
let _zoomLevel = 1       // user zoom multiplier (1 = auto-fit)

function uid() { return Math.random().toString(36).slice(2, 9) }

// ── Default block shapes ───────────────────────────────────────────────────

const CARD_DEFAULTS = { card: false, card_border: '', card_bg: '#FFFFFF' }

function makeBlock(type) {
  const id = uid()
  const c = CARD_DEFAULTS  // shorthand
  const defaults = {
    cover:        { id, type, title: 'Report Title', subtitle: 'A clear, confident subtitle.', author: _currentUser?.name || 'Your Name', date: '', category: 'Report' },
    'section-page':{ id, type, title: 'Section Title', description: 'Brief section description.' },
    h1:           { id, type, ...c, text: 'Section heading' },
    h2:           { id, type, ...c, text: 'Sub-heading' },
    h3:           { id, type, ...c, text: 'Topic heading' },
    body:         { id, type, ...c, text: 'Body copy goes here. Write clearly, confidently, and directly.', muted: false },
    'text-1col':  { id, type, segments: [{ style: 'h2', text: 'Heading' }, { style: 'body', text: 'Body copy goes here.' }] },
    'text-2col':  { id, type,
                    left:  [{ style: 'h2', text: 'Left heading' }, { style: 'body', text: 'Left column copy.' }],
                    right: [{ style: 'h2', text: 'Right heading' }, { style: 'body', text: 'Right column copy.' }] },
    bullets:      { id, type, ...c, items: ['First point', 'Second point', 'Third point'] },
    numbered:     { id, type, ...c, items: ['Step one', 'Step two', 'Step three'] },
    stats:        { id, type, ...c, columns: 1, section_num: '01', section_title: 'Section heading goes here', body: '',
                    items: [{ value: '14', unit: '%', description: 'of professionals say their company uses Instagram to share marketing messages.' }]},
    'stat-cards': { id, type, ...c,
                    left:  { section_num: '01', section_title: 'Section heading',
                             items: [{ value_type: 'stat', value: '14', unit: '%', icon: '', description: 'of professionals say their company uses Instagram.' }],
                             body: '' },
                    right: { section_num: '02', section_title: 'Section heading',
                             items: [{ value_type: 'stat', value: '68', unit: '%', icon: '', description: 'of Gen Z consumers prefer video content over static posts.' }],
                             body: '' } },
    'abx-header':        { id, type, ...c, title: 'Report title goes here', descriptor: 'Get the lowdown on the key trends shaping your audience.', image: '', image_scale: 1 },
    'infographic-hero':  { id, type, accent: 'Eyebrow line here!', title: 'Infographic title\ngoes here', image: '', image_scale: 1, image_zoom: 1, image_offset_x: 0, image_offset_y: 0 },
    'ig-stats': { id, type, columns: 3, items: [
      { stat_type: 'simple',  eyebrow: '',       value: '34',  unit: '%', description: 'of males eat fast food at least once a week' },
      { stat_type: 'eyebrow', eyebrow: 'Nearly', value: '1/5', unit: '',  description: 'consumers order meals over the phone every week' },
      { stat_type: 'eyebrow', eyebrow: 'Nearly', value: '1/5', unit: '',  description: 'consumers order meals over the phone every week' },
      { stat_type: 'simple',  eyebrow: '',       value: '40',  unit: '%', description: 'of North Americans eat fast food at least once a week' },
      { stat_type: 'simple',  eyebrow: '',       value: '40',  unit: '%', description: 'of North Americans eat fast food at least once a week' },
      { stat_type: 'simple',  eyebrow: '',       value: '61',  unit: '%', description: 'of consumers in EMEA visit a QSR every week' },
    ]},
    table:        { id, type, ...c, headers: ['Column A', 'Column B', 'Column C'],
                    rows: [['Row 1A','Row 1B','Row 1C'],['Row 2A','Row 2B','Row 2C']], caption: '' },
    callout:      { id, type, ...c, text: 'Key insight or highlight to draw attention to.', style: 'brand' },
    'two-columns':{ id, type, ...c, left: 'Left column content.', right: 'Right column content.' },
    divider:      { id, type, ...c, thick: false },
    'page-break': { id, type },
    small:        { id, type, ...c, text: 'Small supporting text or footnote.' },
    footer:       { id, type, text: 'Like these insights?\nDig into more data in our platform.', button_label: 'Discover more', button_url: '' },
  }
  return defaults[type] || { id, type }
}

// ── Block sidebar definitions ─────────────────────────────────────────────

function getBlockGroups(templateType) {
  if (templateType === 'insight-report') {
    return [
      {
        label: 'Content blocks',
        open: true,
        blocks: [
          { type: 'abx-header',  lucide: 'layout-panel-top', label: 'Hero' },
          { type: 'stats',       lucide: 'rows-2',           label: 'Rows' },
          { type: 'stat-cards',  lucide: 'layout-grid',      label: '2 Column' },
          { type: 'divider',     lucide: 'minus',            label: 'Divider' },
          { type: 'footer',      lucide: 'link',             label: 'Footer CTA' },
        ],
      },
      {
        label: 'Others',
        open: false,
        blocks: [
          { type: 'ig-stats',        lucide: 'bar-chart-2',      label: 'IG Stats Grid' },
          { type: 'infographic-hero',lucide: 'image',            label: 'Infographic Hero' },
          { type: 'text-1col',      lucide: 'align-left',       label: '1 Column Text' },
          { type: 'text-2col',      lucide: 'columns-2',        label: '2 Column Text' },
          { type: 'table',          lucide: 'table',            label: 'Table' },
          { type: 'callout',        lucide: 'message-square',   label: 'Callout' },
        ],
      },
    ]
  }

  if (templateType === 'infographic') {
    return [
      {
        label: 'Content blocks',
        open: true,
        blocks: [
          { type: 'infographic-hero', lucide: 'image',        label: 'Infographic Hero' },
          { type: 'ig-stats',         lucide: 'bar-chart-2',  label: 'IG Stats Grid' },
          { type: 'footer',           lucide: 'link',         label: 'Footer CTA' },
        ],
      },
      {
        label: 'Others',
        open: false,
        blocks: [
          { type: 'stats',       lucide: 'rows-2',           label: 'Rows' },
          { type: 'abx-header',  lucide: 'layout-panel-top', label: 'Hero' },
          { type: 'stat-cards',  lucide: 'layout-grid',      label: '2 Column' },
          { type: 'text-1col',   lucide: 'align-left',       label: '1 Column Text' },
          { type: 'text-2col',   lucide: 'columns-2',        label: '2 Column Text' },
          { type: 'table',       lucide: 'table',            label: 'Table' },
          { type: 'callout',     lucide: 'message-square',   label: 'Callout' },
          { type: 'divider',     lucide: 'minus',            label: 'Divider' },
        ],
      },
    ]
  }

  // Fallback — show everything
  return [
    {
      label: 'Content blocks',
      open: true,
      blocks: [
        { type: 'abx-header',       lucide: 'layout-panel-top', label: 'Hero' },
        { type: 'infographic-hero', lucide: 'image',            label: 'Infographic Hero' },
        { type: 'ig-stats',         lucide: 'bar-chart-2',      label: 'IG Stats Grid' },
        { type: 'stats',            lucide: 'rows-2',           label: 'Rows' },
        { type: 'stat-cards',       lucide: 'layout-grid',      label: '2 Column' },
        { type: 'footer',           lucide: 'link',             label: 'Footer CTA' },
      ],
    },
    {
      label: 'Others',
      open: false,
      blocks: [
        { type: 'text-1col',   lucide: 'align-left',     label: '1 Column Text' },
        { type: 'text-2col',   lucide: 'columns-2',      label: '2 Column Text' },
        { type: 'table',       lucide: 'table',          label: 'Table' },
        { type: 'callout',     lucide: 'message-square', label: 'Callout' },
        { type: 'divider',     lucide: 'minus',          label: 'Divider' },
      ],
    },
  ]
}

// ── Page grouping ──────────────────────────────────────────────────────────

// Split flat block list into pages:
// cover / section-page → solo full-page
// page-break           → flushes current content page (no visible block)
// everything else      → accumulates into content pages
function groupIntoPages(blocks) {
  const pages = []
  let current = []

  for (const block of blocks) {
    if (block.type === 'cover' || block.type === 'section-page') {
      if (current.length) { pages.push({ type: 'content', blocks: current }); current = [] }
      pages.push({ type: block.type, block })
    } else if (block.type === 'page-break') {
      if (current.length) { pages.push({ type: 'content', blocks: current }); current = [] }
    } else {
      current.push(block)
    }
  }
  if (current.length) pages.push({ type: 'content', blocks: current })
  return pages
}

function blockActionsFloat(blockId) {
  return `<div class="block-actions-float">
    <button class="icon-btn" data-action="up"   data-id="${blockId}" title="Move up">${lucideSVG('arrow-up', 14, 'currentColor')}</button>
    <button class="icon-btn" data-action="down" data-id="${blockId}" title="Move down">${lucideSVG('arrow-down', 14, 'currentColor')}</button>
    <button class="icon-btn" data-action="dupe" data-id="${blockId}" title="Duplicate">${lucideSVG('copy', 14, 'currentColor')}</button>
    <button class="icon-btn danger" data-action="del" data-id="${blockId}" title="Delete">${lucideSVG('trash-2', 14, 'currentColor')}</button>
  </div>`
}

function renderPage(page, num) {
  if (page.type === 'cover') {
    const b = page.block
    const sel = b.id === selectedId ? ' selected' : ''
    return `<div class="page-wrapper">
      <div class="page-label">Page ${num} · Cover</div>
      <div class="a4-page a4-cover${sel}" data-id="${b.id}">
        <div class="cover-inner">
          <div class="cover-top-line"></div>
          <div class="cover-body">
            ${b.category ? `<div class="cover-badge">${b.category}</div>` : ''}
            <div class="cover-title">${b.title || 'Untitled'}</div>
            ${b.subtitle ? `<div class="cover-subtitle">${b.subtitle}</div>` : ''}
            ${(b.author || b.date) ? `<div class="cover-meta">${[b.author, b.date].filter(Boolean).join(' · ')}</div>` : ''}
          </div>
        </div>
        ${blockActionsFloat(b.id)}
      </div>
    </div>`
  }

  if (page.type === 'section-page') {
    const b = page.block
    const sel = b.id === selectedId ? ' selected' : ''
    return `<div class="page-wrapper">
      <div class="page-label">Page ${num} · Section</div>
      <div class="a4-page a4-section${sel}" data-id="${b.id}">
        <div class="section-inner">
          <div class="section-page-title">${b.title || ''}</div>
          ${b.description ? `<div class="section-page-desc">${b.description}</div>` : ''}
        </div>
        ${blockActionsFloat(b.id)}
      </div>
    </div>`
  }

  // content page
  return `<div class="page-wrapper">
    <div class="page-label">Page ${num}</div>
    <div class="a4-page a4-content">
      ${page.blocks.map(b => {
        const sel = b.id === selectedId ? ' selected' : ''
        const content = b.card
          ? `<div class="card-frame" style="${b.card_border ? `border:2px solid ${b.card_border};` : ''}background:${b.card_bg||'#FFFFFF'}">${blockPreview(b)}</div>`
          : blockPreview(b)
        return `<div class="page-block${sel}" data-id="${b.id}">
          ${content}
          ${blockActionsFloat(b.id)}
        </div>`
      }).join('')}
    </div>
  </div>`
}

// ── Rendering ─────────────────────────────────────────────────────────────

// Migrate legacy stat-card side to items array (backwards compat)
function migrateCardSide(card) {
  if (card && card.items && card.items.length > 0) return card
  return {
    ...card,
    items: [{
      value_type:  card.value_type  || 'stat',
      value:       card.value       || '',
      unit:        card.unit        || '%',
      icon:        card.icon        || '',
      lucide_icon: card.lucide_icon || '',
      description: card.description || '',
    }]
  }
}

const _SEG_STYLES = {
  h1:    'font-size:38px;font-weight:800;color:#101720;line-height:1.15;margin:0 0 8px',
  h2:    'font-size:26px;font-weight:700;color:#101720;line-height:1.25;margin:0 0 6px',
  h3:    'font-size:20px;font-weight:600;color:#101720;line-height:1.3;margin:0 0 4px',
  body:  'font-size:18px;font-weight:400;color:#101720;line-height:1.6;margin:0 0 8px',
  small: 'font-size:12px;font-weight:400;color:#7989A6;line-height:1.5;margin:0 0 4px',
}
function _renderSegments(segs) {
  return (segs || []).map(seg =>
    `<div style="${_SEG_STYLES[seg.style] || _SEG_STYLES.body}">${seg.text || ''}</div>`
  ).join('')
}

function blockPreview(block) {
  switch (block.type) {
    case 'cover':
      return `<div class="block-preview cover-preview">
        <div>${block.title || 'Untitled'}</div>
        <div style="font-size:11px;color:#FF5993;margin-top:4px;font-weight:400">${block.subtitle || ''}</div>
        <div style="margin-top:6px;font-size:10px;color:#7989A6">${[block.author, block.date].filter(Boolean).join(' · ')}</div>
      </div>`

    case 'section-page':
      return `<div class="block-preview cover-preview" style="background:#101720">
        <div>${block.title || ''}</div>
        <div style="font-size:10px;color:#7989A6;font-weight:400;margin-top:4px">${block.description || ''}</div>
      </div>`

    case 'h1':
      return `<div class="block-preview h1-preview">${block.text || ''}</div>`
    case 'h2':
      return `<div class="block-preview h2-preview">${block.text || ''}</div>`
    case 'h3':
      return `<div class="block-preview h3-preview">${block.text || ''}</div>`

    case 'body':
      return `<div class="block-preview" style="color:${block.muted ? '#7989A6' : '#101720'}">${block.text || ''}</div>`

    case 'text-1col':
      return `<div class="block-preview">${_renderSegments(block.segments)}</div>`

    case 'text-2col':
      return `<div class="block-preview" style="display:grid;grid-template-columns:1fr 1fr;gap:24px">
        <div>${_renderSegments(block.left)}</div>
        <div>${_renderSegments(block.right)}</div>
      </div>`

    case 'bullets':
      return `<div class="block-preview">${(block.items || []).map(i =>
        `<div style="padding:2px 0;padding-left:12px;position:relative"><span style="position:absolute;left:0;color:#FF0077">•</span>${i}</div>`
      ).join('')}</div>`

    case 'numbered':
      return `<div class="block-preview">${(block.items || []).map((item, i) =>
        `<div style="padding:2px 0;padding-left:18px;position:relative"><span style="position:absolute;left:0;color:#FF0077">${i+1}.</span>${item}</div>`
      ).join('')}</div>`

    case 'abx-header': {
      const _loading = block.image === '__loading__'
      const _hasImg  = block.image && !_loading
      const _s       = block.image_scale || 1
      // Explicit px height drives the grid rows to grow with scale.
      // Base 420px = comfortable default; scaling up makes the block taller.
      const _imgH    = Math.round(420 * _s)
      const _imgHTML = _loading
        ? `<div class="abx-header-img-loading">
             <div class="abx-img-spinner"></div>
             <span>Loading image…</span>
           </div>`
        : `<img src="${block.image}" alt="" />`
      // image_wrap: higher % = wider text box = less padding. Range 0.3–1.3, invert to get pad factor.
      const _wrapFactor = block.image_wrap ?? 0.9
      const _pad = (_hasImg || _loading) ? Math.round(_imgH * (1.6 - _wrapFactor)) : 0
      return `<div class="abx-header-preview${(_hasImg || _loading) ? ' has-image' : ''}">
        <div class="abx-header-card">
          <div class="abx-header-content"${_pad ? ` style="padding-right:${_pad}px"` : ''}>
            <div class="abx-header-title">${block.title || 'Report title'}</div>
          </div>
          <div class="abx-header-band"${_pad ? ` style="padding-right:${_pad}px"` : ''}>
            <div class="abx-header-desc">${block.descriptor || ''}</div>
            <img src="${logoMonoUrl}" class="abx-header-logo-img" alt="GWI." onerror="this.outerHTML='<div class=\\'abx-header-logo-text\\'>GWI.</div>'" />
          </div>
        </div>
        ${(_hasImg || _loading) ? `<div class="abx-header-right" style="height:${_imgH}px">${_imgHTML}</div>` : ''}
      </div>`
    }

    case 'infographic-hero': {
      const _igLoading = block.image === '__loading__'
      const _igHasImg  = block.image && !_igLoading
      const titleLines = (block.title || '').split('\n')
      const _igS       = block.image_scale || 1
      const _igImgH    = Math.round(420 * _igS)
      const _igImgHTML = _igLoading
        ? `<div class="abx-header-img-loading">
             <div class="abx-img-spinner"></div>
             <span>Loading image…</span>
           </div>`
        : `<img src="${block.image}" alt="" />`
      const _igWrapFactor = block.image_wrap ?? 0.9
      const _igPad = (_igHasImg || _igLoading) ? Math.round(_igImgH * (1.6 - _igWrapFactor)) : 0
      return `<div class="ig-hero-preview${(_igHasImg || _igLoading) ? ' has-image' : ''}"${(_igHasImg || _igLoading) ? ` style="min-height:${_igImgH}px"` : ''}>
        <div class="ig-hero-left"${_igPad ? ` style="padding-right:${_igPad}px"` : ''}>
          <div class="ig-hero-title">
            ${block.accent ? `<div class="ig-hero-accent">${block.accent}</div>` : ''}
            ${titleLines.map(l => `<div class="ig-hero-title-line">${l}</div>`).join('')}
          </div>
          <img src="${logoUrl}" class="ig-hero-logo" alt="GWI."
            onerror="this.outerHTML='<div class=\\'ig-hero-logo-text\\'>GWI<span style=\\'color:#FF0077\\'>.</span></div>'" />
        </div>
        ${(_igHasImg || _igLoading) ? `<div class="ig-hero-right" style="height:${_igImgH}px">${_igImgHTML}</div>` : ''}
        <div class="ig-hero-rule"></div>
      </div>`
    }

    case 'ig-stats': {
      const cols = block.columns || 3
      const items = block.items || []

      // Distribute into columns: items in row-major order → column arrays
      const colArrays = Array.from({ length: cols }, (_, ci) =>
        items.filter((_, i) => i % cols === ci)
      )

      const rows = Math.ceil(items.length / cols)
      const statCellHTML = (item, isLastInCol) => {
        const isEyebrow = item.stat_type === 'eyebrow'
        const valueFontSize = cols === 2 ? '120px' : rows >= 2 ? '68px' : '88px'
        return `
          <div class="ig-stat-cell${isLastInCol ? ' ig-stat-cell--last' : ''}${rows >= 2 ? ' ig-stat-cell--compact' : ''}">
            ${isEyebrow ? `<div class="ig-stat-eyebrow">${item.eyebrow || ''}</div>` : ''}
            <div class="ig-stat-value" style="font-size:${valueFontSize}">
              <span class="ig-stat-number">${item.value || '00'}</span>
              ${item.unit ? `<span class="ig-stat-unit">${item.unit}</span>` : ''}
            </div>
            <div class="ig-stat-desc">${item.description || ''}</div>
          </div>
        `
      }

      const colsHTML = colArrays.map(colItems =>
        `<div class="ig-stats-col">
          ${colItems.map((item, i) => statCellHTML(item, i === colItems.length - 1)).join('')}
        </div>`
      ).join('<div class="ig-stats-col-divider"></div>')

      return `<div class="ig-stats-grid">${colsHTML}</div>`
    }

    case 'stats': {
      const statRows = (block.items || []).map(s => `
        <div class="figma-stat-row">
          <div class="figma-stat-value"><span class="figma-stat-num">${s.value || '—'}</span><span class="figma-stat-unit">${s.unit || ''}</span></div>
          <div class="figma-stat-desc">${s.description || ''}</div>
        </div>`).join('')
      const grid = block.columns === 2
        ? `<div class="figma-stat-grid figma-stat-grid--2">${statRows}</div>`
        : `<div class="figma-stat-grid figma-stat-grid--1">${statRows}</div>`
      return `<div class="block-preview figma-stat-block">
        ${block.section_num ? `<div class="figma-section-num">${block.section_num}</div>` : ''}
        ${block.section_title ? `<div class="figma-section-title">${block.section_title}</div>` : ''}
        ${grid}
        ${block.body ? `<div class="figma-stat-body">${block.body}</div>` : ''}
      </div>`
    }

    case 'stat-cards': {
      const statCard = (rawCard) => {
        const card = migrateCardSide(rawCard || {})
        const rows = (card.items || []).map(item => {
          const vt = item.value_type || 'stat'
          let valueBlock
          if (vt === 'icon' && item.icon) {
            valueBlock = `<img src="${API_BASE}/api/icon-file/${encodeURIComponent(item.icon)}" class="stat-card-icon-preview" alt="" />`
          } else if (vt === 'lucide' && item.lucide_icon) {
            valueBlock = `<span class="stat-card-lucide-preview">${lucideSVG(item.lucide_icon, 80, '#101720')}</span>`
          } else {
            valueBlock = `<span class="figma-stat-num">${item.value || '—'}</span><span class="figma-stat-unit">${item.unit || ''}</span>`
          }
          return `<div class="figma-stat-row">
            <div class="figma-stat-value">${valueBlock}</div>
            <div class="figma-stat-desc">${item.description || ''}</div>
          </div>`
        }).join('')
        return `
        <div class="stat-card">
          ${card.section_num ? `<div class="figma-section-num">${card.section_num}</div>` : ''}
          ${card.section_title ? `<div class="figma-section-title">${card.section_title}</div>` : ''}
          ${rows}
          ${card.body ? `<div class="figma-stat-body">${card.body}</div>` : ''}
        </div>`
      }
      return `<div class="stat-cards-preview">
        ${statCard(block.left || {})}
        <div class="stat-cards-divider"></div>
        ${statCard(block.right || {})}
      </div>`
    }

    case 'table':
      return `<div class="block-preview table-preview">
        <table>
          <tr>${(block.headers || []).map(h => `<th>${h}</th>`).join('')}</tr>
          ${(block.rows || []).map(r =>
            `<tr>${r.map(c => `<td>${c}</td>`).join('')}</tr>`
          ).join('')}
        </table>
      </div>`

    case 'callout':
      const cls = { brand: 'brand-callout', success: 'success-callout', warning: 'warning-callout' }[block.style] || ''
      return `<div class="block-preview callout-preview ${cls}">${block.text || ''}</div>`

    case 'two-columns':
      return `<div class="block-preview" style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        <div style="font-size:18px;color:#000;font-weight:400">${block.left || ''}</div>
        <div style="font-size:18px;color:#000;font-weight:400">${block.right || ''}</div>
      </div>`

    case 'divider':
      return `<div style="border-top:${block.thick ? '2' : '1'}px solid #CED9EB;margin:4px 0"></div>`

    case 'page-break':
      return `<div style="border:1.5px dashed #CED9EB;border-radius:4px;padding:6px;text-align:center;font-size:11px;color:#ABB8CF">Page break</div>`

    case 'small':
      return `<div class="block-preview" style="font-size:11px;color:#7989A6">${block.text || ''}</div>`

    case 'footer':
      return `<div class="footer-preview">
        <div class="footer-preview-text">${(block.text || '').replace(/\n/g, '<br>')}</div>
        <div class="footer-preview-btn">${block.button_label || 'Discover more'}</div>
      </div>`

    default:
      return `<div class="block-preview text-muted">${block.type}</div>`
  }
}

function renderBlocks() {
  const editorEl = container.querySelector('.editor-content')
  if (!editorEl) return

  if (blocks.length === 0) {
    if (_isLoading) {
      editorEl.innerHTML = `
        <div class="editor-loading-wrap">
          <div class="editor-loading-center">
            <div class="page-spinner"></div>
            <span class="editor-loading-label">Loading PDF…</span>
          </div>
        </div>`
      return
    }
    editorEl.innerHTML = `
      <div class="editor-empty">
        <p>Click a block type in the left panel to add it.</p>
      </div>`
    return
  }

  const blocksHtml = blocks.map(b => {
    const sel = b.id === selectedId ? ' selected' : ''
    const content = b.card
      ? `<div class="card-frame" style="${b.card_border ? `border:2px solid ${b.card_border};` : ''}background:${b.card_bg||'#FFFFFF'}">${blockPreview(b)}</div>`
      : blockPreview(b)
    return `<div class="page-block${sel}" data-id="${b.id}" draggable="true">
      ${content}
      ${blockActionsFloat(b.id)}
    </div>`
  }).join('')

  editorEl.innerHTML = `
    <div class="page-canvas">
      <div class="zoom-badge">100%</div>
      <div class="canvas-scaler">
        <div class="report-canvas">${blocksHtml}</div>
      </div>
    </div>`

  applyCanvasScale(editorEl)

  // Unified event delegation
  const canvas = editorEl.querySelector('.report-canvas')
  canvas.addEventListener('click', (e) => {
    const actionBtn = e.target.closest('[data-action]')
    if (actionBtn) {
      e.stopPropagation()
      handleBlockAction(actionBtn.dataset.action, actionBtn.dataset.id)
      return
    }
    const blockEl = e.target.closest('[data-id]')
    if (blockEl?.dataset.id) {
      selectBlock(blockEl.dataset.id)
    } else {
      if (selectedId !== null) { selectedId = null; render() }
    }
  })

  // ── Drag-and-drop block reordering ──────────────────────────────────────
  let _dragId = null

  const _removeIndicator = () => canvas.querySelector('.drag-indicator')?.remove()

  canvas.addEventListener('dragstart', e => {
    const blockEl = e.target.closest('.page-block')
    if (!blockEl) return
    _dragId = blockEl.dataset.id
    e.dataTransfer.effectAllowed = 'move'
    e.dataTransfer.setData('text/plain', _dragId)
    // Defer so the drag ghost renders before opacity drops
    requestAnimationFrame(() => blockEl.classList.add('dragging'))
  })

  canvas.addEventListener('dragover', e => {
    e.preventDefault()
    e.dataTransfer.dropEffect = 'move'
    const blockEl = e.target.closest('.page-block')
    if (!blockEl || blockEl.dataset.id === _dragId) return

    const rect = blockEl.getBoundingClientRect()
    const isBefore = e.clientY < rect.top + rect.height / 2

    _removeIndicator()
    const indicator = document.createElement('div')
    indicator.className = 'drag-indicator'
    blockEl.parentNode.insertBefore(indicator, isBefore ? blockEl : blockEl.nextSibling)
    blockEl.dataset.dragPos = isBefore ? 'before' : 'after'
    // Track target
    canvas.dataset.dragTarget = blockEl.dataset.id
    canvas.dataset.dragPos    = blockEl.dataset.dragPos
  })

  canvas.addEventListener('dragleave', e => {
    if (!canvas.contains(e.relatedTarget)) {
      _removeIndicator()
      delete canvas.dataset.dragTarget
    }
  })

  canvas.addEventListener('drop', e => {
    e.preventDefault()
    _removeIndicator()
    const toId  = canvas.dataset.dragTarget
    const pos   = canvas.dataset.dragPos
    delete canvas.dataset.dragTarget
    delete canvas.dataset.dragPos

    if (!_dragId || !toId || _dragId === toId) return

    const fromIdx = blocks.findIndex(b => b.id === _dragId)
    const toIdx   = blocks.findIndex(b => b.id === toId)
    if (fromIdx === -1 || toIdx === -1) return

    pushUndo()
    const dragged   = blocks[fromIdx]
    const remaining = blocks.filter(b => b.id !== _dragId)
    // toIdx in original array; after removal, if dragging down shift by -1
    let insertAt = pos === 'after' ? toIdx + 1 : toIdx
    if (fromIdx < toIdx) insertAt -= 1
    remaining.splice(Math.max(0, insertAt), 0, dragged)
    blocks = remaining
    _dragId = null
    render()
  })

  canvas.addEventListener('dragend', () => {
    _removeIndicator()
    canvas.querySelectorAll('.page-block.dragging').forEach(el => el.classList.remove('dragging'))
    _dragId = null
  })
}

function applyCanvasScale(editorEl) {
  const pageCanvas   = editorEl.querySelector('.page-canvas')
  const scaler       = editorEl.querySelector('.canvas-scaler')
  const reportCanvas = editorEl.querySelector('.report-canvas')
  if (!scaler || !pageCanvas || !reportCanvas) return

  const availW   = pageCanvas.clientWidth - 48
  const autoFit  = Math.min(1, availW / 1200)
  const scale    = autoFit * _zoomLevel
  scaler.style.transform = `scale(${scale})`
  scaler.style.height    = (reportCanvas.offsetHeight * scale) + 'px'

  // Update zoom badge
  const badge = editorEl.querySelector('.zoom-badge')
  if (badge) badge.textContent = Math.round(_zoomLevel * 100) + '%'

  if (!scaler._resizeObs && window.ResizeObserver) {
    scaler._resizeObs = new ResizeObserver(() => applyCanvasScale(editorEl))
    scaler._resizeObs.observe(pageCanvas)
  }
}

function renderPanel() {
  const panelBody = container.querySelector('.panel-body')
  if (!panelBody) return

  if (activeTab === 'brand') {
    renderBrandPanel(panelBody)
    return
  }

  if (activeTab === 'code') {
    renderCodePanel(panelBody)
    return
  }

  // Edit tab
  const block = blocks.find(b => b.id === selectedId)
  if (!block) {
    panelBody.innerHTML = `
      <div class="no-selection">
        <p>Click a block in the editor to edit its content, or add a new block from the left panel.</p>
      </div>`
    return
  }

  const noCard = ['cover', 'section-page', 'page-break', 'footer', 'abx-header', 'infographic-hero', 'ig-stats', 'table', 'stats']
  panelBody.innerHTML = BlockEditor(block) + (noCard.includes(block.type) ? '' : cardSectionHTML(block))
  attachEditorListeners(panelBody, block)
}

function renderBrandPanel(el) {
  el.innerHTML = `
    <div class="brand-section">
      <h4>Primary colours</h4>
      ${BRAND.primary.map(c => `
        <div class="colour-row">
          <div class="colour-dot" style="background:${c.hex}"></div>
          <span class="colour-name">${c.name}</span>
          <span class="colour-hex">${c.hex}</span>
        </div>`).join('')}
    </div>
    <div class="brand-section">
      <h4>Grey scale</h4>
      ${BRAND.greys.map(c => `
        <div class="colour-row">
          <div class="colour-dot" style="background:${c.hex};border-color:rgba(0,0,0,.1)"></div>
          <span class="colour-name">${c.name}</span>
          <span class="colour-hex">${c.hex}</span>
        </div>`).join('')}
    </div>
    <div class="brand-section">
      <h4>Secondary colours</h4>
      ${BRAND.secondary.map(c => `
        <div class="colour-row">
          <div class="colour-dot" style="background:${c.hex}"></div>
          <span class="colour-name">${c.name}</span>
          <span class="colour-hex">${c.hex}</span>
        </div>`).join('')}
    </div>
    <div class="brand-section">
      <h4>Typography — Faktum</h4>
      <div class="type-row">
        <div class="type-sample" style="font-size:20px;font-weight:800;line-height:1.2">Hero</div>
        <span class="type-spec">ExtraBold 800</span>
      </div>
      <div class="type-row">
        <div class="type-sample" style="font-size:15px;font-weight:700">Section heading</div>
        <span class="type-spec">Bold 700</span>
      </div>
      <div class="type-row">
        <div class="type-sample" style="font-size:12px;font-weight:600">UI label / CTA</div>
        <span class="type-spec">SemiBold 600</span>
      </div>
      <div class="type-row">
        <div class="type-sample" style="font-size:12px;font-weight:400">Body copy — write clearly and directly.</div>
        <span class="type-spec">Regular 400</span>
      </div>
    </div>
    <div class="brand-section">
      <h4>Tone of voice</h4>
      <div style="font-size:12px;line-height:1.7;color:#526482">
        <p style="margin-bottom:8px"><strong style="color:#101720">Bold.</strong> Strong verbs, clear claims. Turn confidence to 11.</p>
        <p style="margin-bottom:8px"><strong style="color:#101720">Clear.</strong> Short sentences, plain language. Demystify, don't impress.</p>
        <p><strong style="color:#101720">Human.</strong> Write like one person talking to another.</p>
      </div>
    </div>
    <div class="brand-section">
      <h4>Data viz palette</h4>
      <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
        ${BRAND.dataViz.map(c => `
          <div title="${c.name}: ${c.hex}" style="width:32px;height:32px;border-radius:6px;background:${c.hex};border:1px solid rgba(0,0,0,.08)"></div>
        `).join('')}
      </div>
      <div style="font-size:11px;color:#7989A6;margin-top:6px">Always use in this order for charts and graphs.</div>
    </div>
  `
}

function renderCodePanel(el) {
  const code = codeGen(blocks)
  el.innerHTML = `
    <div style="margin-bottom:10px">
      <div class="text-xs text-muted" style="margin-bottom:6px">Generated Python script — copy and run to produce your PDF.</div>
      <div class="script-output" id="code-out">${syntaxHL(code)}</div>
      <button class="copy-btn" id="copy-code">Copy to clipboard</button>
    </div>
    <div style="font-size:11px;color:#7989A6;line-height:1.6">
      Run with: <code style="background:#EBF1FB;padding:2px 6px;border-radius:4px;font-family:var(--mono)">python3 builder.py</code>
    </div>
  `
  el.querySelector('#copy-code')?.addEventListener('click', async (e) => {
    await navigator.clipboard.writeText(code).catch(() => {})
    e.target.textContent = 'Copied!'
    e.target.classList.add('copied')
    setTimeout(() => {
      e.target.textContent = 'Copy to clipboard'
      e.target.classList.remove('copied')
    }, 2000)
  })
}

function syntaxHL(code) {
  return code
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/(from|import|def|class|if|else|elif|for|in|return|True|False|None)/g,
             '<span class="kw">$1</span>')
    .replace(/("""[\s\S]*?"""|'[^']*'|"[^"]*")/g, '<span class="str">$1</span>')
    .replace(/\b(\d+\.?\d*)\b/g, '<span class="num">$1</span>')
    .replace(/(pdf\.\w+)/g, '<span class="fn">$1</span>')
    .replace(/(#.*$)/gm, '<span class="cm">$1</span>')
}

// ── Icon modal ────────────────────────────────────────────────────────────

function iconLabel(filename) {
  return filename.replace(/^Icon=/, '').replace(/,\s*Colour=.*$/i, '').replace(/\.[^.]+$/, '').trim()
}

function refreshIconSlot(slot, chosen) {
  const preview = slot.querySelector('.icon-picker-preview')
  const label   = slot.querySelector('.icon-picker-label')
  if (chosen) {
    if (preview) { preview.src = `${API_BASE}/api/icon-file/${encodeURIComponent(chosen)}`; preview.style.display = '' }
    if (label)   label.textContent = iconLabel(chosen)
  } else {
    if (preview) preview.style.display = 'none'
    if (label)   label.textContent = 'No icon selected'
  }
}

let _iconCache = null  // cache the icons list after first fetch

function openIconModal(currentIcon, onSelect) {
  const overlay = document.createElement('div')
  overlay.className = 'icon-modal-overlay'
  overlay.innerHTML = `
    <div class="icon-modal">
      <div class="icon-modal-header">
        <span class="icon-modal-title">Choose an icon</span>
        <input class="icon-modal-search field-input" placeholder="Search 130+ icons…" autocomplete="off" />
        <button class="icon-modal-close" title="Close">×</button>
      </div>
      <div class="icon-modal-body">
        <div class="icon-modal-status">Loading icons…</div>
      </div>
      <div class="img-modal-footer">
        <a class="modal-request-btn" href="https://form.asana.com/?k=IhJ5evuZfLbryH5cr_4wgQ&d=149651404743580" target="_blank" rel="noopener">
          ${lucideSVG('external-link', 13, 'currentColor')} Request an icon
        </a>
      </div>
    </div>`
  document.body.appendChild(overlay)

  // Close
  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
  overlay.querySelector('.icon-modal-close').addEventListener('click', () => overlay.remove())
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc) }
  })

  const body   = overlay.querySelector('.icon-modal-body')
  const search = overlay.querySelector('.icon-modal-search')

  function renderGrid(icons) {
    if (!icons.length) {
      body.innerHTML = '<div class="icon-modal-status">No icons match your search.</div>'
      return
    }
    body.innerHTML = `<div class="icon-modal-grid">
      ${icons.map(f => {
        const lbl = iconLabel(f)
        return `<button class="icon-modal-thumb${f === currentIcon ? ' active' : ''}" data-icon="${f}" title="${lbl}">
          <img src="${API_BASE}/api/icon-file/${encodeURIComponent(f)}" alt="${lbl}" loading="lazy" />
          <span class="icon-modal-label">${lbl}</span>
        </button>`
      }).join('')}
    </div>`
    body.querySelectorAll('.icon-modal-thumb').forEach(btn => {
      btn.addEventListener('click', () => {
        onSelect(btn.dataset.icon)
        overlay.remove()
      })
    })
  }

  const load = _iconCache
    ? Promise.resolve(_iconCache)
    : apiFetchJSON('/api/icons').then(list => { _iconCache = list; return list })

  load
    .then(icons => {
      renderGrid(icons)
      setTimeout(() => search.focus(), 60)
      search.addEventListener('input', () => {
        const q = search.value.toLowerCase()
        renderGrid(q ? icons.filter(f => iconLabel(f).toLowerCase().includes(q)) : icons)
      })
    })
    .catch(() => {
      body.innerHTML = '<div class="icon-modal-status" style="color:#DA3441">Could not load icons — make sure the server is running.</div>'
    })
}

// ── Lucide icon modal ─────────────────────────────────────────────────────

function openLucideModal(currentIcon, onSelect) {
  const overlay = document.createElement('div')
  overlay.className = 'icon-modal-overlay'
  overlay.innerHTML = `
    <div class="icon-modal">
      <div class="icon-modal-header">
        <span class="icon-modal-title">Choose a Lucide icon</span>
        <input class="icon-modal-search field-input" placeholder="Search ${LUCIDE_ICON_NAMES.length} icons…" autocomplete="off" />
        <button class="icon-modal-close" title="Close">×</button>
      </div>
      <div class="icon-modal-body">
        <div class="icon-modal-status">Loading…</div>
      </div>
    </div>`
  document.body.appendChild(overlay)

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
  overlay.querySelector('.icon-modal-close').addEventListener('click', () => overlay.remove())
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc) }
  })

  const body   = overlay.querySelector('.icon-modal-body')
  const search = overlay.querySelector('.icon-modal-search')

  function renderGrid(names) {
    if (!names.length) {
      body.innerHTML = '<div class="icon-modal-status">No icons match.</div>'
      return
    }
    // Render in batches to avoid blocking the main thread for 1900+ icons
    body.innerHTML = `<div class="icon-modal-grid lucide-modal-grid"></div>`
    const grid = body.querySelector('.lucide-modal-grid')
    const chunk = 100
    let i = 0
    function addChunk() {
      const slice = names.slice(i, i + chunk)
      slice.forEach(name => {
        const btn = document.createElement('button')
        btn.className = 'icon-modal-thumb' + (name === currentIcon ? ' active' : '')
        btn.dataset.icon = name
        btn.title = name
        btn.innerHTML = lucideSVG(name, 32, '#101720') + `<span class="icon-modal-label">${name}</span>`
        btn.addEventListener('click', () => { onSelect(name); overlay.remove() })
        grid.appendChild(btn)
      })
      i += chunk
      if (i < names.length) requestAnimationFrame(addChunk)
    }
    addChunk()
  }

  renderGrid(LUCIDE_ICON_NAMES)
  setTimeout(() => search.focus(), 60)
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase().replace(/\s+/g, '-')
    renderGrid(q ? LUCIDE_ICON_NAMES.filter(n => n.includes(q)) : LUCIDE_ICON_NAMES)
  })
}

// ── Image picker modal ────────────────────────────────────────────────────

function refreshImgSlot(slot, chosen, name) {
  const preview = slot.querySelector('.img-picker-preview')
  const lbl     = slot.querySelector('.img-picker-label')
  const btn     = slot.querySelector('.img-picker-open-btn')
  if (preview) {
    if (chosen) { preview.src = chosen; preview.style.display = '' }
    else        { preview.src = ''; preview.style.display = 'none' }
  }
  if (lbl) lbl.textContent = name || (chosen ? 'Image selected' : 'No image selected')
  if (btn) btn.textContent = chosen ? 'Change image →' : 'Add image →'
  slot.dataset.selected     = chosen || ''
  slot.dataset.selectedName = name  || ''
}

// ── Illustration category preferences (localStorage) ──────────────────────
const ILLUS_PREFS_KEY = 'abx_illus_enabled_nodes'

function getEnabledNodes() {
  try { return JSON.parse(localStorage.getItem(ILLUS_PREFS_KEY)) } catch { return null }
}

function openImageModal(currentImg, onSelect) {
  const overlay = document.createElement('div')
  overlay.className = 'icon-modal-overlay'
  overlay.innerHTML = `
    <div class="icon-modal img-modal">
      <div class="icon-modal-header">
        <span class="icon-modal-title">Choose an illustration</span>
        <input class="icon-modal-search field-input" placeholder="Search illustrations…" autocomplete="off" />
        <button class="icon-modal-close" title="Close">×</button>
      </div>
      <div class="icon-modal-body"></div>
    </div>`
  document.body.appendChild(overlay)

  overlay.addEventListener('click', (e) => { if (e.target === overlay) overlay.remove() })
  overlay.querySelector('.icon-modal-close').addEventListener('click', () => overlay.remove())
  document.addEventListener('keydown', function esc(e) {
    if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', esc) }
  })

  const body   = overlay.querySelector('.icon-modal-body')
  const search = overlay.querySelector('.icon-modal-search')
  let   _all   = []

  function renderGrid(images) {
    if (!images.length) {
      body.innerHTML = '<div class="icon-modal-status">No illustrations available.</div>'
      return
    }
    const cats = {}
    images.forEach(img => {
      const cat = img.category || 'Illustrations'
      if (!cats[cat]) cats[cat] = []
      cats[cat].push(img)
    })
    const noneBtn = `<button class="icon-modal-thumb img-modal-thumb${!currentImg ? ' active' : ''}" data-url="" title="None">
      <div class="img-modal-none">—</div>
      <span class="icon-modal-label">None</span>
    </button>`
    body.innerHTML = Object.entries(cats).map(([cat, items], idx) => `
      <div class="img-modal-category">
        <div class="img-modal-category-label">${cat}</div>
        <div class="icon-modal-grid img-modal-grid">
          ${idx === 0 ? noneBtn : ''}
          ${items.map(img => `
            <button class="icon-modal-thumb img-modal-thumb${(img.svg_url && img.svg_url === currentImg) || img.url === currentImg ? ' active' : ''}" data-url="${img.url}" data-node="${img.node_id || ''}" data-svg="${img.svg_url || ''}" title="${img.name}">
              <img src="${img.url || img.svg_url}" alt="${img.name}" loading="lazy" />
              <span class="icon-modal-label">${img.name}</span>
            </button>`).join('')}
        </div>
      </div>`).join('')
    body.querySelectorAll('.img-modal-thumb').forEach(btn => {
      btn.addEventListener('click', () => {
        const nodeId  = btn.dataset.node
        const svgUrl  = btn.dataset.svg
        const name    = btn.title || ''
        if (!nodeId) { onSelect('', ''); overlay.remove(); return }
        // Use pre-warmed SVG URL if available — instant, no API call
        if (svgUrl) { onSelect(svgUrl, name); overlay.remove(); return }
        btn.disabled = true
        btn.classList.add('img-modal-thumb--loading')
        const _spin = document.createElement('div')
        _spin.className = 'img-modal-thumb-spinner'
        btn.appendChild(_spin)
        apiFetchJSON(`/api/figma-svg?node_id=${encodeURIComponent(nodeId)}`)
          .then(data => { onSelect(data.url, name); overlay.remove() })
          .catch(() => { onSelect(btn.dataset.url, name); overlay.remove() })
      })
    })
  }

  function loadFigmaAssets() {
    body.innerHTML = '<div class="icon-modal-status">Loading illustrations…</div>'
    apiFetchJSON('/api/figma-assets')
      .then(images => {
        _all = Array.isArray(images) ? images : []
        renderGrid(_all)
        setTimeout(() => search.focus(), 60)
      })
      .catch(err => {
        body.innerHTML = `<div class="icon-modal-status" style="color:#DA3441">Could not load: ${err.message}</div>`
      })
  }

  loadFigmaAssets()
  search.addEventListener('input', () => {
    const q = search.value.toLowerCase()
    renderGrid(q ? _all.filter(f => f.name.toLowerCase().includes(q)) : _all)
  })
}

// ── Block editing ─────────────────────────────────────────────────────────

function updateRangeFill(el) {
  const min = parseFloat(el.min) || 0
  const max = parseFloat(el.max) || 100
  const val = parseFloat(el.value) || 0
  const pct = ((val - min) / (max - min)) * 100
  el.style.setProperty('--range-pct', `${pct}%`)
}

function attachEditorListeners(panelBody, block) {
  // Helper: read the right value from a field el (rich or plain)
  function fieldVal(el) {
    if (el.dataset.rich) return el.innerHTML
    if (el.type === 'checkbox') return el.checked
    return el.value
  }

  // Select-all on focus for numeric stat/value/unit inputs so the old value
  // doesn't need to be manually cleared before typing a new one
  panelBody.addEventListener('focusin', e => {
    const el = e.target
    if (el.tagName !== 'INPUT' || el.type === 'range' || el.type === 'checkbox') return
    if (el.dataset.statField || el.dataset.igField || el.dataset.itemField) {
      el.select()
    }
  })

  // Initialise range fill for any sliders already in panel
  panelBody.querySelectorAll('input[type="range"]').forEach(updateRangeFill)

  // Strip formatting on paste into rich fields — insert plain text only
  panelBody.querySelectorAll('[data-rich]').forEach(el => {
    el.addEventListener('paste', e => {
      e.preventDefault()
      const text = (e.clipboardData || window.clipboardData).getData('text/plain')
      document.execCommand('insertText', false, text)
    })
  })

  // Generic text inputs / textareas / rich fields
  panelBody.querySelectorAll('[data-field]').forEach(el => {
    el.addEventListener('input', () => {
      const field = el.dataset.field
      let val = fieldVal(el)
      if (field === 'columns') val = parseInt(val)
      if (el.type === 'range') val = parseFloat(val)
      updateBlock(block.id, { [field]: val })
      // Live update any adjacent range-val display and track fill
      if (el.type === 'range') {
        const valSpan = el.parentElement?.querySelector('.range-val')
        if (valSpan) valSpan.textContent = Math.round(parseFloat(el.value) * 100) + '%'
        updateRangeFill(el)
      }
    })
  })

  // ▲▼ fine-step buttons (1% increments) on range sliders
  panelBody.querySelectorAll('.range-step-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const field   = btn.dataset.stepField
      const delta   = parseFloat(btn.dataset.delta)
      const min     = parseFloat(btn.dataset.min)
      const max     = parseFloat(btn.dataset.max)
      const current = parseFloat(blocks.find(b => b.id === block.id)?.[field] ?? 1)
      const next    = Math.round(Math.min(max, Math.max(min, current + delta)) * 1000) / 1000
      // Sync slider position + label
      const rangeEl = panelBody.querySelector(`input[type="range"][data-field="${field}"]`)
      if (rangeEl) { rangeEl.value = next; updateRangeFill(rangeEl) }
      const valSpan = rangeEl?.closest('div')?.querySelector('.range-val')
      if (valSpan) valSpan.textContent = Math.round(next * 100) + '%'
      updateBlock(block.id, { [field]: next })
    })
  })

  // Columns pill picker (1 col / 2 col) — rerenders panel so stat label updates
  panelBody.querySelectorAll('[data-col-pick]').forEach(btn => {
    btn.addEventListener('click', () => {
      updateBlock(block.id, { columns: parseInt(btn.dataset.colPick) }, { rerenderPanel: true })
    })
  })

  // Stats items — structural add/remove need full render so new fields appear in panel
  panelBody.querySelector('#add-stat')?.addEventListener('click', () => {
    pushUndo()
    const b = blocks.find(x => x.id === block.id)
    blocks = blocks.map(bl => bl.id === block.id ? { ...bl, items: [...(b.items||[]), { value: '', unit: '%', description: '' }] } : bl)
    render()
  })

  panelBody.querySelectorAll('[data-stat-field]').forEach(el => {
    el.addEventListener('input', () => {
      const idx   = parseInt(el.dataset.statIdx)
      const field = el.dataset.statField
      const b     = blocks.find(x => x.id === block.id)
      const items = [...b.items]
      items[idx] = { ...items[idx], [field]: fieldVal(el) }
      updateBlock(block.id, { items })
    })
  })

  panelBody.querySelectorAll('[data-remove-stat]').forEach(btn => {
    btn.addEventListener('click', () => {
      pushUndo()
      const idx = parseInt(btn.dataset.removeStat)
      const b   = blocks.find(x => x.id === block.id)
      blocks = blocks.map(bl => bl.id === block.id ? { ...bl, items: b.items.filter((_, i) => i !== idx) } : bl)
      render()
    })
  })

  // ig-stats items
  panelBody.querySelector('#ig-add-stat')?.addEventListener('click', () => {
    pushUndo()
    const b = blocks.find(x => x.id === block.id)
    blocks = blocks.map(bl => bl.id === block.id
      ? { ...bl, items: [...(b.items||[]), { stat_type: 'simple', eyebrow: '', value: '00', unit: '%', description: 'Description here' }] }
      : bl)
    render()
  })

  panelBody.querySelectorAll('[data-ig-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      pushUndo()
      const idx = parseInt(btn.dataset.igRemove)
      const b = blocks.find(x => x.id === block.id)
      blocks = blocks.map(bl => bl.id === block.id
        ? { ...bl, items: b.items.filter((_, i) => i !== idx) }
        : bl)
      render()
    })
  })

  panelBody.querySelectorAll('[data-ig-field]').forEach(el => {
    el.addEventListener('input', () => {
      const idx   = parseInt(el.dataset.igIdx)
      const field = el.dataset.igField
      const val   = el.dataset.rich ? el.innerHTML : el.value
      const b     = blocks.find(x => x.id === block.id)
      const items = [...b.items]
      items[idx] = { ...items[idx], [field]: val }
      updateBlock(block.id, { items })
    })
  })

  panelBody.querySelectorAll('[data-ig-type]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx  = parseInt(btn.dataset.igIdx)
      const type = btn.dataset.igType
      const b    = blocks.find(x => x.id === block.id)
      const items = [...b.items]
      items[idx] = { ...items[idx], stat_type: type }
      blocks = blocks.map(bl => bl.id === block.id ? { ...bl, items } : bl)
      render()
    })
  })

  // ig-stats column toggle (style-chip with data-val)
  panelBody.querySelectorAll('.style-chip[data-val]').forEach(btn => {
    btn.addEventListener('click', () => {
      updateBlock(block.id, { [btn.dataset.field]: parseInt(btn.dataset.val) })
      render()
    })
  })

  // Bullet/numbered list items
  panelBody.querySelectorAll('[data-list-item]').forEach(el => {
    el.addEventListener('input', () => {
      const idx  = parseInt(el.dataset.listItem)
      const b    = blocks.find(x => x.id === block.id)
      const items = [...b.items]
      items[idx] = el.value
      updateBlock(block.id, { items })
    })
  })
  panelBody.querySelector('#add-list-item')?.addEventListener('click', () => {
    const b = blocks.find(x => x.id === block.id)
    updateBlock(block.id, { items: [...(b.items||[]), 'New item'] })
  })
  panelBody.querySelectorAll('[data-remove-list]').forEach(btn => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.removeList)
      const b   = blocks.find(x => x.id === block.id)
      updateBlock(block.id, { items: b.items.filter((_, i) => i !== idx) })
    })
  })

  // Callout style
  panelBody.querySelectorAll('.style-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      updateBlock(block.id, { style: chip.dataset.style })
    })
  })

  // Image picker (abx-header, infographic-hero)
  const imgSlot = panelBody.querySelector('.img-picker-slot')
  if (imgSlot) {
    imgSlot.querySelector('.img-picker-open-btn')?.addEventListener('click', () => {
      openImageModal(imgSlot.dataset.selected, (chosen, name) => {
        refreshImgSlot(imgSlot, chosen, name)
        updateBlock(block.id, { image: chosen, image_name: name || '' })
      })
    })
  }

  // Stat-cards: value-type toggle (per item)
  panelBody.querySelectorAll('.vt-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const side = btn.dataset.cardSide
      const idx  = parseInt(btn.dataset.itemIdx)
      const val  = btn.dataset.value
      const b    = blocks.find(x => x.id === block.id)
      const cardSide = migrateCardSide(b[side] || {})
      const items = [...cardSide.items]
      items[idx] = { ...items[idx], value_type: val }
      updateBlock(block.id, { [side]: { ...cardSide, items } })
      // Toggle stat/icon/lucide field visibility immediately (no full re-render)
      const itemEl = btn.closest('.sc-item')
      if (itemEl) {
        itemEl.querySelector('.vt-stat-fields').style.display   = val === 'stat' ? '' : 'none'
        itemEl.querySelector('.vt-icon-fields').style.display   = val === 'icon' ? '' : 'none'
        itemEl.querySelector('.vt-lucide-fields')?.style && (itemEl.querySelector('.vt-lucide-fields').style.display = 'none')
        itemEl.querySelectorAll('.vt-btn').forEach(b2 => b2.classList.toggle('active', b2.dataset.value === val))
      }
    })
  })

  // Stat-cards: per-item field inputs (value, unit, description, body)
  panelBody.querySelectorAll('[data-card-side][data-item-idx][data-item-field]').forEach(el => {
    el.addEventListener('input', () => {
      const side  = el.dataset.cardSide
      const idx   = parseInt(el.dataset.itemIdx)
      const field = el.dataset.itemField
      const b     = blocks.find(x => x.id === block.id)
      const cardSide = migrateCardSide(b[side] || {})
      const items = [...cardSide.items]
      items[idx] = { ...items[idx], [field]: fieldVal(el) }
      updateBlock(block.id, { [side]: { ...cardSide, items } })
    })
  })

  // Stat-cards: body copy (card-level, not item-level)
  panelBody.querySelectorAll('[data-card-side][data-card-field="body"]').forEach(el => {
    el.addEventListener('input', () => {
      const side = el.dataset.cardSide
      const b    = blocks.find(x => x.id === block.id)
      const cardSide = migrateCardSide(b[side] || {})
      updateBlock(block.id, { [side]: { ...cardSide, body: fieldVal(el) } })
    })
  })

  // Stat-cards: section_num and section_title (card-level)
  panelBody.querySelectorAll('[data-card-side][data-card-field]:not([data-card-field="body"])').forEach(el => {
    if (el.dataset.itemIdx !== undefined) return  // handled above
    if (el.dataset.cardField === 'body') return
    el.addEventListener('input', () => {
      const side  = el.dataset.cardSide
      const field = el.dataset.cardField
      const b     = blocks.find(x => x.id === block.id)
      const cardSide = migrateCardSide(b[side] || {})
      updateBlock(block.id, { [side]: { ...cardSide, [field]: fieldVal(el) } })
    })
  })

  // Stat-cards: add item button — needs full render so new item fields appear
  panelBody.querySelectorAll('.sc-add-item').forEach(btn => {
    btn.addEventListener('click', () => {
      pushUndo()
      const side = btn.dataset.side
      const b    = blocks.find(x => x.id === block.id)
      const cardSide = migrateCardSide(b[side] || {})
      const items = [...cardSide.items, { value_type: 'stat', value: '', unit: '%', icon: '', description: '' }]
      blocks = blocks.map(bl => bl.id === block.id ? { ...bl, [side]: { ...cardSide, items } } : bl)
      render()
    })
  })

  // Stat-cards: remove item button — needs full render so item disappears from panel
  panelBody.querySelectorAll('.sc-item-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      pushUndo()
      const side = btn.dataset.side
      const idx  = parseInt(btn.dataset.itemIdx)
      const b    = blocks.find(x => x.id === block.id)
      const cardSide = migrateCardSide(b[side] || {})
      if (cardSide.items.length <= 1) return  // keep at least one
      const items = cardSide.items.filter((_, i) => i !== idx)
      blocks = blocks.map(bl => bl.id === block.id ? { ...bl, [side]: { ...cardSide, items } } : bl)
      render()
    })
  })

  // Stat-cards: custom icon picker per item
  panelBody.querySelectorAll('.icon-picker-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const side = btn.dataset.cardSide
      const idx  = parseInt(btn.dataset.itemIdx)
      const b    = blocks.find(x => x.id === block.id)
      const cardSide = migrateCardSide(b[side] || {})
      const currentIcon = cardSide.items[idx]?.icon || ''
      openIconModal(currentIcon, (chosen) => {
        const items = [...cardSide.items]
        items[idx] = { ...items[idx], icon: chosen }
        updateBlock(block.id, { [side]: { ...cardSide, items } })
        const slot = btn.closest('.icon-picker-slot')
        if (slot) refreshIconSlot(slot, chosen)
      })
    })
  })

  // Stat-cards: Lucide icon picker per item
  panelBody.querySelectorAll('.lucide-picker-open-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const side = btn.dataset.cardSide
      const idx  = parseInt(btn.dataset.itemIdx)
      const b    = blocks.find(x => x.id === block.id)
      const cardSide = migrateCardSide(b[side] || {})
      const current = cardSide.items[idx]?.lucide_icon || ''
      openLucideModal(current, (chosen) => {
        const items = [...cardSide.items]
        items[idx] = { ...items[idx], lucide_icon: chosen }
        updateBlock(block.id, { [side]: { ...cardSide, items } })
        // Update slot preview inline
        const slot = btn.closest('.lucide-picker-slot')
        if (slot) {
          const svgEl = slot.querySelector('.lucide-picker-preview')
          const lblEl = slot.querySelector('.lucide-picker-label')
          if (svgEl) svgEl.innerHTML = `<span class="lucide-preview-svg" data-icon="${chosen}">${lucideSVG(chosen, 32, '#101720')}</span>`
          if (lblEl) lblEl.textContent = chosen
        }
      })
    })
  })

  // Render any lucide preview SVGs in the panel
  panelBody.querySelectorAll('.lucide-preview-svg[data-icon]').forEach(el => {
    const name = el.dataset.icon
    if (name && !el.querySelector('svg')) el.innerHTML = lucideSVG(name, 32, '#101720')
  })

  // Card border / background colour chips
  panelBody.querySelectorAll('[data-card-border]').forEach(btn => {
    btn.addEventListener('click', () => updateBlock(block.id, { card_border: btn.dataset.cardBorder }))
  })
  panelBody.querySelectorAll('[data-card-bg]').forEach(btn => {
    btn.addEventListener('click', () => updateBlock(block.id, { card_bg: btn.dataset.cardBg }))
  })

  // Table: header cells
  panelBody.querySelectorAll('[data-header-idx]').forEach(el => {
    el.addEventListener('input', () => {
      const idx = parseInt(el.dataset.headerIdx)
      const b   = blocks.find(x => x.id === block.id)
      const headers = [...b.headers]
      headers[idx] = el.value
      updateBlock(block.id, { headers })
    })
  })

  // Table: row cells
  panelBody.querySelectorAll('[data-row-idx][data-col-idx]').forEach(el => {
    el.addEventListener('input', () => {
      const ri = parseInt(el.dataset.rowIdx)
      const ci = parseInt(el.dataset.colIdx)
      const b  = blocks.find(x => x.id === block.id)
      const rows = b.rows.map(r => [...r])
      rows[ri][ci] = el.value
      updateBlock(block.id, { rows })
    })
  })

  // Add row
  panelBody.querySelector('#add-table-row')?.addEventListener('click', () => {
    pushUndo()
    const b = blocks.find(x => x.id === block.id)
    updateBlock(block.id, { rows: [...b.rows, b.headers.map(() => '')] }, { rerenderPanel: true })
  })

  // Add column
  panelBody.querySelector('#add-table-col')?.addEventListener('click', () => {
    pushUndo()
    const b = blocks.find(x => x.id === block.id)
    updateBlock(block.id, {
      headers: [...b.headers, `Column ${b.headers.length + 1}`],
      rows:    b.rows.map(r => [...r, ''])
    }, { rerenderPanel: true })
  })

  // Delete column
  panelBody.querySelectorAll('.tbl-del-col').forEach(btn => {
    btn.addEventListener('click', () => {
      pushUndo()
      const ci = parseInt(btn.dataset.colIdx)
      const b  = blocks.find(x => x.id === block.id)
      updateBlock(block.id, {
        headers: b.headers.filter((_, i) => i !== ci),
        rows:    b.rows.map(r => r.filter((_, i) => i !== ci))
      }, { rerenderPanel: true })
    })
  })

  // Delete row
  panelBody.querySelectorAll('.tbl-del-row').forEach(btn => {
    btn.addEventListener('click', () => {
      pushUndo()
      const ri = parseInt(btn.dataset.rowIdx)
      const b  = blocks.find(x => x.id === block.id)
      updateBlock(block.id, { rows: b.rows.filter((_, i) => i !== ri) }, { rerenderPanel: true })
    })
  })

  // ── text-1col / text-2col ─────────────────────────────────────────────────
  if (block.type === 'text-1col' || block.type === 'text-2col') {
    const is2 = block.type === 'text-2col'

    // Helper: get current segs for a col ('segments', 'left', or 'right')
    const getSegs = (col) => {
      const b = blocks.find(x => x.id === block.id)
      return [...(is2 ? (b[col] || []) : (b.segments || []))]
    }
    const setSegs = (col, segs) => {
      updateBlock(block.id, is2 ? { [col]: segs } : { segments: segs }, { rerenderPanel: true })
    }

    // Textarea text changes
    panelBody.querySelectorAll('.seg-text').forEach(el => {
      el.addEventListener('input', () => {
        const idx = parseInt(el.dataset.segIdx)
        const col = el.dataset.col || 'segments'
        const segs = getSegs(col)
        segs[idx] = { ...segs[idx], text: el.value }
        updateBlock(block.id, is2 ? { [col]: segs } : { segments: segs })
      })
    })

    // Style button picks
    panelBody.querySelectorAll('.seg-style-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx  = parseInt(btn.dataset.segIdx)
        const col  = btn.dataset.col || 'segments'
        const segs = getSegs(col)
        segs[idx] = { ...segs[idx], style: btn.dataset.segStyle }
        setSegs(col, segs)
      })
    })

    // Delete segment
    panelBody.querySelectorAll('.seg-del-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        pushUndo()
        const idx  = parseInt(btn.dataset.segIdx)
        const col  = btn.dataset.col || 'segments'
        const segs = getSegs(col).filter((_, i) => i !== idx)
        setSegs(col, segs)
      })
    })

    // Add segment
    panelBody.querySelectorAll('[data-add-seg]').forEach(btn => {
      btn.addEventListener('click', () => {
        pushUndo()
        const col  = btn.dataset.addSeg || 'segments'
        const segs = [...getSegs(col), { style: 'body', text: '' }]
        setSegs(col, segs)
      })
    })
  }
}

// ── State management ──────────────────────────────────────────────────────

function _getDefaultIllustrationUrl() {
  return ''
}

function addBlock(type) {
  pushUndo()
  const block = makeBlock(type)
  if (type === 'abx-header' && !block.image) {
    block.image = _getDefaultIllustrationUrl()
  }
  blocks = [...blocks, block]
  selectedId = block.id
  activeTab = 'edit'
  render()
  showToast(`Added ${type.replace('-', ' ')} block`)
}

function selectBlock(id) {
  selectedId = id
  activeTab = 'edit'
  render()
}

// Debounced canvas-only update — fires after 120ms of inactivity
let _renderBlocksTimer = null
function updateBlock(id, patch, { noHistory = false, rerenderPanel = false } = {}) {
  if (_viewOnly) return  // read-only — no mutations allowed
  if (!noHistory) pushUndoDebounced()
  blocks = blocks.map(b => b.id === id ? { ...b, ...patch } : b)
  clearTimeout(_renderBlocksTimer)
  _renderBlocksTimer = setTimeout(() => {
    renderBlocks()
    if (rerenderPanel) renderPanel()
  }, 120)
  _scheduleAutosave()
}

function handleBlockAction(action, id) {
  const idx = blocks.findIndex(b => b.id === id)
  pushUndo()
  if (action === 'del') {
    blocks = blocks.filter(b => b.id !== id)
    if (selectedId === id) selectedId = null
    render()
  } else if (action === 'up' && idx > 0) {
    blocks = [...blocks.slice(0, idx-1), blocks[idx], blocks[idx-1], ...blocks.slice(idx+1)]
    render()
  } else if (action === 'down' && idx < blocks.length - 1) {
    blocks = [...blocks.slice(0, idx), blocks[idx+1], blocks[idx], ...blocks.slice(idx+2)]
    render()
  } else if (action === 'dupe') {
    const copy = { ...blocks[idx], id: uid() }
    blocks = [...blocks.slice(0, idx+1), copy, ...blocks.slice(idx+1)]
    selectedId = copy.id
    render()
  }
}

function setTab(tab) {
  activeTab = tab
  render()
}

// ── Toast ─────────────────────────────────────────────────────────────────

function showToast(msg, type = 'success') {
  const t = document.querySelector('.toast')
  if (!t) return
  t.textContent = msg
  t.className = `toast ${type} show`
  setTimeout(() => t.classList.remove('show'), 2200)
}

// ── Main render ───────────────────────────────────────────────────────────

function render() {
  renderBlocks()
  renderPanel()
  syncTabs()
}

function syncTabs() {
  container.querySelectorAll('.panel-tab').forEach(tab => {
    tab.classList.toggle('active', tab.dataset.tab === activeTab)
  })
}

// ── Rich text toolbar ─────────────────────────────────────────────────────

let _richToolbarEl = null
let _richActiveEl  = null

function setupRichToolbar() {
  if (_richToolbarEl) return   // already mounted

  const toolbar = document.createElement('div')
  toolbar.id = 'rich-toolbar'
  toolbar.className = 'rich-toolbar'
  toolbar.innerHTML = `
    <button class="rt-btn rt-bold"      data-cmd="bold"      title="Bold"><strong>B</strong></button>
    <button class="rt-btn rt-italic"    data-cmd="italic"    title="Italic"><em>I</em></button>
    <button class="rt-btn rt-underline" data-cmd="underline" title="Underline"><u>U</u></button>
    <div class="rt-sep"></div>
    <button class="rt-color" data-color="#FF0077" title="Pink"  style="background:#FF0077"></button>
    <button class="rt-color" data-color="#000000" title="Black" style="background:#000000"></button>
  `
  document.body.appendChild(toolbar)
  _richToolbarEl = toolbar

  const boldBtn      = toolbar.querySelector('[data-cmd="bold"]')
  const italicBtn    = toolbar.querySelector('[data-cmd="italic"]')
  const underlineBtn = toolbar.querySelector('[data-cmd="underline"]')

  // Format buttons — mousedown prevents selection loss
  ;[boldBtn, italicBtn, underlineBtn].forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      document.execCommand(btn.dataset.cmd)
      updateActiveStates()
      fireRichInput()
    })
  })

  // Colour buttons
  toolbar.querySelectorAll('.rt-color').forEach(btn => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault()
      document.execCommand('foreColor', false, btn.dataset.color)
      fireRichInput()
    })
  })

  function updateActiveStates() {
    boldBtn.classList.toggle('rt-active',      document.queryCommandState('bold'))
    italicBtn.classList.toggle('rt-active',    document.queryCommandState('italic'))
    underlineBtn.classList.toggle('rt-active', document.queryCommandState('underline'))
  }

  // Track selection to show/hide toolbar
  document.addEventListener('selectionchange', () => {
    const sel = window.getSelection()
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      toolbar.classList.remove('rt-visible')
      return
    }
    // Only show if selection is inside a rich field
    const node = sel.anchorNode
    const rich = node?.parentElement?.closest('[data-rich]') || node?.closest?.('[data-rich]')
    if (!rich) { toolbar.classList.remove('rt-visible'); return }

    _richActiveEl = rich
    const rect = sel.getRangeAt(0).getBoundingClientRect()
    toolbar.style.left = `${rect.left + rect.width / 2}px`
    toolbar.style.top  = `${rect.top + window.scrollY - 44}px`
    toolbar.classList.add('rt-visible')
    updateActiveStates()
  })
}

function fireRichInput() {
  if (_richActiveEl) {
    _richActiveEl.dispatchEvent(new Event('input', { bubbles: true }))
  }
}

function blockGroupsHTML(templateType) {
  return getBlockGroups(templateType).map(group => `
    <div class="block-accordion${group.open ? ' open' : ''}">
      <button class="block-accordion-toggle">
        <span>${group.label}</span>
        <span class="block-accordion-chevron">▾</span>
      </button>
      <div class="block-accordion-body">
        <div class="block-grid">
          ${group.blocks.map(bt => `
            <button class="block-btn" data-type="${bt.type}">
              <span class="icon">${bt.lucide ? lucideSVG(bt.lucide, 16, 'currentColor') : bt.icon}</span>
              ${bt.label}
            </button>
          `).join('')}
        </div>
      </div>
    </div>
  `).join('')
}

function rebuildBlockSidebar() {
  const section = container.querySelector('#block-groups-section')
  if (!section) return
  section.innerHTML = blockGroupsHTML(currentTemplateType)
  // Re-bind accordion toggles
  section.querySelectorAll('.block-accordion-toggle').forEach(btn => {
    btn.addEventListener('click', () => btn.closest('.block-accordion').classList.toggle('open'))
  })
  // Re-bind block add buttons
  section.querySelectorAll('.block-btn[data-type]').forEach(btn => {
    btn.addEventListener('click', () => addBlock(btn.dataset.type))
  })
}

// ── User profile ───────────────────────────────────────────────────────────

async function _loadUserProfile() {
  if (_currentUser) return _currentUser
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const meta = session?.user?.user_metadata || {}
    _currentUserId = session?.user?.id || null
    _currentUser = {
      name:      meta.full_name || meta.name || session?.user?.email || '',
      avatarUrl: meta.avatar_url || meta.picture || '',
    }
  } catch { _currentUser = { name: '', avatarUrl: '' } }
  return _currentUser
}

// ── Autosave ───────────────────────────────────────────────────────────────

async function _silentSave(saveId, saveBlocks, saveMeta) {
  if (!saveId || saveId.startsWith('pending-')) return
  const snap = JSON.stringify(saveBlocks)
  if (snap === _lastSavedBlocks && saveId === currentTemplateId) return  // nothing changed
  try {
    await apiFetch(`/api/templates/${saveId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:   saveMeta.name,
        status: 'draft',
        doc:    { filename: saveMeta.filename, docTitle: saveMeta.filename.replace(/\.pdf$/i, ''), docAuthor: saveMeta.author, docAuthorAvatar: _currentUser?.avatarUrl || '', blocks: saveBlocks }
      })
    })
    if (saveId === currentTemplateId) {
      _lastSavedBlocks = snap
      _showSaveIndicator('saved')
    }
    // Keep cache fresh so switching back shows latest state
    _templateCache.set(saveId, { id: saveId, name: saveMeta.name, doc: { filename: saveMeta.filename, blocks: saveBlocks } })
  } catch {
    if (saveId === currentTemplateId) _showSaveIndicator('error')
  }
}

function _showSaveIndicator(state) {
  const el = container?.querySelector?.('#autosave-status')
  if (!el) return
  el.textContent = state === 'saving' ? 'Saving…' : state === 'error' ? 'Save failed' : 'Saved'
  el.dataset.state = state
  clearTimeout(el._hide)
  if (state === 'saved') el._hide = setTimeout(() => { el.textContent = '' }, 2500)
}

function _captureCurrentMeta() {
  return {
    name:     container?.querySelector?.('.tb-filename-input')?.value || 'Untitled',
    filename: container?.querySelector?.('#filename')?.value || 'untitled.pdf',
    author:   container?.querySelector?.('#doc-author')?.value || '',
  }
}

function _scheduleAutosave() {
  if (_viewOnly) return
  clearTimeout(_autosaveTimer)
  _autosaveTimer = setTimeout(() => {
    if (!currentTemplateId || currentTemplateId.startsWith('pending-')) return
    _showSaveIndicator('saving')
    _silentSave(currentTemplateId, [...blocks], _captureCurrentMeta())
  }, 3000)
}

// ── Bootstrap ─────────────────────────────────────────────────────────────

export async function renderApp(root, { navigate, templateId } = {}) {
  // ── Save current template before switching away ─────────────────────────
  if (currentTemplateId && currentTemplateId !== templateId && !currentTemplateId.startsWith('pending-')) {
    clearTimeout(_autosaveTimer)
    const saveId    = currentTemplateId
    const saveBlocks = [...blocks]
    const saveMeta  = _captureCurrentMeta()
    _silentSave(saveId, saveBlocks, saveMeta)   // fire-and-forget, keeps cache fresh
  }

  // Clean up zoom listener from any previous renderApp call
  if (root._cleanupZoom) { root._cleanupZoom(); root._cleanupZoom = null }
  // Reset state
  _lastSavedBlocks = null
  _viewOnly = false
  blocks = []; selectedId = null; activeTab = 'edit'
  currentTemplateId = templateId || null
  currentTemplateType = null
  _navigate = navigate || null
  _isLoading = !!templateId

  // Pre-register the tab so it appears immediately (name updated after load)
  if (templateId) addTab(templateId, 'Untitled')

  root.innerHTML = `
    <div class="shell">

      ${titlebarHTML({ activeTabId: templateId, currentName: 'Untitled' })}

      <!-- Sidebar (dark) -->
      <aside class="sidebar dark">

        <div class="sidebar-section">
          <div class="sidebar-section-header" id="doc-type-header">${TEMPLATE_TYPE_NAMES[currentTemplateType] || 'Document'}</div>
          <div class="doc-meta">
            <div class="field-group">
              <label class="field-label">Filename</label>
              <input class="field-input" id="filename" type="text" value="untitled.pdf" placeholder="untitled.pdf" />
            </div>
            <div class="field-group">
              <label class="field-label">Author</label>
              <div class="author-input-wrap">
                <img id="author-avatar" class="author-avatar" alt="" style="display:none" />
                <input class="field-input" id="doc-author" type="text" placeholder="Your name" />
              </div>
            </div>
          </div>
        </div>

        <!-- Actions -->
        <div class="sidebar-actions">
          <button class="btn btn-cta" id="gen-pdf" style="width:100%;justify-content:center">${lucideSVG('file-down', 15, 'currentColor')} Generate PDF</button>
          <button class="btn btn-primary" id="save-tmpl" style="width:100%;justify-content:center">${lucideSVG('save', 15, 'currentColor')} Save</button>
          <div id="autosave-status" style="font-size:10px;text-align:center;color:#6B7A99;min-height:14px;transition:color 0.2s" data-state=""></div>
        </div>

        <div class="sidebar-section" id="block-groups-section">
          ${blockGroupsHTML(currentTemplateType)}
        </div>
      </aside>

      <!-- Editor canvas -->
      <main class="editor">
        <div class="editor-dot-bg"></div>
        <div class="editor-content"></div>
      </main>

      <!-- Right panel (dark) -->
      <aside class="panel dark">
        <div class="panel-tabs">
          <button class="panel-tab active" data-tab="edit">Edit</button>
          <div class="panel-undo-redo">
            <button id="rp-btn-undo" class="panel-undo-btn" title="Undo (⌘Z)" disabled>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7v6h6"/><path d="M21 17a9 9 0 0 0-9-9 9 9 0 0 0-6 2.3L3 13"/></svg>
              Undo
            </button>
            <button id="rp-btn-redo" class="panel-undo-btn" title="Redo (⌘⇧Z)" disabled>
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 7v6h-6"/><path d="M3 17a9 9 0 0 1 9-9 9 9 0 0 1 6 2.3L21 13"/></svg>
              Redo
            </button>
          </div>
        </div>
        <div class="panel-body"></div>
      </aside>

      <!-- Mobile bottom nav (hidden on desktop via CSS) -->
      <nav class="mobile-editor-nav" id="mob-editor-nav">
        <button class="mob-nav-btn" data-mob-panel="sidebar">
          ${lucideSVG('layout-list', 18, 'currentColor')}
          Blocks
        </button>
        <button class="mob-nav-btn active" data-mob-panel="canvas">
          ${lucideSVG('layout-template', 18, 'currentColor')}
          Canvas
        </button>
        <button class="mob-nav-btn" data-mob-panel="panel">
          ${lucideSVG('sliders-horizontal', 18, 'currentColor')}
          Properties
        </button>
      </nav>

      <!-- Mobile overlay scrim -->
      <div class="mob-scrim" id="mob-scrim"></div>

    </div>

    <div class="toast"></div>
  `

  container = root
  setupRichToolbar()

  // ── Prefill author from user profile ────────────────────────────────────
  _loadUserProfile().then(user => {
    const a   = root.querySelector('#doc-author')
    const img = root.querySelector('#author-avatar')
    if (user?.name && a && !a.value) a.value = user.name
    if (user?.avatarUrl && img) {
      img.src = user.avatarUrl
      img.style.display = 'block'
    }
  })

  // ── Mobile panel toggle ──────────────────────────────────────────────────
  ;(function setupMobileNav() {
    const nav     = root.querySelector('#mob-editor-nav')
    const scrim   = root.querySelector('#mob-scrim')
    const sidebar = root.querySelector('.shell > aside.sidebar')
    const panel   = root.querySelector('.shell > aside.panel')
    if (!nav) return

    function closeAll() {
      sidebar?.classList.remove('mob-open')
      panel?.classList.remove('mob-open')
      scrim?.classList.remove('visible')
      nav.querySelectorAll('.mob-nav-btn').forEach(b => b.classList.remove('active'))
      nav.querySelector('[data-mob-panel="canvas"]')?.classList.add('active')
    }

    nav.addEventListener('click', e => {
      const btn = e.target.closest('[data-mob-panel]')
      if (!btn) return
      const target = btn.dataset.mobPanel
      if (target === 'canvas') { closeAll(); return }

      const isOpen = target === 'sidebar'
        ? sidebar?.classList.contains('mob-open')
        : panel?.classList.contains('mob-open')

      closeAll()
      if (!isOpen) {
        if (target === 'sidebar') sidebar?.classList.add('mob-open')
        if (target === 'panel')   panel?.classList.add('mob-open')
        scrim?.classList.add('visible')
        nav.querySelectorAll('.mob-nav-btn').forEach(b => b.classList.remove('active'))
        btn.classList.add('active')
      }
    })

    scrim?.addEventListener('click', closeAll)
  })()

  // ── Zoom shortcuts: Cmd+= zoom in, Cmd+- zoom out, Cmd+0 reset ────────────
  _zoomLevel = 1
  function handleZoom(e) {
    if (!e.metaKey && !e.ctrlKey) return
    if (e.key === '=' || e.key === '+') {
      e.preventDefault()
      _zoomLevel = Math.min(3, parseFloat((_zoomLevel + 0.1).toFixed(2)))
    } else if (e.key === '-') {
      e.preventDefault()
      _zoomLevel = Math.max(0.2, parseFloat((_zoomLevel - 0.1).toFixed(2)))
    } else if (e.key === '0') {
      e.preventDefault()
      _zoomLevel = 1
    } else return
    const editorEl = root.querySelector('.editor')
    if (editorEl) applyCanvasScale(editorEl)
  }

  document.addEventListener('keydown', handleZoom)

  // Undo / Redo keyboard shortcuts
  function handleUndoRedo(e) {
    const isMac = navigator.platform.toUpperCase().includes('MAC')
    const mod   = isMac ? e.metaKey : e.ctrlKey
    if (!mod) return
    // Don't intercept when typing in an input/textarea/contenteditable
    const tag = document.activeElement?.tagName
    const isEditing = tag === 'INPUT' || tag === 'TEXTAREA' ||
                      document.activeElement?.isContentEditable
    if (isEditing) return
    if (e.key === 'z' && !e.shiftKey) { e.preventDefault(); undo() }
    if ((e.key === 'z' && e.shiftKey) || e.key === 'y') { e.preventDefault(); redo() }
  }
  document.addEventListener('keydown', handleUndoRedo)

  // Clean up listeners when navigating away
  root._cleanupZoom = () => {
    document.removeEventListener('keydown', handleZoom)
    document.removeEventListener('keydown', handleUndoRedo)
  }

  // Undo / Redo buttons (titlebar + right panel)
  document.querySelector('#btn-undo')?.addEventListener('click', undo)
  document.querySelector('#btn-redo')?.addEventListener('click', redo)
  document.querySelector('#rp-btn-undo')?.addEventListener('click', undo)
  document.querySelector('#rp-btn-redo')?.addEventListener('click', redo)
  _updateUndoButtons()


  // Block buttons
  root.querySelectorAll('.block-btn[data-type]').forEach(btn => {
    btn.addEventListener('click', () => addBlock(btn.dataset.type))
  })

  // Accordion toggles
  root.querySelectorAll('.block-accordion-toggle').forEach(btn => {
    btn.addEventListener('click', () => {
      btn.closest('.block-accordion').classList.toggle('open')
    })
  })

  // Titlebar events
  bindTitlebarEvents(root, {
    navigate,
    onRename: (name) => {
      updateTabName(templateId, name)
      // Sync → sidebar filename field
      const f = root.querySelector('#filename')
      if (f) f.value = name + '.pdf'
      if (currentTemplateId) {
        _templateCache.delete(currentTemplateId)
        apiFetch(`/api/templates/${currentTemplateId}`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name })
        }).catch(() => {})
      }
    }
  })



  // Logout from editor (titlebar dropdown)
  window.addEventListener('tb-logout', async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  })

  // Rename from dashboard — update filename input + tab label if this template is open
  window.addEventListener('template-renamed', (e) => {
    const { id, name } = e.detail || {}
    if (!id || id !== currentTemplateId) return
    const filenameInput = root.querySelector('#filename')
    if (filenameInput) {
      const withPdf = name.endsWith('.pdf') ? name : name + '.pdf'
      filenameInput.value = withPdf
      filenameInput.defaultValue = withPdf
    }
    updateTabName(id, name)
    const tabLabel = root.querySelector(`.tb-tab[data-tab-id="${id}"] .tb-tab-name`)
    if (tabLabel) tabLabel.textContent = name
  })

  // Sidebar filename field → sync tab + titlebar + persist name & doc.filename
  root.querySelector('#filename')?.addEventListener('change', (e) => {
    const raw      = e.target.value.trim() || 'untitled.pdf'
    const withPdf  = raw.endsWith('.pdf') ? raw : raw + '.pdf'
    const baseName = withPdf.replace(/\.pdf$/i, '')
    // Normalise the input to always show the .pdf extension
    e.target.value = withPdf
    // Update centre titlebar input
    const tbi = root.querySelector('.tb-filename-input')
    if (tbi) { tbi.value = baseName; tbi.defaultValue = baseName }
    // Update tab label in DOM + state (use currentTemplateId which stays current after saves)
    const activeId = currentTemplateId || templateId
    updateTabName(activeId, baseName)
    const tabNameEl = root.querySelector(`.tb-tab[data-tab-id="${activeId}"] .tb-tab-name`)
    if (tabNameEl) tabNameEl.textContent = baseName
    // Persist: update display name + doc.filename so both survive reload
    if (currentTemplateId) {
      const currentDoc = {
        filename:  withPdf,
        docTitle:  baseName,
        docAuthor: root.querySelector('#doc-author')?.value || '',
        docAuthorAvatar: _currentUser?.avatarUrl || '',
        blocks,
      }
      _templateCache.delete(currentTemplateId)
      apiFetch(`/api/templates/${currentTemplateId}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: baseName, doc: currentDoc })
      }).catch(() => {})
    }
  })

  // Tab switching
  root.querySelectorAll('.panel-tab').forEach(tab => {
    tab.addEventListener('click', () => setTab(tab.dataset.tab))
  })

  // Clear all
  root.querySelector('#clear-all')?.addEventListener('click', () => {
    if (blocks.length === 0 || confirm('Clear all blocks?')) {
      pushUndo()
      blocks = []; selectedId = null; render()
      showToast('Document cleared')
    }
  })

  // Save template
  async function captureThumb() {
    try {
      const el     = container.querySelector('.report-canvas')
      const scaler = container.querySelector('.canvas-scaler')
      if (!el) return null

      // Temporarily remove the CSS transform on the scaler so html2canvas
      // can locate the element correctly (getBoundingClientRect is affected
      // by ancestor transforms, which causes gray offset artifacts in the capture).
      const prevTransform = scaler?.style.transform || ''
      const prevHeight    = scaler?.style.height    || ''
      if (scaler) { scaler.style.transform = 'none'; scaler.style.height = 'auto' }
      await new Promise(r => requestAnimationFrame(r))  // let browser reflow

      let offscreen
      try {
        offscreen = await html2canvas(el, {
          scale:           0.5,          // 1200px source → 600px thumb
          useCORS:         true,
          allowTaint:      true,
          backgroundColor: '#ffffff',
          windowWidth:     1200,
          height:          Math.min(el.scrollHeight, 1400), // top ~700px visible
          logging:         false,
          ignoreElements:  (node) =>
            node.classList?.contains('block-actions-float') ||
            node.classList?.contains('zoom-badge'),
        })
      } finally {
        // Always restore — even if html2canvas throws
        if (scaler) { scaler.style.transform = prevTransform; scaler.style.height = prevHeight }
      }

      return offscreen.toDataURL('image/jpeg', 0.85).split(',')[1]
    } catch (e) {
      console.error('Thumb capture failed:', e)
      return null
    }
  }

  async function saveTemplate(status) {
    const btn = root.querySelector(status === 'saved' ? '#save-tmpl' : '#save-draft')
    if (btn) { btn.disabled = true; btn.innerHTML = `${lucideSVG('loader', 15, 'currentColor')} Saving…` }
    try {
      const name  = root.querySelector('.tb-filename-input')?.value || 'Untitled'
      const thumb = await captureThumb()
      const body = {
        name,
        status,
        thumb,
        doc: {
          filename:  root.querySelector('#filename')?.value  || 'untitled.pdf',
          docTitle:  (root.querySelector('#filename')?.value || 'untitled.pdf').replace(/\.pdf$/i, ''),
          docAuthor: root.querySelector('#doc-author')?.value || '',
          docAuthorAvatar: _currentUser?.avatarUrl || '',
          blocks,
        }
      }
      let res
      if (currentTemplateId) {
        res = await apiFetch(`/api/templates/${currentTemplateId}`, {
          method: 'PUT', body: JSON.stringify(body)
        })
      } else {
        res = await apiFetch('/api/templates', {
          method: 'POST', body: JSON.stringify(body)
        })
        if (res.ok) {
          const data = await res.json()
          currentTemplateId = data.id
          history.replaceState(null, '', `/editor/${data.id}`)
          // Register new tab in titlebar
          addTab(data.id, body.name)
          updateTabName(data.id, body.name)
        }
      }
      _lastSavedBlocks = JSON.stringify(blocks)
      clearTimeout(_autosaveTimer)
      showToast(status === 'saved' ? 'Template saved ✓' : 'Saved as draft')
    } catch (e) {
      showToast('Save failed', 'error')
    } finally {
      if (btn) {
        btn.disabled = false
        btn.innerHTML = `${lucideSVG('save', 15, 'currentColor')} Save`
      }
    }
  }

  root.querySelector('#save-tmpl')?.addEventListener('click', () => saveTemplate('saved'))

  // Generate PDF — POST to Flask backend, download the result
  root.querySelector('#gen-pdf')?.addEventListener('click', async () => {
    if (blocks.length === 0) {
      showToast('Add some blocks first', 'error')
      return
    }

    const btn = root.querySelector('#gen-pdf')
    const filename = root.querySelector('#filename')?.value || 'untitled.pdf'

    btn.textContent = 'Generating…'
    btn.disabled = true

    try {
      // Convert an image URL to a base64 data URI so the PDF server
      // never needs to make outbound requests (avoids expired signed URLs)
      async function _toDataURI(url) {
        if (!url || url === '__loading__' || url.startsWith('data:')) return url || ''
        try {
          const resp = await fetch(url)
          if (!resp.ok) throw new Error(resp.status)
          const blob = await resp.blob()
          return await new Promise((resolve, reject) => {
            const r = new FileReader()
            r.onload  = () => resolve(r.result)
            r.onerror = reject
            r.readAsDataURL(blob)
          })
        } catch (e) {
          console.warn('[pdf] Could not convert image to data URI:', e)
          return ''
        }
      }

      // Pre-render Lucide icons to PNG data URLs + inline hero images as data URIs
      const blocksForPDF = await Promise.all(blocks.map(async (b) => {
        // Hero image — convert to data URI so server doesn't need Supabase access
        if ((b.type === 'abx-header' || b.type === 'infographic-hero') && b.image) {
          const imageDataURI = await _toDataURI(b.image)
          b = { ...b, image: imageDataURI }
        }
        if (b.type !== 'stat-cards') return b
        const convertSide = async (side) => {
          if (!side?.items) return side
          const items = await Promise.all(side.items.map(async (item) => {
            if (item.value_type === 'lucide' && item.lucide_icon && !item.icon_png_b64) {
              const dataURL = await lucideToDataURL(item.lucide_icon, 256, '#101720')
              return { ...item, icon_png_b64: dataURL }
            }
            return item
          }))
          return { ...side, items }
        }
        return { ...b, left: await convertSide(b.left), right: await convertSide(b.right) }
      }))

      const res = await apiFetch('/api/generate', {
        method: 'POST',
        body: JSON.stringify({
          blocks: blocksForPDF,
          filename,
          docTitle:  filename.replace(/\.pdf$/i, ''),
          docAuthor: root.querySelector('#doc-author')?.value || '',
        }),
      })

      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Unknown error' }))
        throw new Error(err.error || `Server error ${res.status}`)
      }

      // Download — use Electron native save dialog if available, else blob URL
      const arrayBuffer = await res.arrayBuffer()

      if (window.electronApp?.savePDF) {
        // Convert to base64 so we can pass it over IPC to the main process
        const bytes = new Uint8Array(arrayBuffer)
        let binary = ''
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i])
        const base64 = btoa(binary)
        const result = await window.electronApp.savePDF(base64, filename)
        if (!result.canceled) showToast(`Saved ${result.filePath?.split('/').pop() || filename}`)
      } else {
        // Fallback for plain browser
        const blob = new Blob([arrayBuffer], { type: 'application/pdf' })
        const url  = URL.createObjectURL(blob)
        const a    = document.createElement('a')
        a.href     = url
        a.download = filename
        document.body.appendChild(a)
        a.click()
        document.body.removeChild(a)
        setTimeout(() => URL.revokeObjectURL(url), 5000)
        showToast(`Downloaded ${filename}`)
      }
    } catch (err) {
      if (err.message.includes('Failed to fetch') || err.message.includes('NetworkError')) {
        showToast('Start the Python server: python3 server.py', 'error')
      } else {
        showToast(`Error: ${err.message}`, 'error')
      }
    } finally {
      btn.innerHTML = `${lucideSVG('file-down', 15, 'currentColor')} Generate PDF`
      btn.disabled = false
    }
  })

  // Load existing template if id provided
  if (templateId) {
    const _applyTemplate = (tmpl) => {
      if (!tmpl) return
      _isLoading = false

        // ── Ownership / view-only ───────────────────────────────────────────
        const ownerId = tmpl.user_id || null
        _viewOnly = !!(ownerId && _currentUserId && ownerId !== _currentUserId)
        const shell = root.querySelector('.shell')

        // Remove any existing view-only banner
        root.querySelector('.view-only-banner')?.remove()

        if (_viewOnly) {
          shell?.classList.add('view-only')
          const authorName = tmpl.doc?.docAuthor || 'someone'
          const banner = document.createElement('div')
          banner.className = 'view-only-banner'
          banner.innerHTML = `
            <span>${lucideSVG('eye', 14, 'currentColor')} Viewing <strong>${authorName}</strong>'s file — view only</span>
            <button class="btn btn-primary view-only-copy-btn" id="view-only-copy">
              ${lucideSVG('copy-plus', 14, 'currentColor')} Make a copy
            </button>`
          root.querySelector('.editor')?.prepend(banner)
          root.querySelector('#view-only-copy')?.addEventListener('click', async () => {
            try {
              const copy = await apiFetchJSON(`/api/templates/${currentTemplateId}/copy`, { method: 'POST' })
              window.dispatchEvent(new CustomEvent('show-template-picker'))
              setTimeout(() => _navigate(`/editor/${copy.id}`), 50)
            } catch { _showSaveIndicator('error') }
          })
        } else {
          shell?.classList.remove('view-only')
        }

        const name = tmpl.name || 'Untitled'
        // Populate titlebar filename input
        const tbi = root.querySelector('.tb-filename-input')
        if (tbi) { tbi.value = name; tbi.defaultValue = name }
        // Update tab name in state + DOM (no full re-render needed)
        updateTabName(templateId, name)
        const tabNameEl = root.querySelector(`.tb-tab[data-tab-id="${templateId}"] .tb-tab-name`)
        if (tabNameEl) tabNameEl.textContent = name
        // Sidebar fields
        const f = root.querySelector('#filename')
        const a = root.querySelector('#doc-author')
        // Derive filename: use stored value, or build from template name, or 'untitled.pdf'
        const storedFn = tmpl.doc?.filename
        const nameFn   = name ? name.replace(/[^\w\s-]/g, '').trim().replace(/\s+/g, '_') + '.pdf' : 'untitled.pdf'
        const isDefaultFn = !storedFn || storedFn === 'output.pdf' || storedFn === 'untitled.pdf'
        if (f) f.value = isDefaultFn ? nameFn : storedFn
        if (a) a.value = tmpl.doc?.docAuthor || _currentUser?.name || ''
        blocks = tmpl.doc?.blocks || []
        resetHistory()  // fresh file — clear undo/redo stacks
        // Determine type: prefer stored value, otherwise infer from blocks
        const blockTypes = blocks.map(b => b.type)
        currentTemplateType = tmpl.template_type
          || (blockTypes.includes('infographic-hero') ? 'infographic'    : null)
          || (blockTypes.includes('abx-header')       ? 'insight-report' : null)
        const hdr = root.querySelector('#doc-type-header')
        if (hdr) hdr.textContent = TEMPLATE_TYPE_NAMES[currentTemplateType] || 'Document'
        rebuildBlockSidebar()
        render()
    }

    // ── Pending new template (created in dashboard, not yet in DB) ──────────
    const pending = window._pendingNewTemplate
    if (pending && pending.tempId === templateId) {
      delete window._pendingNewTemplate
      _applyTemplate(pending)

      // Listen for background DB creation to get the real id
      const onPersisted = (e) => {
        if (e.detail.tempId !== templateId) return
        window.removeEventListener('template-persisted', onPersisted)

        // Guard: if the user navigated away before persisting, only update
        // the tab list — never touch currentTemplateId or the URL
        if (currentTemplateId !== templateId) {
          replaceTabId(templateId, e.detail.realId)
          return
        }

        const { realId, blocks: finalBlocks } = e.detail
        currentTemplateId = realId

        // Silently swap URL + tab id without re-rendering
        history.replaceState(null, '', `/editor/${realId}`)

        // Update the in-memory _tabs array (prevents stale pending-id on re-render)
        replaceTabId(templateId, realId)

        // Update DOM tab elements
        const tabEl = root.querySelector(`.tb-tab[data-tab-id="${templateId}"]`)
        if (tabEl) tabEl.dataset.tabId = realId
        const closeBtn = tabEl?.querySelector('[data-close-id]')
        if (closeBtn) closeBtn.dataset.closeId = realId

        // Patch blocks with final illustration (if different)
        if (finalBlocks && JSON.stringify(finalBlocks) !== JSON.stringify(blocks)) {
          blocks = finalBlocks
          render()
        }
      }
      window.addEventListener('template-persisted', onPersisted)

    } else {
      // ── Normal load: existing template from DB ─────────────────────────────
      const cached = _templateCache.get(templateId)
      if (cached) {
        // Render immediately from cache, refresh in background
        _applyTemplate(cached)
        apiFetch(`/api/templates/${templateId}`)
          .then(r => r.ok ? r.json() : null)
          .then(tmpl => { if (tmpl) { _templateCache.set(templateId, tmpl); _applyTemplate(tmpl) } })
          .catch(() => {})
      } else {
        apiFetch(`/api/templates/${templateId}`)
          .then(r => r.ok ? r.json() : null)
          .then(tmpl => { if (tmpl) { _templateCache.set(templateId, tmpl); _applyTemplate(tmpl) } })
          .catch(() => {})
      }
    }
  }

  render()
}
