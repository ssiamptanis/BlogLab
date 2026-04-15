// ── Feedback — floating button, modal, and full page ────────────────────────
import { supabase }                           from './supabase.js'
import { titlebarHTML, bindTitlebarEvents }   from './titlebar.js'

const API_BASE = import.meta.env.VITE_API_URL || ''

let _navigate = null

// ── Auth headers ──────────────────────────────────────────────────────────────
async function _authHeaders() {
  const { data: { session } } = await supabase.auth.getSession()
  return {
    'Authorization': `Bearer ${session?.access_token || ''}`,
    'Content-Type':  'application/json',
  }
}

// ── HTML escape ───────────────────────────────────────────────────────────────
function _esc(s) {
  return String(s ?? '')
    .replace(/&/g,'&amp;').replace(/</g,'&lt;')
    .replace(/>/g,'&gt;').replace(/"/g,'&quot;')
}

// ── Stars HTML ────────────────────────────────────────────────────────────────
function starsHTML(rating, interactive = false, size = 20) {
  return Array.from({ length: 5 }, (_, i) => {
    const on   = i < rating
    // Inactive: white fill + pink stroke so the whole star is solid/clickable
    // Active:   pink fill + pink stroke
    const fill = on ? 'currentColor' : '#fff'
    if (interactive) {
      return `<button class="star-btn${on ? ' on' : ''}" data-star="${i + 1}" type="button" aria-label="${i + 1} stars">
        <svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
        </svg></button>`
    }
    return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="${fill}" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" class="star-icon${on ? ' on' : ''}">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
    </svg>`
  }).join('')
}

// ── Floating button ───────────────────────────────────────────────────────────
let _btnMounted = false

export function mountFeedbackButton(navigate) {
  _navigate = navigate
  if (_btnMounted) { _navigate = navigate; return }
  _btnMounted = true

  const btn = document.createElement('button')
  btn.id        = 'feedback-float-btn'
  btn.title     = 'Leave feedback'
  btn.innerHTML = `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>`
  document.body.appendChild(btn)
  btn.addEventListener('click', () => openFeedbackModal(_navigate))
}

// ── Modal ─────────────────────────────────────────────────────────────────────
export async function openFeedbackModal(navigate, prefill = {}) {
  _navigate = navigate || _navigate

  const { data: { session } } = await supabase.auth.getSession()
  const userEmail = session?.user?.email || ''
  const meta      = session?.user?.user_metadata || {}
  const userName  = meta.full_name || meta.name || ''
  const isEdit    = !!prefill.id

  document.getElementById('fb-modal-overlay')?.remove()

  let rating = prefill.rating || 0

  const overlay = document.createElement('div')
  overlay.id        = 'fb-modal-overlay'
  overlay.className = 'fb-overlay'
  overlay.innerHTML = `
    <div class="fb-modal" role="dialog" aria-modal="true">
      <div class="fb-modal-head">
        <h2 class="fb-modal-title">Leave feedback</h2>
        <button class="fb-modal-x" id="fb-modal-close" aria-label="Close">×</button>
      </div>

      <div class="fb-modal-body">
        <div class="fm-group">
          <div class="fm-label">RATING</div>
          <div class="fm-stars" id="fm-stars">${starsHTML(rating, true, 28)}</div>
        </div>

        <input type="hidden" id="fm-name" value="${_esc(prefill.user_name || userName)}" />

        <div class="fm-group">
          <label class="fm-label" for="fm-text">FEEDBACK</label>
          <textarea class="fm-textarea" id="fm-text"
            placeholder="What's working well, what could be better, what would you like to see next…">${_esc(prefill.feedback_text || '')}</textarea>
        </div>
      </div>

      <div class="fb-modal-foot">
        <button class="fm-btn fm-cancel" id="fm-cancel">Cancel</button>
        <button class="fm-btn fm-submit" id="fm-submit">${isEdit ? 'Save changes' : 'Submit'}</button>
      </div>

      ${!isEdit ? `<div class="fb-modal-view-all">
        <a href="/feedback" id="fm-view-all">View all feedback →</a>
      </div>` : ''}
    </div>`
  document.body.appendChild(overlay)

  // ── Star interaction ───────────────────────────────────────────────────────
  const starsEl = overlay.querySelector('#fm-stars')
  function bindStars(n) {
    rating = n
    starsEl.innerHTML = starsHTML(n, true, 28)
    starsEl.querySelectorAll('.star-btn').forEach((btn, i) => {
      btn.addEventListener('click', () => bindStars(i + 1))
      btn.addEventListener('mouseover', () => {
        starsEl.querySelectorAll('.star-btn svg').forEach((svg, j) => {
          svg.setAttribute('fill', j <= i ? 'currentColor' : '#fff')
        })
      })
      btn.addEventListener('mouseout', () => bindStars(rating))
    })
  }
  bindStars(rating)

  // ── Close helpers ──────────────────────────────────────────────────────────
  const close = () => overlay.remove()
  overlay.querySelector('#fb-modal-close').addEventListener('click', close)
  overlay.querySelector('#fm-cancel').addEventListener('click', close)
  overlay.addEventListener('click', e => { if (e.target === overlay) close() })

  // ── View all link ──────────────────────────────────────────────────────────
  overlay.querySelector('#fm-view-all')?.addEventListener('click', e => {
    e.preventDefault()
    close()
    ;(_navigate || navigate)?.(('/feedback'))
  })

  // ── Submit ─────────────────────────────────────────────────────────────────
  overlay.querySelector('#fm-submit').addEventListener('click', async () => {
    const nameVal  = overlay.querySelector('#fm-name').value.trim()
    const textVal  = overlay.querySelector('#fm-text').value.trim()
    if (!textVal) { overlay.querySelector('#fm-text').focus(); return }

    const submitBtn = overlay.querySelector('#fm-submit')
    submitBtn.disabled  = true
    submitBtn.textContent = 'Saving…'

    try {
      const headers = await _authHeaders()
      const body    = JSON.stringify({
        user_name:     nameVal,
        user_email:    userEmail,
        rating:        rating || null,
        feedback_text: textVal,
      })
      const url    = isEdit ? `${API_BASE}/api/feedback/${prefill.id}` : `${API_BASE}/api/feedback`
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers, body })
      if (!res.ok) {
        const err = await res.json().catch(() => ({}))
        throw new Error(err.error || `Server error ${res.status}`)
      }
      close()
      window.dispatchEvent(new CustomEvent('feedback-updated'))
    } catch (err) {
      submitBtn.disabled    = false
      submitBtn.textContent = isEdit ? 'Save changes' : 'Submit'
      // Show error inside modal
      let errEl = overlay.querySelector('.fm-error')
      if (!errEl) {
        errEl = document.createElement('div')
        errEl.className = 'fm-error'
        overlay.querySelector('.fb-modal-foot').before(errEl)
      }
      errEl.textContent = err.message
    }
  })

  // Focus name field
  setTimeout(() => overlay.querySelector('#fm-name')?.focus(), 60)
}

// ── Full feedback page ────────────────────────────────────────────────────────
export async function renderFeedbackPage(root, { navigate }) {
  _navigate = navigate

  const { data: { session } } = await supabase.auth.getSession()
  const myUserId = session?.user?.id

  root.innerHTML = `
    <div class="dashboard-shell">
      ${titlebarHTML({ isHome: false })}
      <div class="dash-body">
        <aside class="dash-sidebar">
          <div class="dash-sidebar-top">
            <button class="btn btn-outline" id="fb-back">← Back to files</button>
          </div>
        </aside>
        <main class="dash-main">

          <div class="fb-page-hero">
            <div class="fb-page-hero-left">
              <div class="fb-page-label">TEAM INPUT</div>
              <h1 class="fb-page-title">Feedback</h1>
              <p class="fb-page-desc">Ratings and notes from the team — everything submitted through the feedback form lives here.</p>
            </div>
            <div class="fb-page-hero-right" id="fb-stats">
              <div class="fb-avg-num">—</div>
              <div class="fb-avg-denom">/ 5</div>
              <div class="fb-avg-stars" id="fb-avg-stars"></div>
              <div class="fb-avg-label" id="fb-avg-label">—</div>
            </div>
          </div>

          <div class="fb-page-toolbar">
            <button class="btn btn-primary" id="fb-add">+ Add feedback</button>
          </div>

          <div id="fb-list" class="fb-list">
            <div class="fb-empty">Loading…</div>
          </div>

        </main>
      </div>
    </div>
    <div class="toast"></div>`

  bindTitlebarEvents(root, { navigate })
  root.querySelector('#fb-back').addEventListener('click', () => navigate('/dash'))
  root.querySelector('#fb-add').addEventListener('click', () => openFeedbackModal(navigate))

  // Refresh list when a modal submit fires
  const onUpdate = () => loadFeedback()
  window.addEventListener('feedback-updated', onUpdate)
  // Clean up listener when we navigate away
  window.addEventListener('popstate', () => window.removeEventListener('feedback-updated', onUpdate), { once: true })

  async function loadFeedback() {
    const headers = await _authHeaders()
    try {
      const res   = await fetch(`${API_BASE}/api/feedback`, { headers })
      const items = await res.json()
      renderList(Array.isArray(items) ? items : [])
    } catch {
      root.querySelector('#fb-list').innerHTML = `<div class="fb-empty">Could not load feedback.</div>`
    }
  }

  function renderList(items) {
    // Update stats
    const rated = items.filter(i => i.rating)
    const avg   = rated.length
      ? (rated.reduce((s, i) => s + i.rating, 0) / rated.length)
      : null

    root.querySelector('.fb-avg-num').textContent   = avg !== null ? avg.toFixed(1) : '—'
    root.querySelector('#fb-avg-stars').innerHTML   = avg !== null ? starsHTML(Math.round(avg), false, 18) : ''
    root.querySelector('#fb-avg-label').textContent = rated.length
      ? `from ${rated.length} rating${rated.length !== 1 ? 's' : ''}`
      : 'no ratings yet'

    const list = root.querySelector('#fb-list')
    if (!items.length) {
      list.innerHTML = `<div class="fb-empty">No feedback yet — be the first!</div>`
      return
    }

    list.innerHTML = items.map(item => {
      const initial  = (item.user_name || '?')[0].toUpperCase()
      const date     = new Date(item.created_at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
      const canEdit  = item.user_id === myUserId
      return `
        <div class="fb-card" data-id="${item.id}">
          <div class="fb-card-top">
            <div class="fb-card-left">
              <div class="fb-avatar">${initial}</div>
              <div>
                <div class="fb-card-name">${_esc(item.user_name || 'Anonymous')}</div>
                <div class="fb-card-sub">${date}${item.user_email ? ' · ' + _esc(item.user_email) : ''}</div>
              </div>
            </div>
            <div class="fb-card-actions">
              ${item.rating ? `<div class="fb-card-stars">${starsHTML(item.rating, false, 15)}</div>` : ''}
              ${canEdit ? `
                <button class="fb-action-btn fb-edit-btn" data-id="${item.id}" title="Edit">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                </button>
                <button class="fb-action-btn fb-delete-btn" data-id="${item.id}" title="Delete">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                </button>` : ''}
            </div>
          </div>
          <p class="fb-card-text">${_esc(item.feedback_text || '')}</p>
        </div>`
    }).join('')

    list.querySelectorAll('.fb-edit-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const item = items.find(i => i.id === btn.dataset.id)
        if (item) openFeedbackModal(navigate, item)
      })
    })

    list.querySelectorAll('.fb-delete-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('Delete this feedback?')) return
        const headers = await _authHeaders()
        await fetch(`${API_BASE}/api/feedback/${btn.dataset.id}`, { method: 'DELETE', headers })
        loadFeedback()
      })
    })
  }

  loadFeedback()
}
