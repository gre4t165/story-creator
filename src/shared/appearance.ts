/**
 * How the app looks: light or dark (or whatever Windows uses), and the accent color of buttons and highlights.
 * The colors themselves live in renderer/src/styles.css; main uses the paper color so a new window does not
 * flash white before a dark page loads.
 */

export type ThemeMode = 'system' | 'light' | 'dark'
export type AccentId = 'bata' | 'biru' | 'hijau' | 'ungu' | 'magenta'

export const THEME_MODES: { id: ThemeMode; label: string }[] = [
  { id: 'system', label: 'Ikuti Windows' },
  { id: 'light', label: 'Terang' },
  { id: 'dark', label: 'Gelap' }
]

/** `swatch` is only for the picker; the real accent shades (light and dark) are in styles.css. */
export const ACCENTS: { id: AccentId; label: string; swatch: string }[] = [
  { id: 'bata', label: 'Bata', swatch: '#C93A1B' },
  { id: 'biru', label: 'Biru', swatch: '#2563EB' },
  { id: 'hijau', label: 'Hijau', swatch: '#15803D' },
  { id: 'ungu', label: 'Ungu', swatch: '#7C3AED' },
  { id: 'magenta', label: 'Magenta', swatch: '#DB2777' }
]

/** Page background behind the app, for the window itself (matches --color-paper). */
export const PAPER = { light: '#FAF7F2', dark: '#171513' }

export const isThemeMode = (v: unknown): v is ThemeMode => THEME_MODES.some((m) => m.id === v)
export const isAccent = (v: unknown): v is AccentId => ACCENTS.some((a) => a.id === v)
