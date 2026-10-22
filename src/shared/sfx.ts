import catalog from './sfx-catalog.json'
import type { Clip, SfxItem } from './types'

/**
 * The built-in sound effect library and the rules for placing and playing it. Every file is CC0: Kenney's
 * packs (impact, rpg, interface, scifi) and sounds synthesized for the app (generated). The preview and the
 * export both play an item through sfxPlay, so they sound the same.
 */

export type SfxCategory = 'transisi' | 'hentakan' | 'suasana' | 'langkah' | 'benda' | 'senjata' | 'tubuh' | 'scifi' | 'antarmuka'
/** transition: whooshes on clip joints; spot: one moment in a scene; ambience: fills a whole scene. */
type SfxRole = 'transition' | 'spot' | 'ambience'

export interface SfxSound {
  id: string
  label: string
  category: SfxCategory
  role: SfxRole
  /** Repeats to fill its length (ambiences, footsteps, engines). */
  loop: boolean
  /** Words in a scene (Indonesian and English) that call for this sound. Empty: never chosen automatically. */
  tags: string[]
  files: { file: string; ms: number }[]
}

export const SFX_CATEGORIES: { id: SfxCategory; label: string }[] = [
  { id: 'transisi', label: 'Transisi' },
  { id: 'hentakan', label: 'Hentakan' },
  { id: 'suasana', label: 'Suasana' },
  { id: 'langkah', label: 'Langkah' },
  { id: 'benda', label: 'Benda' },
  { id: 'senjata', label: 'Senjata' },
  { id: 'tubuh', label: 'Tubuh' },
  { id: 'scifi', label: 'Sci-fi' },
  { id: 'antarmuka', label: 'Antarmuka' }
]

type Meta = Partial<Omit<SfxSound, 'id' | 'files'>>

const STEP = ['langkah', 'langkah kaki', 'berjalan', 'melangkah', 'footstep', 'footsteps', 'walk', 'walking']
/** Footsteps on a surface: the walking words, plus surface words that only count when someone walks. */
const step = (label: string, surface: string[]): Meta => ({ label, category: 'langkah', role: 'spot', loop: true, tags: [...STEP, ...surface.map((w) => `${w}|step`)] })

/** Labels, roles and keywords per sound. Sounds not listed here get a plain label and are only added by hand. */
const META: Record<string, Meta> = {
  'generated/whoosh': { label: 'Whoosh', category: 'transisi', role: 'transition' },
  'generated/swoosh': { label: 'Swoosh cepat', category: 'transisi', role: 'transition' },
  'generated/riser': { label: 'Riser tegang', category: 'transisi', role: 'spot', tags: ['tiba-tiba', 'mendadak', 'menegangkan', 'suspense', 'sudden'] },
  'generated/boom': { label: 'Dentuman', category: 'hentakan', role: 'spot', tags: ['dentuman', 'gempa', 'runtuh', 'menggelegar', 'boom', 'earthquake'] },
  'generated/hit': { label: 'Hentakan', category: 'hentakan', role: 'spot', tags: ['menghantam', 'hantaman', 'benturan', 'terbentur', 'impact'] },
  'generated/drone': {
    label: 'Dengung misteri',
    category: 'suasana',
    role: 'ambience',
    loop: true,
    tags: ['misteri', 'misterius', 'gelap', 'seram', 'horor', 'hantu', 'mencekam', 'tegang', 'creepy', 'mystery', 'dark', 'horror']
  },
  'generated/heartbeat': { label: 'Detak jantung', category: 'tubuh', role: 'spot', loop: true, tags: ['jantung', 'berdebar', 'deg-degan', 'ketakutan', 'heartbeat'] },
  'generated/clock': { label: 'Detak jam', category: 'benda', role: 'spot', loop: true, tags: ['jam dinding', 'detik', 'menunggu', 'waktu habis', 'clock', 'ticking'] },
  'generated/rain': { label: 'Hujan', category: 'suasana', role: 'ambience', loop: true, tags: ['hujan', 'gerimis', 'badai', 'petir', 'rain', 'storm'] },
  'generated/wind': {
    label: 'Angin',
    category: 'suasana',
    role: 'ambience',
    loop: true,
    tags: ['angin', 'gurun', 'padang pasir', 'gunung', 'puncak', 'tebing', 'bersalju', 'wind', 'desert', 'mountain']
  },
  'generated/ocean': {
    label: 'Ombak laut',
    category: 'suasana',
    role: 'ambience',
    loop: true,
    tags: ['laut', 'pantai', 'ombak', 'samudra', 'samudera', 'kapal', 'pelabuhan', 'berlayar', 'sea', 'ocean', 'beach', 'ship']
  },
  'generated/night': {
    label: 'Malam (jangkrik)',
    category: 'suasana',
    role: 'ambience',
    loop: true,
    tags: ['malam', 'jangkrik', 'hutan', 'desa', 'kampung', 'sawah', 'tengah malam', 'night', 'forest', 'village']
  },
  'generated/roomtone': {
    label: 'Suasana ruangan',
    category: 'suasana',
    role: 'ambience',
    loop: true,
    tags: ['ruangan', 'kamar', 'istana', 'aula', 'balairung', 'kantor', 'keraton', 'room', 'palace', 'hall', 'office']
  },

  'impact/footstep_concrete': step('Langkah di batu', ['jalan', 'kota', 'batu', 'lorong', 'jalanan']),
  'impact/footstep_grass': step('Langkah di rumput', ['rumput', 'taman', 'hutan', 'ladang']),
  'impact/footstep_wood': step('Langkah di kayu', ['kayu', 'lantai kayu', 'rumah', 'panggung']),
  'impact/footstep_snow': step('Langkah di salju', ['salju', 'snow']),
  'impact/footstep_carpet': step('Langkah di karpet', ['karpet', 'carpet']),
  'rpg/footstep': { label: 'Langkah kaki', category: 'langkah', role: 'spot', loop: true, tags: STEP },
  'impact/impactPunch_heavy': { label: 'Pukulan keras', category: 'hentakan', role: 'spot', tags: ['tinju', 'meninju', 'pukulan keras', 'punch'] },
  'impact/impactPunch_medium': { label: 'Pukulan', category: 'hentakan', role: 'spot', tags: ['pukul', 'memukul', 'berkelahi', 'bertarung', 'fight'] },
  'impact/impactMetal_heavy': { label: 'Benturan logam', category: 'hentakan', role: 'spot', tags: ['besi', 'baja', 'logam', 'metal', 'iron'] },
  'impact/impactMetal_light': { label: 'Logam ringan', category: 'benda', role: 'spot' },
  'impact/impactMetal_medium': { label: 'Logam sedang', category: 'benda', role: 'spot' },
  'impact/impactWood_heavy': { label: 'Benturan kayu', category: 'hentakan', role: 'spot', tags: ['tongkat', 'meja', 'balok', 'wood'] },
  'impact/impactWood_light': { label: 'Kayu ringan', category: 'benda', role: 'spot' },
  'impact/impactWood_medium': { label: 'Kayu sedang', category: 'benda', role: 'spot' },
  'impact/impactGlass_heavy': { label: 'Kaca pecah', category: 'benda', role: 'spot', tags: ['pecah', 'kaca', 'jendela', 'gelas', 'glass', 'shatter'] },
  'impact/impactGlass_light': { label: 'Kaca ringan', category: 'benda', role: 'spot' },
  'impact/impactGlass_medium': { label: 'Kaca sedang', category: 'benda', role: 'spot' },
  'impact/impactBell_heavy': { label: 'Lonceng', category: 'benda', role: 'spot', tags: ['lonceng', 'genta', 'gong', 'bell'] },
  'impact/impactMining': { label: 'Palu dan pahat', category: 'benda', role: 'spot', tags: ['tambang', 'menambang', 'palu', 'memahat', 'pandai besi', 'mining'] },
  'impact/impactSoft_heavy': { label: 'Jatuh', category: 'hentakan', role: 'spot', tags: ['jatuh', 'terjatuh', 'roboh', 'tumbang', 'fall'] },
  'impact/impactSoft_medium': { label: 'Jatuh pelan', category: 'hentakan', role: 'spot' },
  'impact/impactPlate_heavy': { label: 'Piring', category: 'benda', role: 'spot', tags: ['piring', 'makan', 'pesta', 'jamuan', 'plate'] },
  'impact/impactPlate_light': { label: 'Piring ringan', category: 'benda', role: 'spot' },
  'impact/impactPlate_medium': { label: 'Piring sedang', category: 'benda', role: 'spot' },
  'impact/impactTin_medium': { label: 'Kaleng', category: 'benda', role: 'spot', tags: ['kaleng', 'tin'] },
  'impact/impactPlank_medium': { label: 'Papan', category: 'benda', role: 'spot', tags: ['papan', 'jembatan kayu', 'plank'] },
  'impact/impactGeneric_light': { label: 'Ketukan', category: 'benda', role: 'spot', tags: ['mengetuk', 'ketukan', 'knock'] },

  'rpg/doorOpen': { label: 'Pintu dibuka', category: 'benda', role: 'spot', tags: ['membuka pintu', 'pintu terbuka', 'pintu dibuka', 'masuk ke', 'door opens', 'pintu'] },
  'rpg/doorClose': { label: 'Pintu ditutup', category: 'benda', role: 'spot', tags: ['menutup pintu', 'pintu tertutup', 'pintu ditutup', 'door closes'] },
  'rpg/creak': { label: 'Derit', category: 'benda', role: 'spot', tags: ['derit', 'berderit', 'reyot', 'creak'] },
  'rpg/bookOpen': { label: 'Buku dibuka', category: 'benda', role: 'spot', tags: ['membuka buku', 'kitab', 'naskah kuno', 'book'] },
  'rpg/bookFlip': { label: 'Membalik halaman', category: 'benda', role: 'spot', tags: ['membaca', 'halaman', 'buku', 'surat', 'gulungan', 'read', 'page'] },
  'rpg/bookClose': { label: 'Buku ditutup', category: 'benda', role: 'spot', tags: ['menutup buku'] },
  'rpg/bookPlace': { label: 'Buku diletakkan', category: 'benda', role: 'spot' },
  'rpg/drawKnife': { label: 'Hunus pedang', category: 'senjata', role: 'spot', tags: ['pedang', 'menghunus', 'keris', 'golok', 'belati', 'sword', 'blade'] },
  'rpg/knifeSlice': { label: 'Tebasan', category: 'senjata', role: 'spot', tags: ['menebas', 'tebasan', 'mengiris', 'memotong', 'slash'] },
  'rpg/chop': { label: 'Kapak', category: 'senjata', role: 'spot', tags: ['kapak', 'menebang', 'kayu bakar', 'axe', 'chop'] },
  'rpg/handleCoins': { label: 'Koin', category: 'benda', role: 'spot', tags: ['koin', 'uang', 'emas', 'harta', 'membayar', 'pasar', 'coin', 'gold', 'money'] },
  'rpg/cloth': { label: 'Kain', category: 'benda', role: 'spot', tags: ['jubah', 'kain', 'selimut', 'cloak', 'cloth'] },
  'rpg/metalPot': { label: 'Panci', category: 'benda', role: 'spot', tags: ['panci', 'memasak', 'dapur', 'kitchen', 'cooking'] },
  'rpg/metalLatch': { label: 'Gembok', category: 'benda', role: 'spot', tags: ['gembok', 'terkunci', 'mengunci', 'lock'] },
  'rpg/metalClick': { label: 'Klik logam', category: 'benda', role: 'spot' },

  'scifi/laserLarge': { label: 'Laser besar', category: 'scifi', role: 'spot', tags: ['meriam', 'blaster', 'laser'] },
  'scifi/laserSmall': { label: 'Laser kecil', category: 'scifi', role: 'spot', tags: ['tembakan laser', 'menembak', 'shoot'] },
  'scifi/laserRetro': { label: 'Laser retro', category: 'scifi', role: 'spot' },
  'scifi/explosionCrunch': { label: 'Ledakan', category: 'hentakan', role: 'spot', tags: ['ledakan', 'meledak', 'bom', 'explosion', 'explode'] },
  'scifi/lowFrequency_explosion': { label: 'Ledakan berat', category: 'hentakan', role: 'spot', tags: ['ledakan besar', 'bom atom', 'big explosion'] },
  'scifi/spaceEngineLarge': {
    label: 'Mesin pesawat besar',
    category: 'scifi',
    role: 'ambience',
    loop: true,
    tags: ['pesawat', 'luar angkasa', 'antariksa', 'kapal angkasa', 'spaceship', 'space']
  },
  'scifi/spaceEngine': { label: 'Mesin pesawat', category: 'scifi', role: 'ambience', loop: true },
  'scifi/spaceEngineLow': { label: 'Mesin pesawat rendah', category: 'scifi', role: 'ambience', loop: true },
  'scifi/spaceEngineSmall': { label: 'Mesin pesawat kecil', category: 'scifi', role: 'ambience', loop: true },
  'scifi/thrusterFire': { label: 'Roket menyala', category: 'scifi', role: 'spot', tags: ['roket', 'meluncur', 'lepas landas', 'rocket', 'launch'] },
  'scifi/forceField': { label: 'Medan energi', category: 'scifi', role: 'spot', tags: ['sihir', 'energi', 'perisai', 'portal', 'magic', 'shield'] },
  'scifi/computerNoise': { label: 'Komputer', category: 'scifi', role: 'ambience', loop: true, tags: ['komputer', 'robot', 'laboratorium', 'computer', 'robot'] },
  'scifi/engineCircular': { label: 'Mesin berputar', category: 'scifi', role: 'ambience', loop: true, tags: ['pabrik', 'mesin', 'factory', 'machine'] },
  'scifi/doorOpen': { label: 'Pintu otomatis dibuka', category: 'scifi', role: 'spot', tags: ['pintu otomatis'] },
  'scifi/doorClose': { label: 'Pintu otomatis ditutup', category: 'scifi', role: 'spot' },
  'scifi/slime': { label: 'Lendir', category: 'scifi', role: 'spot', tags: ['lendir', 'monster', 'slime'] },
  'scifi/impactMetal': { label: 'Logam sci-fi', category: 'scifi', role: 'spot' }
}

const PACK_CATEGORY: Record<string, SfxCategory> = { impact: 'benda', rpg: 'benda', interface: 'antarmuka', scifi: 'scifi', generated: 'hentakan' }

/** "impactGlass_heavy" → "impact glass heavy", for sounds without a label of their own. */
const plainLabel = (id: string): string =>
  id
    .split('/')[1]
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/^./, (c) => c.toUpperCase())

export const SFX_SOUNDS: SfxSound[] = (catalog as { id: string; files: { file: string; ms: number }[] }[]).map((g) => {
  const m = META[g.id] ?? {}
  return {
    id: g.id,
    label: m.label ?? plainLabel(g.id),
    category: m.category ?? PACK_CATEGORY[g.id.split('/')[0]] ?? 'benda',
    role: m.role ?? 'spot',
    loop: m.loop ?? false,
    tags: m.tags ?? [],
    files: g.files
  }
})

const BY_ID = new Map(SFX_SOUNDS.map((s) => [s.id, s]))
const FILE_MS = new Map(SFX_SOUNDS.flatMap((s) => s.files.map((f) => [f.file, f.ms] as const)))

export const sfxSound = (id: string): SfxSound | undefined => BY_ID.get(id)
export const sfxFileMs = (file: string): number => FILE_MS.get(file) ?? 1000
/** URL the renderer plays a library file from (served by the studio:// protocol). */
export const sfxUrl = (file: string): string => `studio://sfx/${file.split('/').map(encodeURIComponent).join('/')}`

/** Ambiences fade in and out so they do not start or stop with a jump. */
const AMBIENCE_FADE_SEC = 0.4

/**
 * How an item plays on a timeline of `total` seconds: where it starts, how long it is heard, whether the file
 * repeats, and its fade. A one-shot never plays past the end of its file.
 */
export function sfxPlay(item: SfxItem, total: number): { startSec: number; playSec: number; loop: boolean; fadeSec: number } {
  const sound = sfxSound(item.sound)
  const loop = sound?.loop ?? false
  const startSec = Math.min(Math.max(0, item.start), Math.max(0, total - 0.05))
  const fileSec = sfxFileMs(item.file) / 1000
  const wanted = Math.max(0.05, item.length)
  const playSec = Math.max(0.05, Math.min(loop ? wanted : Math.min(wanted, fileSec), total - startSec))
  const fadeSec = sound?.role === 'ambience' ? Math.min(AMBIENCE_FADE_SEC, playSec / 3) : 0
  return { startSec, playSec, loop, fadeSec }
}

/** Gain (0–1) of an item `t` seconds into it, with its fades. */
export function sfxFade(play: { playSec: number; fadeSec: number }, t: number): number {
  if (!play.fadeSec) return 1
  return Math.max(0, Math.min(1, t / play.fadeSec, (play.playSec - t) / play.fadeSec))
}

const VOLUME: Record<SfxRole, number> = { transition: -8, spot: -4, ambience: -16 }
/** How long a looping spot sound (footsteps, a heartbeat) plays. */
const SPOT_LOOP_SEC = 2.5

const escapeRe = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Where a tag first appears as a whole word or phrase in `text`, or -1. */
function findTag(text: string, tag: string): number {
  const m = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(tag)}(?=$|[^\\p{L}\\p{N}])`, 'iu').exec(text)
  return m ? m.index + m[1].length : -1
}

/** How strongly a scene calls for a sound, and where in the text the first match is. */
function sceneScore(sound: SfxSound, text: string): { score: number; at: number } {
  let score = 0
  let at = -1
  const walking = sound.category === 'langkah' ? STEP.some((w) => findTag(text, w) >= 0) : true
  for (const raw of sound.tags) {
    const [tag, needs] = raw.split('|')
    if (needs === 'step' && !walking) continue
    const i = findTag(text, tag)
    if (i < 0) continue
    // Longer phrases are more specific than single words.
    score += 1 + tag.split(' ').length
    if (at < 0 || i < at) at = i
  }
  return { score, at }
}

const pickFile = (sound: SfxSound, rand: () => number): { file: string; ms: number } => sound.files[Math.floor(rand() * sound.files.length)] ?? sound.files[0]

type ClipLike = Pick<Clip, 'title' | 'story' | 'visualPrompt' | 'narration' | 'durationMs' | 'transition' | 'transitionMs'>

/**
 * Sound effects for a whole video, from what each scene is about: a whoosh on every transition, up to two
 * matching ambiences under a scene (a village at night in the rain gets crickets and rain), and up to two
 * sounds for the moments the narration (or the scene) names. Neighbouring scenes with the same ambience get
 * one item that runs across both, so it does not restart.
 */
export function autoSfx(clips: ClipLike[], rand: () => number = Math.random): Omit<SfxItem, 'id'>[] {
  const out: Omit<SfxItem, 'id'>[] = []
  const whooshes = ['generated/whoosh', 'generated/swoosh'].map(sfxSound).filter((s): s is SfxSound => !!s)
  const ambiences = SFX_SOUNDS.filter((s) => s.role === 'ambience' && s.tags.length)
  const spots = SFX_SOUNDS.filter((s) => s.role === 'spot' && s.tags.length)
  let t = 0
  let lastSpots = new Set<string>()
  for (let i = 0; i < clips.length; i++) {
    const c = clips[i]
    const dur = c.durationMs / 1000
    const narration = c.narration.toLowerCase()
    const text = [c.title, c.story, c.visualPrompt.split('\n').filter((l) => !/^\s*avoid\s*:/i.test(l)).join(' '), c.narration].join(' \n ').toLowerCase()

    // Transition into the next scene: quick cuts get the short swoosh, longer transitions a full whoosh.
    if (i < clips.length - 1 && c.transition !== 'cut' && whooshes.length) {
      const trSec = Math.min(2, Math.max(0.2, (c.transitionMs ?? 400) / 1000))
      const sound = trSec < 0.35 && whooshes[1] ? whooshes[1] : whooshes[0]
      const f = pickFile(sound, rand)
      const sec = f.ms / 1000
      out.push({ sound: sound.id, file: f.file, start: Math.max(0, t + dur - sec / 2), length: sec, volumeDb: VOLUME.transition, auto: true })
    }

    /** The best matches, strongest first, at most one per category. */
    const ranked = (list: SfxSound[], max: number): SfxSound[] => {
      const scored = list.map((s) => ({ s, score: sceneScore(s, text).score })).filter((x) => x.score > 0)
      scored.sort((a, b) => b.score - a.score)
      const picked: SfxSound[] = []
      for (const { s } of scored) if (picked.length < max && !picked.some((p) => p.category === s.category && p.role !== 'ambience')) picked.push(s)
      return picked
    }

    ranked(ambiences, 2).forEach((sound, k) => {
      const prev = out.findLast((x) => x.auto && x.sound === sound.id)
      if (prev && Math.abs(prev.start + prev.length - t) < 0.05) prev.length += dur
      else {
        const f = pickFile(sound, rand)
        // A second ambience sits under the first.
        out.push({ sound: sound.id, file: f.file, start: t, length: dur, volumeDb: VOLUME.ambience - k * 4, auto: true })
      }
    })

    // The same spot sound in two scenes in a row sounds like a mistake, so the second scene skips it.
    const spotsHere = ranked(
      spots.filter((s) => !lastSpots.has(s.id)),
      2
    )
    for (const sound of spotsHere) {
      const f = pickFile(sound, rand)
      const len = sound.loop ? Math.min(SPOT_LOOP_SEC, dur) : f.ms / 1000
      // When the narration names it, the sound comes when the narrator says it; otherwise early in the scene.
      const inNarration = findFirstTagIn(sound, narration)
      const frac = inNarration >= 0 && narration.length ? inNarration / narration.length : 0.2
      const start = t + Math.min(Math.max(0.1, frac * dur), Math.max(0.1, dur - len))
      out.push({ sound: sound.id, file: f.file, start, length: len, volumeDb: VOLUME.spot, auto: true })
    }
    lastSpots = new Set(spotsHere.map((s) => s.id))
    t += dur
  }
  return out
}

function findFirstTagIn(sound: SfxSound, text: string): number {
  let at = -1
  for (const raw of sound.tags) {
    const i = findTag(text, raw.split('|')[0])
    if (i >= 0 && (at < 0 || i < at)) at = i
  }
  return at
}

/** Default length and volume for a sound added by hand at a time. */
export function newSfxItem(soundId: string, start: number, rand: () => number = Math.random): Omit<SfxItem, 'id'> | null {
  const sound = sfxSound(soundId)
  if (!sound) return null
  const f = pickFile(sound, rand)
  const length = sound.role === 'ambience' ? 8 : sound.loop ? SPOT_LOOP_SEC : f.ms / 1000
  return { sound: sound.id, file: f.file, start, length, volumeDb: VOLUME[sound.role] }
}
