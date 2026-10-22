import { useEffect, useRef, useState } from 'react'
import { AudioLines, Check, Clapperboard, Copy, ExternalLink, Film, Layers, Mic, Move, Music, Play, Sparkles, Type, Volume2, X } from 'lucide-react'
import {
  CAPTION_FONTS,
  CAPTION_POSITIONS,
  CAPTION_STYLES,
  captionNeedsSync,
  captionScaleOf,
  getCaptionFont,
  replaceCaptionWords,
  resolveCaption
} from '@shared/captions'
import { CAMERA_PRESETS, MOTION_STRENGTHS } from '@shared/motion'
import { geminiVoiceName } from '@shared/models'
import { voiceSpan } from '@shared/timeline'
import type { Asset, Clip, WordTiming } from '@shared/types'
import { Select } from '../../../components/Select'
import { AutoTextarea } from '../../../components/AutoTextarea'
import { Button, Segmented, Switch, cx, inputCls } from '../../../components/ui'
import { clipNumber, errorText, secLabel, timecode } from '../../../lib/format'
import { useApp } from '../../../store/app'
import { ELEVENLABS_URL } from '../../../lib/links'
import { useMusicFit } from '../../../lib/useMusicFit'
import { useNarration } from '../../../lib/useNarration'
import { isRunning, jobFor, useProject } from '../../../store/project'
import { UNKNOWN_AUDIO_MS, useAudition, useCaptionUi, useTimeline } from './engine'
import { OverlayPanel } from './OverlayPanel'
import { SfxPanel } from './SfxPanel'
import { TransitionPanel } from './TransitionPanel'

/** 'transisi' has no button on the rail; it opens from the round buttons between clips on the timeline. */
export type InspectorTab = 'klip' | 'suara' | 'caption' | 'overlay' | 'musik' | 'sfx' | 'transisi'

export const INSPECTOR_TABS: { id: InspectorTab; label: string; icon: typeof Move }[] = [
  { id: 'klip', label: 'Klip', icon: Move },
  { id: 'suara', label: 'Suara', icon: Mic },
  { id: 'caption', label: 'Caption', icon: Type },
  { id: 'overlay', label: 'Overlay', icon: Layers },
  { id: 'musik', label: 'Musik', icon: Music },
  { id: 'sfx', label: 'SFX', icon: AudioLines }
]

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-2.5 border-b border-line px-[18px] py-4', className)}>
      <span className="text-sm font-semibold">{title}</span>
      {children}
    </div>
  )
}

function ClipHeader({ clip, index }: { clip: Clip; index: number }) {
  return (
    <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-[18px]">
      <span className="rounded-md bg-ink px-[7px] py-0.5 font-mono text-xs text-paper">{clipNumber(index)}</span>
      <span className="truncate text-[15px] font-semibold">{clip.title}</span>
      <span className="flex-1" />
      <span className="font-mono text-xs text-muted">{secLabel(clip.durationMs)}</span>
    </div>
  )
}

const VIDEO_CAMERA_OPTIONS = [
  { value: 'static' as const, label: 'Diam (ikuti video)' },
  ...CAMERA_PRESETS.filter((p) => p.id !== 'static').map((p) => ({ value: p.id, label: p.label }))
]

function ClipTab({ clip, index }: { clip: Clip; index: number }) {
  const { assets, jobs, updateClip, flush } = useProject()
  const { toast } = useApp()
  const image = clip.imageAssetId ? assets[clip.imageAssetId] : null
  const video = clip.videoAssetId ? assets[clip.videoAssetId] : null
  const videoJob = jobFor(jobs, 'video', { clipId: clip.id })
  const videoCamera = clip.videoCamera ?? 'static'
  // A camera change plays the clip in the preview at once, without moving the playhead.
  const audition = (): void => useAudition.getState().start({ kind: 'clip', clipId: clip.id })
  const setCamera = (patch: Partial<Clip>): void => {
    updateClip(clip.id, patch)
    audition()
  }
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    try {
      await flush()
      await fn()
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <>
      <ClipHeader clip={clip} index={index} />
      {clip.motionType === 'video' ? (
        <Section title="Video AI">
          {video ? (
            <p className="text-[13px] text-ink-2">Klip ini memakai video dari Higgsfield.</p>
          ) : (
            <p className="text-[13px] text-ink-2">Video belum dibuat. Sampai video siap, pratinjau memakai gambar diam.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              variant={video ? 'secondary' : 'accent'}
              icon={<Clapperboard className="size-4" />}
              loading={isRunning(videoJob)}
              disabled={!image}
              onClick={() => void run(() => window.api.generate.clipVideo(clip.id))}
            >
              {video ? 'Buat ulang video' : 'Buat video'}
            </Button>
            <Button size="sm" icon={<Move className="size-4" />} onClick={() => updateClip(clip.id, { motionType: 'camera' })}>
              Kembali ke gerak kamera
            </Button>
          </div>
          {isRunning(videoJob) && (
            <span className="text-xs text-sun-ink">
              {videoJob!.message ?? 'Memproses'} {Math.round(videoJob!.progress * 100)}%
            </span>
          )}
          <div className="mt-1 flex flex-col gap-2">
            <span className="text-[13px] font-medium text-ink-2">Gerak kamera di atas video</span>
            <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
              <Select
                label="Gerak kamera video"
                size="sm"
                value={videoCamera}
                onChange={(v) => setCamera({ videoCamera: v })}
                options={VIDEO_CAMERA_OPTIONS}
              />
              <Select
                label="Kekuatan gerak video"
                size="sm"
                value={clip.videoStrength ?? 'halus'}
                disabled={videoCamera === 'static'}
                onChange={(v) => setCamera({ videoStrength: v })}
                options={MOTION_STRENGTHS.map((m) => ({ value: m.id, label: m.label }))}
              />
            </div>
            <p className="text-xs leading-relaxed text-muted">
              Video AI sudah bergerak sendiri. Tambahkan zoom atau geser kalau ingin efek kamera di atasnya.
            </p>
            <Button size="sm" variant="ghost" className="self-start" icon={<Play className="size-4" />} onClick={audition}>
              Putar pratinjau gerak
            </Button>
          </div>
        </Section>
      ) : (
        <Section title="Animasi kamera">
          <div className="grid grid-cols-[minmax(0,1fr)_120px] gap-2">
            <Select
              label="Gerak kamera"
              size="sm"
              value={clip.cameraPreset}
              onChange={(v) => setCamera({ cameraPreset: v })}
              options={CAMERA_PRESETS.map((p) => ({ value: p.id, label: p.label }))}
            />
            <Select
              label="Kekuatan gerak"
              size="sm"
              value={clip.motionStrength}
              onChange={(v) => setCamera({ motionStrength: v })}
              options={MOTION_STRENGTHS.map((m) => ({ value: m.id, label: m.label }))}
            />
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={<Play className="size-4" />} disabled={!image} onClick={audition}>
              Putar pratinjau gerak
            </Button>
            <Button
              size="sm"
              icon={<Film className="size-4" />}
              disabled={!image}
              onClick={() => {
                updateClip(clip.id, { motionType: 'video' })
                if (!video) void run(() => window.api.generate.clipVideo(clip.id))
              }}
            >
              Jadikan video AI
            </Button>
          </div>
          <p className="text-xs leading-relaxed text-muted">Ganti gerakan atau kekuatannya untuk langsung melihatnya di pratinjau.</p>
        </Section>
      )}
    </>
  )
}

function DbSlider({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  return (
    <div className="flex items-center gap-3 text-[13px]">
      <input type="range" min={min} max={max} step={1} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className="flex-1" />
      <span className="w-14 text-right font-mono">
        {value > 0 ? '+' : ''}
        {value} dB
      </span>
      <button
        type="button"
        onClick={() => onChange(0)}
        disabled={value === 0}
        className="text-xs font-semibold text-accent-dark hover:underline disabled:invisible"
      >
        Normal
      </button>
    </div>
  )
}

/** Which part of the take plays in the clip, and what the clip's end cuts off. */
function VoiceTrim({ clip, voice }: { clip: Clip; voice: Asset }) {
  const { updateClip, assets } = useProject()
  const span = voiceSpan(clip, voice.durationMs ?? UNKNOWN_AUDIO_MS)
  const trimmed = (clip.voiceInMs ?? 0) > 0 || clip.voiceOutMs != null || (clip.voiceStartMs ?? 0) > 0
  const cutMs = span.lengthMs - span.playMs
  const video = clip.motionType === 'video' && clip.videoAssetId ? assets[clip.videoAssetId] : null
  const room = video?.durationMs ? video.durationMs - (clip.mediaInMs ?? 0) : Infinity
  const needed = span.startMs + span.lengthMs + 300
  if (!trimmed && cutMs <= 30) return null
  return (
    <Section title="Potongan suara">
      {cutMs > 30 && (
        <>
          <p className="text-xs leading-relaxed text-bad-ink">
            Akhir suaranya ({secLabel(cutMs)}) terpotong karena klip lebih pendek dari narasinya.
          </p>
          {needed <= room && (
            <Button size="sm" className="self-start" onClick={() => updateClip(clip.id, { durationMs: needed })}>
              Panjangkan klip ke {secLabel(needed)}
            </Button>
          )}
        </>
      )}
      {trimmed && (
        <>
          <p className="text-xs leading-relaxed text-muted">
            Dipakai detik {secLabel(span.inMs)} sampai {secLabel(span.inMs + span.lengthMs)} dari rekamannya, mulai {secLabel(span.startMs)} setelah klip dimulai.
          </p>
          <Button size="sm" variant="ghost" className="self-start" onClick={() => updateClip(clip.id, { voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 })}>
            Kembalikan suara utuh
          </Button>
        </>
      )}
    </Section>
  )
}

/** The narration of one clip: its text, voice, and volume (opened from the TTS track or the Suara tab). */
function VoiceTab({ clip, index }: { clip: Clip; index: number }) {
  const { project, assets, updateClip, updateEditor } = useProject()
  const narration = useNarration()
  if (!project) return null
  const voice = clip.audioAssetId ? assets[clip.audioAssetId] : null
  const stale = !!voice && (voice.prompt ?? '').trim() !== clip.narration.trim()
  const voiceId = typeof voice?.meta.voice === 'string' ? voice.meta.voice : ''
  const voiceName = voiceId && voice?.provider === 'gemini' ? geminiVoiceName(voiceId) : voiceId
  return (
    <>
      <ClipHeader clip={clip} index={index} />
      <Section title="Suara narasi">
        <p className="text-[13px] leading-relaxed text-ink-2">{clip.narration || 'Naskah masih kosong.'}</p>
        {/* Voices come from one take of the whole script, so a change is fixed by re-recording that take. */}
        {narration.running ? (
          <span className="text-xs text-sun-ink">Suara narasi sedang dibuat…</span>
        ) : !voice || stale ? (
          <div className="flex flex-col items-start gap-2">
            <span className="text-xs text-ink-2">{voice ? 'Naskah berubah sejak suara dibuat.' : 'Klip ini belum punya suara.'}</span>
            <Button size="sm" variant="accent" icon={<Volume2 className="size-4" />} onClick={() => void narration.start()}>
              {narration.voiced ? 'Rekam ulang suara narasi' : 'Buat suara narasi'}
            </Button>
          </div>
        ) : (
          <span className="text-xs text-muted">
            {[voiceName && `Suara ${voiceName}`, secLabel(voice.durationMs ?? clip.durationMs), voice.meta.estimatedTimings && 'waktu caption masih perkiraan']
              .filter(Boolean)
              .join(' · ')}
          </span>
        )}
      </Section>
      {voice && (
        <Section title="Volume klip ini">
          <DbSlider label="Volume suara klip ini" value={clip.voiceGainDb ?? 0} min={-12} max={12} onChange={(v) => updateClip(clip.id, { voiceGainDb: v })} />
          <p className="text-xs leading-relaxed text-muted">Naikkan kalau suara klip ini terdengar lebih pelan dari klip lainnya.</p>
        </Section>
      )}
      {voice && <VoiceTrim clip={clip} voice={voice} />}
      <Section title="Volume semua narasi" className="border-b-0">
        <DbSlider label="Volume semua narasi" value={project.editor.voiceVolumeDb ?? 0} min={-20} max={6} onChange={(v) => updateEditor({ voiceVolumeDb: v })} />
        <p className="text-xs leading-relaxed text-muted">
          Mengatur keseimbangan narasi dengan musik latar. Saat ekspor, volume akhirnya tetap disamakan ke standar YouTube kalau opsi itu aktif.
        </p>
      </Section>
    </>
  )
}

/** The words the caption editor is changing: in one voice asset, starting at `from`, `count` long. */
type CaptionRange = { key: string; from: number; count: number }

/**
 * Fixes the text of the caption chunk picked on the timeline. Typing saves on its own after a short pause and
 * the preview follows; the words keep their time span. The editor owns the words it was opened on (and as
 * many as were typed since), so re-chunking after a save never makes it overwrite the next caption.
 */
function CaptionTextEditor() {
  const selected = useCaptionUi((s) => s.selected)
  const select = useCaptionUi((s) => s.select)
  const { items, chunks } = useTimeline()
  const { toast } = useApp()
  const [text, setText] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved'>('idle')
  const range = useRef<CaptionRange | null>(null)
  const pending = useRef<{ range: CaptionRange; value: string; timer: number } | null>(null)
  // Saves run one after another, each on the word list the previous one produced.
  const chain = useRef<Promise<void>>(Promise.resolve())
  const latest = useRef(new Map<string, WordTiming[]>())

  const save = (r: CaptionRange, value: string): void => {
    const tokens = value.split(/\s+/).filter(Boolean)
    // An emptied field keeps the last text until something new is typed.
    if (!tokens.length) return
    chain.current = chain.current.then(async () => {
      const words = latest.current.get(r.key) ?? useProject.getState().assets[r.key]?.meta.words ?? []
      setStatus('saving')
      try {
        const fresh = await window.api.assets.setWords(r.key, replaceCaptionWords(words, r.from, r.count, tokens.join(' ')))
        latest.current.set(r.key, fresh.meta.words ?? [])
        // A chunk opened since then, later in the same clip, moves with the changed word count.
        const now = range.current
        if (now && now !== r && now.key === r.key && now.from > r.from) now.from += tokens.length - r.count
        r.count = tokens.length
        setStatus('saved')
      } catch (e) {
        toast('error', errorText(e))
        setStatus('idle')
      }
    })
  }

  const flush = (): void => {
    const p = pending.current
    if (!p) return
    window.clearTimeout(p.timer)
    pending.current = null
    save(p.range, p.value)
  }

  // A newly picked chunk takes over the editor; the editor's own saves never reset what is being typed.
  useEffect(() => {
    flush()
    latest.current.clear()
    const c = selected ? chunks.find((x) => x.source?.key === selected.key && x.source.from === selected.from) : undefined
    range.current = c?.source ? { ...c.source } : null
    setText(c ? c.words.map((w) => w.text).join(' ') : '')
    setStatus('idle')
    return flush
  }, [selected?.key, selected?.from])

  const r = range.current
  if (!selected || !r) return null
  const item = items.find((it) => it.audio?.id === r.key)
  const words = latest.current.get(r.key) ?? item?.audio?.meta.words ?? []
  const first = words[r.from]
  const last = words[r.from + r.count - 1]

  return (
    <Section title="Edit teks caption" className="bg-sun-soft/40">
      <div className="flex items-center gap-2 text-xs">
        {item && first && last && (
          <span className="font-mono text-muted">
            {timecode(item.start + first.start)} – {timecode(item.start + last.end)}
          </span>
        )}
        <span className="flex-1" />
        <span className={cx(status === 'saved' ? 'text-ok-ink' : 'text-muted')}>
          {status === 'saving' ? 'Menyimpan…' : status === 'saved' ? 'Tersimpan otomatis' : ''}
        </span>
      </div>
      <AutoTextarea
        minRows={2}
        maxHeight={160}
        autoFocus
        value={text}
        onChange={(ev) => {
          const value = ev.target.value
          setText(value)
          if (pending.current) window.clearTimeout(pending.current.timer)
          pending.current = { range: r, value, timer: window.setTimeout(flush, 400) }
        }}
        onBlur={flush}
        aria-label="Teks caption"
        className={cx(inputCls, 'py-2 text-sm leading-relaxed')}
      />
      <p className="text-xs leading-relaxed text-muted">
        Perubahan langsung tersimpan dan tampil di pratinjau. Waktu tampilnya tetap; kalau jumlah kata berubah, waktunya dibagi rata di potongan ini.
        Sinkron ulang dengan Whisper mengembalikan teks dari naskah.
      </p>
      <Button size="sm" variant="ghost" className="self-start" onClick={() => select(null)}>
        Selesai
      </Button>
    </Section>
  )
}

/** Whether caption words follow the real voice, and a way to fix the ones that are still estimates. */
function CaptionTiming() {
  const { project, clips, assets, jobs, flush } = useProject()
  const { toast, go } = useApp()
  const [whisper, setWhisper] = useState<boolean | null>(null)
  useEffect(() => {
    void window.api.whisper.status().then((s) => setWhisper(s.state === 'ready'))
    return window.api.on.whisper((s) => setWhisper(s.state === 'ready'))
  }, [])
  if (!project) return null
  const voiced = clips.filter((c) => c.audioAssetId && assets[c.audioAssetId])
  const estimated = voiced.filter((c) => captionNeedsSync(assets[c.audioAssetId!])).length
  const canResync = voiced.some((c) => assets[c.audioAssetId!]?.provider === 'gemini' || captionNeedsSync(assets[c.audioAssetId!]))
  const job = jobFor(jobs, 'align', {})
  const running = isRunning(job)

  const sync = async (mode: 'stale' | 'all' = 'stale'): Promise<void> => {
    try {
      await flush()
      await window.api.generate.syncCaptions(project.id, mode)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  return (
    <Section title="Waktu caption">
      {!voiced.length ? (
        <p className="text-[13px] text-ink-2">Caption muncul setelah suara narasi dibuat.</p>
      ) : running ? (
        <span className="text-[13px] text-sun-ink">
          {job!.message ?? 'Menyinkronkan'} {Math.round(job!.progress * 100)}%
        </span>
      ) : estimated === 0 ? (
        <>
          <p className="text-[13px] text-ok-ink">Semua caption mengikuti waktu suara aslinya.</p>
          {whisper && canResync && (
            <Button size="sm" variant="ghost" className="self-start" icon={<AudioLines className="size-4" />} onClick={() => void sync('all')}>
              Sinkronkan ulang
            </Button>
          )}
        </>
      ) : (
        <>
          <p className="text-[13px] leading-relaxed text-ink-2">
            {estimated} klip belum disinkronkan dengan suaranya, jadi caption bisa mendahului atau tertinggal.
          </p>
          {whisper ? (
            <Button size="sm" className="self-start" icon={<AudioLines className="size-4" />} onClick={() => void sync()}>
              Sinkronkan dengan Whisper
            </Button>
          ) : (
            <p className="text-[13px] text-ink-2">
              Unduh model Whisper Small di{' '}
              <button
                type="button"
                onClick={async () => {
                  await flush()
                  go({ name: 'settings', back: { name: 'project', id: project.id } })
                }}
                className="font-semibold text-accent-dark hover:underline"
              >
                Pengaturan
              </button>{' '}
              untuk menyamakannya dengan suara.
            </p>
          )}
        </>
      )}
    </Section>
  )
}

const TEXT_SWATCHES = ['#FFFFFF', '#1F1D1A', '#FFC93C', '#E4572E', '#4DABF7', '#51CF66', '#F783AC']
const BOX_SWATCHES = ['#1F1D1A', '#FFFFFF', '#C93A1B', '#FFC93C', '#1E4A7A', '#25572B']

/** A row of colour dots plus a free colour picker. */
function Swatches({ value, colors, label, onChange }: { value: string | null; colors: string[]; label: string; onChange: (c: string) => void }) {
  const custom = !!value && !colors.some((c) => c.toLowerCase() === value.toLowerCase())
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {colors.map((c) => {
        const on = value?.toLowerCase() === c.toLowerCase()
        return (
          <button
            key={c}
            type="button"
            aria-label={`${label} ${c}`}
            aria-pressed={on}
            onClick={() => onChange(c)}
            className={cx('size-7 rounded-full border', on ? 'border-ink ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'border-line-3')}
            style={{ background: c }}
          />
        )
      })}
      <label
        title="Warna lain"
        className={cx(
          'relative size-7 cursor-pointer overflow-hidden rounded-full border',
          custom ? 'border-ink ring-2 ring-accent ring-offset-2 ring-offset-surface' : 'border-line-3'
        )}
        style={{ background: custom ? value! : 'conic-gradient(#e03131, #ffd43b, #51cf66, #22b8cf, #4c6ef5, #cc5de8, #e03131)' }}
      >
        <input
          type="color"
          value={value ?? '#ffffff'}
          onChange={(ev) => onChange(ev.target.value.toUpperCase())}
          aria-label={`${label} lainnya`}
          className="absolute inset-0 size-full cursor-pointer opacity-0"
        />
      </label>
    </div>
  )
}

/** Font, colours and box on top of the chosen caption style. */
function CaptionCustom() {
  const { project, updateEditor } = useProject()
  if (!project) return null
  const e = project.editor
  const r = resolveCaption(e)
  if (!r) return null
  return (
    <>
      <Section title="Font">
        <Select
          label="Font caption"
          size="sm"
          value={getCaptionFont(e.captionFont).id}
          onChange={(v) => updateEditor({ captionFont: v })}
          options={CAPTION_FONTS.map((f) => ({
            value: f.id,
            label: f.name,
            group: f.group,
            // Each option is written in its own font.
            labelStyle: { fontFamily: `'${f.family}', sans-serif`, fontSize: 17, fontWeight: f.id === 'poppins' ? 700 : 400 }
          }))}
        />
      </Section>
      <Section title="Warna teks">
        <Swatches value={r.color} colors={TEXT_SWATCHES} label="Warna teks" onChange={(c) => updateEditor({ captionColor: c })} />
        <span className="text-xs text-muted">Kata yang sedang diucapkan</span>
        <Swatches value={r.highlight} colors={TEXT_SWATCHES} label="Warna sorotan" onChange={(c) => updateEditor({ captionHighlight: c })} />
      </Section>
      <Section title="Latar caption">
        <Segmented
          size="sm"
          value={r.box ? 'on' : 'off'}
          onChange={(v) => updateEditor({ captionBg: v === 'off' ? null : { color: r.box ?? '#1F1D1A', opacity: r.box ? r.boxAlpha : 0.85 } })}
          options={[
            { id: 'on', label: 'Kotak' },
            { id: 'off', label: 'Tanpa latar' }
          ]}
          className="self-start"
        />
        {r.box ? (
          <>
            <Swatches value={r.box} colors={BOX_SWATCHES} label="Warna latar" onChange={(c) => updateEditor({ captionBg: { color: c, opacity: r.boxAlpha } })} />
            <label className="flex items-center gap-3 text-[13px]">
              <span className="w-16 text-ink-2">Opasitas</span>
              <input
                type="range"
                min={15}
                max={100}
                step={5}
                value={Math.round(r.boxAlpha * 100)}
                onChange={(ev) => updateEditor({ captionBg: { color: r.box!, opacity: Number(ev.target.value) / 100 } })}
                aria-label="Opasitas latar caption"
                className="flex-1"
              />
              <span className="w-10 text-right font-mono">{Math.round(r.boxAlpha * 100)}%</span>
            </label>
          </>
        ) : (
          <span className="text-xs text-muted">Tanpa latar, teks diberi garis tepi supaya tetap terbaca.</span>
        )}
      </Section>
    </>
  )
}

function CaptionTab() {
  const { project, updateEditor } = useProject()
  if (!project) return null
  const e = project.editor
  return (
    <>
      <CaptionTextEditor />
      <CaptionTiming />
      <Section title="Gaya caption">
        <div className="grid grid-cols-2 gap-2">
          {CAPTION_STYLES.map((s) => {
            const on = e.captionStyle === s.id
            return (
              <button key={s.id} type="button" aria-pressed={on} onClick={() => updateEditor({ captionStyle: s.id, captionColor: undefined, captionHighlight: undefined, captionBg: undefined })} className="flex flex-col gap-1 text-left">
                <span
                  className={cx('flex h-[52px] w-full items-center justify-center rounded-[10px] bg-[#E99A5B]', on ? 'border-2 border-accent' : 'border border-ink')}
                >
                  <span
                    className="whitespace-nowrap rounded-md px-1.5 py-0.5 text-[12px]"
                    style={{
                      fontFamily: 'Poppins, sans-serif',
                      fontWeight: s.weight,
                      color: s.color,
                      background: s.box ?? 'transparent',
                      WebkitTextStroke: s.box ? undefined : `0.8px ${s.outlineColor}`,
                      paintOrder: 'stroke fill'
                    }}
                  >
                    {s.uppercase ? 'NUSANTARA' : 'Nusantara'} <span style={{ color: s.highlight }}>{s.uppercase ? 'BERSATU' : 'bersatu'}</span>
                  </span>
                </span>
                <span className="text-xs font-medium text-ink-2">{s.name}</span>
              </button>
            )
          })}
        </div>
        <button
          type="button"
          aria-pressed={e.captionStyle === 'none'}
          onClick={() => updateEditor({ captionStyle: 'none' })}
          className={cx(
            'flex h-9 items-center justify-center gap-1.5 rounded-[10px] text-[13px] font-medium',
            e.captionStyle === 'none' ? 'border-2 border-accent bg-accent-soft' : 'border border-line-2 hover:border-ink-2'
          )}
        >
          <X className="size-3.5" />
          Tanpa caption
        </button>
      </Section>
      {e.captionStyle !== 'none' && <CaptionCustom />}
      <Section title="Posisi">
        <Segmented value={e.captionPosition} onChange={(v) => updateEditor({ captionPosition: v })} options={CAPTION_POSITIONS} />
      </Section>
      <Section title="Ukuran caption" className="border-b-0">
        <label className="flex items-center gap-3 text-[13px]">
          <span className="text-xs text-muted">A</span>
          <input
            type="range"
            min={50}
            max={180}
            step={5}
            value={Math.round(captionScaleOf(e) * 100)}
            onChange={(ev) => updateEditor({ captionScale: Number(ev.target.value) / 100 })}
            aria-label="Ukuran caption"
            className="flex-1"
          />
          <span className="text-base font-semibold text-muted">A</span>
          <span className="w-12 text-right font-mono">{Math.round(captionScaleOf(e) * 100)}%</span>
        </label>
        <button type="button" onClick={() => updateEditor({ captionScale: 1, captionSize: 'sedang' })} className="self-start text-xs font-semibold text-accent-dark hover:underline">
          Kembalikan ke 100%
        </button>
      </Section>
    </>
  )
}

/** One field of the music prompt with a copy button. */
function PromptField({ label, hint, value, rows, onChange }: { label: string; hint?: string; value: string; rows: number; onChange: (v: string) => void }) {
  const [copied, setCopied] = useState(false)
  useEffect(() => {
    if (!copied) return
    const t = setTimeout(() => setCopied(false), 1500)
    return () => clearTimeout(t)
  }, [copied])
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2">
        <span className="text-[13px] font-semibold">{label}</span>
        {hint && <span className="text-xs text-muted">{hint}</span>}
        <span className="flex-1" />
        <button
          type="button"
          onClick={() => void window.api.app.copyText(value).then(() => setCopied(true))}
          className={cx('inline-flex h-7 items-center gap-1 rounded-lg px-2 text-xs font-semibold', copied ? 'text-ok-ink' : 'text-accent-dark hover:bg-accent-soft')}
        >
          {copied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
          {copied ? 'Tersalin' : 'Salin'}
        </button>
      </div>
      <AutoTextarea
        minRows={rows}
        maxHeight={220}
        value={value}
        onChange={(ev) => onChange(ev.target.value)}
        aria-label={label}
        className={cx(inputCls, 'py-2 text-[13px] leading-relaxed')}
      />
    </div>
  )
}

const MUSIC_SITES = [
  { name: 'Suno', url: 'https://suno.com/create' },
  { name: 'Udio', url: 'https://www.udio.com/create' },
  { name: 'ElevenLabs Music', url: ELEVENLABS_URL }
]

/** Writes a prompt for background music that suits this story, to use in Suno or another music AI. */
function MusicPromptSection() {
  const { project, updateEditor, flush } = useProject()
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)
  if (!project) return null
  const mp = project.editor.musicPrompt ?? null
  const set = (patch: Partial<NonNullable<typeof mp>>): void => {
    if (mp) updateEditor({ musicPrompt: { ...mp, ...patch } })
  }
  const make = async (): Promise<void> => {
    setBusy(true)
    try {
      await flush()
      const r = await window.api.story.musicPrompt(project.id)
      updateEditor({ musicPrompt: r })
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Section title="Prompt musik AI">
      <p className="text-[13px] leading-relaxed text-ink-2">
        {mp?.reason || 'Buat prompt musik latar yang cocok dengan cerita ini, lalu tempel di Suno atau AI musik lain. Hasilnya bisa dipilih lewat tombol Pilih musik di bawah.'}
      </p>
      {mp && (
        <>
          <PromptField label="Style of Music" hint="kolom gaya di Suno" value={mp.style} rows={3} onChange={(v) => set({ style: v })} />
          <PromptField label="Exclude styles" hint="yang dihindari" value={mp.exclude} rows={1} onChange={(v) => set({ exclude: v })} />
          <PromptField label="Judul lagu" value={mp.title} rows={1} onChange={(v) => set({ title: v })} />
          <PromptField label="Deskripsi" hint="Udio, ElevenLabs, dll." value={mp.description} rows={5} onChange={(v) => set({ description: v })} />
          <p className="text-xs text-muted">
            Pilih mode Instrumental. Video sekitar {secLabel(mp.durationSec * 1000)}; saat ekspor musik otomatis diulang atau dipotong sesuai durasi, lalu memudar di akhir.
          </p>
          <div className="flex flex-wrap gap-1.5">
            {MUSIC_SITES.map((s) => (
              <button
                key={s.name}
                type="button"
                onClick={() => void window.api.app.openExternal(s.url)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border border-line-2 px-3 text-xs font-semibold text-ink-2 hover:border-ink-2 hover:text-ink"
              >
                Buka {s.name}
                <ExternalLink className="size-3.5" />
              </button>
            ))}
          </div>
        </>
      )}
      <Button size="sm" variant={mp ? 'secondary' : 'accent'} className="self-start" icon={<Sparkles className="size-4" />} loading={busy} onClick={() => void make()}>
        {mp ? 'Buat ulang prompt' : 'Buat prompt musik'}
      </Button>
    </Section>
  )
}

function MusicTab() {
  const { project, assets, updateEditor } = useProject()
  const { toast } = useApp()
  const musicFit = useMusicFit()
  if (!project) return null
  const e = project.editor
  const music = e.musicAssetId ? assets[e.musicAssetId] : null
  const pick = async (): Promise<void> => {
    try {
      const a = await window.api.assets.pickMusic(project.id)
      if (a) {
        useProject.getState().addAsset(a)
        updateEditor({ musicAssetId: a.id })
      }
    } catch (err) {
      toast('error', errorText(err))
    }
  }
  return (
    <>
      <MusicPromptSection />
      <Section title="Musik latar">
        {music ? (
          <div className="flex items-center gap-2.5 rounded-xl border border-[#9CC596] bg-ok-soft px-3 py-2.5 text-[13px] text-ok-ink">
            <Music className="size-4 shrink-0" />
            <span className="flex-1 truncate">{music.prompt}</span>
            <button type="button" aria-label="Lepas musik" onClick={() => updateEditor({ musicAssetId: null })} className="hover:text-ink">
              <X className="size-4" />
            </button>
          </div>
        ) : (
          <p className="text-[13px] text-ink-2">Belum ada musik. Pilih file MP3 atau WAV dari komputer.</p>
        )}
        <Button size="sm" className="self-start" icon={<Music className="size-4" />} onClick={() => void pick()}>
          {music ? 'Ganti musik' : 'Pilih musik'}
        </Button>
        {music && (
          <Button
            size="sm"
            className="self-start"
            loading={musicFit.busy}
            title="Atur panjang tiap klip supaya video sepanjang musik dan gambar berganti di ketukan"
            onClick={() => void musicFit.fit(false)}
          >
            Sesuaikan gambar dengan musik
          </Button>
        )}
        {music && (
          <p className="text-xs leading-relaxed text-muted">Tarik tepi musik di timeline untuk mengatur kapan mulai dan berhenti, atau geser untuk memindahkannya.</p>
        )}
        {music && ((e.musicStartMs ?? 0) > 0 || (e.musicInMs ?? 0) > 0 || e.musicEndMs != null) && (
          <Button size="sm" variant="ghost" className="self-start" onClick={() => updateEditor({ musicStartMs: 0, musicInMs: 0, musicEndMs: null })}>
            Kembalikan musik sepanjang video
          </Button>
        )}
      </Section>
      {music && (
        <Section title="Volume" className="border-b-0">
          <label className="flex items-center gap-3 text-[13px]">
            <input
              type="range"
              min={-36}
              max={-3}
              step={1}
              value={e.musicVolumeDb}
              onChange={(ev) => updateEditor({ musicVolumeDb: Number(ev.target.value) })}
              aria-label="Volume musik"
              className="flex-1"
            />
            <span className="w-14 text-right font-mono">{e.musicVolumeDb} dB</span>
          </label>
          <div className="flex items-center gap-3">
            <div className="flex-1">
              <p className="text-sm font-semibold">Kecilkan saat narasi</p>
              <p className="text-[13px] text-muted">Musik otomatis turun ketika ada suara</p>
            </div>
            <Switch on={e.duckMusic} onChange={(v) => updateEditor({ duckMusic: v })} label="Kecilkan musik saat narasi" />
          </div>
        </Section>
      )}
    </>
  )
}

function TransitionView({ id }: { id: string | null }) {
  const clips = useProject((s) => s.clips)
  const i = clips.findIndex((c) => c.id === id)
  if (i < 0 || i >= clips.length - 1) return <p className="p-5 text-sm text-muted">Klik tombol bulat di antara dua klip pada timeline untuk mengatur transisinya.</p>
  return <TransitionPanel clip={clips[i]} next={clips[i + 1]} index={i} />
}

export function Inspector({
  tab,
  clip,
  index,
  total,
  transitionId
}: {
  tab: InspectorTab
  clip: Clip | null
  index: number
  total: number
  transitionId: string | null
}) {
  return (
    <aside className="scroll-thin flex min-h-0 flex-col overflow-y-auto border-l border-line bg-surface">
      {tab === 'klip' && (clip ? <ClipTab clip={clip} index={index} /> : <p className="p-5 text-sm text-muted">Pilih klip di timeline.</p>)}
      {tab === 'suara' && (clip ? <VoiceTab clip={clip} index={index} /> : <p className="p-5 text-sm text-muted">Pilih suara klip di timeline.</p>)}
      {tab === 'caption' && <CaptionTab />}
      {tab === 'overlay' && <OverlayPanel total={total} />}
      {tab === 'musik' && <MusicTab />}
      {tab === 'sfx' && <SfxPanel total={total} />}
      {tab === 'transisi' && <TransitionView id={transitionId} />}
    </aside>
  )
}
