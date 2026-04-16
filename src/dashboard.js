// ABX PDF Builder — Dashboard view
import { titlebarHTML, bindTitlebarEvents, syncTabs, updateTabName } from './titlebar.js'
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
let _search = ''
let _showSettings = false    // settings panel open
let _globalEventsRegistered = false

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

import { apiFetch as _authFetch, supabase } from './supabase.js'

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
    if (_search) {
      const q = _search.toLowerCase()
      if (!t.name.toLowerCase().includes(q)) return false
    }
    return true
  })
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
  const statusClass = t.status === 'saved' ? 'tmpl-status-saved' : 'tmpl-status-draft'
  const statusLabel = t.status === 'saved' ? 'Saved' : 'Draft'
  const typeLabel = inferTemplateTypeLabel(t.block_types)
  const mine = isOwner(t)
  // Fall back to current user's profile for older docs that predate author stamping
  const authorName   = t.doc_author        || (!mine ? '' : _dashUser?.name      || '')
  const authorAvatar = t.doc_author_avatar  || (!mine ? '' : _dashUser?.avatarUrl || '')
  const authorHTML = _authorAvatarHTML(authorName, authorAvatar)
  return `
    <div class="tmpl-card${mine ? '' : ' tmpl-card--others'}" data-id="${t.id}" draggable="${mine}">
      <div class="tmpl-card-thumb">
        ${t.thumb
          ? `<img class="tmpl-card-thumb-img" src="data:image/jpeg;base64,${t.thumb}" alt="" draggable="false" />`
          : `<div class="tmpl-mini-preview">${miniPreviewHTML()}</div>`
        }
        <span class="tmpl-status-badge ${statusClass} tmpl-status-thumb">${statusLabel}</span>
        ${typeLabel ? `<div class="tmpl-card-type-badge">${typeLabel}</div>` : ''}
        ${!mine ? `<div class="tmpl-card-viewonly-badge">${lucideSVG('eye', 10, 'currentColor')} View only</div>` : ''}
      </div>
      <div class="tmpl-card-body">
        <div class="tmpl-card-name">${escHtml(t.name)}</div>
        <div class="tmpl-card-folder ${folder ? '' : 'tmpl-card-folder--unfiled'}">${lucideSVG('folder', 11, 'currentColor')} ${folder ? escHtml(folder) : 'Not filed yet'}</div>
        ${authorHTML}
        <div class="tmpl-card-date">${formatDate(t.updated_at)}</div>
      </div>
      <div class="tmpl-card-actions">
        ${mine ? `
          <button class="tmpl-action-btn" data-action="rename"    data-id="${t.id}" title="Rename">${lucideSVG('pencil', 14, 'currentColor')}</button>
          <button class="tmpl-action-btn" data-action="duplicate" data-id="${t.id}" title="Duplicate">${lucideSVG('copy', 14, 'currentColor')}</button>
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
      <h3>${_search ? 'No results found' : 'Create new asset'}</h3>
      <p>${_search ? 'Try a different search.' : 'Click "+ Create new asset" to get started.'}</p>
    </div>`
  }

  // Real cards — background refresh happens silently with no extra ghost cells
  return `<div class="dash-grid">${list.map(cardHTML).join('')}</div>`
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
            <button class="btn btn-primary" id="dash-new" style="width:100%;justify-content:center;margin-bottom:12px">+ Create new asset</button>
          </div>
          <div class="dash-sidebar-section">
            <button class="dash-filter-btn ${_filter === 'mine'  ? 'active' : ''}" data-filter="mine">My files</button>
            <button class="dash-filter-btn ${_filter === 'all'   ? 'active' : ''}" data-filter="all">All files</button>
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
            <div class="dash-search-wrap">
              <span class="dash-search-icon">${lucideSVG('search', 15, 'var(--pink)')}</span>
              <input class="dash-search" id="dash-search" placeholder="Search templates…" value="${escHtml(_search)}" />
            </div>
            <!-- Create button: mobile only (mirrors sidebar button) -->
            <button class="btn btn-primary dash-mob-create-btn" id="dash-mob-new">+ New</button>
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
]

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
  btn.innerHTML = `${lucideSVG('loader', 15, '#fff')} Querying GWI Spark…`

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
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/)
  if (lines.length < 2) return []
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/[^a-z_]/g, ''))
  const col = key => headers.findIndex(h => h.includes(key))
  const iTitle    = col('title')
  const iMeta     = col('meta')
  const iSubs     = col('sub')
  const iCategory = col('cat')
  return lines.slice(1).map(line => {
    // Handle quoted fields
    const fields = []
    let cur = '', inQ = false
    for (const ch of line) {
      if (ch === '"') { inQ = !inQ }
      else if (ch === ',' && !inQ) { fields.push(cur.trim()); cur = '' }
      else cur += ch
    }
    fields.push(cur.trim())
    return {
      title:     iTitle    >= 0 ? (fields[iTitle]    || '') : '',
      metaDesc:  iMeta     >= 0 ? (fields[iMeta]     || '') : '',
      subtitles: iSubs     >= 0 ? (fields[iSubs]     || '') : '',
      category:  iCategory >= 0 ? (fields[iCategory] || '') : '',
    }
  }).filter(r => r.title)
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
            Category <span class="blog-form-hint">(Audiences, Consumer behaviour, Digital trends, Data journalism, Talk data to me, Product, Strategy)</span>
          </label>
          <input class="blog-form-input" id="blog-category" type="text" value="${(prefill?.category || '').replace(/"/g, '&quot;')}" placeholder="e.g. Digital trends" />
        </div>

        ${!isBulk ? `
        <div class="blog-form-csv-row">
          <span class="blog-form-csv-label">Or create multiple thumbnails from a CSV file</span>
          <label class="blog-form-csv-btn">
            ${lucideSVG('upload', 14, 'currentColor')} Upload CSV
            <input type="file" id="blog-csv-input" accept=".csv" style="display:none" />
          </label>
          <a class="blog-form-csv-template" id="blog-csv-download" href="#">Download template</a>
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

  // CSV template download
  overlay.querySelector('#blog-csv-download')?.addEventListener('click', e => {
    e.preventDefault()
    const csv = 'title,meta_description,subtitles,category\n"My blog title","Meta description here","Subtitle one\nSubtitle two","Digital trends"'
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
    const btn = overlay.querySelector('#blog-form-submit')
    btn.disabled = true
    btn.innerHTML = `<span class="page-spinner" style="width:14px;height:14px;border-width:2px"></span> Generating…`
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

  const overlay = document.createElement('div')
  overlay.className = 'blog-form-overlay tmpl-picker-overlay'
  overlay.innerHTML = `
    <div class="tmpl-picker-modal thumb-picker-modal">
      <div class="tmpl-picker-header">
        <div>
          <h2 class="tmpl-picker-title">Choose your thumbnail</h2>
          <p class="tmpl-picker-subtitle">${blogMeta.title}${isBulk ? ` — ${currentIndex + 1} of ${csvRows.length}` : ''}</p>
        </div>
        <button class="tmpl-picker-close" id="thumb-picker-close">${lucideSVG('x', 16, 'currentColor')}</button>
      </div>

      <div class="thumb-picker-grid" id="thumb-picker-grid">
        ${result.options.map((opt, i) => `
          <button class="thumb-picker-card" data-url="${opt.url}" data-index="${i}">
            <img class="thumb-picker-img" src="${opt.preview || opt.url}" alt="Option ${i + 1}" loading="lazy" />
            <div class="thumb-picker-label">Option ${i + 1}</div>
          </button>
        `).join('')}
      </div>

      <div class="blog-form-error" id="thumb-picker-error" style="display:none"></div>

      <div class="thumb-picker-actions">
        <button class="blog-form-cancel" id="thumb-try-again">${lucideSVG('refresh-cw', 14, 'currentColor')} Try again</button>
        <span class="thumb-picker-hint">Select an image to compose your thumbnail</span>
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
    btn.innerHTML = `<span class="page-spinner" style="width:14px;height:14px;border-width:2px"></span> Fetching…`
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

  // Select image → compose
  overlay.querySelectorAll('.thumb-picker-card').forEach(card => {
    card.addEventListener('click', async () => {
      overlay.querySelectorAll('.thumb-picker-card').forEach(c => c.classList.remove('selected'))
      card.classList.add('selected')
      card.innerHTML = `<span class="page-spinner" style="width:24px;height:24px;border-width:3px"></span>`

      try {
        const res = await apiFetch('/api/thumbnail/compose', {
          method: 'POST',
          body: JSON.stringify({ imageUrl: card.dataset.url })
        })
        overlay.remove()
        showThumbnailResult(blogMeta, res.image, csvRows, currentIndex)
      } catch (err) {
        const errEl = overlay.querySelector('#thumb-picker-error')
        errEl.textContent = 'Failed to compose image — try another'
        errEl.style.display = 'block'
        overlay.querySelectorAll('.thumb-picker-card').forEach(c => c.classList.remove('selected'))
      }
    })
  })
}

// ── Thumbnail result (download + next) ───────────────────────────────────────
function showThumbnailResult(blogMeta, imageDataUrl, csvRows = null, currentIndex = 0) {
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
          <a class="blog-form-submit" id="thumb-result-download" href="${imageDataUrl}" download="${safeTitle}_thumbnail.png">
            ${lucideSVG('download', 14, 'currentColor')} Download PNG
          </a>
          ${hasNext ? `<button class="blog-form-submit" id="thumb-result-next" style="background:#1E3A5F">
            Next thumbnail ${lucideSVG('arrow-right', 14, 'currentColor')}
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
    // Re-generate options for this same row
    apiFetch('/api/thumbnail/generate', {
      method: 'POST', body: JSON.stringify(blogMeta)
    }).then(result => showThumbnailPicker(blogMeta, result, csvRows, currentIndex))
      .catch(() => showBlogThumbnailForm(csvRows, currentIndex))
  })

  overlay.querySelector('#thumb-result-next')?.addEventListener('click', () => {
    overlay.remove()
    showBlogThumbnailForm(csvRows, currentIndex + 1)
  })
}

// ── Talk data to me placeholder ───────────────────────────────────────────────
function showTalkDataForm(blogMeta, csvRows, currentIndex) {
  const _mount = (_root && document.contains(_root)) ? _root : document.body
  const overlay = document.createElement('div')
  overlay.className = 'blog-form-overlay tmpl-picker-overlay'
  overlay.innerHTML = `
    <div class="tmpl-picker-modal blog-form-modal">
      <div class="tmpl-picker-header">
        <div>
          <h2 class="tmpl-picker-title">Talk data to me</h2>
          <p class="tmpl-picker-subtitle">Upload the assets needed to build your thumbnail</p>
        </div>
        <button class="tmpl-picker-close" id="talk-close">${lucideSVG('x', 16, 'currentColor')}</button>
      </div>
      <div class="blog-form" style="gap:16px">
        <p style="color:#94A3B8;font-size:14px;line-height:1.6">
          The <strong style="color:#E2E8F0">Talk data to me</strong> thumbnail requires a photo of a person (looking at the camera) and a company logo. The background will be black or pink.
        </p>
        <div class="blog-form-field">
          <label class="blog-form-label">Person photo</label>
          <input class="blog-form-input" id="talk-person" type="file" accept="image/*" style="padding:8px" />
        </div>
        <div class="blog-form-field">
          <label class="blog-form-label">Company logo</label>
          <input class="blog-form-input" id="talk-logo" type="file" accept="image/*" style="padding:8px" />
        </div>
        <div class="blog-form-field">
          <label class="blog-form-label">Background colour</label>
          <div style="display:flex;gap:12px;margin-top:4px">
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#E2E8F0;font-size:14px">
              <input type="radio" name="talk-bg" value="black" checked /> Black
            </label>
            <label style="display:flex;align-items:center;gap:8px;cursor:pointer;color:#E2E8F0;font-size:14px">
              <input type="radio" name="talk-bg" value="pink" /> Pink (#FF0077)
            </label>
          </div>
        </div>
        <div class="blog-form-actions" style="margin-top:8px">
          <button class="blog-form-cancel" id="talk-cancel">Cancel</button>
          <button class="blog-form-submit" disabled style="opacity:0.5;cursor:not-allowed">
            ${lucideSVG('clock', 14, 'currentColor')} Coming soon
          </button>
        </div>
      </div>
    </div>
  `
  _mount.appendChild(overlay)
  overlay.querySelector('#talk-close').addEventListener('click', () => overlay.remove())
  overlay.querySelector('#talk-cancel').addEventListener('click', () => overlay.remove())
  overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove() })
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

  else if (action === 'delete') {
    if (!confirm(`Delete "${tmpl.name}"?`)) return
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
  const id = card.dataset.id
  if (id) _navigate(`/editor/${id}`)
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

        <div class="settings-card" id="settings-illustrations-card">
          <div class="settings-card-icon">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/>
            </svg>
          </div>
          <div class="settings-card-body">
            <div class="settings-card-title">Illustrations</div>
            <div class="settings-card-desc">Choose which illustration libraries appear in the image picker.</div>
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
      _root.querySelectorAll('.dash-filter-btn[data-filter]').forEach(b =>
        b.classList.toggle('active', b.dataset.filter === _filter))
      // Reset folder sidebar active state to "All folders"
      _root.querySelectorAll('[data-folder-id]').forEach(b => b.classList.remove('active'))
      _root.querySelector('.dash-filter-btn[data-folder-id=""]')?.classList.add('active')
      refreshGrid()
    })
  })

  // Folder filter buttons
  _root.querySelectorAll('[data-folder-id]').forEach(el => {
    if (el.classList.contains('dash-folder-rename') || el.classList.contains('dash-folder-delete')) return
    el.addEventListener('click', onFolderFilter)
  })

  _root.querySelectorAll('.dash-folder-rename').forEach(b => b.addEventListener('click', onRenameFolder))
  _root.querySelectorAll('.dash-folder-delete').forEach(b => b.addEventListener('click', onDeleteFolder))

  // Search
  _root.querySelector('#dash-search')?.addEventListener('input', e => {
    _search = e.target.value
    refreshGrid()
  })

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
  _search = ''
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
