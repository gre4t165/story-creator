import type { CaptionPosition, CaptionSize, CaptionStyleId, WordTiming } from './types'

/**
 * Caption looks shared by the preview (CSS) and the export (ASS subtitles via libass).
 * Colors are hex RGB; font files live in resources/fonts and are used by both sides.
 */
export interface CaptionStyle {
  id: CaptionStyleId
  name: string
  font: string
  weight: number
  /** Font size as a fraction of the video height. */
  size: number
  color: string
  highlight: string
  box: string | null
  boxAlpha: number
  outline: number
  outlineColor: string
  uppercase: boolean
}

export const CAPTION_STYLES: CaptionStyle[] = [
  {
    id: 'karaoke',
    name: 'Karaoke',
    font: 'Poppins',
    weight: 800,
    size: 0.058,
    color: '#FAF7F2',
    highlight: '#FFC93C',
    box: '#1F1D1A',
    boxAlpha: 0.92,
    outline: 0,
    outlineColor: '#1F1D1A',
    uppercase: false
  },
  {
    id: 'tebal',
    name: 'Tebal',
    font: 'Poppins',
    weight: 800,
    size: 0.07,
    color: '#FFFFFF',
    highlight: '#FFC93C',
    box: null,
    boxAlpha: 0,
    outline: 0.006,
    outlineColor: '#1F1D1A',
    uppercase: true
  },
  {
    id: 'minimal',
    name: 'Minimal',
    font: 'Poppins',
    weight: 600,
    size: 0.046,
    color: '#1F1D1A',
    highlight: '#C93A1B',
    box: '#FAF7F2',
    boxAlpha: 0.94,
    outline: 0,
    outlineColor: '#FAF7F2',
    uppercase: false
  },
  {
    id: 'subtitle',
    name: 'Subtitle',
    font: 'Poppins',
    weight: 500,
    size: 0.042,
    color: '#FFFFFF',
    highlight: '#FFFFFF',
    box: '#1F1D1A',
    boxAlpha: 0.72,
    outline: 0,
    outlineColor: '#1F1D1A',
    uppercase: false
  }
]

export const CAPTION_SIZE_SCALE: Record<CaptionSize, number> = { kecil: 0.82, sedang: 1, besar: 1.2 }

/**
 * Fonts for captions, bundled in resources/fonts for both the preview and libass. `cell` is the font's
 * Windows ascent + descent in ems: libass sizes text by it, CSS by the em, so sizes are converted with it.
 */
export interface CaptionFont {
  id: string
  name: string
  family: string
  cell: number
  group: string
  /** The TTF in resources/fonts (for Poppins, the Bold weight; see captionFontFile). */
  file: string
}

const BOLD = 'Tegas & modern'
const CARTOON = 'Kartun & komik'
const OTHER = 'Tulisan tangan & elegan'

export const CAPTION_FONTS: CaptionFont[] = [
  { id: 'poppins', name: 'Poppins', family: 'Poppins', cell: 1.762, group: BOLD, file: 'Poppins-Bold.ttf' },
  { id: 'anton', name: 'Anton', family: 'Anton', cell: 1.733, group: BOLD, file: 'Anton-Regular.ttf' },
  { id: 'bebas', name: 'Bebas Neue', family: 'Bebas Neue', cell: 1.3, group: BOLD, file: 'BebasNeue-Regular.ttf' },
  { id: 'archivo', name: 'Archivo Black', family: 'Archivo Black', cell: 1.347, group: BOLD, file: 'ArchivoBlack-Regular.ttf' },
  { id: 'luckiest', name: 'Luckiest Guy', family: 'Luckiest Guy', cell: 1.226, group: CARTOON, file: 'LuckiestGuy-Regular.ttf' },
  { id: 'bangers', name: 'Bangers', family: 'Bangers', cell: 1.757, group: CARTOON, file: 'Bangers-Regular.ttf' },
  { id: 'comicneue', name: 'Comic Neue', family: 'Comic Neue', cell: 1.35, group: CARTOON, file: 'ComicNeue-Bold.ttf' },
  { id: 'chewy', name: 'Chewy', family: 'Chewy', cell: 1.282, group: CARTOON, file: 'Chewy-Regular.ttf' },
  { id: 'bubblegum', name: 'Bubblegum Sans', family: 'Bubblegum Sans', cell: 1.163, group: CARTOON, file: 'BubblegumSans-Regular.ttf' },
  { id: 'boogaloo', name: 'Boogaloo', family: 'Boogaloo', cell: 1.189, group: CARTOON, file: 'Boogaloo-Regular.ttf' },
  { id: 'sniglet', name: 'Sniglet', family: 'Sniglet', cell: 1.245, group: CARTOON, file: 'Sniglet-ExtraBold.ttf' },
  { id: 'titan', name: 'Titan One', family: 'Titan One', cell: 1.145, group: CARTOON, file: 'TitanOne-Regular.ttf' },
  { id: 'lilita', name: 'Lilita One', family: 'Lilita One', cell: 1.143, group: CARTOON, file: 'LilitaOne-Regular.ttf' },
  { id: 'marker', name: 'Permanent Marker', family: 'Permanent Marker', cell: 1.427, group: OTHER, file: 'PermanentMarker-Regular.ttf' },
  { id: 'dmserif', name: 'DM Serif Display', family: 'DM Serif Display', cell: 1.371, group: OTHER, file: 'DMSerifDisplay-Regular.ttf' }
]

export function getCaptionFont(id: string | undefined): CaptionFont {
  return CAPTION_FONTS.find((f) => f.id === id) ?? CAPTION_FONTS[0]
}

const POPPINS_FILES: Record<number, string> = {
  500: 'Poppins-Medium.ttf',
  600: 'Poppins-SemiBold.ttf',
  700: 'Poppins-Bold.ttf',
  800: 'Poppins-ExtraBold.ttf'
}

/** The font file a caption is drawn with: Poppins has one file per weight, the others a single file. */
export function captionFontFile(style: { fontInfo: CaptionFont; weight: number }): string {
  return style.fontInfo.id === 'poppins' ? (POPPINS_FILES[style.weight] ?? POPPINS_FILES[700]) : style.fontInfo.file
}

/** Corner radius of the caption box, as a share of the font size. */
export const CAPTION_BOX_RADIUS = 0.4

/** Captions may use this share of the frame width, as libass does with 8% side margins. */
export const CAPTION_MAX_WIDTH = 0.84

/**
 * Breaks a caption into lines. The preview (canvas widths) and the export (font-file widths) both call it,
 * so their lines match and the rounded box can be drawn around known lines. Short captions stay on one
 * line; longer ones get two balanced lines with the top one no shorter, like libass's smart wrapping.
 */
export function layoutCaptionLines(words: string[], measure: (text: string) => number, maxWidth: number): string[][] {
  if (words.length < 2 || measure(words.join(' ')) <= maxWidth) return [words]
  let best: { at: number; score: number } | null = null
  for (let at = 1; at < words.length; at++) {
    const top = measure(words.slice(0, at).join(' '))
    const bottom = measure(words.slice(at).join(' '))
    if (top > maxWidth || bottom > maxWidth) continue
    const score = Math.max(top, bottom) + (bottom > top ? 0.01 * maxWidth : 0)
    if (!best || score < best.score) best = { at, score }
  }
  if (best) return [words.slice(0, best.at), words.slice(best.at)]
  // Too long for two lines: fill each line in turn.
  const lines: string[][] = [[]]
  for (const w of words) {
    const line = lines[lines.length - 1]
    if (line.length && measure([...line, w].join(' ')) > maxWidth) lines.push([w])
    else line.push(w)
  }
  return lines
}

/** An ASS drawing (\p1) of a rounded rectangle from (x0, y0) to (x1, y1). */
export function roundedRectPath(x0: number, y0: number, x1: number, y1: number, radius: number): string {
  const r = Math.max(0, Math.min(radius, (x1 - x0) / 2, (y1 - y0) / 2))
  const k = r * 0.4477 // bezier handle for a quarter circle
  const n = (v: number): string => String(Math.round(v))
  return [
    `m ${n(x0 + r)} ${n(y0)}`,
    `l ${n(x1 - r)} ${n(y0)}`,
    `b ${n(x1 - k)} ${n(y0)} ${n(x1)} ${n(y0 + k)} ${n(x1)} ${n(y0 + r)}`,
    `l ${n(x1)} ${n(y1 - r)}`,
    `b ${n(x1)} ${n(y1 - k)} ${n(x1 - k)} ${n(y1)} ${n(x1 - r)} ${n(y1)}`,
    `l ${n(x0 + r)} ${n(y1)}`,
    `b ${n(x0 + k)} ${n(y1)} ${n(x0)} ${n(y1 - k)} ${n(x0)} ${n(y1 - r)}`,
    `l ${n(x0)} ${n(y0 + r)}`,
    `b ${n(x0)} ${n(y0 + k)} ${n(x0 + k)} ${n(y0)} ${n(x0 + r)} ${n(y0)}`
  ].join(' ')
}

export interface ResolvedCaption extends CaptionStyle {
  fontInfo: CaptionFont
}

/**
 * The caption look a project actually uses: its style preset with the user's font, colors and box on top.
 * Without a box, text gets an outline so it stays readable over any picture.
 */
export function resolveCaption(editor: {
  captionStyle: CaptionStyleId
  captionFont?: string
  captionColor?: string
  captionHighlight?: string
  captionBg?: { color: string; opacity: number } | null
}): ResolvedCaption | null {
  const base = getCaptionStyle(editor.captionStyle)
  if (!base) return null
  const fontInfo = getCaptionFont(editor.captionFont)
  const color = editor.captionColor ?? base.color
  const box = editor.captionBg === undefined ? base.box : (editor.captionBg?.color ?? null)
  const boxAlpha = editor.captionBg === undefined ? base.boxAlpha : (editor.captionBg?.opacity ?? 0)
  return {
    ...base,
    font: fontInfo.family,
    weight: fontInfo.id === 'poppins' ? base.weight : 400,
    color,
    highlight: editor.captionHighlight ?? base.highlight,
    box,
    boxAlpha,
    outline: box ? 0 : base.outline || 0.004,
    outlineColor: box ? base.outlineColor : contrastInk(color),
    fontInfo
  }
}

function contrastInk(hex: string): string {
  const h = hex.replace('#', '')
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? '#1F1D1A' : '#FFFFFF'
}

/** The caption size multiplier a project uses: the slider value, or the older small/medium/large choice. */
export function captionScaleOf(editor: { captionSize: CaptionSize; captionScale?: number }): number {
  return editor.captionScale ?? CAPTION_SIZE_SCALE[editor.captionSize]
}

/**
 * libass sizes a font by its Windows ascent + descent, which for Poppins is 1.762 em, while CSS sizes it
 * by the em. The export multiplies font sizes by this, and the preview uses it as the line height, so
 * text is the same size and spacing in both.
 */
export const POPPINS_CELL = 1.762

/** Box padding around boxed caption text, as a fraction of the font size (BorderStyle 4 pads evenly). */
export const CAPTION_BOX_PAD = 0.32

export const CAPTION_POSITIONS: { id: CaptionPosition; label: string }[] = [
  { id: 'atas', label: 'Atas' },
  { id: 'tengah', label: 'Tengah' },
  { id: 'bawah', label: 'Bawah' }
]

export function getCaptionStyle(id: CaptionStyleId): CaptionStyle | null {
  return CAPTION_STYLES.find((c) => c.id === id) ?? null
}

export interface CaptionChunk {
  start: number
  end: number
  words: WordTiming[]
  /** Where the words come from: the voice asset (key) and their place in its word list. */
  source?: { key: string; from: number; count: number }
}

/**
 * Estimated word timings for audio without timestamps (Gemini TTS).
 * Longer words and punctuation pauses get more time.
 */
export function estimateWordTimings(text: string, durationSec: number): WordTiming[] {
  const tokens = text.split(/\s+/).filter(Boolean)
  if (tokens.length === 0 || durationSec <= 0) return []
  const lead = Math.min(0.15, durationSec * 0.03)
  const tail = Math.min(0.25, durationSec * 0.05)
  const usable = Math.max(0.1, durationSec - lead - tail)
  const weight = (w: string): number => {
    let v = Math.max(2, w.replace(/[^\p{L}\p{N}]/gu, '').length) + 1.5
    if (/[.!?…]$/.test(w)) v += 4
    else if (/[,;:]$/.test(w)) v += 2
    return v
  }
  const weights = tokens.map(weight)
  const total = weights.reduce((a, b) => a + b, 0)
  let t = lead
  return tokens.map((w, i) => {
    const d = (weights[i] / total) * usable
    const out = { text: w, start: t, end: t + d }
    t += d
    return out
  })
}

/** Groups words into short caption lines, breaking on sentence ends, long pauses and length. */
export function chunkWords(words: WordTiming[], maxWords = 5, maxChars = 30, key = '', offset = 0): CaptionChunk[] {
  const chunks: CaptionChunk[] = []
  let cur: WordTiming[] = []
  let from = 0
  const flush = (): void => {
    if (cur.length === 0) return
    chunks.push({ start: cur[0].start, end: cur[cur.length - 1].end, words: cur, source: { key, from: from + offset, count: cur.length } })
    cur = []
  }
  words.forEach((w, i) => {
    const chars = cur.reduce((n, x) => n + x.text.length + 1, 0) + w.text.length
    if (cur.length > 0 && (cur.length >= maxWords || chars > maxChars)) flush()
    if (cur.length === 0) from = i
    cur.push(w)
    const next = words[i + 1]
    const pause = next ? next.start - w.end : 0
    if (/[.!?…]$/.test(w.text) || pause > 0.45) flush()
  })
  flush()
  return chunks
}

/** Word timings of every clip shifted onto the video timeline, chunked per clip so a line never spans two scenes. */
export function timelineChunks(items: { start: number; words: WordTiming[]; key?: string; offset?: number }[]): CaptionChunk[] {
  const out: CaptionChunk[] = []
  for (const item of items) {
    for (const c of chunkWords(item.words, undefined, undefined, item.key ?? '', item.offset ?? 0)) {
      out.push({
        start: c.start + item.start,
        end: c.end + item.start,
        words: c.words.map((w) => ({ ...w, start: w.start + item.start, end: w.end + item.start })),
        source: c.source
      })
    }
  }
  return out
}

export function captionAt(chunks: CaptionChunk[], t: number): { chunk: CaptionChunk; word: number } | null {
  for (let i = 0; i < chunks.length; i++) {
    const c = chunks[i]
    const next = chunks[i + 1]
    const holdUntil = next ? Math.min(next.start, c.end + 0.6) : c.end + 0.6
    if (t >= c.start && t < holdUntil) {
      // The latest word that has started stays lit through the short gaps between words, as in the export.
      let word = 0
      c.words.forEach((w, k) => {
        if (w.start <= t) word = k
      })
      return { chunk: c, word }
    }
  }
  return null
}

export function displayWord(text: string, style: CaptionStyle): string {
  return style.uppercase ? text.toLocaleUpperCase('id-ID') : text
}

/** Marks caption timings from the current Whisper method, so timings from older methods can be synced again. */
export const WHISPER_TIMING = 'whisper-dtw'

/**
 * Whether a voice clip's caption words should be timed again with Whisper: estimated timings, or a Gemini
 * voice timed by an older Whisper method. ElevenLabs sends exact word times.
 */
export function captionNeedsSync(a: { provider: string | null; meta: { estimatedTimings?: boolean; timedBy?: unknown } }): boolean {
  if (a.meta.estimatedTimings) return true
  return a.provider === 'gemini' && a.meta.timedBy !== WHISPER_TIMING
}

/**
 * A voice clip's word list with one caption chunk's text replaced. The chunk keeps its time span: with the
 * same number of words each word keeps its own time, otherwise the new words share the span by length.
 * Empty text removes the chunk's words.
 */
export function replaceCaptionWords(words: WordTiming[], from: number, count: number, text: string): WordTiming[] {
  const old = words.slice(from, from + count)
  if (!old.length) return words
  const tokens = text.split(/\s+/).filter(Boolean)
  let next: WordTiming[]
  if (tokens.length === old.length) next = old.map((w, i) => ({ ...w, text: tokens[i] }))
  else {
    const start = old[0].start
    const end = Math.max(start, old[old.length - 1].end)
    const weight = tokens.map((t) => Math.max(2, t.length))
    const sum = weight.reduce((a, b) => a + b, 0) || 1
    let t = start
    next = tokens.map((tok, i) => {
      const d = ((end - start) * weight[i]) / sum
      const w = { text: tok, start: t, end: t + d }
      t += d
      return w
    })
  }
  return [...words.slice(0, from), ...next, ...words.slice(from + count)]
}
