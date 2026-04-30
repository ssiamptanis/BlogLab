// ABX PDF Builder — Dashboard view
import { titlebarHTML, bindTitlebarEvents, syncTabs, updateTabName, patchTitlebarUser } from './titlebar.js'
import { lucideSVG } from './lucide-icons.js'
import { BRAND } from './brand.js'
const ILLUS_PREFS_KEY    = 'abx_illus_enabled_nodes'

const GWI_SVG = `<svg width="52" height="16" viewBox="0 0 264 81" fill="none" xmlns="http://www.w3.org/2000/svg">
  <path fill-rule="evenodd" clip-rule="evenodd" d="M263.42 61.5C263.42 49.5 257.84 43.9 245.81 43.9C233.78 43.9 228.2 49.5 228.2 61.5C228.2 73.5 233.78 79.1 245.81 79.1C257.84 79.1 263.42 73.5 263.42 61.5Z" fill="#FF0077"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M202 78.7H219.5V1.7H202V78.7Z" fill="white"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M170.6 78.7H150.6L135.7 27.3L120.7 78.7H100.8L77 1.7H96.7L110.9 54L125.6 1.7H145.9L161 54.1L175.1 1.7H194.5L170.6 78.7Z" fill="white"/>
  <path fill-rule="evenodd" clip-rule="evenodd" d="M37.3 80.4C26 80.4 16.9 76.8 10.1 69.6C3.4 62.4 0 52.6 0 40.5C0 28.5 3.7 18.7 10.9 11.3C18.2 3.8 27.8 0 39.5 0C54.7 0 66.9 6.8 73.7 19.2L61.3 30.96L60.4 29.5C55.2 21.6 48.2 17.5 39.5 17.5C32.9 17.5 27.6 19.6 23.8 23.7C19.8 27.9 17.9 33.4 17.9 40.4C17.9 47.3 19.8 52.8 23.5 56.7C27.2 60.7 32.3 62.7 38.7 62.7C46 62.7 52.6 59.2 57.3 52.7H39.9V36.1H76.6V78.9H61.9V69.2C59.1 72.6 55.6 75.4 51.7 77.2C47.3 79.3 42.5 80.4 37.3 80.4Z" fill="white"/>
</svg>`

// State
let _root = null
let _navigate = null
let _templates = []
let _folders = []
let _filter = 'mine'         // 'all' | 'mine' | 'saved' | 'draft'
let _currentUserId = null   // set from Supabase session
let _activeFolderId = null   // null = show all folders
let _showSettings = false    // settings panel open
let _globalEventsRegistered = false

// Dashboard filters
let _filterMonth    = ''   // 'YYYY-MM' or ''
let _filterCategory = ''   // category string or ''
let _filterCreator  = ''   // author name or ''

// Cache — persists across navigations so returning home is instant
let _dataLoaded  = false
let _refreshing  = false   // true while background loadData() is in flight
let _dashUser    = null    // { name, avatarUrl } cached user profile

async function _getDashUser() {
  if (_dashUser) return _dashUser
  try {
    const { data: { session } } = await supabase.auth.getSession()
    const meta = session?.user?.user_metadata || {}
    _dashUser = {
      name:      meta.full_name || meta.name || session?.user?.email || '',
      avatarUrl: meta.avatar_url || meta.picture || '',
    }
  } catch { _dashUser = { name: '', avatarUrl: '' } }
  return _dashUser
}

// ── API helpers ──────────────────────────────────────────────────────────────

import { apiFetch as _authFetch, apiUpload, supabase } from './supabase.js'

async function apiFetch(url, opts = {}) {
  const res = await _authFetch(url, opts)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function loadData() {
  // Load user profile and templates in parallel so cardHTML fallback is ready
  const [data, user] = await Promise.all([
    apiFetch('/api/templates'),
    _getDashUser(),
  ])
  _templates     = data.templates || []
  _folders       = data.folders   || []
  // Capture current user ID for ownership checks
  if (!_currentUserId) {
    const { data: { session } } = await supabase.auth.getSession()
    _currentUserId = session?.user?.id || null
  }
  // Remove any open tabs that refer to templates that no longer exist
  syncTabs(_templates.map(t => t.id))
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Inline spinning wheel for button loading states */
function spinnerHTML(size = 14) {
  return `<span class="page-spinner" style="width:${size}px;height:${size}px;border-width:2px;display:inline-block;vertical-align:middle;flex-shrink:0"></span>`
}

function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function initials(name) {
  return (name || 'U').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase()
}

function getFolderName(id) {
  const f = _folders.find(f => f.id === id)
  return f ? f.name : null
}

function isOwner(t) {
  return !_currentUserId || t.user_id === _currentUserId
}

function filteredTemplates() {
  return _templates.filter(t => {
    // Never show other users' drafts
    if (!isOwner(t) && t.status !== 'saved') return false
    if (_filter === 'mine'  && !isOwner(t))           return false
    if (_filter === 'saved' && t.status !== 'saved')   return false
    if (_filter === 'draft' && t.status !== 'draft')   return false
    if (_activeFolderId && t.folder_id !== _activeFolderId) return false

    // Toolbar filters
    if (_filterMonth) {
      const d = t.updated_at ? new Date(t.updated_at) : null
      const key = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : ''
      if (key !== _filterMonth) return false
    }
    if (_filterCategory && (t.doc_category || '').toLowerCase() !== _filterCategory.toLowerCase()) return false
    if (_filterCreator  && (t.doc_author   || '') !== _filterCreator) return false

    return true
  })
}

function _availableMonths() {
  const seen = new Map()
  for (const t of _templates) {
    const d = t.updated_at ? new Date(t.updated_at) : null
    if (!d) continue
    const key   = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    const label = d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
    if (!seen.has(key)) seen.set(key, label)
  }
  return [...seen.entries()].sort((a, b) => b[0].localeCompare(a[0]))
}

function _availableCategories() {
  const seen = new Set()
  for (const t of _templates) {
    const c = (t.doc_category || '').trim()
    if (c) seen.add(c)
  }
  return [...seen].sort()
}

function _availableCreators() {
  const seen = new Set()
  for (const t of _templates) {
    const a = (t.doc_author || '').trim()
    if (a) seen.add(a)
  }
  return [...seen].sort()
}

function dashFilterBarHTML() {
  const months     = _availableMonths()
  const categories = _availableCategories()
  const creators   = _availableCreators()
  const showCreator = _filter === 'all'
  const hasActive  = _filterMonth || _filterCategory || (showCreator && _filterCreator)

  return `
    <div class="dash-filter-bar">
      <span class="dash-filter-label">Filter by:</span>
      <select class="dash-filter-select ${_filterMonth ? 'dash-filter-select--active' : ''}" id="df-month">
        <option value="">Month</option>
        ${months.map(([k, l]) => `<option value="${k}" ${_filterMonth === k ? 'selected' : ''}>${l}</option>`).join('')}
      </select>
      <select class="dash-filter-select ${_filterCategory ? 'dash-filter-select--active' : ''}" id="df-category">
        <option value="">Category</option>
        ${categories.map(c => `<option value="${c}" ${_filterCategory === c ? 'selected' : ''}>${c.replace(/\b\w/g, l => l.toUpperCase())}</option>`).join('')}
      </select>
      ${showCreator ? `
      <select class="dash-filter-select ${_filterCreator ? 'dash-filter-select--active' : ''}" id="df-creator">
        <option value="">Creator</option>
        ${creators.map(a => `<option value="${a}" ${_filterCreator === a ? 'selected' : ''}>${a}</option>`).join('')}
      </select>` : ''}
      ${hasActive ? `<button class="dash-filter-clear" id="df-clear">Clear filters</button>` : ''}
    </div>
  `
}

// ── Render ───────────────────────────────────────────────────────────────────

function miniPreviewHTML() {
  // Draft placeholder — icon centred in a #EEF2F8 field
  return `
    <div class="mini-draft-placeholder">
      <div class="mini-draft-icon">${lucideSVG('layout-template', 32, '#9EB3CC')}</div>
    </div>`
}

function inferTemplateTypeLabel(blockTypes = []) {
  if (blockTypes.includes('infographic-hero')) return 'Infographic'
  if (blockTypes.includes('abx-header'))       return 'One pager PDF'
  return null
}

function _authorAvatarHTML(name, avatarUrl) {
  if (!name) return ''
  const initials = name.split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase()
  const avatarEl = avatarUrl
    ? `<img class="card-author-img" src="${escHtml(avatarUrl)}" alt="${escHtml(name)}" />`
    : `<div class="card-author-initials">${escHtml(initials)}</div>`
  return `<div class="card-author-row">
    ${avatarEl}
    <span class="card-author-name">${escHtml(name)}</span>
  </div>`
}

function cardHTML(t) {
  const folder = t.folder_id ? getFolderName(t.folder_id) : null
  const isBlogThumb = t.template_type === 'blog-thumbnail'
  const rawCategory = (t.doc_category || '').trim()
  const statusClass = isBlogThumb && rawCategory
    ? 'tmpl-status-category'
    : t.status === 'saved' ? 'tmpl-status-saved' : 'tmpl-status-draft'
  const statusLabel = isBlogThumb && rawCategory
    ? rawCategory.replace(/\b\w/g, c => c.toUpperCase())   // title-case
    : t.status === 'saved' ? 'Saved' : 'Draft'
  const typeLabel = isBlogThumb ? 'Blog Thumbnail' : inferTemplateTypeLabel(t.block_types)
  const mine = isOwner(t)
  // Fall back to current user's profile for older docs that predate author stamping
  const authorName   = t.doc_author        || (!mine ? '' : _dashUser?.name      || '')
  const authorAvatar = t.doc_author_avatar  || (!mine ? '' : _dashUser?.avatarUrl || '')
  const authorHTML = _authorAvatarHTML(authorName, authorAvatar)
  // Blog thumbnails use the stored image URL; regular templates use the base64 thumb
  const thumbHTML = isBlogThumb && t.doc_image_url
    ? `<img class="tmpl-card-thumb-img" src="${escHtml(t.doc_image_url)}" alt="" draggable="false" />`
    : t.thumb
      ? `<img class="tmpl-card-thumb-img" src="data:image/jpeg;base64,${t.thumb}" alt="" draggable="false" />`
      : `<div class="tmpl-mini-preview">${miniPreviewHTML()}</div>`
  return `
    <div class="tmpl-card${mine ? '' : ' tmpl-card--others'}" data-id="${t.id}" data-type="${t.template_type || ''}" draggable="${mine}">
      <div class="tmpl-card-thumb">
        ${thumbHTML}
        <span class="tmpl-status-badge ${statusClass} tmpl-status-thumb">${statusLabel}</span>
      </div>
      <div class="tmpl-card-body">
        ${typeLabel ? `<div class="tmpl-card-type-label">${typeLabel}</div>` : ''}
        <div class="tmpl-card-name">${escHtml(t.name)}</div>
        <div class="tmpl-card-folder ${folder ? '' : 'tmpl-card-folder--unfiled'}">${lucideSVG('folder', 11, 'currentColor')} ${folder ? escHtml(folder) : 'Not filed yet'}</div>
        ${authorHTML}
        <div class="tmpl-card-date">${formatDate(t.updated_at)}</div>
      </div>
      <div class="tmpl-card-actions">
        ${(mine || isBlogThumb) ? `
          <button class="tmpl-action-btn" data-action="rename" data-id="${t.id}" title="Rename">${lucideSVG('pencil', 14, 'currentColor')}</button>
          ${!isBlogThumb ? `<button class="tmpl-action-btn" data-action="duplicate" data-id="${t.id}" title="Duplicate">${lucideSVG('copy', 14, 'currentColor')}</button>` : ''}
          ${isBlogThumb ? `<button class="tmpl-action-btn" data-action="download-thumb" data-id="${t.id}" title="Download">${lucideSVG('download', 14, 'currentColor')}</button>` : ''}
          <button class="tmpl-action-btn danger" data-action="delete" data-id="${t.id}" title="Delete">${lucideSVG('trash-2', 14, 'currentColor')}</button>
        ` : `
          <button class="tmpl-action-btn" data-action="copy-to-mine" data-id="${t.id}" title="Make a copy">${lucideSVG('copy-plus', 14, 'currentColor')} Make a copy</button>
        `}
      </div>
    </div>`
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function skeletonCardHTML() {
  return `
    <div class="tmpl-card tmpl-card-skeleton" aria-hidden="true">
      <div class="tmpl-card-thumb">
        <div class="skel-block skel-thumb"></div>
      </div>
      <div class="tmpl-card-body">
        <div class="skel-block skel-title"></div>
        <div class="skel-block skel-sub"></div>
        <div class="skel-block skel-author"></div>
        <div class="skel-block skel-date"></div>
      </div>
    </div>`
}

function gridHTML() {
  const list = filteredTemplates()

  // First-ever load with no cached data — show skeleton placeholders
  if (!list.length && !_dataLoaded) {
    return `<div class="dash-grid">
      ${skeletonCardHTML()}${skeletonCardHTML()}${skeletonCardHTML()}
    </div>`
  }

  // No cards (data loaded but genuinely empty, or search has no results)
  if (!list.length) {
    return `<div class="dash-empty">
      <div class="dash-empty-icon">${lucideSVG('file-plus', 40, '#CED9EB')}</div>
      <h3>Create your first asset</h3>
      <p>Click "+ Create new asset" to get started.</p>
    </div>`
  }

  // Group cards by month/year based on updated_at
  const groups = []
  const seen = new Map()
  for (const t of list) {
    const d = t.updated_at ? new Date(t.updated_at) : null
    const key = d
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
      : 'undated'
    const label = d
      ? d.toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
      : 'Undated'
    if (!seen.has(key)) {
      seen.set(key, groups.length)
      groups.push({ key, label, items: [] })
    }
    groups[seen.get(key)].items.push(t)
  }

  return groups.map((g, i) => `
    <div class="dash-month-group">
      <div class="dash-month-divider ${i === 0 ? 'dash-month-divider--first' : ''}">
        <span class="dash-month-label">${g.label}</span>
        <span class="dash-month-line"></span>
      </div>
      <div class="dash-grid">${g.items.map(cardHTML).join('')}</div>
    </div>
  `).join('')
}

function sidebarFoldersHTML() {
  return _folders.map(f => `
    <div class="dash-folder-btn ${_activeFolderId === f.id ? 'active' : ''}" data-folder-id="${f.id}" data-drop-folder="${f.id}">
      <span class="dash-folder-icon">${lucideSVG('folder', 14, 'currentColor')}</span>
      <span class="dash-folder-label">${escHtml(f.name)}</span>
      <button class="dash-folder-rename" data-folder-id="${f.id}" title="Rename">${lucideSVG('pencil', 12, 'currentColor')}</button>
      <button class="dash-folder-delete" data-folder-id="${f.id}" title="Delete">${lucideSVG('trash-2', 12, 'currentColor')}</button>
    </div>`).join('')
}

function renderDashboardHTML() {
  _root.innerHTML = `
    <div class="dashboard-shell">

      ${titlebarHTML({ isHome: true })}

      <div class="dash-body">

        <!-- Left sidebar -->
        <aside class="dash-sidebar">
          <div class="dash-sidebar-top">
            <button class="btn btn-primary" id="dash-new" style="width:100%;justify-content:center;margin-bottom:12px;background:#00FF88;border-color:#00FF88;color:#000">+ Create new asset</button>
          </div>
          <div class="dash-sidebar-section">
            <button class="dash-filter-btn ${_filter === 'mine'  ? 'active' : ''}" data-filter="mine">${lucideSVG('user', 14, 'currentColor')} My files</button>
            <button class="dash-filter-btn ${_filter === 'all'   ? 'active' : ''}" data-filter="all">${lucideSVG('building-2', 14, 'currentColor')} Files across GWI</button>
          </div>
          <div class="dash-sidebar-section">
            <div class="dash-sidebar-label">Folders</div>
            <button class="dash-filter-btn ${!_activeFolderId ? 'active' : ''}" data-folder-id="">All folders</button>
            ${sidebarFoldersHTML()}
            <button class="dash-folder-add" id="dash-new-folder">+ New folder</button>
          </div>
        </aside>

        <!-- Mobile scrim (closes drawer) -->
        <div class="dash-mob-scrim" id="dash-mob-scrim"></div>

        <!-- Main grid -->
        <main class="dash-main">
          <div class="dash-toolbar">
            <!-- Hamburger: mobile only -->
            <button class="dash-mob-menu-btn" id="dash-mob-menu" title="Menu">
              ${lucideSVG('menu', 20, 'currentColor')}
            </button>
            <!-- Create button: mobile only (mirrors sidebar button) -->
            <button class="btn btn-primary dash-mob-create-btn" id="dash-mob-new">+ New</button>
            ${!_showSettings ? dashFilterBarHTML() : ''}
          </div>
          <div id="dash-content">
            ${_showSettings ? settingsHTML() : gridHTML()}
          </div>
        </main>

      </div>
    </div>
    <div class="toast"></div>
  `
  bindTitlebarEvents(_root, { navigate: _navigate })
  bindEvents()
  _bindMobileDashNav()
  // Patch avatar asynchronously — localStorage read may have missed it on first render
  _getDashUser().then(u => patchTitlebarUser(_root, u))
}

function _bindMobileDashNav() {
  const sidebar  = _root.querySelector('.dash-sidebar')
  const scrim    = _root.querySelector('#dash-mob-scrim')
  const menuBtn  = _root.querySelector('#dash-mob-menu')
  const createMob = _root.querySelector('#dash-mob-new')

  function openDrawer()  { sidebar?.classList.add('mob-open');    scrim?.classList.add('visible') }
  function closeDrawer() { sidebar?.classList.remove('mob-open'); scrim?.classList.remove('visible') }

  menuBtn?.addEventListener('click',  openDrawer)
  scrim?.addEventListener('click',    closeDrawer)
  // Close drawer when a filter/folder is selected on mobile
  sidebar?.addEventListener('click', e => {
    if (e.target.closest('[data-filter], [data-folder-id], .dash-filter-btn')) {
      setTimeout(closeDrawer, 120)
    }
  })
  createMob?.addEventListener('click', () => {
    closeDrawer()
    _root.querySelector('#dash-new')?.click()
  })
}

function refreshGrid() {
  const el = _root.querySelector('#dash-content')
  if (el) el.innerHTML = gridHTML()
  // Refresh sidebar folder buttons
  const sb = _root.querySelector('.dash-sidebar')
  if (sb) {
    const folderSection = sb.querySelectorAll('.dash-sidebar-section')[1]
    if (folderSection) {
      folderSection.innerHTML = `
        <div class="dash-sidebar-label">Folders</div>
        <button class="dash-filter-btn ${!_activeFolderId ? 'active' : ''}" data-folder-id="">All folders</button>
        ${sidebarFoldersHTML()}
        <button class="dash-folder-add" id="dash-new-folder">+ New folder</button>
      `
      folderSection.querySelector('#dash-new-folder')?.addEventListener('click', onNewFolder)
      folderSection.querySelectorAll('[data-folder-id]').forEach(el => {
        if (el.dataset.action) return
        el.addEventListener('click', onFolderFilter)
      })
      folderSection.querySelectorAll('.dash-folder-rename').forEach(b => b.addEventListener('click', onRenameFolder))
      folderSection.querySelectorAll('.dash-folder-delete').forEach(b => b.addEventListener('click', onDeleteFolder))
    }
  }
  // Update filter buttons
  _root.querySelectorAll('.dash-filter-btn[data-filter]').forEach(b => {
    b.classList.toggle('active', b.dataset.filter === _filter)
  })
  bindCardEvents()
  bindFolderDropTargets()
}

function showToast(msg, type = 'success') {
  const t = _root.querySelector('.toast')
  if (!t) return
  t.textContent = msg
  t.className = `toast toast-${type} show`
  setTimeout(() => t.classList.remove('show'), 3000)
}

// ── Custom confirm dialog ─────────────────────────────────────────────────────
function confirmModal(message) {
  return new Promise(resolve => {
    const _mount = (_root && document.contains(_root)) ? _root : document.body
    const overlay = document.createElement('div')
    overlay.className = 'blog-form-overlay tmpl-picker-overlay'
    overlay.style.cssText = 'z-index:2000'
    overlay.innerHTML = `
      <div class="tmpl-picker-modal" style="width:420px;max-width:92vw;padding:32px 28px">
        <p style="font-size:15px;font-weight:600;color:#fff;margin:0 0 24px;text-align:center;line-height:1.5">
          ${escHtml(message)}
        </p>
        <div style="display:flex;gap:12px;justify-content:center">
          <button id="conf-cancel" class="blog-form-cancel" style="min-width:100px">Cancel</button>
          <button id="conf-ok" class="blog-form-submit" style="min-width:100px;background:#e53935">
            ${lucideSVG('trash-2', 14, 'currentColor')} Delete
          </button>
        </div>
      </div>
    `
    _mount.appendChild(overlay)

    const close = (result) => { overlay.remove(); resolve(result) }
    overlay.querySelector('#conf-ok').addEventListener('click',     () => close(true))
    overlay.querySelector('#conf-cancel').addEventListener('click', () => close(false))
    overlay.addEventListener('click', e => { if (e.target === overlay) close(false) })
    overlay.addEventListener('keydown', e => { if (e.key === 'Escape') close(false) })
  })
}

// ── Template type definitions ─────────────────────────────────────────────────

const INSIGHT_REPORT_PREVIEW = `<svg viewBox="0 0 200 283" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="283" fill="#F8F9FB"/>
  <!-- Header dark band -->
  <rect width="200" height="64" fill="#101720"/>
  <rect width="200" height="3" fill="#FF0077"/>
  <!-- Logo placeholder -->
  <rect x="12" y="14" width="26" height="10" rx="2" fill="white" opacity="0.9"/>
  <!-- Title text lines -->
  <rect x="12" y="30" width="110" height="7" rx="2" fill="white" opacity="0.85"/>
  <rect x="12" y="41" width="76" height="4" rx="1.5" fill="white" opacity="0.4"/>
  <rect x="12" y="50" width="90" height="3" rx="1" fill="#FF0077" opacity="0.7"/>
  <!-- Pink divider -->
  <rect y="64" width="200" height="2" fill="#FF0077"/>
  <!-- Column divider -->
  <rect x="100" y="70" width="1" height="108" fill="#DFE7F5"/>
  <!-- Left col header -->
  <rect x="12" y="74" width="28" height="3" rx="1" fill="#526482" opacity="0.6"/>
  <rect x="12" y="81" width="56" height="5" rx="2" fill="#101720" opacity="0.75"/>
  <!-- Left stat 1 -->
  <rect x="12" y="92" width="26" height="11" rx="2" fill="#FF0077" opacity="0.9"/>
  <rect x="12" y="107" width="68" height="2.5" rx="1" fill="#526482" opacity="0.45"/>
  <rect x="12" y="112" width="54" height="2.5" rx="1" fill="#526482" opacity="0.35"/>
  <!-- Left stat 2 -->
  <rect x="12" y="121" width="26" height="11" rx="2" fill="#101720" opacity="0.65"/>
  <rect x="12" y="136" width="68" height="2.5" rx="1" fill="#526482" opacity="0.45"/>
  <rect x="12" y="141" width="54" height="2.5" rx="1" fill="#526482" opacity="0.35"/>
  <!-- Left body -->
  <rect x="12" y="150" width="74" height="2" rx="1" fill="#526482" opacity="0.28"/>
  <rect x="12" y="154" width="66" height="2" rx="1" fill="#526482" opacity="0.22"/>
  <rect x="12" y="158" width="58" height="2" rx="1" fill="#526482" opacity="0.18"/>
  <!-- Right col header -->
  <rect x="110" y="74" width="28" height="3" rx="1" fill="#526482" opacity="0.6"/>
  <rect x="110" y="81" width="56" height="5" rx="2" fill="#101720" opacity="0.75"/>
  <!-- Right stat 1 -->
  <rect x="110" y="92" width="26" height="11" rx="2" fill="#101720" opacity="0.65"/>
  <rect x="110" y="107" width="68" height="2.5" rx="1" fill="#526482" opacity="0.45"/>
  <rect x="110" y="112" width="54" height="2.5" rx="1" fill="#526482" opacity="0.35"/>
  <!-- Right stat 2 -->
  <rect x="110" y="121" width="26" height="11" rx="2" fill="#FF0077" opacity="0.9"/>
  <rect x="110" y="136" width="68" height="2.5" rx="1" fill="#526482" opacity="0.45"/>
  <rect x="110" y="141" width="54" height="2.5" rx="1" fill="#526482" opacity="0.35"/>
  <!-- Right body -->
  <rect x="110" y="150" width="74" height="2" rx="1" fill="#526482" opacity="0.28"/>
  <rect x="110" y="154" width="66" height="2" rx="1" fill="#526482" opacity="0.22"/>
  <rect x="110" y="158" width="58" height="2" rx="1" fill="#526482" opacity="0.18"/>
  <!-- Section divider rule -->
  <rect x="12" y="172" width="176" height="1" fill="#DFE7F5" opacity="0.6"/>
  <!-- Second stat row (abbreviated) -->
  <rect x="12" y="178" width="28" height="3" rx="1" fill="#526482" opacity="0.5"/>
  <rect x="12" y="185" width="26" height="10" rx="2" fill="#101720" opacity="0.65"/>
  <rect x="12" y="199" width="68" height="2" rx="1" fill="#526482" opacity="0.35"/>
  <rect x="12" y="203" width="54" height="2" rx="1" fill="#526482" opacity="0.28"/>
  <rect x="110" y="178" width="28" height="3" rx="1" fill="#526482" opacity="0.5"/>
  <rect x="110" y="185" width="26" height="10" rx="2" fill="#FF0077" opacity="0.9"/>
  <rect x="110" y="199" width="68" height="2" rx="1" fill="#526482" opacity="0.35"/>
  <rect x="110" y="203" width="54" height="2" rx="1" fill="#526482" opacity="0.28"/>
  <!-- Footer -->
  <rect y="249" width="200" height="34" fill="#101720"/>
  <rect y="249" width="200" height="1.5" fill="#FF0077"/>
  <rect x="12" y="259" width="72" height="3" rx="1" fill="white" opacity="0.5"/>
  <rect x="12" y="266" width="50" height="2.5" rx="1" fill="white" opacity="0.35"/>
  <rect x="134" y="257" width="46" height="14" rx="7" fill="#FF0077"/>
  <rect x="143" y="262" width="28" height="2.5" rx="1" fill="white" opacity="0.85"/>
</svg>`

const INFOGRAPHIC_PREVIEW = `<svg viewBox="0 0 200 283" fill="none" xmlns="http://www.w3.org/2000/svg">
  <rect width="200" height="283" fill="#101720"/>
  <!-- Hero section -->
  <!-- Accent italic line -->
  <rect x="12" y="16" width="52" height="4" rx="2" fill="#FF0077" opacity="0.85"/>
  <!-- Big title lines -->
  <rect x="12" y="25" width="85" height="10" rx="2.5" fill="white" opacity="0.92"/>
  <rect x="12" y="39" width="72" height="10" rx="2.5" fill="white" opacity="0.92"/>
  <rect x="12" y="53" width="62" height="10" rx="2.5" fill="white" opacity="0.92"/>
  <!-- Hero descriptor lines -->
  <rect x="12" y="70" width="78" height="3" rx="1" fill="white" opacity="0.3"/>
  <rect x="12" y="76" width="68" height="3" rx="1" fill="white" opacity="0.25"/>
  <rect x="12" y="82" width="74" height="3" rx="1" fill="white" opacity="0.2"/>
  <!-- Right illustration area -->
  <circle cx="158" cy="56" r="44" fill="#1A2535"/>
  <circle cx="155" cy="52" r="18" fill="#2A3A50"/>
  <circle cx="168" cy="64" r="12" fill="#FF0077" opacity="0.45"/>
  <ellipse cx="150" cy="68" rx="14" ry="10" fill="#526482" opacity="0.5"/>
  <rect x="142" y="44" width="8" height="28" rx="4" fill="#FF0077" opacity="0.3"/>
  <circle cx="170" cy="44" r="8" fill="#DFE7F5" opacity="0.2"/>
  <!-- Pink horizontal divider -->
  <rect y="103" width="200" height="2.5" fill="#FF0077"/>
  <!-- Stats grid 3 columns, 3 rows -->
  <!-- Col separators -->
  <rect x="68" y="110" width="1" height="100" fill="#2A3447"/>
  <rect x="132" y="110" width="1" height="100" fill="#2A3447"/>
  <!-- Row 1 -->
  <rect x="10" y="112" width="24" height="3" rx="1" fill="#DFE7F5" opacity="0.4"/>
  <rect x="10" y="119" width="38" height="12" rx="2.5" fill="#FF0077" opacity="0.9"/>
  <rect x="10" y="135" width="48" height="2" rx="1" fill="#526482" opacity="0.45"/>
  <rect x="10" y="139" width="42" height="2" rx="1" fill="#526482" opacity="0.35"/>
  <rect x="10" y="143" width="46" height="2" rx="1" fill="#526482" opacity="0.28"/>
  <rect x="74" y="112" width="24" height="3" rx="1" fill="#DFE7F5" opacity="0.4"/>
  <rect x="74" y="119" width="38" height="12" rx="2.5" fill="#DFE7F5" opacity="0.65"/>
  <rect x="74" y="135" width="48" height="2" rx="1" fill="#526482" opacity="0.45"/>
  <rect x="74" y="139" width="42" height="2" rx="1" fill="#526482" opacity="0.35"/>
  <rect x="74" y="143" width="46" height="2" rx="1" fill="#526482" opacity="0.28"/>
  <rect x="138" y="112" width="24" height="3" rx="1" fill="#DFE7F5" opacity="0.4"/>
  <rect x="138" y="119" width="38" height="12" rx="2.5" fill="#FF0077" opacity="0.9"/>
  <rect x="138" y="135" width="48" height="2" rx="1" fill="#526482" opacity="0.45"/>
  <rect x="138" y="139" width="42" height="2" rx="1" fill="#526482" opacity="0.35"/>
  <rect x="138" y="143" width="46" height="2" rx="1" fill="#526482" opacity="0.28"/>
  <!-- Row 2 -->
  <rect x="10" y="155" width="24" height="3" rx="1" fill="#DFE7F5" opacity="0.4"/>
  <rect x="10" y="162" width="38" height="12" rx="2.5" fill="#DFE7F5" opacity="0.65"/>
  <rect x="10" y="178" width="48" height="2" rx="1" fill="#526482" opacity="0.4"/>
  <rect x="10" y="182" width="42" height="2" rx="1" fill="#526482" opacity="0.3"/>
  <rect x="74" y="155" width="24" height="3" rx="1" fill="#DFE7F5" opacity="0.4"/>
  <rect x="74" y="162" width="38" height="12" rx="2.5" fill="#FF0077" opacity="0.9"/>
  <rect x="74" y="178" width="48" height="2" rx="1" fill="#526482" opacity="0.4"/>
  <rect x="74" y="182" width="42" height="2" rx="1" fill="#526482" opacity="0.3"/>
  <rect x="138" y="155" width="24" height="3" rx="1" fill="#DFE7F5" opacity="0.4"/>
  <rect x="138" y="162" width="38" height="12" rx="2.5" fill="#DFE7F5" opacity="0.65"/>
  <rect x="138" y="178" width="48" height="2" rx="1" fill="#526482" opacity="0.4"/>
  <rect x="138" y="182" width="42" height="2" rx="1" fill="#526482" opacity="0.3"/>
  <!-- Row 3 (abbreviated) -->
  <rect x="10" y="195" width="24" height="3" rx="1" fill="#DFE7F5" opacity="0.3"/>
  <rect x="10" y="201" width="38" height="9" rx="2" fill="#FF0077" opacity="0.75"/>
  <rect x="74" y="195" width="24" height="3" rx="1" fill="#DFE7F5" opacity="0.3"/>
  <rect x="74" y="201" width="38" height="9" rx="2" fill="#DFE7F5" opacity="0.5"/>
  <rect x="138" y="195" width="24" height="3" rx="1" fill="#DFE7F5" opacity="0.3"/>
  <rect x="138" y="201" width="38" height="9" rx="2" fill="#FF0077" opacity="0.75"/>
  <!-- Footer -->
  <rect y="250" width="200" height="33" fill="#0A1018"/>
  <rect y="250" width="200" height="1.5" fill="#FF0077"/>
  <rect x="12" y="260" width="72" height="3" rx="1" fill="#DFE7F5" opacity="0.4"/>
  <rect x="12" y="267" width="50" height="2.5" rx="1" fill="#DFE7F5" opacity="0.28"/>
  <rect x="134" y="258" width="46" height="14" rx="7" fill="#FF0077"/>
  <rect x="143" y="263" width="28" height="2.5" rx="1" fill="white" opacity="0.85"/>
</svg>`

const TEMPLATE_TYPES = [
  {
    id: 'blog-thumbnail',
    name: 'Blog thumbnail image',
    description: 'Create a branded thumbnail image for blog posts and articles. Eye-catching visuals sized and styled for GWI\'s content channels.',
    preview: null,
    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><path d="M21 15l-5-5L5 21"/></svg>`,
    blocks: []
  },
  {
    id: 'graph',
    name: 'Graph',
    description: 'Generate on-brand data visualisations using your Datylon templates. Open directly in the Datylon web builder.',
    preview: null,
    icon: `<svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/><line x1="2" y1="20" x2="22" y2="20"/></svg>`,
    blocks: []
  },
]

// ── Datylon graph templates ───────────────────────────────────────────────────
// Add your templates here. svgPath = path to the exported SVG in public/datylon/
// datlylonUrl = full URL of the template in insights.datylon.com
// ⚠ Replace placeholder entries below with your real Datylon templates.
// For each template: update name, description, chartType, datlylonUrl,
// svgPath (exported SVG saved to public/datylon/), and previewUrl (screenshot).
// series: 'single' | 'multi'
const GRAPH_TEMPLATES = [
  // ── Multi-series ──────────────────────────────────────────────
  {
    id: 'butterfly-chart',
    name: 'Butterfly Chart',
    description: 'Compare two groups side-by-side along a shared axis. Great for demographic breakdowns.',
    series: 'multi',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-butterfly-chart.svg',
    previewUrl: '/datylon/preview-butterfly-chart.jpg',
  },
  {
    id: 'dot-plot',
    name: 'Dot Plot',
    description: 'Show distributions or rankings with minimal ink. Effective for benchmarking across segments.',
    series: 'multi',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-dot-plot.svg',
    previewUrl: '/datylon/preview-dot-plot.jpg',
  },
  {
    id: 'heatmap',
    name: 'Heatmap',
    description: 'Reveal patterns across two dimensions using colour intensity. Ideal for cross-tabulated data.',
    series: 'multi',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-heatmap.svg',
    previewUrl: '/datylon/preview-heatmap.jpg',
  },
  {
    id: 'horizontal-stacked-bar-100',
    name: 'Horizontal Stacked Bar (100%)',
    description: 'Show part-to-whole relationships as proportions across categories on a normalised scale.',
    series: 'multi',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-horizontal-stacked-bar-100.svg',
    previewUrl: '/datylon/preview-horizontal-stacked-bar-100.jpg',
  },
  {
    id: 'horizontal-stacked-bar',
    name: 'Horizontal Stacked Bar',
    description: 'Compare absolute totals while showing segment composition across multiple categories.',
    series: 'multi',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-horizontal-stacked-bar.svg',
    previewUrl: '/datylon/preview-horizontal-stacked-bar.jpg',
  },
  {
    id: 'line-chart',
    name: 'Line Chart',
    description: 'Track trends over time for multiple series. Best for continuous data with clear directionality.',
    series: 'multi',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-line-chart.svg',
    previewUrl: '/datylon/preview-line-chart.jpg',
  },
  {
    id: 'stacked-area-chart',
    name: 'Stacked Area Chart',
    description: 'Show cumulative totals over time with each series layered on top of the previous.',
    series: 'multi',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-stacked-area-chart.svg',
    previewUrl: '/datylon/preview-stacked-area-chart.jpg',
  },
  {
    id: 'vertical-bar-chart',
    name: 'Vertical Bar Chart',
    description: 'Compare values across categories with grouped vertical bars for multi-series data.',
    series: 'multi',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-vertical-bar-chart.svg',
    previewUrl: '/datylon/preview-vertical-bar-chart.jpg',
  },
  {
    id: 'vertical-stacked-bar-100',
    name: 'Vertical Stacked Bar (100%)',
    description: 'Display proportional composition vertically across categories on a normalised scale.',
    series: 'multi',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-vertical-stacked-bar-100.svg',
    previewUrl: '/datylon/preview-vertical-stacked-bar-100.jpg',
  },
  {
    id: 'horizontal-bar-chart',
    name: 'Horizontal Bar Chart',
    description: 'Compare multiple series across categories with grouped horizontal bars.',
    series: 'multi',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-horizontal-bar-chart.svg',
    previewUrl: '/datylon/preview-horizontal-bar-chart.jpg',
  },
  // ── Single-series ─────────────────────────────────────────────
  {
    id: 'area-chart',
    name: 'Area Chart',
    description: 'Visualise a single trend over time with a filled area to emphasise volume or magnitude.',
    series: 'single',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-area-chart.svg',
    previewUrl: '/datylon/preview-area-chart.jpg',
  },
  {
    id: 'dial',
    name: 'Dial',
    description: 'Display a single KPI as a gauge. Perfect for progress-to-target or percentage metrics.',
    series: 'single',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-dial.svg',
    previewUrl: '/datylon/preview-dial.jpg',
  },
  {
    id: 'donut',
    name: 'Donut Chart',
    description: 'Show part-to-whole proportions in a circular layout with a central label for the key figure.',
    series: 'single',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-donut.svg',
    previewUrl: '/datylon/preview-donut.jpg',
  },
  {
    id: 'horizontal-bar-chart-1',
    name: 'Horizontal Bar Chart 1',
    description: 'Single-series horizontal bars ordered for easy ranking and label readability.',
    series: 'single',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-horizontal-bar-chart-1.svg',
    previewUrl: '/datylon/preview-horizontal-bar-chart-1.jpg',
  },
  {
    id: 'horizontal-bar-chart-2',
    name: 'Horizontal Bar Chart 2',
    description: 'An alternative single-series horizontal layout with a different visual style.',
    series: 'single',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-horizontal-bar-chart-2.svg',
    previewUrl: '/datylon/preview-horizontal-bar-chart-2.jpg',
  },
  {
    id: 'treemap-slices',
    name: 'Treemap (Slices)',
    description: 'Represent hierarchical data as proportional slices — highlights the dominant category clearly.',
    series: 'single',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-treemap-slices.svg',
    previewUrl: '/datylon/preview-treemap-slices.jpg',
  },
  {
    id: 'treemap',
    name: 'Treemap',
    description: 'Show part-to-whole relationships using nested rectangles sized by value.',
    series: 'single',
    datlylonUrl: 'https://insights.datylon.com/workspace/templates',
    svgPath: '/datylon/template-treemap.svg',
    previewUrl: '/datylon/preview-treemap.jpg',
  },
]

const _DATYLON_KEY = 'gwi_datylon_downloaded'

function _isDatlylonDownloaded(id) {
  try { return JSON.parse(localStorage.getItem(_DATYLON_KEY) || '[]').includes(id) }
  catch { return false }
}

function _markDatlylonDownloaded(id) {
  try {
    const list = JSON.parse(localStorage.getItem(_DATYLON_KEY) || '[]')
    if (!list.includes(id)) { list.push(id); localStorage.setItem(_DATYLON_KEY, JSON.stringify(list)) }
  } catch {}
}

export function showTemplatePicker(navigateFn) {
  // Accept a fresh navigate fn (e.g. when called from editor via event)
  if (typeof navigateFn === 'function') _navigate = navigateFn
  // Use _root if it's still attached to the live document, otherwise fall back to body
  const _mount = (_root && document.contains(_root)) ? _root : document.body
  _mount.querySelector('.tmpl-picker-overlay')?.remove()

  const overlay = document.createElement('div')
  overlay.className = 'tmpl-picker-overlay'
  overlay.innerHTML = `
    <div class="tmpl-picker-modal">
      <div class="tmpl-picker-header">
        <div>
          <h2 class="tmpl-picker-title">Create a new asset</h2>
          <p class="tmpl-picker-subtitle">Start from a template or generate one from GWI data</p>
        </div>
        <button class="tmpl-picker-close" id="tmpl-picker-close">${lucideSVG('x', 16, 'currentColor')}</button>
      </div>

      <!-- Template cards -->
      <div class="tmpl-picker-grid">
        ${TEMPLATE_TYPES.map(t => `
          <button class="tmpl-picker-card ${t.comingSoon ? 'coming-soon' : ''}" data-type="${t.id}" ${t.comingSoon ? 'disabled' : ''}>
            <div class="tmpl-picker-card-icon">${t.icon}</div>
            <div class="tmpl-picker-eyebrow">${t.name}</div>
            <div class="tmpl-picker-desc">${t.description}</div>
            <div class="tmpl-picker-cta">
              ${lucideSVG('arrow-right', 14, 'currentColor')} Select this format
            </div>
            ${t.comingSoon ? '<div class="tmpl-picker-soon">Coming soon</div>' : ''}
          </button>
        `).join('')}
      </div>

    </div>
  `

  _mount.appendChild(overlay)
  // Focus close button (top of modal) to prevent browser scrolling to the input
  const closeBtn = overlay.querySelector('#tmpl-picker-close')
  if (closeBtn) closeBtn.focus({ preventScroll: true })
  // Belt-and-braces: reset scroll after any focus-induced scroll
  setTimeout(() => {
    const modal = overlay.querySelector('.tmpl-picker-modal')
    if (modal) modal.scrollTop = 0
  }, 0)

  overlay.querySelector('#tmpl-picker-close').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

  // Blank template cards
  overlay.querySelectorAll('.tmpl-picker-card:not([disabled])').forEach(btn => {
    btn.addEventListener('click', async () => {
      overlay.remove()
      if (btn.dataset.type === 'blog-thumbnail') {
        showBlogThumbnailForm()
      } else if (btn.dataset.type === 'graph') {
        showGraphTemplates()
      } else {
        await onNewTemplate(btn.dataset.type)
      }
    })
  })

}

function showSparkStatus(overlay, type, msg) {
  const el = overlay.querySelector('#spark-status')
  if (!el) return
  el.style.display = ''
  el.className = `spark-status spark-status-${type}`
  el.innerHTML = type === 'loading'
    ? `<span class="spark-spinner"></span> ${msg}`
    : `${lucideSVG(type === 'error' ? 'alert-circle' : 'check-circle', 14, 'currentColor')} ${msg}`
}

async function ensureSparkFolder() {
  // Returns the id of the "From Spark" folder, creating it if needed
  const folders = await apiFetch('/api/folders')
  const existing = folders.find(f => f.name === 'From Spark')
  if (existing) return existing.id
  const created = await apiFetch('/api/folders', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'From Spark' })
  })
  return created.id
}

async function onSparkGenerate(overlay, audience, topic, templateType = 'insight-report') {
  const btn = overlay.querySelector('#spark-generate')
  btn.disabled = true
  btn.innerHTML = `${spinnerHTML(15)} Querying GWI Spark…`

  const steps = [
    `Pulling primary insights on <strong>${audience}</strong> × <strong>${topic}</strong>…`,
    `Gathering behavioural data…`,
    `Building your report…`,
  ]
  let stepIdx = 0
  showSparkStatus(overlay, 'loading', steps[0])
  const stepTimer = setInterval(() => {
    stepIdx = Math.min(stepIdx + 1, steps.length - 1)
    showSparkStatus(overlay, 'loading', steps[stepIdx])
  }, 4000)

  try {
    const data = await apiFetch('/api/spark-generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audience, topic, template_type: templateType })
    })

    clearInterval(stepTimer)
    if (!data.blocks?.length) throw new Error('No blocks returned')

    const statCount = data.blocks.filter(b => b.type === 'stat-cards' || b.type === 'ig-stats').length
    showSparkStatus(overlay, 'success', `Generated ${statCount} stat sections from GWI data — filing into your Spark folder…`)

    // Ensure "From Spark" folder exists
    const sparkFolderId = await ensureSparkFolder()

    await new Promise(r => setTimeout(r, 700))
    overlay.remove()

    const safeName = (s) => s.toLowerCase().replace(/\s+/g, '_').replace(/[^\w_]/g, '')
    const templateData = await apiFetch('/api/templates', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name:          `${audience} × ${topic}`,
        status:        'draft',
        folder_id:     sparkFolderId,
        template_type: templateType,
        doc: {
          filename: `${safeName(audience)}_${safeName(topic)}.pdf`,
          blocks:   data.blocks
        }
      })
    })
    _navigate(`/editor/${templateData.id}`)

  } catch (e) {
    clearInterval(stepTimer)
    console.error('Spark generate error:', e)
    const msg = e.message?.includes('ANTHROPIC_API_KEY')
      ? 'ANTHROPIC_API_KEY not configured — add it to your .env file and restart.'
      : `Generation failed: ${e.message}`
    showSparkStatus(overlay, 'error', msg)
    btn.disabled = false
    btn.innerHTML = `${lucideSVG('sparkles', 15, '#fff')} Generate`
  }
}

// ── Event handlers ───────────────────────────────────────────────────────────

function makeId() {
  return Math.random().toString(36).slice(2, 10)
}

// Default illustration: young man with beer (node 8399:1154)
const DEFAULT_ILLUS_NODE  = '8399:1154'
const DASH_ILLUS_CACHE_KEY = 'figma_assets_v11'

function _getCachedIllustrationUrl() {
  try {
    const raw = localStorage.getItem(DASH_ILLUS_CACHE_KEY)
    if (!raw) return ''
    const { data } = JSON.parse(raw)
    const target = data?.find(i => i.node_id === DEFAULT_ILLUS_NODE) || data?.[0]
    return target?.svg_url || ''
  } catch { return '' }
}

async function _fetchIllustrationUrl() {
  // Return cached SVG url, fetching from API if needed
  const cached = _getCachedIllustrationUrl()
  if (cached) return cached
  try {
    const data = await apiFetch('/api/figma-assets')
    if (data?.length) {
      const target = data.find(i => i.node_id === DEFAULT_ILLUS_NODE) || data[0]
      const svgUrl = target?.svg_url || ''
      if (svgUrl) {
        localStorage.setItem(DASH_ILLUS_CACHE_KEY, JSON.stringify({ data, ts: Date.now() }))
        return svgUrl
      }
    }
  } catch {}
  // Fallback: call figma-svg directly for the default illustration
  try {
    const res = await apiFetch(`/api/figma-svg?node_id=${encodeURIComponent(DEFAULT_ILLUS_NODE)}`)
    if (res?.url) return res.url
  } catch {}
  return ''
}

// ── CSV parser ────────────────────────────────────────────────────────────────

const _VALID_CATEGORIES = [
  'audiences',
  'consumer behaviour',
  'digital trends',
  'data journalism',
  'talk data to me',
  'product',
  'strategy',
]

function normalizeCategory(raw) {
  if (!raw) return ''
  const s = raw.toLowerCase().trim()
    .replace(/\bbehavior\b/g, 'behaviour')   // US → UK spelling
  // Exact match
  if (_VALID_CATEGORIES.includes(s)) return s
  // One contains the other (handles "digital" → "digital trends")
  const contain = _VALID_CATEGORIES.find(c => c.startsWith(s) || s.startsWith(c))
  if (contain) return contain
  // Word-overlap fallback: significant words (>3 chars) mostly match
  const sWords = s.split(/\s+/).filter(w => w.length > 3)
  const overlap = _VALID_CATEGORIES.find(c => {
    const cWords = c.split(/\s+/).filter(w => w.length > 3)
    return cWords.length > 0 && cWords.every(cw => sWords.some(sw => sw.startsWith(cw.slice(0,4)) || cw.startsWith(sw.slice(0,4))))
  })
  return overlap || ''
}

function parseCSV(text) {
  // Strip BOM if present, split into physical lines
  const raw = text.replace(/^﻿/, '').trim()
  const allLines = raw.split(/\r?\n/)

  // Skip blank lines and comment lines (#) to find the actual header row
  const usableLines = allLines.filter(l => l.trim() && !l.trim().startsWith('#'))
  if (usableLines.length < 2) return []

  const headers = usableLines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''))
  const col = key => headers.findIndex(h => h.includes(key))
  const iTitle    = col('title')
  const iMeta     = col('meta')
  const iSubs     = col('sub')
  const iCategory = col('cat')

  function splitLine(line) {
    const fields = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = '' }
      else cur += ch
    }
    fields.push(cur.trim())
    return fields
  }

  return usableLines.slice(1).map(line => {
    const fields = splitLine(line)
    // Subtitles: pipe-separated ("Sub one|Sub two") → newline-joined for the textarea
    const rawSubs = iSubs >= 0 ? (fields[iSubs] || '') : ''
    const subtitles = rawSubs.includes('|')
      ? rawSubs.split('|').map(s => s.trim()).join('\n')
      : rawSubs
    return {
      title:     iTitle    >= 0 ? (fields[iTitle]    || '') : '',
      metaDesc:  iMeta     >= 0 ? (fields[iMeta]     || '') : '',
      subtitles,
      category:  normalizeCategory(iCategory >= 0 ? (fields[iCategory] || '') : ''),
    }
  }).filter(r => r.title)
}

// ── Graph template gallery ────────────────────────────────────────────────────
function showGraphTemplates() {
  const _mount = (_root && document.contains(_root)) ? _root : document.body
  _mount.querySelector('.graph-gallery-overlay')?.remove()

  function _cardHTML(t) {
    const downloaded = _isDatlylonDownloaded(t.id)
    const preview = t.previewUrl
      ? `<img class="graph-card-preview" src="${escHtml(t.previewUrl)}" alt="${escHtml(t.name)}" />`
      : `<div class="graph-card-preview graph-card-preview--placeholder">${lucideSVG('bar-chart-2', 32, 'rgba(255,255,255,0.2)')}</div>`

    return `
      <div class="graph-card" data-id="${escHtml(t.id)}">
        ${preview}
        <div class="graph-card-body">
          <div class="graph-card-meta">
            <span class="graph-card-type">${escHtml(t.series === 'multi' ? 'Multi series' : 'Single series')}</span>
            ${downloaded ? `<span class="graph-card-badge graph-card-badge--done">${lucideSVG('check', 11, 'currentColor')} Downloaded</span>` : ''}
          </div>
          <div class="graph-card-name">${escHtml(t.name)}</div>
          <div class="graph-card-desc">${escHtml(t.description)}</div>
          <div class="graph-card-actions">
            ${downloaded
              ? `<a class="graph-btn graph-btn--primary" href="${escHtml(t.datlylonUrl)}" target="_blank" rel="noopener">
                   ${lucideSVG('external-link', 13, 'currentColor')} Open in Datylon
                 </a>
                 ${t.svgPath ? `<button class="graph-btn graph-btn--ghost graph-btn--download" data-id="${escHtml(t.id)}" data-svg="${escHtml(t.svgPath)}">
                   ${lucideSVG('download', 13, 'currentColor')} Re-download SVG
                 </button>` : ''}`
              : `${t.svgPath
                  ? `<button class="graph-btn graph-btn--primary graph-btn--download" data-id="${escHtml(t.id)}" data-svg="${escHtml(t.svgPath)}">
                       ${lucideSVG('download', 13, 'currentColor')} Download template
                     </button>`
                  : `<button class="graph-btn graph-btn--primary" disabled style="opacity:0.35;cursor:not-allowed">
                       ${lucideSVG('download', 13, 'currentColor')} Template coming soon
                     </button>`
                }
                 <a class="graph-btn graph-btn--ghost" href="${escHtml(t.datlylonUrl)}" target="_blank" rel="noopener">
                   ${lucideSVG('external-link', 13, 'currentColor')} Open in Datylon
                 </a>`
            }
          </div>
        </div>
      </div>`
  }

  let _activeFilter = 'all'

  function _filteredTemplates() {
    if (_activeFilter === 'all') return GRAPH_TEMPLATES
    return GRAPH_TEMPLATES.filter(t => t.series === _activeFilter)
  }

  function _renderGrid() {
    const grid = overlay.querySelector('#graph-gallery-grid')
    if (!grid) return
    const templates = _filteredTemplates()
    grid.innerHTML = templates.length
      ? templates.map(_cardHTML).join('')
      : `<p class="graph-gallery-empty">No templates in this category yet.</p>`
    grid.querySelectorAll('.graph-btn--download').forEach(bindDownloadBtn)
  }

  const overlay = document.createElement('div')
  overlay.className = 'graph-gallery-overlay tmpl-picker-overlay'
  overlay.innerHTML = `
    <div class="tmpl-picker-modal graph-gallery-modal">
      <div class="tmpl-picker-header">
        <div>
          <h2 class="tmpl-picker-title">Graph templates</h2>
          <p class="tmpl-picker-subtitle">Select a template — download it once to your Datylon workspace, then open directly next time.</p>
        </div>
        <button class="tmpl-picker-close" id="graph-gallery-close">${lucideSVG('x', 16, 'currentColor')}</button>
      </div>
      <div class="graph-gallery-info">
        ${lucideSVG('info', 16, 'currentColor')}
        <span>You need a free <a href="https://www.datylon.com/" target="_blank" rel="noopener" class="graph-info-link">Datylon account</a> to edit templates. First time? Download the SVG and upload it via <strong>Workspace → Templates → Upload template</strong> in Datylon.</span>
      </div>
      <div class="graph-series-toggle">
        <button class="graph-series-btn active" data-series="all">All</button>
        <button class="graph-series-btn" data-series="single">Single series</button>
        <button class="graph-series-btn" data-series="multi">Multi series</button>
      </div>
      <div class="graph-gallery-grid" id="graph-gallery-grid">
        ${GRAPH_TEMPLATES.map(_cardHTML).join('')}
      </div>
    </div>
  `

  _mount.appendChild(overlay)
  overlay.querySelector('#graph-gallery-close').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

  // Series toggle
  overlay.querySelectorAll('.graph-series-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      _activeFilter = btn.dataset.series
      overlay.querySelectorAll('.graph-series-btn').forEach(b => b.classList.toggle('active', b === btn))
      _renderGrid()
    })
  })

  // Download SVG buttons
  function bindDownloadBtn(btn) {
    btn.addEventListener('click', async () => {
      const id  = btn.dataset.id
      const svg = btn.dataset.svg
      if (!svg) { showToast('SVG file not configured for this template yet.', 'error'); return }
      try {
        const a = Object.assign(document.createElement('a'), { href: svg, download: `datylon-template-${id.slice(0, 8)}.svg` })
        a.click()
        _markDatlylonDownloaded(id)
        const card = overlay.querySelector(`.graph-card[data-id="${id}"]`)
        if (card) {
          const tmp = document.createElement('div')
          tmp.innerHTML = _cardHTML(GRAPH_TEMPLATES.find(t => t.id === id))
          const newCard = tmp.firstElementChild
          card.replaceWith(newCard)
          newCard.querySelectorAll('.graph-btn--download').forEach(b => bindDownloadBtn(b))
        }
        showToast('Template downloaded — upload it to Datylon via Workspace → Templates → Upload template.', 'success')
      } catch { showToast('Download failed — try again.', 'error') }
    })
  }
  overlay.querySelectorAll('.graph-btn--download').forEach(bindDownloadBtn)
}

// ── Blog thumbnail form ───────────────────────────────────────────────────────
function showBlogThumbnailForm(csvRows = null, currentIndex = 0) {
  const _mount = (_root && document.contains(_root)) ? _root : document.body
  _mount.querySelector('.blog-form-overlay')?.remove()

  const isBulk    = csvRows && csvRows.length > 1
  const prefill   = csvRows ? csvRows[currentIndex] : null
  const progress  = isBulk ? `<div class="blog-form-progress">Thumbnail ${currentIndex + 1} of ${csvRows.length}</div>` : ''

  const overlay = document.createElement('div')
  overlay.className = 'blog-form-overlay tmpl-picker-overlay'
  overlay.innerHTML = `
    <div class="tmpl-picker-modal blog-form-modal">
      <div class="tmpl-picker-header">
        <div>
          <h2 class="tmpl-picker-title">Blog thumbnail details</h2>
          <p class="tmpl-picker-subtitle">${isBulk ? `Reviewing CSV row ${currentIndex + 1} of ${csvRows.length} — edit before generating` : 'Fill in the details or upload a CSV for multiple thumbnails'}</p>
        </div>
        <button class="tmpl-picker-close" id="blog-form-close">${lucideSVG('x', 16, 'currentColor')}</button>
      </div>

      ${progress}

      <form class="blog-form" id="blog-thumbnail-form" autocomplete="off">
        <div class="blog-form-field">
          <label class="blog-form-label" for="blog-title">Blog title <span class="blog-form-required">*</span></label>
          <input class="blog-form-input" id="blog-title" type="text" value="${(prefill?.title || '').replace(/"/g, '&quot;')}" placeholder="e.g. The state of social media in 2025" required />
        </div>

        <div class="blog-form-field">
          <label class="blog-form-label" for="blog-meta">Meta description</label>
          <textarea class="blog-form-input blog-form-textarea" id="blog-meta" rows="4"
            placeholder="e.g. A look at how audiences across markets are engaging with social platforms this year…">${prefill?.metaDesc || ''}</textarea>
        </div>

        <div class="blog-form-field">
          <label class="blog-form-label" for="blog-subtitles">Body subtitles <span class="blog-form-hint">(optional — one per line)</span></label>
          <textarea class="blog-form-input blog-form-textarea" id="blog-subtitles" rows="3"
            placeholder="e.g. Why TikTok still leads">${prefill?.subtitles || ''}</textarea>
        </div>

        <div class="blog-form-field">
          <label class="blog-form-label" for="blog-category">
            Category <span class="blog-form-required">*</span>
          </label>
          <select class="blog-form-input" id="blog-category">
            <option value="" disabled ${!prefill?.category ? 'selected' : ''}>Select a category…</option>
            <option value="audiences"           ${(prefill?.category||'').toLowerCase() === 'audiences'            ? 'selected' : ''}>Audiences</option>
            <option value="consumer behaviour"  ${(prefill?.category||'').toLowerCase() === 'consumer behaviour'   ? 'selected' : ''}>Consumer behaviour</option>
            <option value="digital trends"      ${(prefill?.category||'').toLowerCase() === 'digital trends'       ? 'selected' : ''}>Digital trends</option>
            <option value="data journalism"     ${(prefill?.category||'').toLowerCase() === 'data journalism'      ? 'selected' : ''}>Data journalism</option>
            <option value="talk data to me"     ${(prefill?.category||'').toLowerCase() === 'talk data to me'      ? 'selected' : ''}>Talk data to me</option>
            <option value="product"             ${(prefill?.category||'').toLowerCase() === 'product'              ? 'selected' : ''}>Product</option>
            <option value="strategy"            ${(prefill?.category||'').toLowerCase() === 'strategy'             ? 'selected' : ''}>Strategy</option>
          </select>
        </div>

        <div class="blog-category-preview" id="blog-category-preview" style="display:none">
          <div class="blog-category-preview-img-wrap">
            <img class="blog-category-preview-img" id="blog-category-preview-img" src="" alt="" style="display:none" />
            <div class="blog-category-preview-placeholder" id="blog-category-preview-placeholder"></div>
          </div>
          <p class="blog-category-preview-caption" id="blog-category-preview-caption"></p>
        </div>

        ${!isBulk ? `
        <div class="blog-form-csv-row">
          <span class="blog-form-csv-label">Or create multiple thumbnails from a CSV file</span>
          <label class="blog-form-csv-btn">
            ${lucideSVG('upload', 14, 'currentColor')} Upload CSV
            <input type="file" id="blog-csv-input" accept=".csv" style="display:none" />
          </label>
          <a class="blog-form-csv-template" id="blog-csv-download" href="#">${lucideSVG('download', 14, 'currentColor')} Download template</a>
        </div>
        ` : ''}

        <div class="blog-form-error" id="blog-form-error" style="display:none"></div>

        <div class="blog-form-actions">
          <button type="button" class="blog-form-cancel" id="blog-form-cancel">${isBulk ? 'Cancel batch' : 'Cancel'}</button>
          <button type="submit" class="blog-form-submit" id="blog-form-submit">
            Generate thumbnail ${lucideSVG('arrow-right', 14, 'currentColor')}
          </button>
        </div>
      </form>
    </div>
  `

  _mount.appendChild(overlay)
  overlay.querySelector('#blog-title').focus()

  const close = () => overlay.remove()
  overlay.querySelector('#blog-form-close').addEventListener('click', close)
  overlay.querySelector('#blog-form-cancel').addEventListener('click', close)
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })

  // Category example preview
  const _catSelect      = overlay.querySelector('#blog-category')
  const _catPreview     = overlay.querySelector('#blog-category-preview')
  const _catImg         = overlay.querySelector('#blog-category-preview-img')
  const _catPlaceholder = overlay.querySelector('#blog-category-preview-placeholder')
  const _catCaption     = overlay.querySelector('#blog-category-preview-caption')

  function _updateCategoryPreview(category) {
    if (!category) { _catPreview.style.display = 'none'; return }
    const slug  = category.toLowerCase().replace(/\s+/g, '-')
    const label = category.replace(/\b\w/g, c => c.toUpperCase())
    _catCaption.textContent = `Example of ${label} thumbnail`
    _catImg.style.display = 'none'
    _catPlaceholder.style.display = 'flex'
    _catImg.onload  = () => { _catImg.style.display = 'block'; _catPlaceholder.style.display = 'none' }
    _catImg.onerror = () => { _catImg.style.display = 'none';  _catPlaceholder.style.display = 'flex' }
    _catImg.src = `/assets/examples/${slug}.png`
    _catPreview.style.display = 'block'
  }

  _catSelect.addEventListener('change', () => _updateCategoryPreview(_catSelect.value))
  if (prefill?.category) _updateCategoryPreview(prefill.category)

  // CSV template download
  overlay.querySelector('#blog-csv-download')?.addEventListener('click', e => {
    e.preventDefault()
    // IMPORTANT: no embedded newlines in any field — use | to separate multiple subtitles
    // Valid categories: Audiences | Consumer behaviour | Digital trends | Data journalism | Talk data to me | Product | Strategy
    const rows = [
      'title,meta_description,subtitles,category',
      '"The state of social media in 2025","How audiences across markets are engaging with social platforms this year","Why TikTok still leads|The rise of short-form video","Digital trends"',
      '"Understanding Gen Z spending habits","How the youngest consumers are reshaping global markets","Key spending shifts|Brand loyalty trends","Audiences"',
      '"Q3 2025 platform insights","A breakdown of platform performance across regions","","Strategy"',
    ]
    const csv = rows.join('\r\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(blob), download: 'thumbnail-template.csv' })
    a.click()
  })

  // CSV upload
  overlay.querySelector('#blog-csv-input')?.addEventListener('change', e => {
    const file = e.target.files[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = ev => {
      const rows = parseCSV(ev.target.result)
      if (!rows.length) {
        showBlogFormError(overlay, 'CSV has no valid rows. Make sure it has a header row with: title, meta_description, subtitles, category')
        return
      }
      overlay.remove()
      showBlogThumbnailForm(rows, 0)
    }
    reader.readAsText(file)
  })

  // Form submit
  overlay.querySelector('#blog-thumbnail-form').addEventListener('submit', async e => {
    e.preventDefault()
    const blogMeta = {
      title:     overlay.querySelector('#blog-title').value.trim(),
      metaDesc:  overlay.querySelector('#blog-meta').value.trim(),
      subtitles: overlay.querySelector('#blog-subtitles').value.trim(),
      category:  overlay.querySelector('#blog-category').value.trim(),
    }
    if (!blogMeta.title) return
    if (!blogMeta.category) {
      showBlogFormError(overlay, 'Please select a category')
      overlay.querySelector('#blog-category').focus()
      return
    }
    const btn = overlay.querySelector('#blog-form-submit')
    btn.disabled = true
    btn.innerHTML = `${spinnerHTML()} Generating…`
    hideFormError(overlay)

    try {
      const result = await apiFetch('/api/thumbnail/generate', {
        method: 'POST',
        body: JSON.stringify({ ...blogMeta, attempt: 0 })
      })
      if (!result.ok && result.error) throw new Error(result.error)
      overlay.remove()
      showThumbnailPicker(blogMeta, result, csvRows, currentIndex, 0)
    } catch (err) {
      showBlogFormError(overlay, err.message || 'Generation failed — try again')
      btn.disabled = false
      btn.innerHTML = `Generate thumbnail ${lucideSVG('arrow-right', 14, 'currentColor')}`
    }
  })
}

function showBlogFormError(overlay, msg) {
  const el = overlay.querySelector('#blog-form-error')
  if (!el) return
  el.textContent = msg
  el.style.display = 'block'
}
function hideFormError(overlay) {
  const el = overlay.querySelector('#blog-form-error')
  if (el) el.style.display = 'none'
}

// ── Thumbnail image picker ────────────────────────────────────────────────────
function showThumbnailPicker(blogMeta, result, csvRows = null, currentIndex = 0, attempt = 0) {
  if (result.type === 'talk-data') {
    showTalkDataForm(blogMeta, csvRows, currentIndex)
    return
  }
  let _attempt = attempt

  const _mount = (_root && document.contains(_root)) ? _root : document.body
  const isBulk = csvRows && csvRows.length > 1
  const usedIds = []

  const isFigma = result.type === 'figma'
  // Figma picker: compact layout — 3 cols, wraps to fit however many options there are
  const pickerModalStyle = isFigma
    ? 'style="width:900px;max-width:96vw"'
    : ''
  const pickerGridStyle  = isFigma
    ? 'style="grid-template-columns:repeat(3,1fr);max-height:none;overflow:visible"'
    : ''

  const overlay = document.createElement('div')
  overlay.className = 'blog-form-overlay tmpl-picker-overlay'
  overlay.innerHTML = `
    <div class="tmpl-picker-modal thumb-picker-modal" ${pickerModalStyle}>
      <div class="tmpl-picker-header">
        <div>
          <h2 class="tmpl-picker-title">Choose your thumbnail</h2>
          <p class="tmpl-picker-subtitle">${blogMeta.title}${isBulk ? ` — ${currentIndex + 1} of ${csvRows.length}` : ''}</p>
        </div>
        <button class="tmpl-picker-close" id="thumb-picker-close">${lucideSVG('x', 16, 'currentColor')}</button>
      </div>

      ${!isFigma ? `
      <div class="thumb-picker-guidance">
        <span class="thumb-picker-guidance-icon">${lucideSVG('alert-triangle', 15, 'currentColor')}</span>
        <span>Please select an image with a <strong>single, clear focal point</strong>, using a <strong>simple, uncluttered composition</strong>. Ideally the image will have plenty of <strong>negative space</strong> and a <strong>clean, minimal colour background</strong> if possible.</span>
      </div>` : ''}

      <div class="thumb-picker-grid" id="thumb-picker-grid" ${pickerGridStyle}>
        ${result.options.map((opt, i) => `
          <button class="thumb-picker-card" data-url="${opt.url}" data-index="${i}">
            <img class="thumb-picker-img" src="${opt.preview || opt.url}" alt="Option ${i + 1}" loading="lazy" />
            <div class="thumb-picker-label" style="display:flex;justify-content:space-between;align-items:center;padding:5px 8px 7px;width:100%">
              <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${isFigma && opt.name ? escHtml(opt.name.replace(/^product thumbnail[\s\-–—:]+/i, '').trim()) : `Option ${i + 1}`}</span>
              ${!isFigma ? `<span style="font-size:10px;opacity:0.45;text-transform:uppercase;letter-spacing:0.05em;flex-shrink:0;margin-left:6px">${opt.source || 'pexels'}</span>` : ''}
            </div>
          </button>
        `).join('')}
      </div>

      <div class="blog-form-error" id="thumb-picker-error" style="display:none"></div>

      <div class="thumb-picker-actions">
        <button class="blog-form-cancel" id="thumb-try-again">${lucideSVG('refresh-cw', 14, 'currentColor')} Try again</button>
        <span class="thumb-picker-hint">Select an image to ${isFigma ? 'use as your thumbnail' : 'compose your thumbnail'}</span>
      </div>
    </div>
  `

  _mount.appendChild(overlay)
  overlay.querySelector('#thumb-picker-close').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

  // Try again — re-call generate with used IDs excluded
  overlay.querySelector('#thumb-try-again').addEventListener('click', async () => {
    const btn = overlay.querySelector('#thumb-try-again')
    btn.disabled = true
    btn.innerHTML = `${spinnerHTML()} Fetching…`
    try {
      _attempt += 1
      const newResult = await apiFetch('/api/thumbnail/generate', {
        method: 'POST',
        body: JSON.stringify({ ...blogMeta, excludeIds: result.options.map(o => o.id), attempt: _attempt })
      })
      overlay.remove()
      showThumbnailPicker(blogMeta, newResult, csvRows, currentIndex, _attempt)
    } catch (err) {
      btn.disabled = false
      btn.innerHTML = `${lucideSVG('refresh-cw', 14, 'currentColor')} Try again`
      const errEl = overlay.querySelector('#thumb-picker-error')
      errEl.textContent = err.message || 'Failed to fetch new options'
      errEl.style.display = 'block'
    }
  })

  // Select image
  // Figma (Product/Strategy): compose immediately — no adjustment screen needed
  // Pexels/Unsplash: open adjustment screen so user can crop/position first
  overlay.querySelectorAll('.thumb-picker-card').forEach(card => {
    card.addEventListener('click', async () => {
      if (isFigma) {
        // Disable all cards while composing
        overlay.querySelectorAll('.thumb-picker-card').forEach(c => { c.disabled = true; c.style.opacity = '0.5' })
        const errEl = overlay.querySelector('#thumb-picker-error')
        errEl.style.display = 'none'
        try {
          const res = await apiFetch('/api/thumbnail/compose', {
            method: 'POST',
            body: JSON.stringify({ imageUrl: card.dataset.url }),
          })
          overlay.remove()
          showThumbnailResult(blogMeta, res.image, csvRows, currentIndex, result, _attempt, card.dataset.url)
        } catch (err) {
          overlay.querySelectorAll('.thumb-picker-card').forEach(c => { c.disabled = false; c.style.opacity = '' })
          errEl.textContent = 'Composition failed — try again'
          errEl.style.display = 'block'
        }
      } else {
        overlay.remove()
        showImageAdjust(blogMeta, card.dataset.url, csvRows, currentIndex, result, _attempt)
      }
    })
  })
}

// ── Thumbnail result (save / download / next) ────────────────────────────────
function showThumbnailResult(blogMeta, imageDataUrl, csvRows = null, currentIndex = 0, pickerResult = null, pickerAttempt = 0, sourceImageUrl = null, adjustParams = null) {
  const _mount = (_root && document.contains(_root)) ? _root : document.body
  const isBulk    = csvRows && csvRows.length > 1
  const hasNext   = isBulk && currentIndex < csvRows.length - 1
  const safeTitle = blogMeta.title.replace(/[^a-z0-9]/gi, '_').toLowerCase()

  const overlay = document.createElement('div')
  overlay.className = 'blog-form-overlay tmpl-picker-overlay'
  overlay.innerHTML = `
    <div class="tmpl-picker-modal thumb-result-modal">
      <div class="tmpl-picker-header">
        <div>
          <h2 class="tmpl-picker-title">Your thumbnail is ready</h2>
          <p class="tmpl-picker-subtitle">${blogMeta.title}${isBulk ? ` — ${currentIndex + 1} of ${csvRows.length}` : ''}</p>
        </div>
        <button class="tmpl-picker-close" id="thumb-result-close">${lucideSVG('x', 16, 'currentColor')}</button>
      </div>
      <div class="thumb-result-preview">
        <img src="${imageDataUrl}" alt="Thumbnail" class="thumb-result-img" />
      </div>
      <div class="thumb-picker-actions">
        <button class="blog-form-cancel" id="thumb-result-back">${lucideSVG('arrow-left', 14, 'currentColor')} Choose different</button>
        <div style="display:flex;gap:10px">
          <button class="blog-form-submit" id="thumb-result-save" style="background:#2a7a4b">
            ${lucideSVG('bookmark', 14, 'currentColor')} Save
          </button>
          <button class="blog-form-submit" id="thumb-result-download">
            ${lucideSVG('download', 14, 'currentColor')} Download
          </button>
          ${hasNext ? `<button class="blog-form-submit" id="thumb-result-next" style="background:#ffffff;color:#000000;border-color:#ffffff">
            Next ${lucideSVG('arrow-right', 14, '#000000')}
          </button>` : ''}
        </div>
      </div>
    </div>
  `

  _mount.appendChild(overlay)
  overlay.querySelector('#thumb-result-close').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

  overlay.querySelector('#thumb-result-back').addEventListener('click', () => {
    overlay.remove()
    if (pickerResult) {
      showThumbnailPicker(blogMeta, pickerResult, csvRows, currentIndex, pickerAttempt)
    } else {
      showBlogThumbnailForm(csvRows, currentIndex)
    }
  })

  // ── Save to dashboard ────────────────────────────────────────────────────────
  overlay.querySelector('#thumb-result-save').addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    btn.innerHTML = `${spinnerHTML()} Saving…`

    try {
      const user = await _getDashUser()
      let userId = _currentUserId
      if (!userId) {
        const { data: { session } } = await supabase.auth.getSession()
        userId = session?.user?.id || null
      }

      // Generate a JPEG preview (720×420) from the composed imageDataUrl
      // so the dashboard card always shows exactly what the user agreed to download
      const previewJpeg = await new Promise(resolve => {
        const img = new Image()
        img.onload = () => {
          const c = document.createElement('canvas')
          c.width = 720; c.height = 420
          c.getContext('2d').drawImage(img, 0, 0, 720, 420)
          resolve(c.toDataURL('image/jpeg', 0.92))
        }
        img.onerror = () => resolve(null)
        img.src = imageDataUrl
      })

      // Upload full-res PNG to Supabase Storage so it can be re-downloaded later
      let composedUrl = null
      try {
        const blob = await fetch(imageDataUrl).then(r => r.blob())
        const path = `thumbnails/${userId}/${crypto.randomUUID()}.png`
        const { error: upErr } = await supabase.storage
          .from('abx-images')
          .upload(path, blob, { contentType: 'image/png' })
        if (!upErr) {
          const { data: signData } = await supabase.storage
            .from('abx-images')
            .createSignedUrl(path, 60 * 60 * 24 * 365 * 10)  // 10-year signed URL
          composedUrl = signData?.signedUrl || null
        } else {
          console.warn('[save] storage upload failed:', upErr)
          // Visible warning — download from card won't be full-res without this
          showToast('Saved, but full-res storage upload failed — card download may be low-res', 'error')
        }
      } catch (upEx) {
        console.warn('[save] storage upload error:', upEx)
        showToast('Saved, but full-res storage upload failed — card download may be low-res', 'error')
      }

      const { data: record, error } = await supabase
        .from('templates')
        .insert({
          user_id:       userId,
          name:          blogMeta.title,
          status:        'saved',
          folder_id:     null,
          template_type: 'blog-thumbnail',
          doc:           { imageUrl: sourceImageUrl, previewJpeg, composedUrl, adjustParams, blogMeta, docAuthor: user.name, docAuthorAvatar: user.avatarUrl },
          block_count:   0,
          block_types:   [],
        })
        .select()
        .single()

      if (error) throw new Error(error.message)

      _templates.unshift({
        ...record,
        doc_image_url:     previewJpeg || sourceImageUrl || '',
        doc_composed_url:  composedUrl || '',
        doc_source_url:    sourceImageUrl || '',
        doc_adjust_params: adjustParams || null,
        doc_author:        user.name      || '',
        doc_author_avatar: user.avatarUrl || '',
      })
      refreshGrid()
      showToast(`"${blogMeta.title}" saved to dashboard`)
      btn.innerHTML = `${lucideSVG('check', 14, 'currentColor')} Saved`
    } catch (err) {
      showToast(`Save failed: ${err.message}`, 'error')
      btn.disabled = false
      btn.innerHTML = `${lucideSVG('bookmark', 14, 'currentColor')} Save to dashboard`
    }
  })

  // ── Download PNG ─────────────────────────────────────────────────────────────
  overlay.querySelector('#thumb-result-download').addEventListener('click', async () => {
    // Convert data URL to a blob URL so the browser always shows a save dialog,
    // not an inline preview (same approach as _downloadThumbnail)
    try {
      const blob = await fetch(imageDataUrl).then(r => r.blob())
      const blobUrl = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href     = blobUrl
      a.download = `${safeTitle}_thumbnail.png`
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      setTimeout(() => URL.revokeObjectURL(blobUrl), 10_000)
    } catch {
      // Fallback: direct data URL (older browsers)
      const a = document.createElement('a')
      a.href     = imageDataUrl
      a.download = `${safeTitle}_thumbnail.png`
      a.click()
    }
  })

  overlay.querySelector('#thumb-result-next')?.addEventListener('click', () => {
    overlay.remove()
    showBlogThumbnailForm(csvRows, currentIndex + 1)
  })
}

// ── Shared slider fill helper (WebKit track fill via CSS --pct variable) ─────
function syncFill(input) {
  const min = parseFloat(input.min) || 0
  const max = parseFloat(input.max) || 100
  const val = parseFloat(input.value)
  const pct = ((val - min) / (max - min)) * 100
  input.style.setProperty('--pct', `${pct}%`)
}

// ── Image crop/position adjustment (all Pexels/Figma categories) ─────────────
function showImageAdjust(blogMeta, imageUrl, csvRows, currentIndex, result, attempt) {
  const _mount = (_root && document.contains(_root)) ? _root : document.body
  const W = 1200, H = 700

  let userScale = 1.0
  let offsetX   = 0
  let offsetY   = 0

  // Default positioning:
  //   Portrait images  → scale to fill the canvas width (no side bars), may overflow top/bottom
  //   Landscape images → contain the full image (no cropping), user zooms in as needed
  // The user then pans and zooms before hitting "Use this".
  function calcDraw(imgW, imgH, scale, ox, oy) {
    const isPortrait = imgH > imgW
    const base = (isPortrait ? W / imgW : Math.min(W / imgW, H / imgH)) * scale
    const dw   = imgW * base
    const dh   = imgH * base
    const bx   = (W - dw) / 2
    const by   = (H - dh) / 2
    return { x: bx + ox, y: by + oy, w: dw, h: dh }
  }

  const overlay = document.createElement('div')
  overlay.className = 'blog-form-overlay tmpl-picker-overlay'
  overlay.innerHTML = `
    <style>
      .iadj-slider {
        width: 100%;
        margin-bottom: 10px;
        appearance: none;
        -webkit-appearance: none;
        height: 4px;
        border-radius: 2px;
        outline: none;
        cursor: pointer;
        background: transparent;
      }
      .iadj-slider::-webkit-slider-runnable-track {
        height: 4px;
        border-radius: 2px;
        background: linear-gradient(to right,
          #FF0077 0%, #FF0077 var(--pct, 50%),
          rgba(255,255,255,0.15) var(--pct, 50%), rgba(255,255,255,0.15) 100%);
      }
      .iadj-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px; height: 14px;
        border-radius: 50%;
        background: #FF0077;
        cursor: pointer;
        margin-top: -5px;
      }
      .iadj-slider::-moz-range-track {
        background: rgba(255,255,255,0.15);
        border-radius: 2px; height: 4px;
      }
      .iadj-slider::-moz-range-progress {
        background: #FF0077;
        border-radius: 2px; height: 4px;
      }
      .iadj-slider::-moz-range-thumb {
        width: 14px; height: 14px;
        border-radius: 50%;
        background: #FF0077;
        cursor: pointer; border: none;
      }
    </style>
    <div class="tmpl-picker-modal blog-form-modal" style="max-width:820px;width:92vw">
      <div class="tmpl-picker-header">
        <div>
          <h2 class="tmpl-picker-title">Adjust image</h2>
          <p class="tmpl-picker-subtitle">${escHtml(blogMeta.title)}</p>
        </div>
        <button class="tmpl-picker-close" id="iadj-close">${lucideSVG('x', 16, 'currentColor')}</button>
      </div>
      <div class="blog-form" style="gap:16px">
        <canvas id="iadj-canvas" style="width:100%;border-radius:6px;display:block;background:#111"></canvas>
        <div id="iadj-loading" style="display:flex;align-items:center;justify-content:center;gap:8px;margin-top:-8px"><span class="page-spinner" style="width:16px;height:16px;border-width:2px"></span><span style="font-size:13px;color:var(--text-secondary)">Loading image…</span></div>

        <div style="max-width:420px;margin:0 auto;width:100%">
          <p style="font-weight:700;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:6px;color:#fff">Image adjustments</p>
          <p style="font-size:12px;color:rgba(255,255,255,0.4);margin-bottom:14px">The full image is shown. Zoom in and pan to frame your shot, then click <strong style="color:rgba(255,255,255,0.65)">Use this</strong>.</p>
          <label class="blog-form-label">Zoom — <span id="iadj-scale-val">100%</span></label>
          <input type="range" class="iadj-slider" id="iadj-scale" min="100" max="500" value="100">
          <label class="blog-form-label">Left / Right — <span id="iadj-x-val">0</span></label>
          <input type="range" class="iadj-slider" id="iadj-x" min="-800" max="800" value="0">
          <label class="blog-form-label">Up / Down — <span id="iadj-y-val">0</span></label>
          <input type="range" class="iadj-slider" id="iadj-y" min="-800" max="800" value="0">
        </div>

        <div id="iadj-error" class="blog-form-error" style="display:none"></div>

        <div class="blog-form-actions" style="margin-top:4px">
          <button class="blog-form-cancel" id="iadj-back" style="display:flex;align-items:center;gap:6px">
            <span style="display:flex;align-items:center;position:relative;top:1px">${lucideSVG('arrow-left', 14, 'currentColor')}</span>
            Try another
          </button>
          <button class="blog-form-submit" id="iadj-use">${lucideSVG('check', 14, 'currentColor')} Use this</button>
        </div>
      </div>
    </div>
  `
  _mount.appendChild(overlay)

  const canvas  = overlay.querySelector('#iadj-canvas')
  const loadMsg = overlay.querySelector('#iadj-loading')
  canvas.width  = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  const img = new Image()
  img.crossOrigin = 'anonymous'
  img.onload = () => {
    loadMsg.style.display = 'none'
    draw()
  }
  img.onerror = () => { loadMsg.textContent = 'Could not load preview — adjust blind or try another image.' }
  img.src = imageUrl

  function draw() {
    ctx.fillStyle = '#000'
    ctx.fillRect(0, 0, W, H)
    if (!img.naturalWidth) return
    const p = calcDraw(img.naturalWidth, img.naturalHeight, userScale, offsetX, offsetY)
    ctx.drawImage(img, p.x, p.y, p.w, p.h)
  }

  // Sliders
  const sliderDefs = [
    ['#iadj-scale', '#iadj-scale-val', v => { userScale = v / 100 }, v => `${v}%`],
    ['#iadj-x',     '#iadj-x-val',     v => { offsetX   = v       }, v => v >= 0 ? `+${v}` : `${v}`],
    ['#iadj-y',     '#iadj-y-val',     v => { offsetY   = v       }, v => v >= 0 ? `+${v}` : `${v}`],
  ]
  sliderDefs.forEach(([sel, lblSel, setter, fmt]) => {
    const input = overlay.querySelector(sel)
    const label = overlay.querySelector(lblSel)
    syncFill(input)
    input.addEventListener('input', () => {
      const v = parseInt(input.value, 10)
      label.textContent = fmt(v)
      setter(v)
      syncFill(input)
      draw()
    })
  })

  // Close / back
  overlay.querySelector('#iadj-close').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
  overlay.querySelector('#iadj-back').addEventListener('click', () => {
    overlay.remove()
    showThumbnailPicker(blogMeta, result, csvRows, currentIndex, attempt)
  })

  // Use this → server composes with user's params
  overlay.querySelector('#iadj-use').addEventListener('click', async () => {
    const btn   = overlay.querySelector('#iadj-use')
    const errEl = overlay.querySelector('#iadj-error')
    btn.disabled = true
    btn.innerHTML = `${spinnerHTML()} Composing…`
    errEl.style.display = 'none'
    try {
      const res = await apiFetch('/api/thumbnail/compose', {
        method: 'POST',
        body: JSON.stringify({ imageUrl, scale: userScale, offsetX, offsetY }),
      })
      overlay.remove()
      showThumbnailResult(blogMeta, res.image, csvRows, currentIndex, result, attempt, imageUrl, { scale: userScale, offsetX, offsetY })
    } catch (err) {
      errEl.textContent = 'Composition failed — try again'
      errEl.style.display = 'block'
      btn.disabled = false
      btn.innerHTML = `${lucideSVG('check', 14, 'currentColor')} Use this`
    }
  })
}

// ── Talk data to me — adjustment screen ──────────────────────────────────────
function showTalkDataAdjust(blogMeta, personDataUrl, logoDataUrl, defaults, csvRows, currentIndex) {
  const _mount = (_root && document.contains(_root)) ? _root : document.body
  const W = 1200, H = 700

  const BG_COLORS = { black: '#000000', pink: '#FF0077' }

  // Mutable state — all offsets are in canvas pixels (1200×700 space)
  let personScale = 1.0
  let personOffX  = 0
  let personOffY  = 0
  let logoScale   = 1.0
  let logoOffX    = 0
  let logoOffY    = 0
  let currentBg   = defaults.bgColor || 'black'

  const overlay = document.createElement('div')
  overlay.className = 'blog-form-overlay tmpl-picker-overlay'
  overlay.innerHTML = `
    <style>
      .adj-slider {
        width: 100%;
        margin-bottom: 10px;
        appearance: none;
        -webkit-appearance: none;
        height: 4px;
        border-radius: 2px;
        outline: none;
        cursor: pointer;
        background: transparent;
      }
      /* WebKit — filled track via CSS variable set by JS */
      .adj-slider::-webkit-slider-runnable-track {
        height: 4px;
        border-radius: 2px;
        background: linear-gradient(
          to right,
          #FF0077 0%,
          #FF0077 var(--pct, 50%),
          rgba(255,255,255,0.15) var(--pct, 50%),
          rgba(255,255,255,0.15) 100%
        );
      }
      .adj-slider::-webkit-slider-thumb {
        -webkit-appearance: none;
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #FF0077;
        cursor: pointer;
        margin-top: -5px; /* centre 14px thumb on 4px track */
      }
      /* Firefox — native progress fill */
      .adj-slider::-moz-range-track {
        background: rgba(255,255,255,0.15);
        border-radius: 2px;
        height: 4px;
      }
      .adj-slider::-moz-range-progress {
        background: #FF0077;
        border-radius: 2px;
        height: 4px;
      }
      .adj-slider::-moz-range-thumb {
        width: 14px;
        height: 14px;
        border-radius: 50%;
        background: #FF0077;
        cursor: pointer;
        border: none;
      }
    </style>
    <div class="tmpl-picker-modal blog-form-modal" style="max-width:820px;width:92vw">
      <div class="tmpl-picker-header">
        <div>
          <h2 class="tmpl-picker-title">Adjust placement</h2>
          <p class="tmpl-picker-subtitle">${escHtml(blogMeta.title)}</p>
        </div>
        <button class="tmpl-picker-close" id="adj-close">${lucideSVG('x', 16, 'currentColor')}</button>
      </div>
      <div class="blog-form" style="gap:16px">

        <canvas id="adj-canvas" style="width:100%;border-radius:6px;display:block;background:#000"></canvas>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:24px;margin-top:4px">

          <div>
            <p style="font-weight:700;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;color:#ffffff">Image adjustments</p>
            <label class="blog-form-label">Size — <span id="adj-ps-val">100%</span></label>
            <input type="range" class="adj-slider" id="adj-ps" min="40" max="180" value="100">
            <label class="blog-form-label">Left / Right — <span id="adj-px-val">0</span></label>
            <input type="range" class="adj-slider" id="adj-px" min="-500" max="500" value="0">
            <label class="blog-form-label">Up / Down — <span id="adj-py-val">0</span></label>
            <input type="range" class="adj-slider" id="adj-py" min="-400" max="400" value="0">
          </div>

          <div>
            <p style="font-weight:700;font-size:11px;letter-spacing:0.08em;text-transform:uppercase;margin-bottom:12px;color:#ffffff">Logo adjustments</p>
            <label class="blog-form-label">Size — <span id="adj-ls-val">100%</span></label>
            <input type="range" class="adj-slider" id="adj-ls" min="20" max="200" value="100">
            <label class="blog-form-label">Left / Right — <span id="adj-lx-val">0</span></label>
            <input type="range" class="adj-slider" id="adj-lx" min="-500" max="500" value="0">
            <label class="blog-form-label">Up / Down — <span id="adj-ly-val">0</span></label>
            <input type="range" class="adj-slider" id="adj-ly" min="-400" max="400" value="0">
          </div>

        </div>

        <div style="display:flex;align-items:center;gap:14px">
          <span style="font-size:13px;font-weight:600;color:#ffffff;white-space:nowrap">Background colour</span>
          <div style="display:flex;gap:10px">
            <button class="adj-bg-btn" data-color="black"
              style="border:2px solid ${currentBg === 'black' ? '#FF0077' : 'transparent'};background:#000000;color:#fff;padding:6px 18px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">
              Black
            </button>
            <button class="adj-bg-btn" data-color="pink"
              style="border:2px solid ${currentBg === 'pink' ? '#FF0077' : 'transparent'};background:#FF0077;color:#fff;padding:6px 18px;border-radius:6px;cursor:pointer;font-size:13px;font-weight:600">
              Pink
            </button>
          </div>
        </div>

        <div class="blog-form-actions" style="margin-top:4px">
          <button class="blog-form-cancel" id="adj-back" style="display:flex;align-items:center;gap:6px">
            <span style="display:flex;align-items:center;position:relative;top:1px">${lucideSVG('arrow-left', 14, 'currentColor')}</span>
            Regenerate
          </button>
          <button class="blog-form-submit" id="adj-use">${lucideSVG('check', 14, 'currentColor')} Use this</button>
        </div>
      </div>
    </div>
  `
  _mount.appendChild(overlay)

  const canvas = overlay.querySelector('#adj-canvas')
  canvas.width  = W
  canvas.height = H
  const ctx = canvas.getContext('2d')

  const personImg = new Image()
  const logoImg   = new Image()
  let loaded = 0

  function draw() {
    ctx.clearRect(0, 0, W, H)
    ctx.fillStyle = BG_COLORS[currentBg] || '#000000'
    ctx.fillRect(0, 0, W, H)

    if (loaded < 2) return

    // Person — scale from default size, keep bottom-anchored
    const dp = defaults.person
    const newPw = Math.round(dp.w * personScale)
    const newPh = Math.round(dp.h * personScale)
    const newPx = dp.x + personOffX
    const newPy = (dp.y + dp.h) - newPh + personOffY  // bottom-anchor then shift
    ctx.drawImage(personImg, newPx, newPy, newPw, newPh)

    // Logo — scale from default size, keep centred on its default centre point
    const dl = defaults.logo
    const newLw = Math.round(dl.w * logoScale)
    const newLh = Math.round(dl.h * logoScale)
    const centreLx = dl.x + dl.w / 2
    const centreLy = dl.y + dl.h / 2
    const newLx = Math.round(centreLx - newLw / 2 + logoOffX)
    const newLy = Math.round(centreLy - newLh / 2 + logoOffY)
    ctx.drawImage(logoImg, newLx, newLy, newLw, newLh)
  }

  personImg.onload = () => { loaded++; draw() }
  logoImg.onload   = () => { loaded++; draw() }
  personImg.src    = personDataUrl
  logoImg.src      = logoDataUrl

  // Wire up sliders
  const sliderDefs = [
    ['#adj-ps', '#adj-ps-val', v => { personScale = v / 100 }, v => `${v}%`],
    ['#adj-px', '#adj-px-val', v => { personOffX  = v       }, v => v >= 0 ? `+${v}` : `${v}`],
    ['#adj-py', '#adj-py-val', v => { personOffY  = v       }, v => v >= 0 ? `+${v}` : `${v}`],
    ['#adj-ls', '#adj-ls-val', v => { logoScale   = v / 100 }, v => `${v}%`],
    ['#adj-lx', '#adj-lx-val', v => { logoOffX    = v       }, v => v >= 0 ? `+${v}` : `${v}`],
    ['#adj-ly', '#adj-ly-val', v => { logoOffY    = v       }, v => v >= 0 ? `+${v}` : `${v}`],
  ]
  sliderDefs.forEach(([inputSel, labelSel, setter, fmt]) => {
    const input = overlay.querySelector(inputSel)
    const label = overlay.querySelector(labelSel)
    syncFill(input)   // set initial fill position
    input.addEventListener('input', () => {
      const v = parseInt(input.value, 10)
      label.textContent = fmt(v)
      setter(v)
      syncFill(input)
      draw()
    })
  })

  // BG colour buttons
  overlay.querySelectorAll('.adj-bg-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      currentBg = btn.dataset.color
      overlay.querySelectorAll('.adj-bg-btn').forEach(b => {
        b.style.borderColor = b === btn ? 'var(--pink)' : 'transparent'
      })
      draw()
    })
  })

  // Close / back
  overlay.querySelector('#adj-close').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
  overlay.querySelector('#adj-back').addEventListener('click', () => {
    overlay.remove()
    showTalkDataForm(blogMeta, csvRows, currentIndex)
  })

  // Use this → export canvas as PNG and proceed to result screen
  overlay.querySelector('#adj-use').addEventListener('click', () => {
    const finalDataUrl = canvas.toDataURL('image/png')
    overlay.remove()
    showThumbnailResult(blogMeta, finalDataUrl, csvRows, currentIndex, null, 0, null)
  })
}

// ── Image resize helper ───────────────────────────────────────────────────────
// Scales an image File down so neither dimension exceeds maxPx, returns a Blob
function resizeImageFile(file, maxPx = 1000) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)
    img.onload = () => {
      URL.revokeObjectURL(url)
      let { width: w, height: h } = img
      if (w <= maxPx && h <= maxPx) {
        // Already small enough — return original as blob
        resolve(file)
        return
      }
      const scale = maxPx / Math.max(w, h)
      w = Math.round(w * scale)
      h = Math.round(h * scale)
      const canvas = document.createElement('canvas')
      canvas.width = w; canvas.height = h
      canvas.getContext('2d').drawImage(img, 0, 0, w, h)
      canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Resize failed')), 'image/jpeg', 0.92)
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read image')) }
    img.src = url
  })
}

// ── Talk data to me ───────────────────────────────────────────────────────────
function showTalkDataForm(blogMeta, csvRows, currentIndex) {
  const _mount = (_root && document.contains(_root)) ? _root : document.body
  const overlay = document.createElement('div')
  overlay.className = 'blog-form-overlay tmpl-picker-overlay'
  overlay.innerHTML = `
    <div class="tmpl-picker-modal blog-form-modal">
      <div class="tmpl-picker-header">
        <div>
          <h2 class="tmpl-picker-title">Talk data to me</h2>
          <p class="tmpl-picker-subtitle">${escHtml(blogMeta.title)}</p>
        </div>
        <button class="tmpl-picker-close" id="talk-close">${lucideSVG('x', 16, 'currentColor')}</button>
      </div>
      <div class="blog-form" style="gap:16px">
        <div id="talk-error" class="blog-form-error" style="display:none"></div>

        <div class="blog-form-field">
          <label class="blog-form-label">Person photo <span class="blog-form-required">*</span></label>
          <p class="blog-form-hint-text">Photo of a person facing the camera. Background will be removed automatically.</p>
          <input class="blog-form-input" id="talk-person" type="file" accept="image/*" style="padding:8px" />
        </div>

        <div class="blog-form-field">
          <label class="blog-form-label">Company logo <span class="blog-form-required">*</span></label>
          <p class="blog-form-hint-text" style="color:#f59e0b">
            ${lucideSVG('alert-triangle', 12, 'currentColor')} Logo must be full white. Any background will be removed automatically.
          </p>
          <input class="blog-form-input" id="talk-logo" type="file" accept="image/*,image/svg+xml,.svg" style="padding:8px" />
        </div>

        <div class="blog-form-actions" style="margin-top:8px">
          <button class="blog-form-cancel" id="talk-cancel">Cancel</button>
          <button class="blog-form-submit" id="talk-generate">
            ${lucideSVG('image', 14, 'currentColor')} Generate thumbnail
          </button>
        </div>
      </div>
    </div>
  `
  _mount.appendChild(overlay)
  overlay.querySelector('#talk-close').addEventListener('click',  () => overlay.remove())
  overlay.querySelector('#talk-cancel').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

  // Generate
  overlay.querySelector('#talk-generate').addEventListener('click', async () => {
    const personFile = overlay.querySelector('#talk-person').files[0]
    const logoFile   = overlay.querySelector('#talk-logo').files[0]
    const errEl      = overlay.querySelector('#talk-error')

    errEl.style.display = 'none'
    if (!personFile) { errEl.textContent = 'Please upload a person photo.'; errEl.style.display = 'block'; return }
    if (!logoFile)   { errEl.textContent = 'Please upload a company logo.';  errEl.style.display = 'block'; return }

    const btn = overlay.querySelector('#talk-generate')
    btn.disabled = true
    btn.innerHTML = `${spinnerHTML()} Removing backgrounds…`

    try {
      // Resize both files to max 1000px wide/tall before uploading — keeps
      // payloads small and avoids remove.bg resolution limits / Render timeouts
      const [personBlob, logoBlob] = await Promise.all([
        resizeImageFile(personFile, 1000),
        resizeImageFile(logoFile,   1000),
      ])

      const formData = new FormData()
      formData.append('person',  personBlob, personFile.name)
      formData.append('logo',    logoBlob,   logoFile.name)
      formData.append('bgColor', 'black')

      const res  = await apiUpload('/api/thumbnail/talkdata', formData)
      const data = await res.json()
      if (!res.ok || data.error) throw new Error(data.error || `HTTP ${res.status}`)

      overlay.remove()
      showTalkDataAdjust(blogMeta, data.personImage, data.logoImage, data.defaults, csvRows, currentIndex)
    } catch (err) {
      errEl.textContent = err.message || 'Generation failed — try again'
      errEl.style.display = 'block'
      btn.disabled = false
      btn.innerHTML = `${lucideSVG('image', 14, 'currentColor')} Generate thumbnail`
    }
  })
}

async function onNewTemplate(typeId = 'blog-thumbnail', blogMeta = null) {
  const tmplType = TEMPLATE_TYPES.find(t => t.id === typeId) || TEMPLATE_TYPES[0]

  // Both hero block types use the same illustration — apply to either
  const usesHero = typeId === 'insight-report' || typeId === 'infographic'
  // Use whatever illustration URL is already cached — no network wait
  const cachedImageUrl = usesHero ? _getCachedIllustrationUrl() : ''
  // If cache is cold, use sentinel so the editor shows a loading placeholder
  const initImageUrl   = cachedImageUrl || (usesHero ? '__loading__' : '')

  // Stamp fresh IDs once — reuse same block objects for init + final
  const baseBlocks = JSON.parse(JSON.stringify(tmplType.blocks)).map(b => ({
    ...b,
    id: makeId()
  }))

  // Patch image into whichever hero block type is present
  const patchImage = (blist, imageUrl) => blist.map(b => ({
    ...b,
    ...((b.type === 'abx-header' || b.type === 'infographic-hero') ? { image: imageUrl } : {})
  }))

  const tempId     = 'pending-' + makeId()
  const initBlocks = patchImage(baseBlocks, initImageUrl)

  // Fetch user profile for author stamping (non-blocking — fire and continue)
  const user = await _getDashUser()

  // Use blog title as template name if provided
  const templateName = (blogMeta?.title) || 'Untitled'

  // Store inline so renderApp can apply instantly — no API round-trip needed
  window._pendingNewTemplate = {
    tempId,
    name:          templateName,
    template_type: tmplType.id,
    folder_id:     _activeFolderId || null,
    doc: { filename: 'untitled.pdf', docAuthor: user.name, docAuthorAvatar: user.avatarUrl, blocks: initBlocks, blogMeta: blogMeta || {} }
  }

  // Navigate immediately — editor UI appears at once
  _navigate(`/editor/${tempId}`)

  // Background: get best illustration + persist to DB
  ;(async () => {
    try {
      const svgUrl      = await _fetchIllustrationUrl()
      const finalImage  = svgUrl || cachedImageUrl || ''
      const finalBlocks = patchImage(baseBlocks, finalImage)

      const data = await apiFetch('/api/templates', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:          templateName,
          status:        'draft',
          folder_id:     _activeFolderId || null,
          template_type: tmplType.id,
          doc: { filename: 'untitled.pdf', docAuthor: user.name, docAuthorAvatar: user.avatarUrl, blocks: finalBlocks, blogMeta: blogMeta || {} }
        })
      })

      // Tell the editor its real DB id + final blocks (with best illustration)
      window.dispatchEvent(new CustomEvent('template-persisted', {
        detail: { tempId, realId: data.id, blocks: finalBlocks }
      }))
    } catch {
      showToast('Failed to save template — check connection', 'error')
    }
  })()
}

function onNewFolder() {
  // Replace the "+ New folder" button with an inline input
  const addBtn = _root.querySelector('#dash-new-folder')
  if (!addBtn || addBtn.classList.contains('editing')) return
  addBtn.classList.add('editing')

  const input = document.createElement('input')
  input.className = 'dash-folder-inline-input'
  input.placeholder = 'Folder name…'
  addBtn.replaceWith(input)
  input.focus()

  async function commit() {
    const name = input.value.trim()
    input.remove()
    refreshGrid() // restores the button
    if (!name) return
    try {
      const folder = await apiFetch('/api/folders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      _folders.push(folder)
      refreshGrid()
      showToast(`Folder "${name}" created`)
    } catch (e) {
      showToast('Failed to create folder', 'error')
    }
  }

  input.addEventListener('keydown', e => {
    if (e.key === 'Enter')  commit()
    if (e.key === 'Escape') { input.remove(); refreshGrid() }
  })
  input.addEventListener('blur', commit)
}

function onFolderFilter(e) {
  const btn = e.currentTarget
  const id = btn.dataset.folderId || null
  _activeFolderId = id || null
  refreshGrid()
}

function onRenameFolder(e) {
  e.stopPropagation()
  const fid = e.currentTarget.dataset.folderId
  const folder = _folders.find(f => f.id === fid)
  if (!folder) return

  // Replace the label span with an inline input
  const btn = _root.querySelector(`.dash-folder-btn[data-folder-id="${fid}"]`)
  if (!btn) return
  const labelEl = btn.querySelector('.dash-folder-label')
  const input = document.createElement('input')
  input.className = 'dash-folder-inline-input'
  input.value = folder.name
  labelEl.replaceWith(input)
  input.focus()
  input.select()

  async function commit() {
    const name = input.value.trim()
    if (!name || name === folder.name) { refreshGrid(); return }
    try {
      await apiFetch(`/api/folders/${fid}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name })
      })
      folder.name = name
      showToast('Folder renamed')
    } catch (err) {
      showToast('Failed to rename folder', 'error')
    }
    refreshGrid()
  }

  input.addEventListener('keydown', ev => {
    if (ev.key === 'Enter')  { ev.preventDefault(); commit() }
    if (ev.key === 'Escape') refreshGrid()
  })
  input.addEventListener('blur', commit)
}

async function onDeleteFolder(e) {
  e.stopPropagation()
  const fid = e.currentTarget.dataset.folderId
  const folder = _folders.find(f => f.id === fid)
  if (!folder) return

  // Show confirmation modal requiring the user to type the folder name
  const confirmed = await showDeleteFolderModal(folder.name)
  if (!confirmed) return

  try {
    await apiFetch(`/api/folders/${fid}`, { method: 'DELETE' })
    _folders = _folders.filter(f => f.id !== fid)
    _templates.forEach(t => { if (t.folder_id === fid) t.folder_id = null })
    if (_activeFolderId === fid) _activeFolderId = null
    refreshGrid()
  } catch (e) {
    showToast('Failed to delete folder', 'error')
  }
}

function showDeleteFolderModal(folderName) {
  return new Promise(resolve => {
    // Remove any existing modal
    document.querySelector('.del-folder-modal-overlay')?.remove()

    const overlay = document.createElement('div')
    overlay.className = 'del-folder-modal-overlay'
    overlay.innerHTML = `
      <div class="del-folder-modal">
        <div class="del-folder-modal-icon">${lucideSVG('trash-2', 22, '#FF0077')}</div>
        <h3 class="del-folder-modal-title">Delete folder</h3>
        <p class="del-folder-modal-body">
          This will permanently delete <strong>"${escHtml(folderName)}"</strong> and move all its templates to <em>All</em>.<br>
          Type the folder name to confirm.
        </p>
        <input class="del-folder-modal-input field-input" type="text" placeholder="${escHtml(folderName)}" autocomplete="off" />
        <div class="del-folder-modal-actions">
          <button class="btn btn-ghost del-folder-cancel">Cancel</button>
          <button class="btn del-folder-confirm" disabled>Delete folder</button>
        </div>
      </div>`

    document.body.appendChild(overlay)

    const input   = overlay.querySelector('.del-folder-modal-input')
    const confirm = overlay.querySelector('.del-folder-confirm')
    const cancel  = overlay.querySelector('.del-folder-cancel')

    input.focus()

    input.addEventListener('input', () => {
      const match = input.value.trim() === folderName
      confirm.disabled = !match
    })

    const close = (result) => {
      overlay.remove()
      resolve(result)
    }

    confirm.addEventListener('click', () => close(true))
    cancel.addEventListener('click',  () => close(false))
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(false) })
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(false) })
  })
}

async function onCardAction(e) {
  const btn = e.target.closest('[data-action]')
  if (!btn) return
  const action = btn.dataset.action
  const id     = btn.dataset.id
  const tmpl   = _templates.find(t => t.id === id)
  if (!tmpl) return

  if (action === 'open') {
    _navigate(`/editor/${id}`)
  }

  else if (action === 'rename') {
    const card = btn.closest('.tmpl-card')
    if (!card) return
    const nameEl = card.querySelector('.tmpl-card-name')
    if (!nameEl || nameEl.querySelector('input')) return  // already editing

    const current = tmpl.name
    nameEl.innerHTML = `<input class="tmpl-rename-input" value="${escHtml(current)}" />`
    const input = nameEl.querySelector('input')
    input.addEventListener('click', e => e.stopPropagation())
    input.focus()
    input.select()

    async function commitRename() {
      const newName = input.value.trim()
      if (!newName || newName === current) {
        nameEl.textContent = current
        return
      }
      nameEl.textContent = newName
      try {
        await apiFetch(`/api/templates/${id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: newName })
        })
        tmpl.name = newName
        // Update in-memory tab + live DOM tab label
        updateTabName(id, newName)
        const tabLabel = _root.querySelector(`.tb-tab[data-tab-id="${id}"] .tb-tab-name`)
        if (tabLabel) tabLabel.textContent = newName
        // Notify the editor (if open) to update its filename input
        window.dispatchEvent(new CustomEvent('template-renamed', { detail: { id, name: newName } }))
        showToast('Renamed')
      } catch (e) {
        nameEl.textContent = current
        showToast('Rename failed', 'error')
      }
    }

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur() }
      if (e.key === 'Escape') { nameEl.textContent = current }
    })
    input.addEventListener('blur', commitRename, { once: true })
  }

  else if (action === 'duplicate') {
    try {
      const full = await apiFetch(`/api/templates/${id}`)
      const data = await apiFetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name:      `${full.name} (copy)`,
          status:    'draft',
          folder_id: full.folder_id,
          doc:       full.doc,
        })
      })
      _templates.unshift(data)
      refreshGrid()
      showToast('Template duplicated')
    } catch (e) { showToast('Duplicate failed', 'error') }
  }

  else if (action === 'download-thumb') {
    btn.disabled = true
    const origIcon = btn.innerHTML
    btn.innerHTML = spinnerHTML()
    try {
      await _downloadThumbnail(tmpl)
    } catch (e) {
      showToast(`Download failed: ${e.message}`, 'error')
    }
    btn.disabled = false
    btn.innerHTML = origIcon
  }

  else if (action === 'delete') {
    const confirmed = await confirmModal('Are you sure you want to delete this?')
    if (!confirmed) return
    try {
      await apiFetch(`/api/templates/${id}`, { method: 'DELETE' })
      _templates = _templates.filter(t => t.id !== id)
      refreshGrid()
      showToast('Deleted')
    } catch (e) { showToast('Delete failed', 'error') }
  }

  else if (action === 'copy-to-mine') {
    try {
      showToast('Making a copy…')
      const copy = await apiFetch(`/api/templates/${id}/copy`, { method: 'POST' })
      _templates.unshift({
        ...copy,
        doc_author:        _dashUser?.name      || '',
        doc_author_avatar: _dashUser?.avatarUrl || '',
      })
      refreshGrid()
      showToast('Copy added to your files')
      _navigate(`/editor/${copy.id}`)
    } catch (e) { showToast('Copy failed', 'error') }
  }
}

function onCardOpen(e) {
  // Open on clicking card body (not action buttons or rename input)
  const card = e.target.closest('.tmpl-card')
  if (!card) return
  if (e.target.closest('.tmpl-card-actions')) return
  if (e.target.closest('.tmpl-rename-input')) return
  const id   = card.dataset.id
  const type = card.dataset.type
  if (!id) return

  // Blog thumbnails open a download dialog — they have no editor page
  if (type === 'blog-thumbnail') {
    const tmpl = _templates.find(t => t.id === id)
    if (!tmpl) return
    _showBlogThumbnailCardDialog(tmpl)
    return
  }

  _navigate(`/editor/${id}`)
}

/** Download a saved blog thumbnail.
 *  Priority: composedUrl (Storage) → recompose from sourceUrl → previewUrl fallback.
 *  Always forces a file-save dialog by fetching cross-origin URLs as blobs first.
 */
async function _downloadThumbnail(tmpl) {
  const composedUrl  = tmpl.doc_composed_url || ''
  const sourceUrl    = tmpl.doc_source_url   || ''
  const previewUrl   = tmpl.doc_image_url    || ''
  const adjustParams = tmpl.doc_adjust_params || null
  const safeTitle    = (tmpl.name || 'thumbnail').replace(/[^a-z0-9]/gi, '_').toLowerCase()

  let href = null
  let mimeType = 'image/png'

  if (composedUrl) {
    // Best path: full-res PNG from Supabase Storage — fetch as blob to force save dialog
    const resp = await fetch(composedUrl)
    if (!resp.ok) throw new Error(`Storage fetch failed: ${resp.status}`)
    href = URL.createObjectURL(await resp.blob())
  } else if (sourceUrl && sourceUrl.startsWith('http')) {
    // Legacy: recompose from original Pexels/Unsplash URL using saved crop params
    const res = await apiFetch('/api/thumbnail/compose', {
      method: 'POST',
      body: JSON.stringify({
        imageUrl: sourceUrl,
        scale:    adjustParams?.scale   ?? 1.0,
        offsetX:  adjustParams?.offsetX ?? 0,
        offsetY:  adjustParams?.offsetY ?? 0,
      })
    })
    if (res.error) throw new Error(res.error)
    // data: URL — convert to blob so browser shows save dialog
    const blob = await fetch(res.image).then(r => r.blob())
    href = URL.createObjectURL(blob)
  } else {
    // No full-res source available (Talk data thumbnails saved before Storage was wired up,
    // or a storage upload that failed silently). Can't reconstruct 1200×700 here.
    throw new Error(
      'Full-resolution image not available for this card. ' +
      'Re-generate the thumbnail and download directly from the result screen, ' +
      'or re-save it to create a fresh high-res copy.'
    )
  }

  if (!href) throw new Error('No image available to download')

  const a = document.createElement('a')
  a.href     = href
  a.download = `${safeTitle}_thumbnail.png`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)

  // Revoke blob URL after a short delay to free memory
  if (href.startsWith('blob:')) setTimeout(() => URL.revokeObjectURL(href), 10_000)
}

function _showBlogThumbnailCardDialog(tmpl) {
  const _mount   = (_root && document.contains(_root)) ? _root : document.body
  const imageUrl = tmpl.doc_image_url || ''  // preview for display only

  const overlay = document.createElement('div')
  overlay.className = 'blog-form-overlay tmpl-picker-overlay'
  overlay.innerHTML = `
    <div class="tmpl-picker-modal thumb-result-modal">
      <div class="tmpl-picker-header">
        <div>
          <h2 class="tmpl-picker-title">${escHtml(tmpl.name)}</h2>
          <p class="tmpl-picker-subtitle">Blog Thumbnail · ${formatDate(tmpl.updated_at)}</p>
        </div>
        <button class="tmpl-picker-close" id="thumb-card-close">${lucideSVG('x', 16, 'currentColor')}</button>
      </div>
      <div class="thumb-result-preview">
        ${imageUrl
          ? `<img src="${escHtml(imageUrl)}" alt="Thumbnail" class="thumb-result-img" />`
          : `<div style="display:flex;align-items:center;justify-content:center;height:200px;color:#64748B">No preview available</div>`}
      </div>
      <div class="thumb-picker-actions">
        <button class="blog-form-cancel" id="thumb-card-close2">${lucideSVG('x', 14, 'currentColor')} Close</button>
        ${imageUrl ? `
          <button class="blog-form-submit" id="thumb-card-download">
            ${lucideSVG('download', 14, 'currentColor')} Download PNG
          </button>` : ''}
      </div>
    </div>
  `
  _mount.appendChild(overlay)
  overlay.querySelector('#thumb-card-close').addEventListener('click',  () => overlay.remove())
  overlay.querySelector('#thumb-card-close2').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })

  overlay.querySelector('#thumb-card-download')?.addEventListener('click', async (e) => {
    const btn = e.currentTarget
    btn.disabled = true
    btn.innerHTML = `${spinnerHTML()} Downloading…`
    try {
      await _downloadThumbnail(tmpl)
    } catch (err) {
      showToast(`Download failed: ${err.message}`, 'error')
    }
    btn.disabled = false
    btn.innerHTML = `${lucideSVG('download', 14, 'currentColor')} Download PNG`
  })
}

async function moveTemplateToFolder(templateId, folderId) {
  const tmpl = _templates.find(t => t.id === templateId)
  if (!tmpl) return
  try {
    await apiFetch(`/api/templates/${templateId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ folder_id: folderId })
    })
    tmpl.folder_id = folderId
    refreshGrid()
    const folderName = folderId ? getFolderName(folderId) : 'All files'
    showToast(`Moved to "${folderName}"`)
  } catch (e) { showToast('Move failed', 'error') }
}

function _onDragStart(e) {
  const card = e.target.closest('.tmpl-card[draggable]')
  if (!card) return
  e.dataTransfer.setData('text/plain', card.dataset.id)
  e.dataTransfer.effectAllowed = 'move'
  card.classList.add('dragging')
}
function _onDragEnd(e) {
  e.target.closest('.tmpl-card')?.classList.remove('dragging')
}

function bindCardEvents() {
  const content = _root.querySelector('#dash-content')
  if (!content) return
  // Remove before adding — prevents accumulation across refreshGrid() calls
  content.removeEventListener('click', onCardOpen)
  content.removeEventListener('click', onCardAction)
  content.removeEventListener('dragstart', _onDragStart)
  content.removeEventListener('dragend', _onDragEnd)
  content.addEventListener('click', onCardOpen)
  content.addEventListener('click', onCardAction)
  content.addEventListener('dragstart', _onDragStart)
  content.addEventListener('dragend', _onDragEnd)
}

function bindFolderDropTargets() {
  _root.querySelectorAll('[data-drop-folder]').forEach(el => {
    el.addEventListener('dragover', e => {
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      el.classList.add('drag-over')
    })
    el.addEventListener('dragleave', () => el.classList.remove('drag-over'))
    el.addEventListener('drop', async e => {
      e.preventDefault()
      el.classList.remove('drag-over')
      const templateId = e.dataTransfer.getData('text/plain')
      const folderId   = el.dataset.dropFolder || null
      if (templateId) await moveTemplateToFolder(templateId, folderId || null)
    })
  })

  // Also allow dropping onto "All folders" to remove from folder
  const allBtn = _root.querySelector('.dash-filter-btn[data-folder-id=""]')
  if (allBtn) {
    allBtn.addEventListener('dragover', e => { e.preventDefault(); allBtn.classList.add('drag-over') })
    allBtn.addEventListener('dragleave', () => allBtn.classList.remove('drag-over'))
    allBtn.addEventListener('drop', async e => {
      e.preventDefault()
      allBtn.classList.remove('drag-over')
      const templateId = e.dataTransfer.getData('text/plain')
      if (templateId) await moveTemplateToFolder(templateId, null)
    })
  }
}

// ── Settings view ─────────────────────────────────────────────────────────────

function settingsHTML() {
  return `
    <div class="settings-view">
      <h2 class="settings-title">Settings</h2>
      <div class="settings-cards">

        <div class="settings-card" id="settings-brand-card">
          <div class="settings-card-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/><path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20"/><path d="M2 12h20"/>
            </svg>
          </div>
          <div class="settings-card-body">
            <div class="settings-card-title">Brand</div>
            <div class="settings-card-desc">Colours, typography, tone of voice and data viz palette.</div>
          </div>
          <div class="settings-card-arrow">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>


        <div class="settings-card" id="settings-signout-card">
          <div class="settings-card-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
            </svg>
          </div>
          <div class="settings-card-body">
            <div class="settings-card-title">Sign out</div>
            <div class="settings-card-desc">Sign out of your GWI workspace.</div>
          </div>
          <div class="settings-card-arrow">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>

        <div class="settings-card" id="settings-studio-card" data-href="https://form.asana.com/?k=IhJ5evuZfLbryH5cr_4wgQ&d=149651404743580">
          <div class="settings-card-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4L16.5 3.5z"/>
            </svg>
          </div>
          <div class="settings-card-body">
            <div class="settings-card-title">Request a studio service</div>
            <div class="settings-card-desc">Get help from the design studio — custom reports, templates, and more.</div>
          </div>
          <div class="settings-card-arrow">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 18 15 12 9 6"/></svg>
          </div>
        </div>

      </div>
    </div>
  `
}

// ── Illustrations settings modal ──────────────────────────────────────────────

function showIllustrationsModal() {
  const overlay = document.createElement('div')
  overlay.className = 'icon-modal-overlay'
  overlay.innerHTML = `
    <div class="icon-modal settings-illus-modal">
      <div class="icon-modal-header">
        <span class="icon-modal-title">Illustrations</span>
        <button class="icon-modal-close" title="Close">×</button>
      </div>
      <div class="settings-illus-body">
        <div class="settings-illus-toolbar">
          <button class="btn settings-illus-all">Enable all</button>
          <button class="btn settings-illus-none">Disable all</button>
          <button class="btn btn-cta settings-illus-save" style="margin-left:auto">Save</button>
        </div>
        <div class="settings-illus-list"><div class="icon-modal-status">Loading…</div></div>
      </div>
    </div>`
  document.body.appendChild(overlay)

  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
  overlay.querySelector('.icon-modal-close').addEventListener('click', () => overlay.remove())

  const list = overlay.querySelector('.settings-illus-list')
  let _allImages = []

  function renderList(images) {
    let saved
    try { saved = JSON.parse(localStorage.getItem(ILLUS_PREFS_KEY)) } catch { saved = null }
    const enabledSet = saved ? new Set(saved) : null  // null = all enabled

    // Group by category
    const cats = {}
    images.forEach(img => {
      const cat = img.category || 'Illustrations'
      if (!cats[cat]) cats[cat] = []
      cats[cat].push(img)
    })

    list.innerHTML = Object.entries(cats).map(([cat, items]) => `
      <div class="settings-illus-section">
        <div class="settings-illus-section-header">
          <span>${cat}</span>
          <span class="settings-illus-section-count">${items.length}</span>
        </div>
        <div class="settings-illus-grid">
          ${items.map(img => {
            const on = !enabledSet || enabledSet.has(img.node_id)
            return `<div class="settings-illus-item${on ? ' enabled' : ''}" data-node="${img.node_id}">
              <img src="${img.url}" alt="${img.name}" loading="lazy" />
              <span class="settings-illus-item-name">${img.name}</span>
              <button class="settings-illus-toggle" aria-label="${on ? 'Disable' : 'Enable'}" aria-pressed="${on}">
                <span class="settings-illus-toggle-track">
                  <span class="settings-illus-toggle-thumb"></span>
                </span>
              </button>
            </div>`
          }).join('')}
        </div>
      </div>`).join('')

    list.querySelectorAll('.settings-illus-toggle').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = btn.closest('.settings-illus-item')
        const on = item.classList.toggle('enabled')
        btn.setAttribute('aria-pressed', on)
        btn.setAttribute('aria-label', on ? 'Disable' : 'Enable')
      })
    })
  }

  overlay.querySelector('.settings-illus-all').addEventListener('click', () => {
    list.querySelectorAll('.settings-illus-item').forEach(el => el.classList.add('enabled'))
  })
  overlay.querySelector('.settings-illus-none').addEventListener('click', () => {
    list.querySelectorAll('.settings-illus-item').forEach(el => el.classList.remove('enabled'))
  })
  overlay.querySelector('.settings-illus-save').addEventListener('click', () => {
    const allItems = [...list.querySelectorAll('.settings-illus-item')]
    const enabled = allItems.filter(el => el.classList.contains('enabled')).map(el => el.dataset.node)
    const pref = enabled.length === allItems.length ? null : enabled
    try { localStorage.setItem(ILLUS_PREFS_KEY, JSON.stringify(pref)) } catch {}
    overlay.remove()
  })

  apiFetch('/api/figma-assets')
    .then(images => { _allImages = images; renderList(images) })
    .catch(() => {
      list.innerHTML = '<div class="icon-modal-status" style="color:#DA3441">Could not load illustrations.</div>'
    })
}

// ── Brand modal ───────────────────────────────────────────────────────────────

function showBrandModal() {
  const existing = _root.querySelector('.brand-modal-overlay')
  if (existing) { existing.remove(); return }

  const overlay = document.createElement('div')
  overlay.className = 'brand-modal-overlay'
  overlay.innerHTML = `
    <div class="brand-modal">
      <div class="brand-modal-header">
        <span class="brand-modal-title">Brand guidelines</span>
        <button class="brand-modal-close" id="brand-modal-close">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>
      <div class="brand-modal-body">
        <div class="brand-section">
          <h4>Primary colours</h4>
          ${BRAND.primary.map(c => `
            <div class="colour-row">
              <div class="colour-dot" style="background:${c.hex};${c.hex === '#FFFFFF' ? 'border:1px solid #E5EAF2' : ''}"></div>
              <span class="colour-name">${c.name}</span>
              <span class="colour-hex">${c.hex}</span>
            </div>`).join('')}
        </div>
        <div class="brand-section">
          <h4>Grey scale</h4>
          ${BRAND.greys.map(c => `
            <div class="colour-row">
              <div class="colour-dot" style="background:${c.hex};border:1px solid rgba(0,0,0,.08)"></div>
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
          <div class="type-row"><div class="type-sample" style="font-size:20px;font-weight:800;line-height:1.2">Hero</div><span class="type-spec">ExtraBold 800</span></div>
          <div class="type-row"><div class="type-sample" style="font-size:15px;font-weight:700">Section heading</div><span class="type-spec">Bold 700</span></div>
          <div class="type-row"><div class="type-sample" style="font-size:12px;font-weight:600">UI label / CTA</div><span class="type-spec">SemiBold 600</span></div>
          <div class="type-row"><div class="type-sample" style="font-size:12px;font-weight:400">Body copy — write clearly and directly.</div><span class="type-spec">Regular 400</span></div>
        </div>
        <div class="brand-section">
          <h4>Tone of voice</h4>
          <div style="font-size:12px;line-height:1.7;color:#526482">
            <p style="margin-bottom:8px"><strong style="color:#101720">Bold.</strong> Strong verbs, clear claims.</p>
            <p style="margin-bottom:8px"><strong style="color:#101720">Clear.</strong> Short sentences, plain language.</p>
            <p><strong style="color:#101720">Human.</strong> Write like one person talking to another.</p>
          </div>
        </div>
        <div class="brand-section">
          <h4>Data viz palette</h4>
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:4px">
            ${BRAND.dataViz.map(c => `<div title="${c.name}: ${c.hex}" style="width:32px;height:32px;border-radius:6px;background:${c.hex};border:1px solid rgba(0,0,0,.08)"></div>`).join('')}
          </div>
          <div style="font-size:11px;color:#7989A6;margin-top:6px">Always use in this order for charts and graphs.</div>
        </div>
      </div>
    </div>
  `
  _root.appendChild(overlay)
  overlay.querySelector('#brand-modal-close').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
}

function bindEvents() {
  _root.querySelector('#dash-new')?.addEventListener('click', showTemplatePicker)
  _root.querySelector('#dash-new-folder')?.addEventListener('click', onNewFolder)

  // Filter buttons
  _root.querySelectorAll('.dash-filter-btn[data-filter]').forEach(btn => {
    btn.addEventListener('click', () => {
      _filter = btn.dataset.filter
      // Switching top-level filter always clears the active folder
      _activeFolderId = null
      // Clear creator filter when leaving "Files across GWI"
      if (_filter !== 'all') _filterCreator = ''
      _root.querySelectorAll('.dash-filter-btn[data-filter]').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === _filter))
      // Reset folder sidebar active state to "All folders"
      _root.querySelectorAll('[data-folder-id]').forEach(b => b.classList.remove('active'))
      _root.querySelector('.dash-filter-btn[data-folder-id=""]')?.classList.add('active')
      _refreshFilterBar()
      refreshGrid()
    })
  })

  // Toolbar dropdown filters
  function _rebindFilterBar() {
    _root.querySelector('#df-month')?.addEventListener('change', e => {
      _filterMonth = e.target.value
      _refreshFilterBar()
      refreshGrid()
    })
    _root.querySelector('#df-category')?.addEventListener('change', e => {
      _filterCategory = e.target.value
      _refreshFilterBar()
      refreshGrid()
    })
    _root.querySelector('#df-creator')?.addEventListener('change', e => {
      _filterCreator = e.target.value
      _refreshFilterBar()
      refreshGrid()
    })
    _root.querySelector('#df-clear')?.addEventListener('click', () => {
      _filterMonth = ''; _filterCategory = ''; _filterCreator = ''
      _refreshFilterBar()
      refreshGrid()
    })
  }
  function _refreshFilterBar() {
    const toolbar = _root.querySelector('.dash-toolbar')
    if (!toolbar) return
    toolbar.querySelector('.dash-filter-bar')?.remove()
    const div = document.createElement('div')
    div.innerHTML = dashFilterBarHTML()
    while (div.firstChild) toolbar.appendChild(div.firstChild)
    _rebindFilterBar()
  }
  _rebindFilterBar()

  // Folder filter buttons
  _root.querySelectorAll('[data-folder-id]').forEach(el => {
    if (el.classList.contains('dash-folder-rename') || el.classList.contains('dash-folder-delete')) return
    el.addEventListener('click', onFolderFilter)
  })

  _root.querySelectorAll('.dash-folder-rename').forEach(b => b.addEventListener('click', onRenameFolder))
  _root.querySelectorAll('.dash-folder-delete').forEach(b => b.addEventListener('click', onDeleteFolder))

  // Global window listeners — registered once ever
  if (!_globalEventsRegistered) {
    _globalEventsRegistered = true
    window.addEventListener('tb-logout', async () => {
      await supabase.auth.signOut()
      window.location.href = '/'
    })
  }

  bindCardEvents()
  bindFolderDropTargets()
}

function bindSettingsEvents() {
  _root.querySelector('#settings-brand-card')?.addEventListener('click', showBrandModal)
  _root.querySelector('#settings-illustrations-card')?.addEventListener('click', showIllustrationsModal)
  _root.querySelector('#settings-studio-card')?.addEventListener('click', () => {
    const url = 'https://form.asana.com/?k=IhJ5evuZfLbryH5cr_4wgQ&d=149651404743580'
    if (window.electronAPI?.openExternal) {
      window.electronAPI.openExternal(url)
    } else {
      window.open(url, '_blank', 'noopener')
    }
  })
  _root.querySelector('#settings-signout-card')?.addEventListener('click', async () => {
    await supabase.auth.signOut()
    window.location.href = '/'
  })
}

// ── Entry point ──────────────────────────────────────────────────────────────

export async function renderDashboard(root, { navigate }) {
  _root = root
  _navigate = navigate
  _filter = 'mine'
  _activeFolderId = null
  _showSettings = false

  if (_dataLoaded) {
    // Render immediately with cached data, refresh silently in background
    renderDashboardHTML()
    loadData()
      .then(() => {
        // Only re-render if the user is still on the dashboard
        if (_root && window.location.pathname === '/dash') renderDashboardHTML()
      })
      .catch(() => {})
    return
  }

  // First load — animated loading screen
  const _loadingWords = [
    'Coalescing…','Elucidating…','Cogitating…','Combobulating…','Herding…',
    'Crafting…','Wandering…','Accomplishing…','Furling…','Ideating…',
    'Sussing…','Marinating…','Brewing…','Generating…','Crunching…',
    'Thinking…','Computing…','Shleping…','Whirring…','Reticulating…',
    'Flibbertigibbeting…','Transmuting…','Wibbling…','Jiving…','Puzzling…',
    'Mulling…','Forging…','Puttering…','Simmering…','Germinating…',
    'Actualizing…','Perusing…','Actioning…','Concocting…','Philosophising…',
    'Synthesizing…','Spelunking…','Unfurling…','Skewing…','Hatching…',
    'Deliberating…','Churning…','Effecting…','Deciphering…','Smooshing…',
    'Pontificating…','Envisaging…','Booping…',
  ]
  root.innerHTML = `
    <div class="dash-loading-screen">
      <div class="dash-loading-card">
        <div class="dash-loading-spinner"></div>
        <div class="dash-loading-word">${_loadingWords[Math.floor(Math.random() * _loadingWords.length)]}</div>
      </div>
    </div>`

  // Cycle words while data loads
  let _wordIdx = Math.floor(Math.random() * _loadingWords.length)
  const _wordEl = root.querySelector('.dash-loading-word')
  const _wordTimer = setInterval(() => {
    _wordIdx = (_wordIdx + 1 + Math.floor(Math.random() * (_loadingWords.length - 1))) % _loadingWords.length
    if (_wordEl) {
      _wordEl.classList.remove('dash-word-in')
      void _wordEl.offsetWidth // reflow to restart animation
      _wordEl.textContent = _loadingWords[_wordIdx]
      _wordEl.classList.add('dash-word-in')
    }
  }, 1400)

  // Fire illustration + icon preload in parallel while the user reads the words
  _fetchIllustrationUrl().catch(() => {})

  try {
    await loadData()
    _dataLoaded = true
  } catch (e) {
    clearInterval(_wordTimer)
    root.innerHTML = `<div style="display:flex;align-items:center;justify-content:center;height:100vh;font-family:sans-serif;color:#DA3441;font-size:14px">Could not connect to server. Is server.py running?</div>`
    return
  }
  clearInterval(_wordTimer)

  renderDashboardHTML()
}

/**
 * Preload all dashboard data in the background — call this while the login
 * animation is still showing so the dashboard renders instantly on navigate().
 * Fires templates fetch + illustration URL fetch in parallel.
 */
export async function preloadDashboard() {
  if (_dataLoaded) return
  await Promise.all([
    loadData()
      .then(() => { _dataLoaded = true })
      .catch(() => {}),
    _fetchIllustrationUrl()
      .catch(() => {}),
  ])
}

// ── Settings page (own URL: /settings) ────────────────────────────────────

export async function renderSettings(root, { navigate }) {
  _root = root
  _navigate = navigate

  root.innerHTML = `
    <div class="dashboard-shell">
      ${titlebarHTML({ isHome: false })}
      <div class="dash-body">
        <aside class="dash-sidebar">
          <div class="dash-sidebar-top">
            <button class="btn btn-outline" id="settings-back" style="width:100%;justify-content:center;gap:8px">
              ← Back to files
            </button>
          </div>
        </aside>
        <main class="dash-main">
          <div class="dash-toolbar">
            <span style="font-size:13px;font-weight:700;color:var(--navy);letter-spacing:.01em">Settings</span>
          </div>
          <div id="dash-content">
            ${settingsHTML()}
          </div>
        </main>
      </div>
    </div>
    <div class="toast"></div>
  `

  bindTitlebarEvents(root, { navigate })
  bindSettingsEvents()

  root.querySelector('#settings-back')?.addEventListener('click', () => navigate('/dash'))

  if (!_globalEventsRegistered) {
    _globalEventsRegistered = true
    window.addEventListener('tb-logout', async () => {
      await supabase.auth.signOut()
      window.location.href = '/'
    })
  }
}
