import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { visualSourceOf } from '@shared/script'
import { MIN_ITEM_MS, splitNarration, voiceSpan, wordGapNear } from '@shared/timeline'
import type { Asset, Clip, ProjectBundle } from '@shared/types'
import { emit } from './events'
import { assetAbsPath, binPath } from './paths'
import { getAsset, getBundle, getClip, insertAsset, insertClipAfter, patchClip, patchClipText, touchProject } from './repo'

/**
 * Timeline edits that touch files or several clips at once: splitting a clip in two and taking a voice off
 * a clip. Simple trims and moves are saved by the editor itself.
 */

function cutAudio(src: string, out: string, fromSec: number, toSec: number | null): Promise<void> {
  const range = toSec == null ? `atrim=start=${fromSec.toFixed(4)}` : `atrim=start=${fromSec.toFixed(4)}:end=${toSec.toFixed(4)}`
  return new Promise((resolve, reject) => {
    execFile(
      binPath(ffmpegStatic!),
      ['-hide_banner', '-y', '-i', src, '-af', `${range},asetpts=PTS-STARTPTS`, '-c:a', 'pcm_s16le', out],
      { windowsHide: true },
      (err, _o, stderr) => (err ? reject(new Error(`Gagal memotong suara: ${String(stderr).trim().split('\n').pop()}`)) : resolve())
    )
  })
}

async function voicePart(audio: Asset, clipId: string, fromMs: number, toMs: number | null, prompt: string): Promise<Asset> {
  const rel = `audio/${randomUUID()}.wav`
  const abs = assetAbsPath(audio.projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  await cutAudio(assetAbsPath(audio.projectId, audio.localPath), abs, fromMs / 1000, toMs == null ? null : toMs / 1000)
  const lo = fromMs / 1000
  const hi = toMs == null ? Infinity : toMs / 1000
  const words = (audio.meta.words ?? []).filter((w) => w.start >= lo && w.start < hi).map((w) => ({ ...w, start: w.start - lo, end: Math.min(w.end, hi) - lo }))
  const asset = insertAsset({
    projectId: audio.projectId,
    clipId,
    kind: 'audio',
    provider: audio.provider,
    model: audio.model,
    prompt,
    localPath: rel,
    durationMs: (toMs ?? audio.durationMs ?? fromMs) - fromMs,
    meta: { ...audio.meta, words }
  })
  emit.asset(asset)
  return asset
}

/**
 * Splits a clip at `atMs` into two clips that play back exactly as before. The second clip shows the same
 * picture (a video continues where the first part stopped), and the narration is divided between them:
 * the audio file is cut at the pause between two words nearest to the cut, and so is the narration text,
 * so each part can later be re-voiced on its own. The first part ends in a cut, the second keeps the
 * original transition.
 */
export async function splitClip(clipId: string, atMs: number): Promise<ProjectBundle> {
  const clip = getClip(clipId)
  if (clip.durationMs < MIN_ITEM_MS * 2) throw new Error('Klip ini terlalu pendek untuk dipotong.')
  let at = Math.round(Math.min(clip.durationMs - MIN_ITEM_MS, Math.max(MIN_ITEM_MS, atMs)))
  const audio = getAsset(clip.audioAssetId)
  const newId = randomUUID()

  let narrationA = clip.narration
  let narrationB = ''
  let voiceA: Partial<Clip> = {}
  let voiceB: Pick<Clip, 'audioAssetId' | 'voiceInMs' | 'voiceOutMs' | 'voiceStartMs'> = { audioAssetId: null, voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }

  if (audio) {
    const span = voiceSpan(clip, audio.durationMs ?? 0)
    const words = audio.meta.words ?? []
    if (at <= span.startMs) {
      // The voice starts after the cut: all of it goes with the second part.
      voiceA = { audioAssetId: null, voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
      voiceB = { audioAssetId: audio.id, voiceInMs: clip.voiceInMs, voiceOutMs: clip.voiceOutMs, voiceStartMs: span.startMs - at }
      narrationA = ''
      narrationB = clip.narration
    } else if (at < span.startMs + span.playMs) {
      // Cut the voice between two words when one is close, and move the picture cut with it.
      let cutIn = span.inMs + (at - span.startMs)
      const gap = wordGapNear(words, cutIn / 1000)
      if (gap !== null) {
        const snapped = Math.round(span.startMs + (gap * 1000 - span.inMs))
        if (snapped >= MIN_ITEM_MS && snapped <= clip.durationMs - MIN_ITEM_MS) {
          at = snapped
          cutIn = Math.round(gap * 1000)
        }
      }
      const spokenBefore = words.filter((w) => w.start * 1000 < cutIn).length
      ;[narrationA, narrationB] = splitNarration(clip.narration, spokenBefore)
      const partA = await voicePart(audio, clip.id, 0, cutIn, narrationA)
      const partB = await voicePart(audio, newId, cutIn, null, narrationB)
      voiceA = { audioAssetId: partA.id, voiceInMs: span.inMs, voiceOutMs: null, voiceStartMs: span.startMs }
      voiceB = {
        audioAssetId: partB.id,
        voiceInMs: 0,
        voiceOutMs: clip.voiceOutMs != null ? Math.max(MIN_ITEM_MS, clip.voiceOutMs - cutIn) : null,
        voiceStartMs: 0
      }
    }
    // Otherwise the voice ends before the cut and stays with the first part.
  }

  const b: Clip = {
    ...clip,
    id: newId,
    title: `${clip.title} (2)`,
    story: '',
    narration: narrationB,
    visualSource: '',
    durationMs: clip.durationMs - at,
    mediaInMs: clip.mediaInMs + at,
    ...voiceB
  }
  b.visualSource = visualSourceOf(b)
  insertClipAfter(clip.id, b)

  // The first part keeps its picture and plays up to the cut.
  const a = { ...clip, narration: narrationA }
  patchClipText(clip.id, { narration: narrationA, visualSource: visualSourceOf(a), transition: 'cut' })
  patchClip(clip.id, { durationMs: at, ...voiceA })
  touchProject(clip.projectId)
  return getBundle(clip.projectId)
}

/** Takes the voice off a clip (the audio stays in the clip's history and can be picked again). */
export function detachVoice(clipId: string): void {
  const patch: Partial<Clip> = { audioAssetId: null, voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
  patchClip(clipId, patch)
  emit.clip({ clipId, patch })
}
