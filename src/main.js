// ABX PDF Builder — router (History API)
import { renderApp }                                    from './app.js'
import { renderDashboard, renderSettings, showTemplatePicker,
         preloadDashboard }                             from './dashboard.js'
import { renderFeedbackPage, mountFeedbackButton }      from './feedback.js'
import { addTab }                                       from './titlebar.js'
import { supabase, supabaseReady }                       from './supabase.js'
import { renderLogin }                                  from './auth.js'

const root = document.getElementById('app')

// ── Render the correct page for the current pathname ──────────────────────────
function render() {
  const path = window.location.pathname
  if (path === '/dash' || path === '/') {
    renderDashboard(root, { navigate })
  } else if (path === '/settings') {
    renderSettings(root, { navigate })
  } else if (path === '/feedback') {
    renderFeedbackPage(root, { navigate })
  } else if (path.startsWith('/editor/')) {
    const id = path.split('/')[2] || null
    renderApp(root, { navigate, templateId: id })
  } else {
    // Unknown path — fall back to dashboard
    history.replaceState(null, '', '/dash')
    renderDashboard(root, { navigate })
  }
}

// ── Navigate to a path using History API ──────────────────────────────────────
function navigate(path) {
  if (path && path !== window.location.pathname) {
    history.pushState(null, '', path)
  }
  render()
}

// ── Wire up app-level listeners and kick off render ───────────────────────────
function startApp() {
  window.addEventListener('show-template-picker', () => showTemplatePicker(navigate))
  window.addEventListener('popstate', render)   // browser back/forward
  mountFeedbackButton(navigate)                 // persistent floating button
  render()
}

// ── Boot ──────────────────────────────────────────────────────────────────────
async function boot() {
  const { data: { session } } = await supabase.auth.getSession()

  if (!session) {
    // Not signed in — show the login page
    renderLogin(root)

    supabase.auth.onAuthStateChange((event, newSession) => {
      if (newSession) {
        // After OAuth: show splash while preloading (max 3s), then go to dash
        renderLogin(root, { loading: true })
        Promise.race([
          preloadDashboard().catch(() => {}),
          new Promise(r => setTimeout(r, 3000)),
        ]).finally(() => {
          history.replaceState(null, '', '/dash')
          startApp()
        })
      }
    })
    return
  }

  // Already signed in — go straight to wherever they were.
  // Kick off preload in background; the dashboard skeleton handles the wait.
  preloadDashboard().catch(() => {})

  // Redirect bare "/" to "/dash"
  if (window.location.pathname === '/') {
    history.replaceState(null, '', '/dash')
  }

  startApp()
}

supabaseReady.then(boot).catch(err => {
  document.getElementById('app').innerHTML =
    `<div style="padding:40px;font-family:sans-serif;color:#c00">Failed to load app config: ${err.message}</div>`
})
