import { useLayoutEffect, useRef, useState, type PointerEvent, type ReactNode } from 'react'
import { AudioLines, Film, Image as ImageIcon, Layers, Mic, Music, Scissors, Trash2, Type, ZoomIn } from 'lucide-react'
import type { CaptionChunk } from '@shared/captions'
import { overlayEnd } from '@shared/overlays'
import { sfxPlay, sfxSound } from '@shared/sfx'
import { MIN_ITEM_MS, musicSpan, voiceSpan } from '@shared/timeline'
import type { Asset, EditorSettings, Overlay, SfxItem, WordTiming } from '@shared/types'
import { cx } from '../../../components/ui'
import { errorText, timecode } from '../../../lib/format'
import { useApp } from '../../../store/app'
import { useProject } from '../../../store/project'
import { UNKNOWN_AUDIO_MS, updateOverlay, usePlayback, voiceWindow, type TimelineItem } from './engine'
import { updateSfx } from './SfxPanel'
import { TransitionButton } from './TransitionButton'
import { Waveform } from './Waveform'

const LABEL_W = 140
/** Space between the track labels and the start of the time axis. */
const PAD = 8
const ORIGIN = LABEL_W + PAD
const ROW_GAP = 8
const TICK_STEPS = [1, 2, 5, 10, 15, 30, 60, 120]
/** The one look for "this is what the panel is editing", on every track. */
const SELECTED = 'z-[1] ring-2 ring-accent ring-offset-1 ring-offset-surface'
/** How close (in pixels) a dragged edge has to come to the playhead or a clip joint to snap to it. */
const SNAP_PX = 8
const MAX_IMAGE_MS = 120_000

/** What was clicked on the timeline. */
export type TimelinePick =
  | { kind: 'clip'; id: string }
  | { kind: 'voice'; id: string }
  | { kind: 'caption'; chunk: CaptionChunk }
  | { kind: 'music' }
  | { kind: 'overlay'; id: string }
  | { kind: 'sfx'; id: string }
  | { kind: 'transition'; id: string }

/** What the inspector is editing right now, so the timeline can mark it. */
export type TimelineSelection =
  | { kind: 'clip' | 'voice' | 'overlay' | 'sfx' | 'transition'; id: string }
  | { kind: 'caption'; key: string; from: number }
  | { kind: 'music' }
  | null

type Placed = { o: Overlay; start: number; end: number }
type PlacedSfx = { s: SfxItem; start: number; end: number }

/** Sound effects packed into rows the same way, so an ambience and a moment on top of it both stay visible. */
export function sfxLanes(sfx: SfxItem[], total: number): PlacedSfx[][] {
  const lanes: PlacedSfx[][] = []
  for (const s of [...sfx].sort((a, b) => a.start - b.start)) {
    const play = sfxPlay(s, total)
    const start = play.startSec
    const end = play.startSec + play.playSec
    const free = lanes.find((lane) => lane.every((x) => x.end <= start + 1e-6 || x.start >= end - 1e-6))
    if (free) free.push({ s, start, end })
    else lanes.push([{ s, start, end }])
  }
  return lanes
}

/**
 * Overlays packed into rows: each one goes into the first row that is free for its whole time, so overlays
 * that show at the same time get rows of their own instead of covering each other.
 */
export function overlayLanes(overlays: Overlay[], total: number): Placed[][] {
  const lanes: Placed[][] = []
  for (const o of overlays) {
    const start = Math.min(o.start, total)
    const end = overlayEnd(o, total)
    if (end <= start) continue
    const free = lanes.find((lane) => lane.every((x) => x.end <= start + 1e-6 || x.start >= end - 1e-6))
    if (free) free.push({ o, start, end })
    else lanes.push([{ o, start, end }])
  }
  return lanes
}

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v))
const secs = (ms: number): string => `${(ms / 1000).toFixed(1).replace('.', ',')} dtk`
const r2 = (s: number): number => Math.round(s * 100) / 100

/**
 * A caption chunk moved or stretched on the timeline, written back to its voice's word list: every word in
 * the chunk is mapped from the old span onto the new one, the other words stay.
 */
function retimedWords(all: WordTiming[], c: CaptionChunk, start: number, end: number): WordTiming[] {
  const src = c.source!
  const scale = c.end > c.start ? (end - start) / (c.end - c.start) : 1
  const map = (t: number): number => start + (t - c.start) * scale
  const out = [...all]
  c.words.forEach((w, i) => {
    const k = src.from + i
    const orig = all[k]
    if (!orig) return
    out[k] = { ...orig, start: Math.max(0, orig.start + (map(w.start) - w.start)), end: Math.max(0, orig.end + (map(w.end) - w.end)) }
  })
  return out
}

function Playhead({ pps }: { pps: number }) {
  const t = usePlayback((s) => s.t)
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-10 w-0.5 bg-accent" style={{ left: ORIGIN + t * pps }}>
      <span className="absolute -left-[6px] -top-0.5 size-3.5 rounded-[3px] border-[1.5px] border-ink bg-accent" />
    </div>
  )
}

/** One track: a label that stays put while the timeline scrolls sideways, and the items on the time axis. */
function Row({ label, icon, height, children }: { label: string; icon?: ReactNode; height: number; children?: ReactNode }) {
  return (
    <div className="flex" style={{ height: height + ROW_GAP }}>
      <div
        className="sticky left-0 z-20 flex shrink-0 items-start gap-2 bg-surface pl-4 text-[13px] font-semibold"
        style={{ width: LABEL_W, marginRight: PAD, paddingTop: Math.max(0, (height - 20) / 2) }}
      >
        {icon}
        <span className="truncate">{label}</span>
      </div>
      <div className="relative flex-1 self-start" style={{ height }}>
        {children}
      </div>
    </div>
  )
}

type Mode = 'move' | 'left' | 'right'

/** What an item does under the pointer: a press without movement picks it; a drag moves or trims it. */
interface DragSpec {
  click(): void
  /** Starts a drag; returns what each move does (seconds moved; returns the label to show) and how it ends. */
  begin(mode: Mode): { move(d: number): string; end?(): void } | null
}

export function Timeline({
  items,
  chunks,
  music,
  total,
  editor,
  assets,
  selection,
  onPick,
  canSplit,
  canDelete,
  onSplit,
  onDelete
}: {
  items: TimelineItem[]
  chunks: CaptionChunk[]
  music: Asset | null
  total: number
  editor: EditorSettings
  assets: Record<string, Asset>
  selection: TimelineSelection
  onPick: (pick: TimelinePick) => void
  canSplit: boolean
  canDelete: boolean
  onSplit: () => void
  onDelete: () => void
}) {
  const scroller = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1000)
  const [zoom, setZoom] = useState(1)
  const seek = usePlayback((s) => s.seek)
  const updateClip = useProject((s) => s.updateClip)
  const updateEditor = useProject((s) => s.updateEditor)
  const { toast } = useApp()
  // While dragging, the scale stays as it was when the drag began, so a clip that grows does not shrink the view.
  const [frozenPps, setFrozenPps] = useState<number | null>(null)
  const [badge, setBadge] = useState<{ x: number; y: number; text: string } | null>(null)
  const [capDrag, setCapDrag] = useState<{ key: string; from: number; start: number; end: number } | null>(null)
  const drag = useRef<{ x: number; mode: Mode; spec: DragSpec; pps: number; moved: boolean; session: ReturnType<DragSpec['begin']> } | null>(null)

  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const pps = frozenPps ?? Math.max(2, ((width - ORIGIN - 16) / Math.max(total, 1)) * zoom)
  const step = TICK_STEPS.find((s) => s * pps >= 70) ?? 120
  const ticks: number[] = []
  for (let s = 0; s <= total + 0.001; s += step) ticks.push(s)
  const lanes = overlayLanes(editor.overlays ?? [], total)
  const fxLanes = sfxLanes(editor.sfx ?? [], total)
  const ms = musicSpan(editor, total)

  // Edges snap to the playhead and to the joints between clips.
  const joints = [0, total, ...items.map((it) => it.end)]
  const snap = (sec: number, withJoints = true): number => {
    const tol = SNAP_PX / (drag.current?.pps ?? pps)
    let best = sec
    let bestD = tol
    for (const p of [usePlayback.getState().t, ...(withJoints ? joints : [])]) {
      const d = Math.abs(p - sec)
      if (d < bestD) {
        best = p
        bestD = d
      }
    }
    return best
  }

  const seekFrom = (e: PointerEvent<HTMLDivElement>): void => {
    const el = scroller.current!
    const x = e.clientX - el.getBoundingClientRect().left
    if (x < LABEL_W) return
    seek(Math.min(total, Math.max(0, (x + el.scrollLeft - ORIGIN) / pps)))
  }

  const is = (kind: string, id?: string): boolean => !!selection && selection.kind === kind && (id === undefined || ('id' in selection && selection.id === id))
  const pick = (p: TimelinePick, at?: number): void => {
    if (at !== undefined) seek(Math.min(total, Math.max(0, at)))
    onPick(p)
  }

  const finish = (cancel: boolean): void => {
    const d = drag.current
    drag.current = null
    if (!d) return
    if (d.moved) {
      if (!cancel) d.session?.end?.()
      setFrozenPps(null)
      setBadge(null)
    } else if (!cancel) d.spec.click()
  }
  const on = (spec: DragSpec, mode: Mode) => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      e.stopPropagation()
      if (e.button !== 0) return
      try {
        e.currentTarget.setPointerCapture(e.pointerId)
      } catch {
        // Without capture the drag still follows the pointer while it stays over the item.
      }
      drag.current = { x: e.clientX, mode, spec, pps, moved: false, session: null }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const d = drag.current
      if (!d) return
      const dx = e.clientX - d.x
      if (!d.moved) {
        if (Math.abs(dx) < 4) return
        d.moved = true
        d.session = d.spec.begin(d.mode)
        setFrozenPps(d.pps)
      }
      const text = d.session?.move(dx / d.pps)
      if (text) setBadge({ x: e.clientX, y: e.clientY, text })
    },
    onPointerUp: () => finish(false),
    onPointerCancel: () => finish(true)
  })
  /** The two trim handles on an item's edges, with a grip that shows on hover and while the item is selected. */
  const edges = (spec: DragSpec, label: string, selected: boolean): ReactNode =>
    (['left', 'right'] as const).map((side) => (
      <span
        key={side}
        {...on(spec, side)}
        title={`Tarik untuk mengatur ${side === 'left' ? 'awal' : 'akhir'} ${label}`}
        className={cx(
          'group/edge absolute inset-y-0 z-[4] flex w-2.5 cursor-ew-resize items-center justify-center hover:bg-ink/20',
          side === 'left' ? 'left-0 rounded-l-[inherit]' : 'right-0 rounded-r-[inherit]'
        )}
      >
        <span className={cx('h-1/2 max-h-6 w-[3px] rounded-full bg-ink/70 transition-opacity', selected ? 'opacity-100' : 'opacity-0 group-hover/edge:opacity-100')} />
      </span>
    ))

  // ---- clips: the right edge sets the length, the left edge trims the start (a video starts later in its file) ----
  const clipSpec = (it: TimelineItem): DragSpec => ({
    click: () => pick({ kind: 'clip', id: it.clip.id }, it.start),
    begin: (mode) => {
      if (mode === 'move') return null
      const dur0 = it.clip.durationMs
      const in0 = it.clip.mediaInMs ?? 0
      const videoMs = it.clip.motionType === 'video' && it.video?.durationMs ? it.video.durationMs : null
      return {
        move: (d) => {
          if (mode === 'right') {
            // A video can be shortened, but never made longer than what is left of it.
            const max = videoMs ? Math.max(videoMs - in0, dur0) : MAX_IMAGE_MS
            const dur = clamp(Math.round((snap(it.start + dur0 / 1000 + d, false) - it.start) * 1000), MIN_ITEM_MS, max)
            updateClip(it.clip.id, { durationMs: dur })
            return videoMs && dur >= videoMs - in0 ? `${secs(dur)} · batas panjang video` : secs(dur)
          }
          // The clip stays joined to the one before it, so its start edge shortens or lengthens it.
          if (videoMs) {
            const mediaIn = clamp(in0 + Math.round(d * 1000), 0, videoMs - MIN_ITEM_MS)
            const dur = clamp(dur0 - (mediaIn - in0), MIN_ITEM_MS, Math.max(videoMs - mediaIn, MIN_ITEM_MS))
            updateClip(it.clip.id, { mediaInMs: mediaIn, durationMs: dur })
            return `video mulai ${secs(mediaIn)} · ${secs(dur)}`
          }
          const dur = clamp(dur0 - Math.round(d * 1000), MIN_ITEM_MS, MAX_IMAGE_MS)
          updateClip(it.clip.id, { durationMs: dur })
          return secs(dur)
        }
      }
    }
  })

  // ---- voices: trim either edge, or move inside the clip ----
  const voiceSpec = (it: TimelineItem): DragSpec => ({
    click: () => pick({ kind: 'voice', id: it.clip.id }, it.start),
    begin: (mode) => {
      if (!it.audio) return null
      const audioMs = it.audio.durationMs ?? UNKNOWN_AUDIO_MS
      const in0 = it.clip.voiceInMs ?? 0
      const out0 = it.clip.voiceOutMs ?? audioMs
      const start0 = it.clip.voiceStartMs ?? 0
      return {
        move: (d) => {
          const dms = Math.round(d * 1000)
          if (mode === 'move') {
            const start = clamp(Math.round((snap(it.start + (start0 + dms) / 1000) - it.start) * 1000), 0, it.clip.durationMs - MIN_ITEM_MS)
            updateClip(it.clip.id, { voiceStartMs: start })
            return `mulai ${secs(start)} di klip`
          }
          if (mode === 'left') {
            const dd = clamp(dms, Math.max(-in0, -start0), out0 - MIN_ITEM_MS - in0)
            updateClip(it.clip.id, { voiceInMs: in0 + dd, voiceStartMs: start0 + dd })
            return secs(out0 - in0 - dd)
          }
          const endT = snap(it.start + (start0 + out0 - in0 + dms) / 1000)
          const out = clamp(Math.round(in0 + (endT - it.start) * 1000 - start0), in0 + MIN_ITEM_MS, audioMs)
          updateClip(it.clip.id, { voiceOutMs: out >= audioMs ? null : out })
          return secs(out - in0)
        }
      }
    }
  })

  // ---- captions: move or stretch a chunk; its words are re-timed when the drag ends ----
  const captionSpec = (c: CaptionChunk, i: number): DragSpec => ({
    click: () => c.source && pick({ kind: 'caption', chunk: c }, c.start + 0.01),
    begin: (mode) => {
      const src = c.source
      const item = src && items.find((it) => it.audio?.id === src.key)
      const win = item && voiceWindow(item)
      if (!src || !win) return null
      const prev = chunks[i - 1]?.source?.key === src.key ? chunks[i - 1] : null
      const next = chunks[i + 1]?.source?.key === src.key ? chunks[i + 1] : null
      const lo = prev ? prev.end : win.from
      const hi = next ? next.start : win.to
      let start = c.start
      let end = c.end
      return {
        move: (d) => {
          if (mode === 'move') {
            const len = c.end - c.start
            start = clamp(snap(c.start + d), lo, Math.max(lo, hi - len))
            end = start + len
          } else if (mode === 'left') start = clamp(snap(c.start + d), lo, c.end - 0.15)
          else end = clamp(snap(c.end + d), c.start + 0.15, hi)
          setCapDrag({ key: src.key, from: src.from, start, end })
          return `${timecode(start)} – ${timecode(end)}`
        },
        end: () => {
          setCapDrag(null)
          const asset = assets[src.key]
          if (!asset || (start === c.start && end === c.end)) return
          window.api.assets.setWords(asset.id, retimedWords(asset.meta.words ?? [], c, start, end)).catch((e) => toast('error', errorText(e)))
        }
      }
    }
  })

  // ---- music: trim either edge (the song keeps its place), or move it ----
  const musicSpec: DragSpec = {
    click: () => pick({ kind: 'music' }),
    begin: (mode) => {
      const m0 = musicSpan(editor, total)
      const len = m0.endSec - m0.startSec
      const toMs = (s: number): number => Math.round(s * 1000)
      return {
        move: (d) => {
          if (mode === 'move') {
            const s = clamp(snap(m0.startSec + d), 0, Math.max(0, total - len))
            updateEditor({ musicStartMs: toMs(s), musicEndMs: s + len >= total - 0.01 ? null : toMs(s + len) })
            return `${timecode(s)} – ${timecode(s + len)}`
          }
          if (mode === 'left') {
            const s = clamp(snap(m0.startSec + d), Math.max(0, m0.startSec - m0.inSec), m0.endSec - 0.5)
            updateEditor({ musicStartMs: toMs(s), musicInMs: toMs(m0.inSec + (s - m0.startSec)) })
            return `mulai ${timecode(s)}`
          }
          const e = clamp(snap(m0.endSec + d), m0.startSec + 0.5, total)
          updateEditor({ musicEndMs: e >= total - 0.01 ? null : toMs(e) })
          return `selesai ${timecode(e)}`
        }
      }
    }
  }

  // ---- overlays: trim either edge, or move ----
  const overlaySpec = (o: Overlay, start: number, end: number): DragSpec => ({
    click: () => pick({ kind: 'overlay', id: o.id }, start + 0.01),
    begin: (mode) => {
      const len = end - start
      return {
        move: (d) => {
          if (mode === 'move') {
            const s = r2(clamp(snap(start + d), 0, Math.max(0, total - len)))
            updateOverlay(o.id, { start: s, end: s + len >= total - 0.01 ? null : r2(s + len) })
            return `${timecode(s)} – ${timecode(s + len)}`
          }
          if (mode === 'left') {
            const s = r2(clamp(snap(start + d), 0, end - MIN_ITEM_MS / 1000))
            updateOverlay(o.id, { start: s })
            return `mulai ${timecode(s)}`
          }
          const e = r2(clamp(snap(end + d), start + MIN_ITEM_MS / 1000, total))
          updateOverlay(o.id, { end: e >= total - 0.01 ? null : e })
          return `selesai ${timecode(e)}`
        }
      }
    }
  })

  // ---- sound effects: move, or set the length with the right edge (one-shots stop at the end of their file) ----
  const sfxSpec = (s: SfxItem, start: number, end: number): DragSpec => ({
    click: () => pick({ kind: 'sfx', id: s.id }, start + 0.01),
    begin: (mode) => {
      const len = end - start
      return {
        move: (d) => {
          if (mode === 'right') {
            const e = r2(clamp(snap(end + d), start + 0.1, total))
            updateSfx(s.id, { length: r2(e - start) })
            return `durasi ${timecode(e - start)}`
          }
          if (mode === 'left') {
            const st = r2(clamp(snap(start + d), 0, end - 0.1))
            updateSfx(s.id, { start: st, length: r2(end - st) })
            return `mulai ${timecode(st)}`
          }
          const st = r2(clamp(snap(start + d), 0, Math.max(0, total - Math.min(len, 0.1))))
          updateSfx(s.id, { start: st })
          return `mulai ${timecode(st)}`
        }
      }
    }
  })

  const btn =
    'inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-2 bg-surface px-2.5 text-[13px] font-medium text-ink hover:border-ink-2 disabled:cursor-not-allowed disabled:opacity-40'

  return (
    <section className="flex min-h-0 min-w-0 flex-col border-t border-line-2 bg-surface">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-line px-4 text-[13px] text-ink-2">
        <button type="button" className={btn} disabled={!canSplit} onClick={onSplit} title="Potong di posisi playhead (S)">
          <Scissors className="size-4" />
          Potong
        </button>
        <button type="button" className={btn} disabled={!canDelete} onClick={onDelete} title="Hapus item yang dipilih (Delete)">
          <Trash2 className="size-4" />
          Hapus
        </button>
        <span className="ml-2 min-w-0 truncate">Klik untuk memilih, tarik tepinya untuk mengubah durasi, geser untuk memindahkan.</span>
        <span className="flex-1" />
        <label className="flex shrink-0 items-center gap-2">
          <ZoomIn className="size-4" />
          Zoom
          <input type="range" min={1} max={8} step={0.25} value={zoom} onChange={(e) => setZoom(Number(e.target.value))} aria-label="Zoom timeline" className="w-32" />
        </label>
      </div>
      <div
        ref={scroller}
        className="scroll-thin relative min-h-0 flex-1 overflow-auto pt-1.5"
        onPointerDown={(e) => {
          if (e.clientX - e.currentTarget.getBoundingClientRect().left < LABEL_W) return
          e.currentTarget.setPointerCapture(e.pointerId)
          seekFrom(e)
        }}
        onPointerMove={(e) => e.buttons === 1 && e.currentTarget.hasPointerCapture(e.pointerId) && seekFrom(e)}
      >
        <div className="relative" style={{ width: ORIGIN + total * pps + 16 }}>
          <Row label="" height={22}>
            {ticks.map((s) => (
              <span key={s} className="absolute top-0 h-[21px] border-l border-line-2 pl-1 font-mono text-[11px] text-muted" style={{ left: s * pps }}>
                {Math.floor(s / 60)}:{String(Math.round(s % 60)).padStart(2, '0')}
              </span>
            ))}
          </Row>

          <Row label="Klip" icon={<ImageIcon className="size-4" />} height={64}>
            {items.map((it) => {
              const spec = clipSpec(it)
              const videoLeft = it.clip.motionType === 'video' && it.video?.durationMs ? it.video.durationMs - (it.clip.mediaInMs ?? 0) : null
              const held = videoLeft != null && it.clip.durationMs > videoLeft + 50 ? (it.clip.durationMs - videoLeft) / 1000 : 0
              return (
                <div
                  key={it.clip.id}
                  role="button"
                  tabIndex={0}
                  {...on(spec, 'move')}
                  onKeyDown={(e) => e.key === 'Enter' && spec.click()}
                  aria-label={`Klip ${it.index + 1} ${it.clip.title}`}
                  aria-pressed={is('clip', it.clip.id)}
                  className={cx(
                    'absolute top-0 flex h-16 cursor-pointer select-none flex-col justify-between overflow-hidden rounded-lg border border-ink bg-sand bg-cover bg-center p-1.5 text-left',
                    is('clip', it.clip.id) && SELECTED
                  )}
                  style={{
                    left: it.start * pps + 1,
                    width: Math.max(8, (it.end - it.start) * pps - 3),
                    backgroundImage: it.image ? `url("${it.image.url}")` : undefined
                  }}
                >
                  <span className="pointer-events-none flex items-center gap-1 self-start">
                    <span className="rounded-[5px] border border-ink bg-surface px-1 font-mono text-[11px]">{String(it.index + 1).padStart(2, '0')}</span>
                    {it.clip.motionType === 'video' && it.video && (
                      <span className="flex size-[18px] items-center justify-center rounded-[5px] bg-ink text-paper">
                        <Film className="size-3" />
                      </span>
                    )}
                  </span>
                  <span className="pointer-events-none max-w-full truncate rounded bg-surface/85 px-1 text-xs font-semibold">{it.clip.title}</span>
                  {held > 0 && (
                    <span
                      title="Videonya sudah habis di sini; frame terakhirnya ditahan"
                      className="pointer-events-none absolute inset-y-0 right-0 bg-[repeating-linear-gradient(135deg,rgba(31,29,26,0.35)_0_4px,transparent_4px_8px)]"
                      style={{ width: held * pps }}
                    />
                  )}
                  {edges(spec, 'klip', is('clip', it.clip.id))}
                </div>
              )
            })}
            {/* One button on each joint: the transition belongs to the clip before it. */}
            {items.slice(1).map((it, i) => (
              <TransitionButton
                key={`tr-${items[i].clip.id}`}
                clip={items[i].clip}
                next={it.clip}
                x={it.start * pps}
                selected={is('transition', items[i].clip.id)}
                onPick={() => pick({ kind: 'transition', id: items[i].clip.id })}
              />
            ))}
          </Row>

          <Row label="Caption" icon={<Type className="size-4" />} height={30}>
            {chunks.map((c, i) => {
              const selected = !!c.source && selection?.kind === 'caption' && selection.key === c.source.key && selection.from === c.source.from
              const live = capDrag && c.source && capDrag.key === c.source.key && capDrag.from === c.source.from ? capDrag : null
              const start = live ? live.start : c.start
              const end = live ? live.end : c.end
              const text = c.words.map((w) => w.text).join(' ')
              const spec = captionSpec(c, i)
              return (
                <div
                  key={i}
                  role="button"
                  tabIndex={0}
                  {...on(spec, 'move')}
                  onKeyDown={(e) => e.key === 'Enter' && spec.click()}
                  title={`${text} (klik untuk edit teks)`}
                  aria-pressed={selected}
                  className={cx(
                    'absolute top-0 flex h-[30px] cursor-pointer select-none items-center overflow-hidden whitespace-nowrap rounded-md border border-sun-line bg-sun-soft px-1.5 text-xs text-sun-ink hover:border-sun-ink',
                    selected && SELECTED
                  )}
                  style={{ left: start * pps + 1, width: Math.max(4, (end - start) * pps - 2) }}
                >
                  <span className="pointer-events-none truncate">{text}</span>
                  {edges(spec, 'caption', selected)}
                </div>
              )
            })}
          </Row>

          <Row label="Suara TTS" icon={<Mic className="size-4" />} height={40}>
            {items.map((it) => {
              if (!it.audio) return null
              const span = voiceSpan(it.clip, it.audio.durationMs ?? UNKNOWN_AUDIO_MS)
              if (span.playMs <= 0) return null
              const spec = voiceSpec(it)
              const cut = span.lengthMs > span.playMs + 30
              return (
                <div
                  key={`${it.clip.id}-${it.audio.id}`}
                  role="button"
                  tabIndex={0}
                  {...on(spec, 'move')}
                  onKeyDown={(e) => e.key === 'Enter' && spec.click()}
                  aria-label={`Suara klip ${it.index + 1}`}
                  aria-pressed={is('voice', it.clip.id)}
                  className={cx(
                    'absolute top-0 flex h-10 cursor-pointer select-none items-center overflow-hidden rounded-md border border-line-2 bg-stage px-1 hover:border-ink-2',
                    is('voice', it.clip.id) && SELECTED
                  )}
                  style={{ left: (it.start + span.startMs / 1000) * pps + 1, width: Math.max(4, (span.playMs / 1000) * pps - 2) }}
                >
                  <Waveform url={it.audio.url} className="pointer-events-none h-8 w-full" />
                  {cut && (
                    <span
                      title="Suaranya terpotong di akhir klip. Panjangkan klip, atau potong suaranya."
                      className="pointer-events-none absolute inset-y-0 right-0 w-1 bg-bad-ink"
                    />
                  )}
                  {edges(spec, 'suara', is('voice', it.clip.id))}
                </div>
              )
            })}
          </Row>

          <Row label="Musik" icon={<Music className="size-4" />} height={30}>
            {music && (
              <div
                role="button"
                tabIndex={0}
                {...on(musicSpec, 'move')}
                onKeyDown={(e) => e.key === 'Enter' && musicSpec.click()}
                aria-pressed={is('music')}
                aria-label="Musik latar"
                className={cx(
                  'absolute top-0 flex h-[30px] cursor-pointer select-none items-center gap-2 overflow-hidden whitespace-nowrap rounded-md border border-ok-line bg-ok-soft px-2.5 text-xs text-ok-ink hover:border-ok-ink',
                  is('music') && SELECTED
                )}
                style={{ left: ms.startSec * pps + 1, width: Math.max(10, (ms.endSec - ms.startSec) * pps - 2) }}
              >
                <Music className="pointer-events-none size-3.5 shrink-0" />
                <span className="pointer-events-none truncate">{music.prompt ?? 'Musik latar'}</span>
                {edges(musicSpec, 'musik', is('music'))}
              </div>
            )}
          </Row>

          {(lanes.length ? lanes : [[]]).map((lane, li) => (
            <Row key={li} label={li === 0 ? 'Overlay' : `Overlay ${li + 1}`} icon={<Layers className="size-4" />} height={30}>
              {lane.map(({ o, start, end }) => {
                const label = o.kind === 'text' ? o.text.split('\n')[0] || 'Teks' : (assets[o.assetId]?.prompt ?? 'Gambar')
                const spec = overlaySpec(o, start, end)
                return (
                  <div
                    key={o.id}
                    role="button"
                    tabIndex={0}
                    {...on(spec, 'move')}
                    onKeyDown={(e) => e.key === 'Enter' && spec.click()}
                    aria-pressed={is('overlay', o.id)}
                    title={label}
                    className={cx(
                      'absolute top-0 flex h-[30px] cursor-pointer select-none items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-md border px-2 text-xs font-medium',
                      o.kind === 'image' ? 'border-info-line bg-info-soft text-info-ink' : 'border-violet-line bg-violet-soft text-violet-ink',
                      is('overlay', o.id) && SELECTED
                    )}
                    style={{ left: start * pps + 1, width: Math.max(10, (end - start) * pps - 2) }}
                  >
                    {o.kind === 'image' ? <ImageIcon className="pointer-events-none size-3.5 shrink-0" /> : <Type className="pointer-events-none size-3.5 shrink-0" />}
                    <span className="pointer-events-none truncate">{label}</span>
                    {edges(spec, 'overlay', is('overlay', o.id))}
                  </div>
                )
              })}
            </Row>
          ))}

          {(fxLanes.length ? fxLanes : [[]]).map((lane, li) => (
            <Row key={`sfx-${li}`} label={li === 0 ? 'SFX' : `SFX ${li + 1}`} icon={<AudioLines className="size-4" />} height={26}>
              {lane.map(({ s, start, end }) => {
                const sound = sfxSound(s.sound)
                const spec = sfxSpec(s, start, end)
                const ambience = sound?.role === 'ambience'
                return (
                  <div
                    key={s.id}
                    role="button"
                    tabIndex={0}
                    {...on(spec, 'move')}
                    onKeyDown={(e) => e.key === 'Enter' && spec.click()}
                    aria-pressed={is('sfx', s.id)}
                    title={`${sound?.label ?? s.sound}${s.auto ? ' (otomatis)' : ''}`}
                    className={cx(
                      'absolute top-0 flex h-[26px] cursor-pointer select-none items-center gap-1 overflow-hidden whitespace-nowrap rounded-md border px-1.5 text-[11px] font-medium',
                      ambience ? 'border-teal-line bg-teal-soft text-teal-ink' : 'border-amber-line bg-amber-soft text-amber-ink',
                      is('sfx', s.id) && SELECTED
                    )}
                    style={{ left: start * pps + 1, width: Math.max(6, (end - start) * pps - 2) }}
                  >
                    <span className="pointer-events-none truncate">{sound?.label ?? s.sound}</span>
                    {edges(spec, 'SFX', is('sfx', s.id))}
                  </div>
                )
              })}
            </Row>
          ))}

          <Playhead pps={pps} />
        </div>
      </div>
      {badge && (
        <span
          className="pointer-events-none fixed z-50 -translate-x-1/2 rounded-md bg-ink px-2 py-1 font-mono text-[11px] text-paper shadow-lg"
          style={{ left: badge.x, top: badge.y - 34 }}
        >
          {badge.text}
        </span>
      )}
    </section>
  )
}
