import { createClient } from '@supabase/supabase-js'

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY in .env')
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY)

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
