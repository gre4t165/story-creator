import type { Clip, EditorSettings, WordTiming } from './types'

/**
 * Editing rules shared by the editor preview and the export, so a trimmed or split timeline plays the same
 * in both. A clip's voice belongs to the clip (like the sound of a video clip): it can be trimmed and moved
 * inside the clip, and whatever runs past the clip's end is cut.
 */

/** Shortest clip, voice or overlay the editor makes by dragging, in milliseconds. */
export const MIN_ITEM_MS = 300

/** Where a clip's voice plays: from `startMs` into the clip, source audio `inMs` to `inMs + playMs`. */
export interface VoiceSpan {
  startMs: number
  inMs: number
  /** The trimmed length, before the clip end cuts it. */
  lengthMs: number
  /** What is heard: the trimmed length, cut at the clip's end. */
  playMs: number
}

export function voiceSpan(clip: Pick<Clip, 'durationMs' | 'voiceInMs' | 'voiceOutMs' | 'voiceStartMs'>, audioMs: number): VoiceSpan {
  const inMs = Math.min(Math.max(0, clip.voiceInMs ?? 0), audioMs)
  const outMs = Math.min(audioMs, Math.max(inMs, clip.voiceOutMs ?? audioMs))
  const startMs = Math.max(0, clip.voiceStartMs ?? 0)
  const lengthMs = outMs - inMs
  return { startMs, inMs, lengthMs, playMs: Math.max(0, Math.min(lengthMs, clip.durationMs - startMs)) }
}

/**
 * The caption words a clip shows, in clip time: the words inside the trimmed voice, moved to where the voice
 * plays, without those past the clip's end. `offset` is the first word's index in the voice's own word list.
 */
export function clipCaptionWords(
  clip: Pick<Clip, 'durationMs' | 'voiceInMs' | 'voiceOutMs' | 'voiceStartMs'>,
  words: WordTiming[],
  audioMs: number
): { words: WordTiming[]; offset: number } {
  const span = voiceSpan(clip, audioMs)
  const lo = span.inMs / 1000
  const hi = (span.inMs + span.playMs) / 1000
  const shift = span.startMs / 1000 - lo
  let first = -1
  const out: WordTiming[] = []
  words.forEach((w, i) => {
    if (w.end <= lo || w.start >= hi) return
    if (first < 0) first = i
    out.push({ text: w.text, start: Math.max(lo, w.start) + shift, end: Math.min(hi, w.end) + shift })
  })
  return { words: out, offset: Math.max(0, first) }
}

/** Background music on the timeline: from `startSec` to `endSec`, starting `inSec` into the song. */
export function musicSpan(editor: Pick<EditorSettings, 'musicStartMs' | 'musicEndMs' | 'musicInMs'>, totalSec: number): { startSec: number; endSec: number; inSec: number } {
  const startSec = Math.min(Math.max(0, (editor.musicStartMs ?? 0) / 1000), Math.max(0, totalSec - 0.1))
  const endSec = Math.max(startSec + 0.1, Math.min(totalSec, editor.musicEndMs != null ? editor.musicEndMs / 1000 : totalSec))
  return { startSec, endSec, inSec: Math.max(0, (editor.musicInMs ?? 0) / 1000) }
}

/**
 * Splits narration text after its `k`-th spoken word, keeping voice tags (<short pause>) with the words
 * around them. Returns the two halves.
 */
export function splitNarration(text: string, k: number): [string, string] {
  if (k <= 0) return ['', text.trim()]
  const re = /<[^>]*>|\S+/g
  let seen = 0
  let m: RegExpExecArray | null
  while ((m = re.exec(text))) {
    if (m[0].startsWith('<')) continue
    seen++
    if (seen === k) {
      const cut = m.index + m[0].length
      return [text.slice(0, cut).trim(), text.slice(cut).trim()]
    }
  }
  return [text.trim(), '']
}

/** The middle of the pause between two words nearest to `t` (seconds), if one is within `reach`. */
export function wordGapNear(words: WordTiming[], t: number, reach = 0.4): number | null {
  let best: number | null = null
  for (let i = 0; i < words.length - 1; i++) {
    const gap = (words[i].end + words[i + 1].start) / 2
    if (Math.abs(gap - t) <= reach && (best === null || Math.abs(gap - t) < Math.abs(best - t))) best = gap
  }
  return best
}

/** Shortest a picture stays on screen when clips are fitted to a song. */
const FIT_MIN_MS = 1500

/**
 * Clip lengths that make the video as long as a song, cutting on its beats where it can. A clip never gets
 * shorter than its voice (plus a little air), so narration is not cut; the rest of the song is shared out so
 * every picture gets about the same time. Each cut then moves to the nearest beat, as long as no clip drops
 * under its minimum. When the voices alone are longer than the song, clips just fit their voices.
 */
export function fitClipsToMusic(
  clips: Pick<Clip, 'durationMs' | 'voiceInMs' | 'voiceOutMs' | 'voiceStartMs' | 'audioAssetId'>[],
  audioMsOf: (assetId: string) => number | null,
  musicMs: number,
  beatsSec: number[] = []
): { durations: number[]; fits: boolean } {
  const mins = clips.map((c) => {
    const audioMs = c.audioAssetId ? audioMsOf(c.audioAssetId) : null
    if (audioMs == null) return FIT_MIN_MS
    const span = voiceSpan({ ...c, durationMs: Number.MAX_SAFE_INTEGER }, audioMs)
    return Math.max(FIT_MIN_MS, span.startMs + span.lengthMs + 300)
  })
  const need = mins.reduce((n, m) => n + m, 0)
  if (!clips.length || need >= musicMs) return { durations: mins, fits: need <= musicMs }

  // Water-filling: clips whose minimum is above the fair share keep it, the others split what is left.
  const durations = [...mins]
  let open = clips.map((_, i) => i)
  let left = musicMs
  for (;;) {
    const share = left / open.length
    const fixed = open.filter((i) => mins[i] > share)
    if (!fixed.length) {
      for (const i of open) durations[i] = share
      break
    }
    for (const i of fixed) left -= mins[i]
    open = open.filter((i) => mins[i] <= share)
  }

  // Snap each inner cut to the nearest beat within half of the shorter neighbouring clip.
  const cuts: number[] = []
  let t = 0
  for (let i = 0; i < durations.length - 1; i++) cuts.push((t += durations[i]))
  const beats = beatsSec.map((b) => b * 1000).sort((a, b) => a - b)
  let prev = 0
  for (let i = 0; i < cuts.length; i++) {
    const nextEnd = i + 1 < cuts.length ? cuts[i + 1] : musicMs
    const lo = prev + mins[i]
    const hi = nextEnd - mins[i + 1]
    const reach = Math.min(durations[i], durations[i + 1]) / 2
    let best = cuts[i]
    let bestDist = Infinity
    for (const b of beats) {
      if (b < lo || b > hi) continue
      const d = Math.abs(b - cuts[i])
      if (d <= reach && d < bestDist) {
        best = b
        bestDist = d
      }
    }
    cuts[i] = best
    prev = best
  }
  const edges = [0, ...cuts, musicMs]
  return { durations: clips.map((_, i) => Math.round(edges[i + 1] - edges[i])), fits: true }
}
