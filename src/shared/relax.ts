import { FREE_LIMITS } from './license'
import { SFX_SOUNDS, sfxUrl } from './sfx'
import type { AmbienceLayer, Asset, EditorSettings, RelaxKind, RelaxSettings, RelaxVoice } from './types'

/**
 * Sleep, meditation and ambience videos: long, quiet videos where a short story (or only pictures) loops under
 * ambient sound for up to ten hours. The editor preview and the export read the same rules from here: which
 * layers play, how loud, how long the final video is, and when the screen goes dark.
 */

export const RELAX_KINDS: { id: RelaxKind; label: string; hint: string }[] = [
  { id: 'sleep', label: 'Cerita tidur', hint: 'Cerita pelan dan menenangkan, narator lembut, suasana di bawahnya.' },
  { id: 'meditation', label: 'Meditasi', hint: 'Narasi napas dan relaksasi tubuh dengan jeda hening panjang.' },
  { id: 'ambience', label: 'Ambience', hint: 'Tanpa narasi: pemandangan yang bergerak pelan dan suara alam berjam-jam.' }
]

/** Lengths of the final video offered in the editor and the Idea step, in seconds. */
export const RELAX_LENGTHS: { sec: number; label: string }[] = [
  { sec: 600, label: '10 menit' },
  { sec: 1800, label: '30 menit' },
  { sec: 3600, label: '1 jam' },
  { sec: 7200, label: '2 jam' },
  { sec: 10800, label: '3 jam' },
  { sec: 28800, label: '8 jam' },
  { sec: 36000, label: '10 jam' }
]

export const MAX_RELAX_SEC = 36000

/** "Layar gelap" choices: the picture fades to black after this long, the sound keeps going. */
export const DIM_CHOICES: { sec: number | null; label: string }[] = [
  { sec: null, label: 'Tidak' },
  { sec: 900, label: '15 menit' },
  { sec: 1800, label: '30 menit' },
  { sec: 3600, label: '1 jam' },
  { sec: 7200, label: '2 jam' }
]

/** Story length chips per kind: a sleep story is read once, an ambience is a short set of scenes that loops. */
export const RELAX_STORY_DURATIONS: Record<RelaxKind, { sec: number; label: string }[]> = {
  sleep: [
    { sec: 300, label: '5 menit' },
    { sec: 600, label: '10 menit' },
    { sec: 900, label: '15 menit' },
    { sec: 1200, label: '20 menit' },
    { sec: 1800, label: '30 menit' }
  ],
  meditation: [
    { sec: 300, label: '5 menit' },
    { sec: 600, label: '10 menit' },
    { sec: 900, label: '15 menit' },
    { sec: 1200, label: '20 menit' }
  ],
  ambience: [
    { sec: 120, label: '4 pemandangan' },
    { sec: 180, label: '6 pemandangan' },
    { sec: 240, label: '8 pemandangan' },
    { sec: 360, label: '12 pemandangan' }
  ]
}

/** Each ambience scene is on screen this long before it fades into the next. */
export const AMBIENCE_SCENE_SEC = 30

/** Scenes per story length: calm narration lingers, so scenes are longer than in a story video. */
export function relaxClipCount(kind: RelaxKind, durationSec: number): number {
  const per = kind === 'ambience' ? AMBIENCE_SCENE_SEC : kind === 'meditation' ? 16 : 14
  return Math.max(3, Math.min(120, Math.round(durationSec / per)))
}

/** Extra silence held after each line of narration in a relax video, so the listener can breathe with it. */
export function relaxHoldMs(editor: Pick<EditorSettings, 'relax'>): number {
  const kind = editor.relax?.kind
  return kind === 'meditation' ? 5000 : kind === 'sleep' ? 1800 : 0
}

/** A new relax project starts with a sound that suits its kind, so the first preview is not silent. */
const STARTER_LAYERS: Record<RelaxKind, { file: string; label: string; volumeDb: number }[]> = {
  sleep: [{ file: 'ambience/rain-roof.ogg', label: 'Hujan di atap', volumeDb: 0 }],
  meditation: [{ file: 'ambience/river.ogg', label: 'Sungai mengalir', volumeDb: -4 }],
  ambience: [
    { file: 'ambience/rain-night.ogg', label: 'Hujan malam', volumeDb: 0 },
    { file: 'ambience/fireplace.ogg', label: 'Perapian', volumeDb: -6 }
  ]
}

export const newRelaxSettings = (kind: RelaxKind): RelaxSettings => ({
  kind,
  lengthSec: 3600,
  voice: 'calm',
  layers: STARTER_LAYERS[kind].map((l) => ({ ...l, id: globalThis.crypto.randomUUID() })),
  fadeOutSec: 10,
  dimAfterSec: null
})

// ---------- how the narrator speaks ----------

/** Delivery per voice service for a calm or whispered narrator. Voicebox and other local servers keep their own. */
export function relaxDelivery(voice: RelaxVoice): { gemini: string; elevenSpeed: number; elevenTag: string; edgeRate: string } {
  return voice === 'whisper'
    ? {
        gemini: 'soft ASMR whisper, very close to the microphone, slow and intimate, long gentle pauses',
        elevenSpeed: 0.85,
        elevenTag: '[whispers]',
        edgeRate: '-25%'
      }
    : {
        gemini: 'soothing bedtime narrator, soft and warm, slow relaxed pace, long calm pauses between sentences',
        elevenSpeed: 0.88,
        elevenTag: '[softly]',
        edgeRate: '-18%'
      }
}

// ---------- ambient sound ----------

const AMBIENCE_ORDER = ['rain-roof', 'rain-night', 'rain-tent', 'thunderstorm', 'ocean', 'river', 'forest', 'crickets', 'wind', 'fireplace', 'campfire', 'cafe', 'fan', 'whitenoise', 'pinknoise', 'brownnoise']
const rank = (id: string): number => {
  const i = AMBIENCE_ORDER.indexOf(id.slice('ambience/'.length))
  return i < 0 ? AMBIENCE_ORDER.length : i
}

/** Library recordings for long ambiences (resources/sfx/ambience): real CC0 recordings and generated noise, rain first. */
export const AMBIENCE_SOUNDS = SFX_SOUNDS.filter((s) => s.id.startsWith('ambience/')).sort((a, b) => rank(a.id) - rank(b.id))

/**
 * Library recordings are matched to -26 LUFS (scripts/ambience-pack.cjs), about 8 dB under a narrator, so a new
 * layer starts at its own level; two or three together land near the loudness of sleep videos on YouTube.
 */
export const LAYER_DEFAULT_DB = 0

/** Every layer fades in at the start, and the whole mix fades out over `fadeOutSec` at the end. */
export const LAYER_FADE_IN_SEC = 3

/** Where a layer's sound comes from: a library file or an asset (imported, or made by ElevenLabs). */
export function layerSource(layer: AmbienceLayer, assets: Asset[]): { url: string; asset?: Asset; file?: string } | null {
  if (layer.file) return { url: sfxUrl(layer.file), file: layer.file }
  const asset = layer.assetId ? assets.find((a) => a.id === layer.assetId) : undefined
  return asset ? { url: asset.url, asset } : null
}

/** Volume of one layer in the mix, in dB: its own setting plus the ambience master. */
export const layerDb = (layer: AmbienceLayer, relax: Pick<RelaxSettings, 'volumeDb'>): number => layer.volumeDb + (relax.volumeDb ?? 0)

// ---------- length and looping ----------

/** The final length in seconds: never shorter than the story itself, and at most 10 minutes in the free version. */
export function relaxLengthSec(relax: Pick<RelaxSettings, 'lengthSec'>, storySec: number, pro: boolean): number {
  const wanted = Math.min(MAX_RELAX_SEC, Math.max(storySec, relax.lengthSec))
  return pro ? wanted : Math.max(storySec, Math.min(wanted, FREE_LIMITS.maxRelaxSec))
}

/** The picture of the last scene fades into the first one over this long, so the loop has no visible seam. */
export const LOOP_FADE_SEC = 3

/** Seconds the picture takes to go dark once "Layar gelap" starts. */
export const DIM_FADE_SEC = 20

/** Assets a relax project uses, so cleanup never deletes an imported ambience. */
export const relaxAssetIds = (editor: Pick<EditorSettings, 'relax'>): string[] =>
  (editor.relax?.layers ?? []).map((l) => l.assetId).filter((id): id is string => !!id)

/** A rough file size for the dialog: slow pictures and quiet sound compress well. */
export function relaxSizeEstimateGb(lengthSec: number, resolution: 720 | 1080 | 2160): number {
  const mbps = resolution === 720 ? 0.9 : resolution === 1080 ? 1.8 : 6
  return ((mbps + 0.128) * lengthSec) / 8 / 1000
}
