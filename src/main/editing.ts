import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { looseAssets } from '@shared/media'
import { visualSourceOf } from '@shared/script'
import { MIN_ITEM_MS, splitNarration, voiceSpan, wordGapNear } from '@shared/timeline'
import type { Asset, Clip, JobKind, LinkRestore, ProjectBundle } from '@shared/types'
import { emit } from './events'
import { assetAbsPath, binPath } from './paths'
import { cancelJob } from './jobs'
import {
  activeJobFor,
  activeProjectJob,
  clipsOf,
  deleteAssets,
  getAsset,
  getBundle,
  getCharacter,
  getClip,
  getProject,
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

/** Back to no picture; the file stays in the project, so undo can bring it back. */
const NO_IMAGE: Partial<Clip> = { imageAssetId: null }
/** No voice, and the trim and position that belonged to it start over. */
const NO_VOICE: Partial<Clip> = { audioAssetId: null, voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }

/** Stops what is still being made for a clip, or it would land right after the clip was cleared. */
async function cancelFor(clipId: string, kind: JobKind): Promise<void> {
  const running = activeJobFor({ clipId }, kind)
  if (running) await cancelJob(running.id)
}

async function clear(clipId: string, kind: JobKind, patch: Partial<Clip>): Promise<void> {
  await cancelFor(clipId, kind)
  patchClip(clipId, patch)
  emit.clip({ clipId, patch })
  touchProject(getClip(clipId).projectId)
}

/** Takes the video off one clip. */
export const detachVideo = (clipId: string): Promise<void> => clear(clipId, 'video', NO_VIDEO)

/** Takes the picture off one clip. */
export async function detachImage(clipId: string): Promise<void> {
  await clear(clipId, 'image', NO_IMAGE)
  syncCover(getClip(clipId).projectId)
}

/** Takes the voice off a clip (the audio stays in the clip's history and can be picked again). */
export const detachVoice = (clipId: string): Promise<void> => clear(clipId, 'tts', NO_VOICE)

type Removal = { bundle: ProjectBundle; count: number }

/** Takes the video off every clip of a project, whether AI-made or imported. */
export async function detachAllVideos(projectId: string): Promise<Removal> {
  const todo = clipsOf(projectId).filter((c) => c.videoAssetId || c.motionType === 'video' || activeJobFor({ clipId: c.id }, 'video'))
  for (const c of todo) await detachVideo(c.id)
  return { bundle: getBundle(projectId), count: todo.filter((c) => c.videoAssetId).length }
}

/** Takes the picture off every clip. Character sheets stay: they belong to the cast, not to a scene. */
export async function detachAllImages(projectId: string): Promise<Removal> {
  const todo = clipsOf(projectId).filter((c) => c.imageAssetId || activeJobFor({ clipId: c.id }, 'image'))
  for (const c of todo) await clear(c.id, 'image', NO_IMAGE)
  syncCover(projectId)
  return { bundle: getBundle(projectId), count: todo.filter((c) => c.imageAssetId).length }
}

/** Takes the narration voice off every clip, and stops a take that is still being recorded. */
export async function detachAllVoices(projectId: string): Promise<Removal> {
  const take = activeProjectJob(projectId, 'narration')
  if (take) await cancelJob(take.id)
  const todo = clipsOf(projectId).filter((c) => c.audioAssetId || activeJobFor({ clipId: c.id }, 'tts'))
  for (const c of todo) await detachVoice(c.id)
  return { bundle: getBundle(projectId), count: todo.filter((c) => c.audioAssetId).length }
}

/** The cover is the first picture of the video: it follows when that picture goes away or comes back. */
function syncCover(projectId: string): void {
  touchProject(projectId, { coverAssetId: clipsOf(projectId).find((c) => c.imageAssetId)?.imageAssetId ?? null })
}

/**
 * Deletes the files of pictures, voices and videos nothing uses any more, to free disk space. Undo can no longer
 * bring them back. Music, logos and character sheets are never touched.
 */
export function purgeUnusedMedia(projectId: string): { bundle: ProjectBundle; count: number; bytes: number } {
  const bundle = getBundle(projectId)
  const loose = looseAssets(getProject(projectId), bundle.clips, bundle.characters, bundle.assets)
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
  syncCover(projectId)
}
