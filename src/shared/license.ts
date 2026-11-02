/**
 * Free and Pro: what the free version limits, and the shape of a license. The rules are decided in the main
 * process (license.ts) so the editor cannot be talked into anything; this file is what both sides agree on.
 *
 * A license is a token the license server signs (Ed25519) for one computer after a code was checked against the
 * payment platform. The app verifies the signature offline with the public key in license-config.ts.
 */

export type LicenseFeature = 'export-hd' | 'export-60fps' | 'no-watermark' | 'auto-sfx' | 'music-fit' | 'batch-import' | 'more-projects' | 'relax-long'

/** What the free version allows. Pro has no limits. */
export const FREE_LIMITS = { maxProjects: 3, maxExportHeight: 720, maxFps: 30, maxRelaxSec: 600 } as const

export const WATERMARK_TEXT = 'Dibuat dengan Story Creator'

export const PRO_FEATURES: { id: LicenseFeature; label: string; free: string; pro: string }[] = [
  { id: 'export-hd', label: 'Resolusi ekspor', free: 'Sampai 720p', pro: '1080p dan 4K' },
  { id: 'export-60fps', label: 'Frame rate', free: '30 fps', pro: '30 dan 60 fps' },
  { id: 'no-watermark', label: 'Watermark di video', free: 'Ada', pro: 'Tanpa watermark' },
  { id: 'more-projects', label: 'Jumlah proyek', free: `Maksimal ${FREE_LIMITS.maxProjects}`, pro: 'Tanpa batas' },
  { id: 'auto-sfx', label: 'SFX otomatis', free: 'SFX manual saja', pro: 'Otomatis dari isi adegan' },
  { id: 'music-fit', label: 'Musik + atur gambar', free: 'Atur durasi manual', pro: 'Gambar berganti di ketukan' },
  { id: 'batch-import', label: 'Impor sekaligus dan JSON', free: 'Satu per satu', pro: 'Banyak file dan JSON' },
  { id: 'relax-long', label: 'Video tidur dan ambience', free: 'Sampai 10 menit', pro: 'Sampai 10 jam' }
]

/** Errors from the main process that start with this make the editor open the upgrade dialog instead of a toast. */
export const PRO_PREFIX = '[PRO] '

const REASON: Record<LicenseFeature, string> = {
  'export-hd': 'Ekspor 1080p dan 4K',
  'export-60fps': 'Ekspor 60 fps',
  'no-watermark': 'Video tanpa watermark',
  'auto-sfx': 'SFX otomatis',
  'music-fit': 'Musik + atur gambar',
  'batch-import': 'Impor banyak file dan JSON',
  'more-projects': `Lebih dari ${FREE_LIMITS.maxProjects} proyek`,
  'relax-long': 'Video relaksasi lebih dari 10 menit'
}

export const proMessage = (feature: LicenseFeature): string => `${PRO_PREFIX}${REASON[feature]} khusus versi Pro.`

/** What a signed license says. `iat`/`exp` are milliseconds; the app asks the server again after 30 days. */
export interface LicenseToken {
  v: 1
  plan: 'pro'
  /** The computer it was issued for (see main/license.ts). */
  device: string
  /** Last characters of the code, for display. */
  code: string
  iat: number
  /** Past this the license stops working until the app has checked it again online. */
  exp: number
}

export const TOKEN_RECHECK_MS = 30 * 24 * 60 * 60 * 1000
export const TOKEN_LIFETIME_MS = 35 * 24 * 60 * 60 * 1000

export interface LicenseState {
  plan: 'free' | 'pro'
  /** active: Pro. recheck: signed, but too old; needs a connection. */
  status: 'free' | 'active' | 'recheck'
  /** The code as "••••-ABCD", or null. */
  code: string | null
  activatedAt: number | null
  /** When it will be checked again (ms), for display. */
  nextCheckAt: number | null
  /** Short id of this computer, to quote when asking for help. */
  deviceId: string
  /** False until the license server and public key are filled in at build time. */
  configured: boolean
  buyUrl: string
}

