import { useEffect, useState, type ReactNode } from 'react'
import { Pause, Play, Plus, RefreshCw, Sparkles, Trash2 } from 'lucide-react'
import { create } from 'zustand'
import { SFX_CATEGORIES, SFX_SOUNDS, autoSfx, newSfxItem, sfxPlay, sfxSound, sfxUrl, type SfxCategory } from '@shared/sfx'
import type { SfxItem } from '@shared/types'
import { Select } from '../../../components/Select'
import { Button, Chip, IconButton, confirmDialog, cx } from '../../../components/ui'
import { timecode } from '../../../lib/format'
import { useApp } from '../../../store/app'
import { useProject } from '../../../store/project'
import { usePlayback } from './engine'

export const useSfxUi = create<{ selectedId: string | null; select(id: string | null): void }>((set) => ({
  selectedId: null,
  select: (id) => set({ selectedId: id })
}))

const sfxNow = (): SfxItem[] => useProject.getState().project?.editor.sfx ?? []

export function updateSfx(id: string, patch: Partial<SfxItem>): void {
  useProject.getState().updateEditor({ sfx: sfxNow().map((s) => (s.id === id ? { ...s, ...patch } : s)) })
}

export function removeSfx(id: string): void {
  useProject.getState().updateEditor({ sfx: sfxNow().filter((s) => s.id !== id) })
  if (useSfxUi.getState().selectedId === id) useSfxUi.getState().select(null)
}

/** One library sound at a time, for trying sounds in the panel. */
let tryEl: HTMLAudioElement | null = null
function useTryOut(): { playing: string | null; toggle(file: string): void } {
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => tryEl?.pause(), [])
  return {
    playing,
    toggle: (file) => {
      tryEl?.pause()
      if (playing === file) return setPlaying(null)
      const a = new Audio(sfxUrl(file))
      a.onended = () => setPlaying(null)
      tryEl = a
      void a.play().catch(() => setPlaying(null))
      setPlaying(file)
    }
  }
}

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-2.5 border-b border-line px-[18px] py-4', className)}>
      <span className="text-sm font-semibold">{title}</span>
      {children}
    </div>
  )
}

function Slider({ label, value, min, max, step, unit, onChange }: { label: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void }) {
  return (
    <label className="flex items-center gap-3 text-[13px]">
      <span className="w-16 shrink-0 text-ink-2">{label}</span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} aria-label={label} className="flex-1" />
      <span className="w-16 text-right font-mono">
        {value > 0 && unit === 'dB' ? '+' : ''}
        {Math.round(value * 10) / 10} {unit}
      </span>
    </label>
  )
}

export function SfxPanel({ total }: { total: number }) {
  const { project, clips, updateEditor } = useProject()
  const { toast } = useApp()
  const selectedId = useSfxUi((s) => s.selectedId)
  const select = useSfxUi((s) => s.select)
  const tryOut = useTryOut()
  const [category, setCategory] = useState<SfxCategory>('suasana')
  if (!project) return null
  const items = project.editor.sfx ?? []
  const sel = items.find((s) => s.id === selectedId) ?? null
  const selSound = sel ? sfxSound(sel.sound) : undefined

  const makeAuto = async (): Promise<void> => {
    const hadAuto = items.some((s) => s.auto)
    if (hadAuto) {
      const ok = await confirmDialog({
        title: 'Buat ulang SFX otomatis?',
        body: 'SFX otomatis yang lama diganti dengan yang baru. SFX yang kamu tambahkan sendiri tidak diubah.',
        confirm: 'Buat ulang'
      })
      if (!ok) return
    }
    const made = autoSfx(clips).map((s) => ({ ...s, id: crypto.randomUUID() }))
    updateEditor({ sfx: [...items.filter((s) => !s.auto), ...made] })
    select(null)
    const scenes = made.filter((s) => sfxSound(s.sound)?.role !== 'transition').length
    toast(
      made.length ? 'success' : 'error',
      made.length
        ? `${made.length} SFX dipasang: ${made.length - scenes} di transisi, ${scenes} sesuai isi adegan.`
        : 'Belum ada yang cocok. Tambahkan transisi antarklip atau tulis naskah adegannya dulu.'
    )
  }

  const clearAll = async (): Promise<void> => {
    const ok = await confirmDialog({ title: 'Hapus semua SFX?', body: `${items.length} efek suara dilepas dari video.`, confirm: 'Hapus semua', danger: true })
    if (ok) {
      updateEditor({ sfx: [] })
      select(null)
    }
  }

  const addAtPlayhead = (soundId: string): void => {
    const t = Math.min(usePlayback.getState().t, Math.max(0, total - 0.1))
    const made = newSfxItem(soundId, t)
    if (!made) return
    const item = { ...made, id: crypto.randomUUID(), length: Math.min(made.length, Math.max(0.1, total - t)) }
    updateEditor({ sfx: [...items, item] })
    select(item.id)
  }

  const otherVariant = (): void => {
    if (!sel || !selSound || selSound.files.length < 2) return
    const i = selSound.files.findIndex((f) => f.file === sel.file)
    updateSfx(sel.id, { file: selSound.files[(i + 1) % selSound.files.length].file })
  }

  const library = SFX_SOUNDS.filter((s) => s.category === category)

  return (
    <>
      <Section title="SFX otomatis">
        <p className="text-[13px] leading-relaxed text-ink-2">
          Whoosh di setiap transisi, suasana (hujan, malam, laut, ruangan) di bawah adegan, dan efek saat narasi menyebutnya, misalnya pintu, pedang,
          langkah, atau ledakan. Semua suara bawaan berlisensi CC0, aman dipakai di YouTube.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="accent" icon={<Sparkles className="size-4" />} disabled={!clips.length} onClick={() => void makeAuto()}>
            {items.some((s) => s.auto) ? 'Buat ulang SFX otomatis' : 'Buat SFX otomatis'}
          </Button>
          {items.length > 0 && (
            <Button size="sm" variant="ghost" icon={<Trash2 className="size-4" />} onClick={() => void clearAll()}>
              Hapus semua
            </Button>
          )}
        </div>
        {items.length > 0 && (
          <Slider label="Semua SFX" value={project.editor.sfxVolumeDb ?? 0} min={-24} max={6} step={1} unit="dB" onChange={(v) => updateEditor({ sfxVolumeDb: v })} />
        )}
      </Section>

      {sel && (
        <Section title="SFX dipilih">
          <div className="flex items-center gap-2">
            <Select
              label="Suara"
              size="sm"
              className="flex-1"
              searchable
              value={sel.sound}
              onChange={(id) => {
                const s = sfxSound(id)
                if (s) updateSfx(sel.id, { sound: id, file: s.files[0].file })
              }}
              options={SFX_SOUNDS.map((s) => ({ value: s.id, label: s.label, hint: SFX_CATEGORIES.find((c) => c.id === s.category)?.label }))}
            />
            <IconButton label={tryOut.playing === sel.file ? 'Hentikan' : 'Dengarkan'} size={36} onClick={() => tryOut.toggle(sel.file)}>
              {tryOut.playing === sel.file ? <Pause className="size-4" /> : <Play className="size-4" />}
            </IconButton>
            <IconButton label="Hapus SFX ini" size={36} onClick={() => removeSfx(sel.id)}>
              <Trash2 className="size-4" />
            </IconButton>
          </div>
          <span className="font-mono text-xs text-muted">
            {timecode(sfxPlay(sel, total).startSec)} – {timecode(sfxPlay(sel, total).startSec + sfxPlay(sel, total).playSec)}
            {sel.auto ? ' · otomatis' : ''}
          </span>
          {selSound && selSound.files.length > 1 && (
            <Button size="sm" className="self-start" icon={<RefreshCw className="size-4" />} onClick={otherVariant}>
              Variasi lain ({selSound.files.findIndex((f) => f.file === sel.file) + 1}/{selSound.files.length})
            </Button>
          )}
          <Slider label="Volume" value={sel.volumeDb} min={-30} max={6} step={1} unit="dB" onChange={(v) => updateSfx(sel.id, { volumeDb: v })} />
          {selSound?.loop && (
            <Slider
              label="Durasi"
              value={sel.length}
              min={0.5}
              max={Math.max(1, Math.min(120, total - sel.start))}
              step={0.1}
              unit="dtk"
              onChange={(v) => updateSfx(sel.id, { length: v })}
            />
          )}
          <p className="text-xs text-muted">Geser SFX di timeline untuk memindahkannya, tarik tepi kanannya untuk mengubah durasi.</p>
        </Section>
      )}

      <Section title="Pustaka SFX" className="border-b-0">
        <div className="flex flex-wrap gap-1.5">
          {SFX_CATEGORIES.map((c) => (
            <Chip key={c.id} on={category === c.id} className="h-8 px-3 text-[13px]" onClick={() => setCategory(c.id)}>
              {c.label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-col">
          {library.map((s) => {
            const file = s.files[0].file
            const on = tryOut.playing === file
            return (
              <div key={s.id} className="flex items-center gap-2 border-b border-line py-1.5 last:border-b-0">
                <button
                  type="button"
                  aria-label={on ? `Hentikan ${s.label}` : `Dengarkan ${s.label}`}
                  onClick={() => tryOut.toggle(file)}
                  className={cx(
                    'flex size-7 shrink-0 items-center justify-center rounded-full border',
                    on ? 'border-accent bg-accent text-white' : 'border-line-2 hover:border-ink-2'
                  )}
                >
                  {on ? <Pause className="size-3.5" /> : <Play className="ml-px size-3.5" />}
                </button>
                <span className="min-w-0 flex-1 truncate text-[13px]">
                  {s.label}
                  {s.files.length > 1 && <span className="text-muted"> · {s.files.length} variasi</span>}
                </span>
                <button
                  type="button"
                  onClick={() => addAtPlayhead(s.id)}
                  title="Tambahkan di posisi playhead"
                  className="inline-flex h-7 items-center gap-1 rounded-md border border-line-2 px-2 text-xs font-medium hover:border-ink-2"
                >
                  <Plus className="size-3.5" />
                  Tambah
                </button>
              </div>
            )
          })}
        </div>
        <p className="text-xs leading-relaxed text-muted">Suara dari Kenney.nl dan buatan Story Creator, semuanya CC0: bebas dipakai, termasuk untuk video yang dimonetisasi.</p>
      </Section>
    </>
  )
}
