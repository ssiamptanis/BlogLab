/**
 * Lucide icon utilities for ABX PDF Builder
 * Icons from https://lucide.dev — ISC licence
 */

// Import every named export from lucide as a flat namespace.
// Vite tree-shakes, but we want all of them for the picker.
import * as _lucide from 'lucide'

// Build a flat map: kebab-name → [[tag, attrs], …]
// Lucide exports PascalCase names like ArrowRight → "arrow-right"
function pascalToKebab(s) {
  return s
    .replace(/([A-Z])/g, (m, c, i) => (i ? '-' : '') + c.toLowerCase())
    .replace(/([a-z])(\d)/g, '$1-$2')   // e.g. trash2 → trash-2
}

const _iconMap = {}
for (const [key, val] of Object.entries(_lucide)) {
  if (Array.isArray(val) && val.length > 0) {
    _iconMap[pascalToKebab(key)] = val
  }
}

export const LUCIDE_ICON_NAMES = Object.keys(_iconMap).sort()

/**
 * Render a Lucide icon as an inline SVG string.
 * @param {string} name  kebab-case icon name, e.g. "arrow-right"
 * @param {number} size  width/height in px (default 24)
 * @param {string} color stroke colour (default "currentColor")
 */
export function lucideSVG(name, size = 24, color = 'currentColor') {
  const data = _iconMap[name]
  if (!data) return ''
  const children = data.map(([tag, attrs]) => {
    const a = Object.entries(attrs || {}).map(([k, v]) => `${k}="${v}"`).join(' ')
    return `<${tag} ${a}/>`
  }).join('')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${children}</svg>`
}

/**
 * Convert a Lucide icon to a PNG data URL via an off-screen canvas.
 * Used when sending icon data to the PDF backend.
 */
export function lucideToDataURL(name, size = 128, color = '#101720') {
  return new Promise((resolve) => {
    const svg = lucideSVG(name, size, color)
    if (!svg) { resolve(''); return }
    const blob = new Blob([svg], { type: 'image/svg+xml' })
    const url  = URL.createObjectURL(blob)
    const img  = new Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = canvas.height = size
      const ctx = canvas.getContext('2d')
      ctx.drawImage(img, 0, 0, size, size)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/png'))
    }
    img.onerror = () => { URL.revokeObjectURL(url); resolve('') }
    img.src = url
  })
}
