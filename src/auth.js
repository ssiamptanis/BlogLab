import { supabase } from './supabase.js'

// Lucide file-text icon paths (PDF document shape)
const PDF_ICON_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5"
  stroke-linecap="round" stroke-linejoin="round" width="100%" height="100%">
  <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
  <circle cx="8.5" cy="8.5" r="1.5"/>
  <polyline points="21 15 16 10 5 21"/>
</svg>`

// Brand colours for the icons
const COLOURS = ['#FF0077', '#FF5993', '#DC1F69', '#FF0077', '#FF0077']

// Linear interpolation helper
const lerp = (a, b, t) => a + (b - a) * t

function startRain(page) {
  const COUNT = 56
  const vw = window.innerWidth
  const vh = window.innerHeight

  // Build particles — depth 0 = very close (big, fast, sharp), 1 = far (tiny, slow, blurry)
  const particles = Array.from({ length: COUNT }, (_, i) => {
    const depth  = Math.random()                        // 0–1
    const colour = COLOURS[Math.floor(Math.random() * COLOURS.length)]

    const el = document.createElement('div')
    el.innerHTML = PDF_ICON_SVG
    el.style.cssText = `
      position:absolute; pointer-events:none;
      color:${colour};
    `
    page.appendChild(el)

    return {
      el,
      // Position in px — spread across full width, stagger starts above viewport
      x:        Math.random() * vw,
      y:        -(Math.random() * vh * 1.5),           // staggered above screen
      // Depth-driven properties
      size:     lerp(72, 14, depth),                   // px — close=big, far=small
      speed:    lerp(180, 35, depth),                  // px/s — close=fast, far=slow
      opacity:  lerp(0.45, 0.06, depth),               // close=bright, far=dim
      blur:     lerp(0, 9, depth),                     // px — far=blurry
      // Sinusoidal horizontal sway — each icon has unique amplitude, frequency, phase
      swayAmp:  lerp(60, 12, depth) * (Math.random() * 0.8 + 0.6), // px
      swayFreq: lerp(0.25, 0.6, depth) * (Math.random() * 0.6 + 0.7), // Hz
      swayPhase:Math.random() * Math.PI * 2,
      // Rotation — close icons tumble faster
      angle:    Math.random() * 360,
      spin:     lerp(25, 4, depth) * (Math.random() > 0.5 ? 1 : -1), // deg/s
      colour,
      depth,
    }
  })

  // Sort so far (blurry) particles are inserted first → rendered behind close ones
  particles.sort((a, b) => b.depth - a.depth)
  particles.forEach(p => page.appendChild(p.el))

  let rafId
  let last = performance.now()

  function tick(now) {
    // Guard: stop if the login page was removed from DOM
    if (!page.isConnected) { cancelAnimationFrame(rafId); return }

    const dt = Math.min((now - last) / 1000, 0.05) // cap at 50ms to avoid jumps
    last = now
    const t  = now / 1000

    for (const p of particles) {
      // Fall
      p.y     += p.speed * dt
      p.angle += p.spin  * dt

      // Reset when it drops off the bottom — reappear at a random position above
      if (p.y > vh + p.size) {
        p.y = -(p.size + Math.random() * 120)
        p.x = Math.random() * vw
      }

      // Sinusoidal horizontal sway: x + A·sin(2π·f·t + φ)
      const swayx = p.x + p.swayAmp * Math.sin(2 * Math.PI * p.swayFreq * t + p.swayPhase)

      p.el.style.cssText = `
        position: absolute;
        pointer-events: none;
        width:   ${p.size}px;
        height:  ${p.size}px;
        left:    ${swayx}px;
        top:     ${p.y}px;
        opacity: ${p.opacity};
        filter:  blur(${p.blur}px);
        color:   ${p.colour};
        transform: rotate(${p.angle}deg);
        will-change: transform;
      `
    }

    rafId = requestAnimationFrame(tick)
  }

  rafId = requestAnimationFrame(tick)
}

// loading=true → used as a splash/loading screen for already-signed-in users
// loading=false (default) → actual login screen with Google button
export function renderLogin(root, { loading = false } = {}) {
  root.innerHTML = `
    <div class="auth-page">
      <!-- Background orbs -->
      <div class="auth-orb auth-orb-1"></div>
      <div class="auth-orb auth-orb-2"></div>
      <div class="auth-orb auth-orb-3"></div>
      <div class="auth-orb auth-orb-4"></div>
      <div class="auth-orb auth-orb-5"></div>

      <div class="auth-card">
        <div class="auth-logo">
          <svg width="100%" viewBox="0 0 264 81" fill="none" style="display:block">
            <path fill-rule="evenodd" clip-rule="evenodd" d="M263.42 61.5C263.42 49.5 257.84 43.9 245.81 43.9C233.78 43.9 228.2 49.5 228.2 61.5C228.2 73.5 233.78 79.1 245.81 79.1C257.84 79.1 263.42 73.5 263.42 61.5Z" fill="#FF0077"/>
            <path fill-rule="evenodd" clip-rule="evenodd" d="M202 78.7H219.5V1.7H202V78.7Z" fill="white"/>
            <path fill-rule="evenodd" clip-rule="evenodd" d="M170.6 78.7H150.6L135.7 27.3L120.7 78.7H100.8L77 1.7H96.7L110.9 54L125.6 1.7H145.9L161 54.1L175.1 1.7H194.5L170.6 78.7Z" fill="white"/>
            <path fill-rule="evenodd" clip-rule="evenodd" d="M37.3 80.4C26 80.4 16.9 76.8 10.1 69.6C3.4 62.4 0 52.6 0 40.5C0 28.5 3.7 18.7 10.9 11.3C18.2 3.8 27.8 0 39.5 0C54.7 0 66.9 6.8 73.7 19.2L61.3 30.96L60.4 29.5C55.2 21.6 48.2 17.5 39.5 17.5C32.9 17.5 27.6 19.6 23.8 23.7C19.8 27.9 17.9 33.4 17.9 40.4C17.9 47.3 19.8 52.8 23.5 56.7C27.2 60.7 32.3 62.7 38.7 62.7C46 62.7 52.6 59.2 57.3 52.7H39.9V36.1H76.6V78.9H61.9V69.2C59.1 72.6 55.6 75.4 51.7 77.2C47.3 79.3 42.5 80.4 37.3 80.4Z" fill="white"/>
          </svg>
        </div>

        ${loading ? `
          <div class="auth-loading-state">
            <div class="page-spinner" style="width:22px;height:22px;border-width:2px"></div>
          </div>
        ` : `
          <p class="auth-subtitle">BlogLab</p>
          <button class="auth-google-btn" id="auth-google">
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none">
              <path d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 01-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" fill="#fff"/>
              <path d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" fill="#fff"/>
              <path d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" fill="#fff"/>
              <path d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" fill="#fff"/>
            </svg>
            Continue with Google
          </button>
        `}
      </div>
    </div>
  `

  // Start the raining icon animation
  startRain(root.querySelector('.auth-page'))

  // Google OAuth — only when showing the actual login form
  if (!loading) {
    document.getElementById('auth-google').addEventListener('click', async () => {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: { redirectTo: window.location.origin },
      })
      if (error) alert(`Sign-in error: ${error.message}`)
    })
  }
}
