import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { visualSourceOf } from '@shared/script'
import { MIN_ITEM_MS, splitNarration, voiceSpan, wordGapNear } from '@shared/timeline'
import type { Asset, Clip, LinkRestore, ProjectBundle } from '@shared/types'
import { emit } from './events'
import { assetAbsPath, binPath } from './paths'
import { cancelJob } from './jobs'
import {
  activeJobFor,
  clipsOf,
  deleteAssets,
  getAsset,
  getBundle,
  getCharacter,
  getClip,
  insertAsset,
  insertClipAfter,
  patchClip,
  patchClipText,
  setCharacterSheet,
  touchProject
} from './repo'

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

/** Back to the picture with a camera move; the video file stays in the project, so undo can bring it back. */
const NO_VIDEO: Partial<Clip> = { videoAssetId: null, motionType: 'camera', mediaInMs: 0 }

/** Takes the video off one clip. A video still being made for it is cancelled, or it would land again. */
export async function detachVideo(clipId: string): Promise<void> {
  const running = activeJobFor({ clipId }, 'video')
  if (running) await cancelJob(running.id)
  patchClip(clipId, NO_VIDEO)
  emit.clip({ clipId, patch: NO_VIDEO })
  touchProject(getClip(clipId).projectId)
}

/** Takes the video off every clip of a project, whether AI-made or imported. */
export async function detachAllVideos(projectId: string): Promise<{ bundle: ProjectBundle; count: number }> {
  const withVideo = clipsOf(projectId).filter((c) => c.videoAssetId || c.motionType === 'video' || activeJobFor({ clipId: c.id }, 'video'))
  const count = withVideo.filter((c) => c.videoAssetId).length
  for (const c of withVideo) await detachVideo(c.id)
  return { bundle: getBundle(projectId), count }
}

/** Deletes the files of videos no clip uses any more, to free disk space. Undo can no longer bring them back. */
export function purgeUnusedVideos(projectId: string): { bundle: ProjectBundle; count: number; bytes: number } {
  const bundle = getBundle(projectId)
  const used = new Set(bundle.clips.map((c) => c.videoAssetId).filter(Boolean))
  const loose = bundle.assets.filter((a) => a.kind === 'video' && !used.has(a.id))
  let bytes = 0
  for (const a of loose) {
    const abs = assetAbsPath(projectId, a.localPath)
    if (!existsSync(abs)) continue
    bytes += statSync(abs).size
    rmSync(abs, { force: true })
  }
  deleteAssets(loose.map((a) => a.id))
  touchProject(projectId)
  return { bundle: getBundle(projectId), count: loose.length, bytes }
}

/**
 * Puts asset links (and the text a clip's visual plan was made from) back after undo or redo. The editor's own
 * save never touches them, so a link restored here must point at an asset of the same project.
 */
export function restoreLinks(projectId: string, links: LinkRestore): void {
  const ok = (id: string | null): string | null => (id && getAsset(id)?.projectId === projectId ? id : null)
  const clipIds = new Set(clipsOf(projectId).map((c) => c.id))
  for (const l of links.clips) {
    if (!clipIds.has(l.id)) continue
    patchClip(l.id, { imageAssetId: ok(l.imageAssetId), videoAssetId: ok(l.videoAssetId), audioAssetId: ok(l.audioAssetId) })
    patchClipText(l.id, { visualSource: l.visualSource })
  }
  for (const l of links.characters) {
    try {
      if (getCharacter(l.id).projectId === projectId) setCharacterSheet(l.id, ok(l.sheetAssetId))
    } catch {
      // The character no longer exists.
    }
  }
  touchProject(projectId)
}

/** Takes the voice off a clip (the audio stays in the clip's history and can be picked again). */
export function detachVoice(clipId: string): void {
  const patch: Partial<Clip> = { audioAssetId: null, voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
  patchClip(clipId, patch)
  emit.clip({ clipId, patch })
}
