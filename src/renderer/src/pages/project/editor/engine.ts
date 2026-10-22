import { useEffect, useMemo, useRef } from 'react'
import { create } from 'zustand'
import { timelineChunks, type CaptionChunk } from '@shared/captions'
import { transitionSecOf } from '@shared/motion'
import { sfxFade, sfxPlay, sfxSound, sfxUrl } from '@shared/sfx'
import { clipCaptionWords, voiceSpan } from '@shared/timeline'
import type { Asset, Clip, Overlay, SfxItem, TransitionId } from '@shared/types'
import { useProject } from '../../../store/project'

export interface TimelineItem {
  clip: Clip
  index: number
  start: number
  end: number
  image: Asset | null
  video: Asset | null
  audio: Asset | null
}

interface PlaybackState {
  t: number
  playing: boolean
  seek(t: number): void
  play(): void
  pause(): void
  toggle(): void
}

export const usePlayback = create<PlaybackState>((set, get) => ({
  t: 0,
  playing: false,
  seek: (t) => set({ t: Math.max(0, t) }),
  play: () => set({ playing: true }),
  pause: () => set({ playing: false }),
  toggle: () => set({ playing: !get().playing })
}))

/** Which overlay the Overlay panel, the preview and the timeline have selected. */
export const useOverlayUi = create<{ selectedId: string | null; select(id: string | null): void }>((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id })
}))

/**
 * A part of the timeline played in the preview only, on a loop, while a setting is being chosen: one clip
 * (camera move) or the joint after a clip (transition, optionally trying another type). The playhead and
 * the audio stay where they are.
 */
export type Audition =
  | { kind: 'clip'; clipId: string }
  | { kind: 'transition'; clipId: string; override?: { transition: TransitionId } }

export const useAudition = create<{
  audition: (Audition & { startedAt: number }) | null
  start(a: Audition): void
  stop(): void
}>((set, get) => ({
  audition: null,
  start: (a) => set({ audition: { ...a, startedAt: performance.now() } }),
  stop: () => {
    if (get().audition) set({ audition: null })
  }
}))

/** The stretch of timeline an audition loops over: the whole clip, or the joint with a little before and after. */
export function auditionWindow(a: Audition, items: TimelineItem[]): { from: number; to: number } | null {
  const i = items.findIndex((it) => it.clip.id === a.clipId)
  if (i < 0) return null
  const it = items[i]
  if (a.kind === 'clip') return { from: it.start, to: it.end }
  const next = items[i + 1]
  if (!next) return null
  const clip = a.kind === 'transition' && a.override ? { ...it.clip, ...a.override } : it.clip
  const sec = Math.min(transitionSecOf(clip), it.end - it.start, next.end - next.start)
  return { from: Math.max(it.start, next.start - 0.8), to: Math.min(next.end, next.start + sec + 0.8) }
}

/** The caption chunk picked on the timeline for editing: its voice asset and first word. */
export const useCaptionUi = create<{ selected: { key: string; from: number } | null; select(s: { key: string; from: number } | null): void }>(
  (set) => ({
    selected: null,
    select: (s) => set({ selected: s })
  })
)

// Overlay edits read the store at call time, so rapid drags never work from a stale list.
const overlaysNow = (): Overlay[] => useProject.getState().project?.editor.overlays ?? []

export function addOverlay(o: Overlay): void {
  useProject.getState().updateEditor({ overlays: [...overlaysNow(), o] })
  useOverlayUi.getState().select(o.id)
}

export function updateOverlay(id: string, patch: Partial<Overlay>): void {
  useProject.getState().updateEditor({ overlays: overlaysNow().map((o) => (o.id === id ? ({ ...o, ...patch } as Overlay) : o)) })
}

export function removeOverlay(id: string): void {
  useProject.getState().updateEditor({ overlays: overlaysNow().filter((o) => o.id !== id) })
  if (useOverlayUi.getState().selectedId === id) useOverlayUi.getState().select(null)
}

export function useTimeline(): { items: TimelineItem[]; total: number; chunks: CaptionChunk[] } {
  const clips = useProject((s) => s.clips)
  const assets = useProject((s) => s.assets)
  return useMemo(() => {
    let acc = 0
    const items = clips.map((clip, index) => {
      const start = acc
      acc += clip.durationMs / 1000
      return {
        clip,
        index,
        start,
        end: acc,
        image: clip.imageAssetId ? (assets[clip.imageAssetId] ?? null) : null,
        video: clip.videoAssetId ? (assets[clip.videoAssetId] ?? null) : null,
        audio: clip.audioAssetId ? (assets[clip.audioAssetId] ?? null) : null
      }
    })
    // Captions follow each clip's voice as trimmed and placed on the timeline (as in the export).
    const chunks = timelineChunks(
      items.map((it) => {
        if (!it.audio) return { start: it.start, words: [] }
        const shown = clipCaptionWords(it.clip, it.audio.meta.words ?? [], it.audio.durationMs ?? UNKNOWN_AUDIO_MS)
        return { start: it.start, words: shown.words, key: it.audio.id, offset: shown.offset }
      })
    )
    return { items, total: acc, chunks }
  }, [clips, assets])
}

/** An audio length to assume when an older asset never recorded its duration. */
export const UNKNOWN_AUDIO_MS = 10 * 60 * 1000

/** Where a clip's voice plays on the timeline, in seconds, and where in its file it starts. */
export function voiceWindow(it: TimelineItem): { from: number; to: number; inSec: number } | null {
  if (!it.audio) return null
  const span = voiceSpan(it.clip, it.audio.durationMs ?? UNKNOWN_AUDIO_MS)
  const from = it.start + span.startMs / 1000
  return { from, to: from + span.playMs / 1000, inSec: span.inMs / 1000 }
}

export function itemAt(items: TimelineItem[], t: number): number {
  if (!items.length) return -1
  const i = items.findIndex((it) => t >= it.start && t < it.end)
  return i === -1 ? items.length - 1 : i
}

const dbToGain = (db: number): number => Math.pow(10, db / 20)

/**
 * Drives the clock and keeps narration and music audio in step with it. An audio element cannot play louder
 * than its file, so when a volume is raised above 0 dB everything is scaled down together: the preview gets
 * quieter overall but keeps the balance the export will have.
 */
export function usePlaybackEngine(
  items: TimelineItem[],
  total: number,
  music: Asset | null,
  musicDb: number,
  duck: boolean,
  voiceDb = 0,
  musicRange: { startSec: number; endSec: number; inSec: number } = { startSec: 0, endSec: Infinity, inSec: 0 },
  sfx: SfxItem[] = [],
  sfxDb = 0
): void {
  const voices = useRef(new Map<string, HTMLAudioElement>())
  const musicEl = useRef<HTMLAudioElement | null>(null)
  const sfxEls = useRef(new Map<string, HTMLAudioElement>())

  useEffect(() => {
    const map = sfxEls.current
    const keep = new Set<string>()
    for (const it of sfx) {
      const key = `${it.id}|${it.file}`
      keep.add(key)
      if (!map.has(key)) {
        const a = new Audio(sfxUrl(it.file))
        a.preload = 'auto'
        a.loop = !!sfxSound(it.sound)?.loop
        map.set(key, a)
      }
    }
    for (const [key, a] of map) {
      if (!keep.has(key)) {
        a.pause()
        map.delete(key)
      }
    }
  }, [sfx])

  useEffect(() => {
    const map = voices.current
    const keep = new Set<string>()
    for (const it of items) {
      if (!it.audio) continue
      const key = `${it.clip.id}|${it.audio.id}`
      keep.add(key)
      if (!map.has(key)) {
        const a = new Audio(it.audio.url)
        a.preload = 'auto'
        map.set(key, a)
      }
    }
    for (const [id, a] of map) {
      if (!keep.has(id)) {
        a.pause()
        map.delete(id)
      }
    }
  }, [items])

  useEffect(() => {
    musicEl.current?.pause()
    if (!music) {
      musicEl.current = null
      return
    }
    const m = new Audio(music.url)
    m.loop = true
    m.preload = 'auto'
    musicEl.current = m
    return () => m.pause()
  }, [music?.id])

  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const voiceGain = (it: TimelineItem): number => dbToGain(voiceDb + (it.clip.voiceGainDb ?? 0))
    const sfxGain = (it: SfxItem): number => dbToGain(it.volumeDb + sfxDb)
    const loudest = Math.max(1, dbToGain(musicDb), ...items.filter((it) => it.audio).map(voiceGain), ...sfx.map(sfxGain))
    const sync = (t: number, playing: boolean): void => {
      let voiceActive = false
      items.forEach((it) => {
        const w = voiceWindow(it)
        if (!w || !it.audio) return
        const a = voices.current.get(`${it.clip.id}|${it.audio.id}`)
        if (!a) return
        a.volume = Math.min(1, voiceGain(it) / loudest)
        // The voice as trimmed and placed in its clip; it stops at the clip's end.
        const target = w.inSec + (t - w.from)
        if (playing && t >= w.from && t < w.to) {
          voiceActive = true
          if (a.paused) {
            a.currentTime = target
            void a.play().catch(() => {})
          } else if (Math.abs(a.currentTime - target) > 0.3) a.currentTime = target
        } else if (!a.paused) a.pause()
      })
      const m = musicEl.current
      if (m) {
        m.volume = Math.min(1, (dbToGain(musicDb) * (duck && voiceActive ? 0.35 : 1)) / loudest)
        if (playing && t >= musicRange.startSec && t < musicRange.endSec) {
          const raw = musicRange.inSec + (t - musicRange.startSec)
          const target = m.duration ? raw % m.duration : raw
          if (m.paused) {
            m.currentTime = target
            void m.play().catch(() => {})
          } else if (Math.abs(m.currentTime - target) > 0.4 && m.duration - Math.abs(m.currentTime - target) > 0.4) m.currentTime = target
        } else if (!m.paused) m.pause()
      }
      // Effects play as sfxPlay says, the same rule the export uses.
      for (const it of sfx) {
        const a = sfxEls.current.get(`${it.id}|${it.file}`)
        if (!a) continue
        const play = sfxPlay(it, total)
        const into = t - play.startSec
        if (playing && into >= 0 && into < play.playSec) {
          a.volume = Math.min(1, (sfxGain(it) * sfxFade(play, into)) / loudest)
          const target = play.loop && a.duration ? into % a.duration : into
          if (a.paused) {
            a.currentTime = target
            void a.play().catch(() => {})
          } else if (!play.loop && Math.abs(a.currentTime - target) > 0.3) a.currentTime = target
        } else if (!a.paused) a.pause()
      }
    }
    const tick = (now: number): void => {
      const s = usePlayback.getState()
      if (s.playing) {
        const t = s.t + (now - last) / 1000
        if (t >= total) usePlayback.setState({ t: total, playing: false })
        else usePlayback.setState({ t })
      }
      last = now
      const st = usePlayback.getState()
      sync(st.t, st.playing)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(raf)
      for (const a of voices.current.values()) a.pause()
      musicEl.current?.pause()
      for (const a of sfxEls.current.values()) a.pause()
    }
  }, [items, total, musicDb, duck, voiceDb, musicRange.startSec, musicRange.endSec, musicRange.inSec, sfx, sfxDb])

  useEffect(() => () => usePlayback.setState({ playing: false }), [])
}
