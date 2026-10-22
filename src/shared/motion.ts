import type { CameraPresetId, MotionStrength, TransitionId } from './types'

/**
 * Camera motion shared by the live preview (CSS transforms) and the FFmpeg export (perspective),
 * so what the user sees in the editor is what lands in the MP4.
 *
 * zoom >= 1. x and y are the camera centre offset inside the free space: -1 = far left/top, 1 = far right/bottom.
 */
export interface CameraFrame {
  zoom: number
  x: number
  y: number
}

export const CAMERA_PRESETS: { id: CameraPresetId; label: string }[] = [
  { id: 'zoomin', label: 'Zoom in' },
  { id: 'zoomout', label: 'Zoom out' },
  { id: 'panleft', label: 'Geser kiri' },
  { id: 'panright', label: 'Geser kanan' },
  { id: 'kenburns', label: 'Ken Burns' },
  { id: 'shake', label: 'Goyang halus' },
  { id: 'static', label: 'Diam' }
]

export const MOTION_STRENGTHS: { id: MotionStrength; label: string; amount: number }[] = [
  { id: 'halus', label: 'Halus', amount: 0.08 },
  { id: 'sedang', label: 'Sedang', amount: 0.15 },
  { id: 'kuat', label: 'Kuat', amount: 0.25 }
]

export const TRANSITIONS: { id: TransitionId; label: string; ffmpeg: string | null }[] = [
  { id: 'fade', label: 'Pudar', ffmpeg: 'fade' },
  { id: 'slideleft', label: 'Geser ke kiri', ffmpeg: 'slideleft' },
  { id: 'zoomin', label: 'Zoom tembus', ffmpeg: 'zoomin' },
  { id: 'cut', label: 'Potong langsung', ffmpeg: null }
]

export const TRANSITION_SEC = 0.4

/** Transition lengths the editor offers, in seconds. */
export const TRANSITION_MIN_SEC = 0.2
export const TRANSITION_MAX_SEC = 2

/** How long the transition from a clip into the next one lasts, in seconds; 0 for a cut. */
export function transitionSecOf(clip: { transition: TransitionId; transitionMs: number | null }): number {
  if (clip.transition === 'cut') return 0
  const ms = clip.transitionMs ?? TRANSITION_SEC * 1000
  return Math.min(TRANSITION_MAX_SEC, Math.max(TRANSITION_MIN_SEC, ms / 1000))
}

export function strengthAmount(strength: MotionStrength): number {
  return MOTION_STRENGTHS.find((s) => s.id === strength)?.amount ?? 0.08
}

const smooth = (p: number): number => {
  const c = Math.min(1, Math.max(0, p))
  return c * c * (3 - 2 * c)
}

const lerp = (a: number, b: number, t: number): number => a + (b - a) * t

/** p is progress 0..1 through the clip, t is seconds since the clip started. */
export function cameraAt(preset: CameraPresetId, strength: MotionStrength, p: number, t: number): CameraFrame {
  const s = strengthAmount(strength)
  const e = smooth(p)
  switch (preset) {
    case 'zoomin':
      return { zoom: lerp(1, 1 + s, e), x: 0, y: 0 }
    case 'zoomout':
      return { zoom: lerp(1 + s, 1, e), x: 0, y: 0 }
    case 'panleft':
      return { zoom: 1 + s, x: lerp(0.9, -0.9, e), y: 0 }
    case 'panright':
      return { zoom: 1 + s, x: lerp(-0.9, 0.9, e), y: 0 }
    case 'kenburns':
      return { zoom: lerp(1 + s * 0.3, 1 + s, e), x: lerp(-0.5, 0.5, e), y: lerp(0.3, -0.3, e) }
    case 'shake':
      return {
        zoom: 1 + Math.max(0.04, s * 0.5),
        x: 0.35 * Math.sin(2 * Math.PI * 1.3 * t),
        y: 0.3 * Math.sin(2 * Math.PI * 1.7 * t + 1)
      }
    default:
      return { zoom: 1, x: 0, y: 0 }
  }
}

/** CSS transform for an image that exactly covers its frame. */
export function cameraCss(frame: CameraFrame): string {
  const free = ((frame.zoom - 1) / 2) * 100
  return `translate(${(-frame.x * free).toFixed(3)}%, ${(-frame.y * free).toFixed(3)}%) scale(${frame.zoom.toFixed(4)})`
}

/**
 * FFmpeg `perspective` options for the same motion, evaluated per frame, or null for a still camera.
 * The crop window is given in source pixels with fractions and resampled with cubic interpolation, so slow
 * moves glide. (zoompan rounds its window to whole pixels every frame, which makes thin lines shimmer and
 * the picture look shaky.) `frames` is the clip length in output frames.
 */
export function cameraPerspective(preset: CameraPresetId, strength: MotionStrength, frames: number, fps: number): string | null {
  if (preset === 'static') return null
  const s = strengthAmount(strength)
  const n = Math.max(1, frames - 1)
  // perspective counts frames from 1.
  const f = '(on-1)'
  const p = `min(${f}/${n},1)`
  const e = `(${p}*${p}*(3-2*${p}))`
  const t = `(${f}/${fps})`
  const lin = (a: number, b: number): string => `(${a}+(${b - a})*${e})`
  let z = '1'
  let x = '0'
  let y = '0'
  switch (preset) {
    case 'zoomin':
      z = lin(1, 1 + s)
      break
    case 'zoomout':
      z = lin(1 + s, 1)
      break
    case 'panleft':
      z = `${1 + s}`
      x = lin(0.9, -0.9)
      break
    case 'panright':
      z = `${1 + s}`
      x = lin(-0.9, 0.9)
      break
    case 'kenburns':
      z = lin(1 + s * 0.3, 1 + s)
      x = lin(-0.5, 0.5)
      y = lin(0.3, -0.3)
      break
    case 'shake':
      z = `${1 + Math.max(0.04, s * 0.5)}`
      x = `(0.35*sin(2*PI*1.3*${t}))`
      y = `(0.3*sin(2*PI*1.7*${t}+1))`
      break
  }
  // The visible window: 1/zoom of the frame, placed in the free space by x and y (-1 to 1), as in cameraCss.
  const w = `(W/${z})`
  const h = `(H/${z})`
  const left = `((W-${w})*(1+${x})/2)`
  const top = `((H-${h})*(1+${y})/2)`
  const right = `(${left}+${w})`
  const bottom = `(${top}+${h})`
  return `perspective=x0='${left}':y0='${top}':x1='${right}':y1='${top}':x2='${left}':y2='${bottom}':x3='${right}':y3='${bottom}':interpolation=cubic:sense=source:eval=frame`
}

/** Moves the "random motion" button picks from: every real move except the shake, which suits few scenes. */
const RANDOM_PRESETS: CameraPresetId[] = ['zoomin', 'zoomout', 'panleft', 'panright', 'kenburns']
const RANDOM_STRENGTHS: MotionStrength[] = ['halus', 'halus', 'sedang']

/**
 * A different camera move for each of `count` clips. Neighbours never get the same move, so a slideshow keeps
 * changing; strengths lean gentle because strong moves on every picture tire the eye.
 */
export function randomMotions(count: number, rand: () => number = Math.random): { cameraPreset: CameraPresetId; motionStrength: MotionStrength }[] {
  const out: { cameraPreset: CameraPresetId; motionStrength: MotionStrength }[] = []
  for (let i = 0; i < count; i++) {
    const prev = out[i - 1]?.cameraPreset
    const choices = RANDOM_PRESETS.filter((p) => p !== prev)
    out.push({
      cameraPreset: choices[Math.floor(rand() * choices.length)],
      motionStrength: RANDOM_STRENGTHS[Math.floor(rand() * RANDOM_STRENGTHS.length)]
    })
  }
  return out
}
