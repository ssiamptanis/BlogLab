// ── Shared titlebar — tab state + HTML + events ───────────────────────────
import logoUrl from '../assets/gwi-logo-on-black.svg?url'

const _tabs = []  // [{ id, name }]

export function getTabs()            { return _tabs }
export function getTab(id)           { return _tabs.find(t => t.id === id) }

export function addTab(id, name) {
  if (!_tabs.find(t => t.id === id)) _tabs.push({ id, name: name || 'Untitled' })
}

export function updateTabName(id, name) {
  const t = _tabs.find(t => t.id === id)
  if (t) t.name = name
}

// Swap a pending/temp id for the real DB id (keeps name, preserves order)
export function replaceTabId(oldId, newId) {
  const t = _tabs.find(t => t.id === oldId)
  if (t) t.id = newId
}

export function closeTab(id) {
  const idx = _tabs.findIndex(t => t.id === id)
  if (idx === -1) return null
  _tabs.splice(idx, 1)
  if (_tabs.length === 0) return null                         // → go home
  return _tabs[Math.min(idx, _tabs.length - 1)].id          // → adjacent tab
}

// Remove any tabs whose IDs are not in the provided set of valid template IDs
export function syncTabs(validIds) {
  const valid = new Set(validIds)
  for (let i = _tabs.length - 1; i >= 0; i--) {
    if (!valid.has(_tabs[i].id)) _tabs.splice(i, 1)
  }
}

function _esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

function _getSessionAvatar() {
  try {
    // Supabase stores session under sb-{project_ref}-auth-token
    const keys = Object.keys(localStorage).filter(k => k.startsWith('sb-') && k.endsWith('-auth-token'))
    for (const k of keys) {
      const s = JSON.parse(localStorage.getItem(k) || '{}')
      const meta = s?.user?.user_metadata || s?.session?.user?.user_metadata
      if (meta?.avatar_url) return { avatar: meta.avatar_url, name: meta.full_name || meta.name || '' }
    }
  } catch {}
  return { avatar: '', name: '' }
}

// ── HTML ─────────────────────────────────────────────────────────────────────

export function titlebarHTML({ activeTabId = null, currentName = '', isHome = false } = {}) {
  const { avatar, name } = _getSessionAvatar()
  const tabsHTML = _tabs.map(tab => `
    <div class="tb-tab${tab.id === activeTabId ? ' active' : ''}" data-tab-id="${tab.id}" style="-webkit-app-region:no-drag">
      <svg class="tb-tab-icon" width="11" height="13" viewBox="0 0 12 14" fill="none">
        <path d="M1 1h7l3 3v9H1V1z" stroke="currentColor" stroke-width="1.2" fill="none"/>
        <path d="M8 1v3h3" stroke="currentColor" stroke-width="1.2" fill="none"/>
      </svg>
      <span class="tb-tab-name">${_esc(tab.name)}</span>
      <button class="tb-tab-close" data-close-id="${tab.id}" title="Close">×</button>
    </div>`).join('')

  return `
    <header class="app-titlebar">
      <div class="tb-traffic">
        <a href="/dash" style="-webkit-app-region:no-drag;display:flex;align-items:center;">
          <img class="tb-logo" src="${logoUrl}" alt="GWI" />
        </a>
      </div>

      <a href="/dash" class="tb-home${isHome ? ' active' : ''}" title="Dashboard" style="-webkit-app-region:no-drag">
        <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
          <path d="M6.5 14.5v-4h3v4H13V8h2L8 1.5 1 8h2v6.5z" fill="currentColor"/>
        </svg>
      </a>

      <div class="tb-tabs" style="-webkit-app-region:no-drag">
        ${tabsHTML}
        <button class="tb-new-tab" id="tb-new-tab" title="New file" style="-webkit-app-region:no-drag">
          <svg width="11" height="11" viewBox="0 0 12 12" fill="none">
            <path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </button>
      </div>

      <div class="tb-filename" style="-webkit-app-region:no-drag;display:none">
        <input class="tb-filename-input" value="${_esc(currentName)}" spellcheck="false" title="Rename template" />
        <span class="tb-filename-arrow">▾</span>
      </div>

      <div class="tb-right" style="-webkit-app-region:no-drag">

        <div class="tb-user-wrap">
          <button class="tb-user-btn" id="tb-user-btn" title="${_esc(name)}">
            ${name ? `<span class="tb-user-name">${_esc(name.split(' ')[0])}</span>` : ''}
            ${avatar
              ? `<img class="tb-avatar" src="${_esc(avatar)}" alt="${_esc(name)}" />`
              : `<div class="tb-avatar tb-avatar-placeholder">${name ? _esc(name[0].toUpperCase()) : '?'}</div>`
            }
            <svg class="tb-user-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"/></svg>
          </button>
          <div class="tb-user-dropdown" id="tb-user-dropdown" hidden>
            <button class="tb-dropdown-item" id="tb-dd-settings">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>
              Settings
            </button>
            <button class="tb-dropdown-item" id="tb-dd-feedback">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>
              Feedback
            </button>
            <div class="tb-dropdown-divider"></div>
            <button class="tb-dropdown-item tb-dropdown-item--danger" id="tb-dd-logout">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
              Log out
            </button>
          </div>
        </div>
      </div>
    </header>`
}

// ── Events ────────────────────────────────────────────────────────────────────

export function bindTitlebarEvents(root, { navigate, onRename } = {}) {
  const bar = root.querySelector('.app-titlebar')
  if (!bar) return

  // Home button
  bar.querySelector('.tb-home')?.addEventListener('click', (e) => {
    e.preventDefault()
    navigate?.('/dash')
  })

  // Tab clicks + double-click to rename
  bar.querySelectorAll('.tb-tab').forEach(tab => {
    // Single click — navigate; suppress if part of a double-click
    tab.addEventListener('click', (e) => {
      if (e.target.closest('.tb-tab-close')) return
      if (e.detail >= 2) return   // double-click handled separately
      navigate?.(`/editor/${tab.dataset.tabId}`)
    })

    // Double-click — inline rename
    tab.addEventListener('dblclick', (e) => {
      if (e.target.closest('.tb-tab-close')) return
      const nameSpan = tab.querySelector('.tb-tab-name')
      if (!nameSpan) return

      const original = nameSpan.textContent
      const input = document.createElement('input')
      input.className = 'tb-tab-rename-input'
      input.value = original
      nameSpan.replaceWith(input)
      input.focus()
      input.select()

      function commit() {
        const newName = input.value.trim() || original
        const span = document.createElement('span')
        span.className = 'tb-tab-name'
        span.textContent = newName
        input.replaceWith(span)
        // Sync → centre filename field
        const filenameInput = bar.querySelector('.tb-filename-input')
        if (filenameInput) { filenameInput.value = newName; filenameInput.defaultValue = newName }
        onRename?.(newName)
      }

      input.addEventListener('blur', commit)
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter')  { e.preventDefault(); input.blur() }
        if (e.key === 'Escape') { input.value = original; input.blur() }
      })
    })
  })

  // Tab close
  bar.querySelectorAll('.tb-tab-close').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation()
      const id     = btn.dataset.closeId
      const nextId = closeTab(id)
      if (nextId) navigate?.(`/editor/${nextId}`)
      else        navigate?.('/dash')
    })
  })

  // New file (+) button — show template picker wherever the user currently is
  bar.querySelector('#tb-new-tab')?.addEventListener('click', () => {
    window.dispatchEvent(new CustomEvent('show-template-picker'))
  })

  // User menu button — toggle dropdown
  const userBtn = bar.querySelector('#tb-user-btn')
  const dropdown = bar.querySelector('#tb-user-dropdown')
  if (userBtn && dropdown) {
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation()
      const isOpen = !dropdown.hidden
      dropdown.hidden = isOpen
      userBtn.classList.toggle('active', !isOpen)
    })

    // Close on outside click
    document.addEventListener('click', () => {
      dropdown.hidden = true
      userBtn.classList.remove('active')
    })

    // Settings item — always navigate to /settings
    bar.querySelector('#tb-dd-settings')?.addEventListener('click', (e) => {
      e.stopPropagation()
      dropdown.hidden = true
      userBtn.classList.remove('active')
      if (typeof navigate === 'function') {
        navigate('/settings')
      } else {
        window.location.href = '/settings'
      }
    })

    // Feedback item — navigate to /feedback
    bar.querySelector('#tb-dd-feedback')?.addEventListener('click', (e) => {
      e.stopPropagation()
      dropdown.hidden = true
      userBtn.classList.remove('active')
      if (typeof navigate === 'function') {
        navigate('/feedback')
      } else {
        window.location.href = '/feedback'
      }
    })

    // Logout item
    bar.querySelector('#tb-dd-logout')?.addEventListener('click', () => {
      dropdown.hidden = true
      userBtn.classList.remove('active')
      window.dispatchEvent(new CustomEvent('tb-logout'))
    })
  }

  // Centre filename field — syncs to the active tab on change
  const filenameInput = bar.querySelector('.tb-filename-input')
  if (filenameInput) {
    filenameInput.addEventListener('change', () => {
      const name = filenameInput.value.trim() || 'Untitled'
      filenameInput.value = name
      filenameInput.defaultValue = name
      // Sync → active tab label in DOM
      const activeTabName = bar.querySelector('.tb-tab.active .tb-tab-name')
      if (activeTabName) activeTabName.textContent = name
      onRename?.(name)
    })
    filenameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter')  filenameInput.blur()
      if (e.key === 'Escape') { filenameInput.value = filenameInput.defaultValue; filenameInput.blur() }
    })
  }
}
