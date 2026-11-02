import { useEffect, useState, type ReactNode } from 'react'
import { FolderOpen, Lock, Pause, Play, Plus, Sparkles, Trash2 } from 'lucide-react'
import { FREE_LIMITS } from '@shared/license'
import { AMBIENCE_SOUNDS, DIM_CHOICES, LAYER_DEFAULT_DB, RELAX_KINDS, RELAX_LENGTHS, layerSource, relaxLengthSec } from '@shared/relax'
import { sfxUrl } from '@shared/sfx'
import type { AmbienceLayer, RelaxSettings } from '@shared/types'
import { Select } from '../../../components/Select'
import { Button, Chip, IconButton, cx, inputCls } from '../../../components/ui'
import { durationLabel, errorText } from '../../../lib/format'
import { useApp } from '../../../store/app'
import { useIsPro, useLicense } from '../../../store/license'
import { useProject } from '../../../store/project'

/** One sound at a time, for trying library recordings and layers in the panel. */
let tryEl: HTMLAudioElement | null = null
function useTryOut(): { playing: string | null; toggle(key: string, url: string): void } {
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => tryEl?.pause(), [])
  return {
    playing,
    toggle: (key, url) => {
      tryEl?.pause()
      if (playing === key) return setPlaying(null)
      const a = new Audio(url)
      a.onended = () => setPlaying(null)
      tryEl = a
      void a.play().catch(() => setPlaying(null))
      setPlaying(key)
    }
  }
}

function Section({ title, hint, children, className }: { title: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-2.5 border-b border-line px-[18px] py-4', className)}>
      <div className="flex flex-col gap-0.5">
        <span className="text-sm font-semibold">{title}</span>
        {hint && <span className="text-[13px] leading-relaxed text-muted">{hint}</span>}
      </div>
      {children}
    </div>
  )
}

function PlayButton({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-label={on ? `Hentikan ${label}` : `Dengarkan ${label}`}
      title={on ? 'Hentikan' : 'Dengarkan'}
      onClick={onClick}
      className={cx(
        'flex size-7 shrink-0 items-center justify-center rounded-full border transition-colors',
        on ? 'border-accent bg-accent text-white' : 'border-line-2 bg-surface text-ink hover:border-ink-2'
      )}
    >
      {on ? <Pause className="size-3.5" fill="currentColor" /> : <Play className="ml-px size-3.5" fill="currentColor" />}
    </button>
  )
}

const FADES = [0, 5, 10, 30]

/** Editor › Suasana: how long the relax video runs, the ambient sounds under it, and how it ends. */
export function RelaxPanel({ total }: { total: number }) {
  const { project, assets, updateEditor } = useProject()
  const { toast } = useApp()
  const pro = useIsPro()
  const tryOut = useTryOut()
  const [describe, setDescribe] = useState('')
  const [seconds, setSeconds] = useState('20')
  const [making, setMaking] = useState(false)
  if (!project?.editor.relax) return null
  const relax = project.editor.relax
  const set = (patch: Partial<RelaxSettings>): void => updateEditor({ relax: { ...relax, ...patch } })
  const setLayer = (id: string, patch: Partial<AmbienceLayer>): void => set({ layers: relax.layers.map((l) => (l.id === id ? { ...l, ...patch } : l)) })
  const addLayer = (layer: Omit<AmbienceLayer, 'id' | 'volumeDb'>): void => set({ layers: [...relax.layers, { ...layer, id: crypto.randomUUID(), volumeDb: LAYER_DEFAULT_DB }] })
  const length = relaxLengthSec(relax, total, pro)
  const kind = RELAX_KINDS.find((k) => k.id === relax.kind)
  const list = Object.values(assets)

  const pickLength = async (sec: number): Promise<void> => {
    if (sec > FREE_LIMITS.maxRelaxSec && !(await useLicense.getState().ensure('relax-long'))) return
    set({ lengthSec: sec })
  }

  const importFile = async (): Promise<void> => {
    try {
      const a = await window.api.relax.pickAmbience(project.id)
      if (!a) return
      useProject.getState().addAsset(a)
      addLayer({ assetId: a.id, label: (a.prompt ?? 'Suara sendiri').replace(/\.[a-z0-9]+$/i, '') })
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const generate = async (): Promise<void> => {
    setMaking(true)
    try {
      const a = await window.api.relax.generateAmbience(project.id, describe, Number(seconds))
      useProject.getState().addAsset(a)
      addLayer({ assetId: a.id, label: describe.trim().slice(0, 40) })
      setDescribe('')
      toast('success', 'Suara dibuat dan dipasang sebagai lapisan. Suaranya diulang mulus sepanjang video.')
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setMaking(false)
    }
  }

  return (
    <>
      <Section
        title={kind ? `Video ${kind.label.toLowerCase()}` : 'Video relaksasi'}
        hint={
          length > total + 1
            ? `Cerita ${durationLabel(total)}, lalu gambarnya diulang mulus sampai ${durationLabel(length)}. Pratinjau memutar bagian ceritanya saja.`
            : `Panjang video ${durationLabel(length)}.`
        }
      >
        <span className="text-[13px] font-semibold text-ink-2">Panjang video akhir</span>
        <div className="flex flex-wrap gap-1.5">
          {RELAX_LENGTHS.map((l) => {
            const locked = !pro && l.sec > FREE_LIMITS.maxRelaxSec
            return (
              <Chip key={l.sec} on={relax.lengthSec === l.sec} onClick={() => void pickLength(l.sec)} className="h-8 px-3 text-[13px]">
                {locked && <Lock className="size-3" />}
                {l.label}
              </Chip>
            )
          })}
        </div>
        {!pro && <span className="text-xs text-muted">Versi gratis sampai {durationLabel(FREE_LIMITS.maxRelaxSec)}. Pro sampai 10 jam.</span>}
      </Section>

      <Section title="Lapisan suasana" hint="Diputar berulang di bawah narasi dan musik, dari awal sampai akhir video.">
        {relax.layers.length === 0 && <p className="text-[13px] text-ink-2">Belum ada. Tambahkan hujan, ombak, atau api unggun dari pustaka di bawah.</p>}
        {relax.layers.map((l) => {
          const src = layerSource(l, list)
          const key = `layer:${l.id}`
          return (
            <div key={l.id} className="flex flex-col gap-1.5 rounded-xl border border-line bg-paper px-3 py-2.5">
              <div className="flex items-center gap-2">
                {src ? <PlayButton on={tryOut.playing === key} onClick={() => tryOut.toggle(key, src.url)} label={l.label} /> : <span className="size-7" />}
                <span className="flex-1 truncate text-[13px] font-semibold">{l.label}</span>
                {!src && <span className="text-xs text-bad-ink">File hilang</span>}
                <IconButton size={28} label={`Hapus ${l.label}`} onClick={() => set({ layers: relax.layers.filter((x) => x.id !== l.id) })}>
                  <Trash2 className="size-4" />
                </IconButton>
              </div>
              <label className="flex items-center gap-3 text-[13px]">
                <input
                  type="range"
                  min={-30}
                  max={6}
                  step={1}
                  value={l.volumeDb}
                  onChange={(e) => setLayer(l.id, { volumeDb: Number(e.target.value) })}
                  aria-label={`Volume ${l.label}`}
                  className="flex-1"
                />
                <span className="w-14 text-right font-mono">
                  {l.volumeDb > 0 ? '+' : ''}
                  {l.volumeDb} dB
                </span>
              </label>
            </div>
          )
        })}
        {relax.layers.length > 1 && (
          <label className="flex items-center gap-3 text-[13px]">
            <span className="w-24 shrink-0 text-ink-2">Semua lapisan</span>
            <input
              type="range"
              min={-20}
              max={10}
              step={1}
              value={relax.volumeDb ?? 0}
              onChange={(e) => set({ volumeDb: Number(e.target.value) })}
              aria-label="Volume semua lapisan suasana"
              className="flex-1"
            />
            <span className="w-14 text-right font-mono">
              {(relax.volumeDb ?? 0) > 0 ? '+' : ''}
              {relax.volumeDb ?? 0} dB
            </span>
          </label>
        )}
      </Section>

      <Section title="Pustaka suasana" hint="Rekaman asli berlisensi CC0, bebas dipakai di YouTube.">
        <div className="flex flex-col">
          {AMBIENCE_SOUNDS.map((s) => {
            const file = s.files[0]?.file
            if (!file) return null
            const key = `lib:${file}`
            return (
              <div key={s.id} className="flex items-center gap-2 border-b border-dashed border-line py-1.5 last:border-b-0">
                <PlayButton on={tryOut.playing === key} onClick={() => tryOut.toggle(key, sfxUrl(file))} label={s.label} />
                <span className="flex-1 text-[13px]">{s.label}</span>
                <Button size="sm" variant="ghost" icon={<Plus className="size-3.5" />} onClick={() => addLayer({ file, label: s.label })}>
                  Tambah
                </Button>
              </div>
            )
          })}
        </div>
      </Section>

      <Section title="Suara sendiri">
        <Button size="sm" className="self-start" icon={<FolderOpen className="size-4" />} onClick={() => void importFile()}>
          Impor file suara
        </Button>
        <span className="text-xs leading-relaxed text-muted">MP3, WAV, OGG, atau M4A. Pakai rekaman milikmu atau yang lisensinya membolehkan dipakai di YouTube.</span>
      </Section>

      <Section title="Buat dengan AI" hint="ElevenLabs membuat suara dari deskripsi dan menyambungnya jadi loop. Memakai kredit ElevenLabs-mu.">
        <textarea
          rows={2}
          value={describe}
          maxLength={450}
          onChange={(e) => setDescribe(e.target.value)}
          placeholder="Hujan deras di atap seng, malam hari, sesekali guntur di kejauhan"
          aria-label="Deskripsi suara suasana"
          className={cx(inputCls, 'resize-none py-2.5 text-sm leading-relaxed')}
        />
        <div className="flex items-center gap-2">
          <Select
            label="Panjang potongan suara"
            size="sm"
            value={seconds}
            onChange={setSeconds}
            options={[
              { value: '10', label: '10 detik' },
              { value: '20', label: '20 detik' },
              { value: '30', label: '30 detik' }
            ]}
          />
          <Button size="sm" variant="primary" loading={making} disabled={!describe.trim()} icon={!making && <Sparkles className="size-4" />} onClick={() => void generate()}>
            Buat suara
          </Button>
        </div>
      </Section>

      <Section title="Akhir video" className="border-b-0">
        <span className="text-[13px] font-semibold text-ink-2">Layar gelap setelah</span>
        <div className="flex flex-wrap gap-1.5">
          {DIM_CHOICES.filter((d) => d.sec == null || d.sec < length).map((d) => (
            <Chip key={String(d.sec)} on={relax.dimAfterSec === d.sec} onClick={() => set({ dimAfterSec: d.sec })} className="h-8 px-3 text-[13px]">
              {d.label}
            </Chip>
          ))}
        </div>
        <span className="text-xs leading-relaxed text-muted">
          Gambar perlahan jadi hitam di pergantian loop berikutnya, suaranya tetap jalan. Hemat baterai dan tidak menyilaukan saat tidur.
        </span>
        <span className="mt-1 text-[13px] font-semibold text-ink-2">Fade di akhir</span>
        <div className="flex flex-wrap gap-1.5">
          {FADES.map((f) => (
            <Chip key={f} on={relax.fadeOutSec === f} onClick={() => set({ fadeOutSec: f })} className="h-8 px-3 text-[13px]">
              {f ? `${f} detik` : 'Tanpa fade'}
            </Chip>
          ))}
        </div>
      </Section>
    </>
  )
}
