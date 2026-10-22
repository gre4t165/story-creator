import { useEffect, type ReactNode } from 'react'
import { Play } from 'lucide-react'
import { TRANSITIONS, TRANSITION_MAX_SEC, TRANSITION_MIN_SEC, transitionSecOf } from '@shared/motion'
import type { Clip, TransitionId } from '@shared/types'
import { Button, cx } from '../../../components/ui'
import { clipNumber } from '../../../lib/format'
import { useProject } from '../../../store/project'
import { useAudition } from './engine'
import { TRANSITION_ICONS, TRANSITION_NOTES, secondsLabel } from './TransitionButton'

function Section({ title, children, className }: { title: string; children: ReactNode; className?: string }) {
  return (
    <div className={cx('flex flex-col gap-2.5 border-b border-line px-[18px] py-4', className)}>
      <span className="text-sm font-semibold">{title}</span>
      {children}
    </div>
  )
}

/**
 * The transition from a clip into the next one, opened from the round button on the timeline joint. While
 * it is open the preview loops that joint, so every pick, hover and length change can be seen right away.
 */
export function TransitionPanel({ clip, next, index }: { clip: Clip; next: Clip; index: number }) {
  const { clips, updateClip } = useProject()
  const start = useAudition((s) => s.start)
  const trying = useAudition((s) => (s.audition?.kind === 'transition' && s.audition.override ? s.audition.override.transition : null))
  const seconds = transitionSecOf(clip)
  const preview = (transition?: TransitionId): void => start({ kind: 'transition', clipId: clip.id, override: transition ? { transition } : undefined })

  useEffect(() => {
    preview()
    return () => useAudition.getState().stop()
  }, [clip.id])

  const joints = clips.slice(0, -1)
  const allSame = joints.every((c) => c.transition === clip.transition && transitionSecOf(c) === seconds)

  return (
    <>
      <div className="flex h-14 shrink-0 items-center gap-2 border-b border-line px-[18px]">
        <span className="text-[15px] font-semibold">Transisi</span>
        <span className="flex-1" />
        <span className="font-mono text-xs text-muted">
          {clipNumber(index)} → {clipNumber(index + 1)}
        </span>
      </div>
      <Section title="Jenis transisi">
        <p className="truncate text-[13px] text-ink-2" title={`${clip.title} → ${next.title}`}>
          {clip.title} → {next.title}
        </p>
        <div className="grid grid-cols-2 gap-2" onMouseLeave={() => trying && preview()}>
          {TRANSITIONS.map((t) => {
            const Icon = TRANSITION_ICONS[t.id]
            const on = t.id === clip.transition
            return (
              <button
                key={t.id}
                type="button"
                aria-pressed={on}
                onMouseEnter={() => (on ? trying && preview() : preview(t.id))}
                onClick={() => {
                  updateClip(clip.id, { transition: t.id })
                  preview()
                }}
                className={cx(
                  'flex flex-col items-start gap-1.5 rounded-xl border p-2.5 text-left transition-colors',
                  on ? 'border-ink bg-sun-soft' : trying === t.id ? 'border-ink-2 bg-paper' : 'border-line-2 hover:border-ink-2'
                )}
              >
                <span className={cx('flex size-8 items-center justify-center rounded-full border', on ? 'border-ink bg-sun' : 'border-line-2 bg-surface')}>
                  <Icon className="size-4" />
                </span>
                <span className={cx('text-sm', on && 'font-semibold')}>{t.label}</span>
                <span className="text-xs leading-snug text-muted">{TRANSITION_NOTES[t.id]}</span>
              </button>
            )
          })}
        </div>
        <p className="text-xs leading-relaxed text-muted">Arahkan kursor ke pilihan lain untuk melihat contohnya di pratinjau, lalu klik untuk memakainya.</p>
      </Section>
      {seconds > 0 && (
        <Section title="Durasi transisi">
          <label className="flex items-center gap-3 text-[13px]">
            <input
              type="range"
              min={TRANSITION_MIN_SEC}
              max={TRANSITION_MAX_SEC}
              step={0.1}
              value={seconds}
              onChange={(e) => updateClip(clip.id, { transitionMs: Math.round(Number(e.target.value) * 1000) })}
              onPointerUp={() => preview()}
              onKeyUp={() => preview()}
              aria-label="Durasi transisi"
              className="min-w-0 flex-1"
            />
            <span className="w-16 shrink-0 text-right font-mono">{secondsLabel(seconds)}</span>
          </label>
          <p className="text-xs leading-relaxed text-muted">Transisi berjalan di awal klip berikutnya, jadi panjang video tidak berubah.</p>
        </Section>
      )}
      <Section title="Pratinjau" className="border-b-0">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" icon={<Play className="size-4" />} onClick={() => preview()}>
            Putar ulang pratinjau
          </Button>
          {!allSame && (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => joints.forEach((c) => c.id !== clip.id && updateClip(c.id, { transition: clip.transition, transitionMs: clip.transitionMs }))}
            >
              Pakai untuk semua sambungan
            </Button>
          )}
        </div>
        <p className="text-xs leading-relaxed text-muted">Pratinjau berulang tanpa menggeser timeline. Klik pratinjau atau tombol putar untuk berhenti.</p>
      </Section>
    </>
  )
}
