import type { PointerEvent } from 'react'
import { Blend, ChevronsLeft, Maximize2, Scissors } from 'lucide-react'
import { TRANSITIONS, transitionSecOf } from '@shared/motion'
import type { Clip, TransitionId } from '@shared/types'
import { cx } from '../../../components/ui'

export const TRANSITION_ICONS: Record<TransitionId, typeof Blend> = { fade: Blend, slideleft: ChevronsLeft, zoomin: Maximize2, cut: Scissors }

export const TRANSITION_NOTES: Record<TransitionId, string> = {
  fade: 'Tenang, cocok untuk pergantian waktu',
  slideleft: 'Pindah tempat atau sudut pandang',
  zoomin: 'Dramatis, untuk momen penting',
  cut: 'Langsung, cocok untuk adegan cepat'
}

export const secondsLabel = (s: number): string => `${s.toFixed(1).replace('.', ',')} dtk`

/** The joint between a clip and the next one on the timeline; it opens the Transisi panel for that joint. */
export function TransitionButton({ clip, next, x, selected, onPick }: { clip: Clip; next: Clip; x: number; selected: boolean; onPick: () => void }) {
  const current = TRANSITIONS.find((t) => t.id === clip.transition) ?? TRANSITIONS[0]
  const Icon = TRANSITION_ICONS[current.id]
  const seconds = transitionSecOf(clip)
  return (
    <button
      type="button"
      onPointerDown={(e: PointerEvent) => e.stopPropagation()}
      onClick={onPick}
      aria-label={`Transisi dari "${clip.title}" ke "${next.title}": ${current.label}`}
      aria-pressed={selected}
      title={`Transisi: ${current.label}${seconds ? ` · ${secondsLabel(seconds)}` : ''}`}
      className={cx(
        // Small and on top, so the clip edges above and below it can still be dragged.
        'absolute top-1/2 z-[5] flex size-5 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border-[1.5px] border-ink shadow-[0_1px_0_rgba(0,0,0,0.25)] transition-colors',
        current.id === 'cut' ? 'bg-surface text-ink-2 hover:bg-sun-soft' : 'bg-sun text-ink hover:bg-sun-soft',
        selected && 'ring-2 ring-accent ring-offset-2 ring-offset-surface'
      )}
      style={{ left: x }}
    >
      <Icon className="size-3" strokeWidth={2.4} />
    </button>
  )
}
