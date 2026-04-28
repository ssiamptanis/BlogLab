import { createClient } from '@supabase/supabase-js'

let _supabase = null

// Fetch Supabase credentials from the server at runtime (no build-time env vars needed).
// All code that uses `supabase` is safe as long as it runs after `supabaseReady` resolves.
export const supabaseReady = fetch('/api/config')
  .then(r => r.json())
  .then(({ supabaseUrl, supabaseAnonKey }) => {
    if (!supabaseUrl || !supabaseAnonKey) {
      throw new Error('Server did not return Supabase credentials from /api/config')
    }
    _supabase = createClient(supabaseUrl, supabaseAnonKey)
    return _supabase
  })

// Proxy that forwards all property access to the real client once initialized.
export const supabase = new Proxy({}, {
  get(_, prop) {
    if (!_supabase) throw new Error('Supabase not yet initialized — await supabaseReady first')
    return _supabase[prop]
  }
})

/** Get the current session's access token — cached until 60s before expiry */
let _cachedToken = null
let _tokenExpiry = 0

export async function getToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) {
    return _cachedToken
  }
  const { data: { session } } = await supabase.auth.getSession()
  _cachedToken = session?.access_token ?? null
  if (_cachedToken) {
    try {
      const payload = JSON.parse(atob(_cachedToken.split('.')[1]))
      _tokenExpiry = payload.exp * 1000
    } catch {
      _tokenExpiry = Date.now() + 3_600_000
    }
  }
  return _cachedToken
}

export function clearTokenCache() {
  _cachedToken = null
  _tokenExpiry = 0
}

const API_BASE = import.meta.env.VITE_API_URL || ''

/** Make an authenticated fetch to the Flask API */
export async function apiFetch(path, options = {}) {
  const token = await getToken()
  const headers = {
    'Content-Type': 'application/json',
    ...(options.headers || {}),
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  }
  return fetch(`${API_BASE}${path}`, { ...options, headers })
}

/** Authenticated multipart upload — lets the browser set the Content-Type boundary automatically */
export async function apiUpload(path, formData) {
  const token = await getToken()
  return fetch(`${API_BASE}${path}`, {
    method: 'POST',
    headers: token ? { Authorization: `Bearer ${token}` } : {},
    body: formData,
  })
}
