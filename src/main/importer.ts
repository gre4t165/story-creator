import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { basename, dirname, extname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { app, BrowserWindow, dialog } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import { estimateWordTimings } from '@shared/captions'
import { stripVoiceTags } from '@shared/speech'
import type { Clip, ImportResult, TtsOverride, TtsProvider } from '@shared/types'
import { emit } from './events'
import { generateClipImage, generateClipTts } from './generation'
import { syncCaptions } from './narration'
import { assetAbsPath, binPath } from './paths'
import { appendClip, clipsOf, getBundle, getClip, getProject, insertAsset, patchClip, patchClipText, touchProject } from './repo'
import { getSettings } from './settings'
import { probeDurationMs, probeSize } from './services/audio'
import { downloadTo } from './services/http'
import { whisperReady } from './whisper'

/**
 * Pictures and voices the user brings in: one file for one clip, many files for many clips (matched by the
 * number in the file name, else in order), or a JSON file that says per scene which picture, voice, narration
 * or narrator voice to use. Imported pictures are the user's own, so they are stored as they are.
 */

const IMAGE_EXT = ['png', 'jpg', 'jpeg', 'webp']
const AUDIO_EXT = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac']
/** Formats Chromium plays in the preview; they go wherever a picture can go. */
const VIDEO_EXT = ['mp4', 'mov', 'webm', 'm4v']
const PROVIDERS: TtsProvider[] = ['gemini', 'elevenlabs', 'edge', 'local']

type Kind = 'image' | 'audio'

/**
 * The dev harness cannot click a native file dialog, so in development STUDIO_PICK_FILES answers it instead:
 * one group of paths per dialog, groups split by ";;" and paths by "|".
 */
const devPicks = !app.isPackaged && process.env.STUDIO_PICK_FILES ? process.env.STUDIO_PICK_FILES.split(';;') : null

/** The next STUDIO_PICK_FILES answer, or null outside the dev harness. */
export function devPick(): string[] | null {
  return devPicks?.length ? devPicks.shift()!.split('|').map((s) => s.trim()).filter(Boolean) : null
}

async function pick(title: string, kind: Kind | 'json', multi: boolean): Promise<string[]> {
  const dev = devPick()
  if (dev) return dev
  const win = BrowserWindow.getFocusedWindow()
  const filters =
    kind === 'json'
      ? [{ name: 'JSON', extensions: ['json'] }]
      : kind === 'image'
        ? [{ name: 'Gambar atau video', extensions: [...IMAGE_EXT, ...VIDEO_EXT] }]
        : [{ name: 'Audio', extensions: AUDIO_EXT }]
  const opts = { title, filters, properties: (multi ? ['openFile', 'multiSelections'] : ['openFile']) as ('openFile' | 'multiSelections')[] }
  const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts)
  return res.canceled ? [] : res.filePaths
}

/** Bytes of a local path (absolute, relative to `base`, or file://) or of an http(s) link. */
async function readSource(src: string, base: string | null): Promise<{ bytes: Buffer; ext: string; name: string }> {
  const s = src.trim()
  if (/^https?:\/\//i.test(s)) {
    const { bytes, contentType } = await downloadTo(s)
    const fromUrl = /\.([a-z0-9]{2,4})(?:\?|#|$)/i.exec(new URL(s).pathname)?.[1]
    const fromType = /^video\/(mp4|quicktime|webm)/.test(contentType)
      ? { mp4: 'mp4', quicktime: 'mov', webm: 'webm' }[/^video\/(\w+)/.exec(contentType)![1]]!
      : /png/.test(contentType)
        ? 'png'
        : /jpe?g/.test(contentType)
          ? 'jpg'
          : /webp/.test(contentType)
            ? 'webp'
            : /wav/.test(contentType)
              ? 'wav'
              : /mpeg|mp3/.test(contentType)
                ? 'mp3'
                : /ogg/.test(contentType)
                  ? 'ogg'
                  : /mp4|m4a|aac/.test(contentType)
                    ? 'm4a'
                    : ''
    return { bytes, ext: (fromUrl ?? fromType ?? '').toLowerCase(), name: basename(new URL(s).pathname) || s }
  }
  const path = /^file:\/\//i.test(s) ? fileURLToPath(s) : isAbsolute(s) || !base ? s : resolve(base, s)
  if (!existsSync(path)) throw new Error(`File tidak ditemukan: ${s}`)
  return { bytes: readFileSync(path), ext: extname(path).slice(1).toLowerCase(), name: basename(path) }
}

function store(projectId: string, folder: string, ext: string, bytes: Buffer): string {
  const rel = `${folder}/${randomUUID()}.${ext}`
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, bytes)
  return rel
}

function setCover(clip: Clip, assetId: string): void {
  const project = getProject(clip.projectId)
  if (!project.coverAssetId || clipsOf(clip.projectId)[0]?.id === clip.id) touchProject(clip.projectId, { coverAssetId: assetId })
}

/** The first frame of a video as a JPG, so the clip has a picture for thumbnails, the cover and the poster. */
function extractFrame(videoAbs: string, imageAbs: string): Promise<void> {
  return new Promise((resolve, reject) => {
    execFile(
      binPath(ffmpegStatic!),
      ['-hide_banner', '-y', '-ss', '0.1', '-i', videoAbs, '-frames:v', '1', '-q:v', '3', imageAbs],
      { windowsHide: true },
      (err) => (err ? reject(new Error('Frame pertama video tidak bisa diambil')) : resolve())
    )
  })
}

/**
 * A video the user brings in becomes the clip's video, the same way an AI video does, with its first frame as
 * the clip's picture. A clip without narration takes the video's length; a voiced clip keeps its length, so
 * the narration is not cut (a shorter video holds its last frame). Its own sound is not used.
 */
async function putVideo(clip: Clip, file: { bytes: Buffer; ext: string; name: string }): Promise<void> {
  const rel = store(clip.projectId, 'videos', file.ext === 'm4v' ? 'mp4' : file.ext, file.bytes)
  const abs = assetAbsPath(clip.projectId, rel)
  const size = await probeSize(abs).catch(() => null)
  const videoMs = await probeDurationMs(abs).catch(() => null)
  if (!size || !videoMs) throw new Error(`${file.name} tidak bisa dibaca sebagai video. Pakai MP4, MOV, atau WebM.`)
  const posterRel = `images/${randomUUID()}.jpg`
  await extractFrame(abs, assetAbsPath(clip.projectId, posterRel))
  const poster = insertAsset({
    projectId: clip.projectId,
    clipId: clip.id,
    kind: 'image',
    provider: 'import',
    model: 'import',
    prompt: file.name,
    localPath: posterRel,
    width: size.width,
    height: size.height,
    meta: { imported: true, frameOf: rel }
  })
  const video = insertAsset({
    projectId: clip.projectId,
    clipId: clip.id,
    kind: 'video',
    provider: 'import',
    model: 'import',
    prompt: file.name,
    localPath: rel,
    durationMs: videoMs,
    width: size.width,
    height: size.height,
    meta: { imported: true }
  })
  emit.asset(poster)
  emit.asset(video)
  const voiced = !!getClip(clip.id).audioAssetId
  const patch = {
    imageAssetId: poster.id,
    videoAssetId: video.id,
    motionType: 'video' as const,
    mediaInMs: 0,
    ...(voiced ? {} : { durationMs: Math.max(1000, videoMs) })
  }
  patchClip(clip.id, patch)
  emit.clip({ clipId: clip.id, patch })
  setCover(clip, poster.id)
}

/** A picture or, when the file is a video, a video for the clip. */
async function putImage(clip: Clip, src: string, base: string | null): Promise<void> {
  const file = await readSource(src, base)
  if (VIDEO_EXT.includes(file.ext)) return putVideo(clip, file)
  const ext = IMAGE_EXT.includes(file.ext) ? (file.ext === 'jpeg' ? 'jpg' : file.ext) : 'png'
  const rel = store(clip.projectId, 'images', ext, file.bytes)
  const size = await probeSize(assetAbsPath(clip.projectId, rel)).catch(() => null)
  if (!size) throw new Error(`${file.name} tidak bisa dibaca sebagai gambar. Pakai PNG, JPG, atau WebP.`)
  const asset = insertAsset({
    projectId: clip.projectId,
    clipId: clip.id,
    kind: 'image',
    provider: 'import',
    model: 'import',
    prompt: file.name,
    localPath: rel,
    width: size.width,
    height: size.height,
    meta: { imported: true }
  })
  emit.asset(asset)
  // A picture replaces an imported or AI video too, so the clip shows what was just chosen.
  const patch = { imageAssetId: asset.id, ...(clip.motionType === 'video' ? { motionType: 'camera' as const } : {}) }
  patchClip(clip.id, patch)
  emit.clip({ clipId: clip.id, patch })
  setCover(clip, asset.id)
}

async function putAudio(clip: Clip, src: string, base: string | null): Promise<void> {
  const file = await readSource(src, base)
  const ext = AUDIO_EXT.includes(file.ext) ? file.ext : 'mp3'
  const rel = store(clip.projectId, 'audio', ext, file.bytes)
  const audioMs = await probeDurationMs(assetAbsPath(clip.projectId, rel)).catch(() => {
    throw new Error(`${file.name} tidak bisa dibaca sebagai audio.`)
  })
  // The narration is what the recording says; its words get estimated times until Whisper re-times them.
  const text = getClip(clip.id).narration.trim()
  const asset = insertAsset({
    projectId: clip.projectId,
    clipId: clip.id,
    kind: 'audio',
    provider: 'import',
    model: 'import',
    prompt: text,
    localPath: rel,
    durationMs: audioMs,
    meta: { words: text ? estimateWordTimings(stripVoiceTags(text), audioMs / 1000) : [], estimatedTimings: !!text, imported: true, voice: file.name }
  })
  emit.asset(asset)
  const patch = { audioAssetId: asset.id, durationMs: Math.max(1500, audioMs + 400), voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
  patchClip(clip.id, patch)
  emit.clip({ clipId: clip.id, patch })
}

/** Re-times captions of imported voices with Whisper when the user has it on. */
function syncIfPossible(projectId: string): void {
  if (!getSettings().whisperAuto || !whisperReady()) return
  try {
    syncCaptions(projectId, 'stale')
  } catch {
    // Nothing left to sync.
  }
}

/** The scene number a file name carries ("03.png", "adegan-12.wav"), from its last number. */
function sceneNumber(path: string): number | null {
  const m = basename(path, extname(path)).match(/\d+/g)
  const n = m ? Number(m[m.length - 1]) : NaN
  return Number.isInteger(n) && n > 0 ? n : null
}

const natural = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

/** The clip for scene `n` (1-based), adding empty scenes at the end when the project is shorter. */
function clipAt(projectId: string, n: number): Clip {
  let clips = clipsOf(projectId)
  while (clips.length < n) {
    appendClip(projectId, `Adegan ${clips.length + 1}`)
    clips = clipsOf(projectId)
  }
  return clips[n - 1]
}

// ---------- public entry points ----------

export async function importClipFile(clipId: string, kind: Kind): Promise<boolean> {
  const [file] = await pick(kind === 'image' ? 'Pilih gambar atau video untuk klip ini' : 'Pilih rekaman suara untuk klip ini', kind, false)
  if (!file) return false
  const clip = getClip(clipId)
  await (kind === 'image' ? putImage(clip, file, null) : putAudio(clip, file, null))
  touchProject(clip.projectId)
  if (kind === 'audio') syncIfPossible(clip.projectId)
  return true
}

/**
 * Many files at once. When every file name has its own scene number, each goes to that scene; otherwise they
 * fill the scenes in file-name order from the first one.
 */
export async function importBatch(projectId: string, kind: Kind): Promise<ImportResult | null> {
  const files = await pick(kind === 'image' ? 'Pilih beberapa gambar atau video (urut sesuai adegan)' : 'Pilih beberapa rekaman suara (urut sesuai adegan)', kind, true)
  if (!files.length) return null
  getProject(projectId)
  const sorted = [...files].sort((a, b) => natural.compare(basename(a), basename(b)))
  const numbers = sorted.map(sceneNumber)
  const byNumber = numbers.every((n) => n != null) && new Set(numbers).size === numbers.length
  const failed: string[] = []
  for (let i = 0; i < sorted.length; i++) {
    const clip = clipAt(projectId, byNumber ? numbers[i]! : i + 1)
    try {
      await (kind === 'image' ? putImage(clip, sorted[i], null) : putAudio(clip, sorted[i], null))
    } catch (e) {
      failed.push(`${basename(sorted[i])}: ${(e as Error).message}`)
    }
  }
  touchProject(projectId)
  if (kind === 'audio') syncIfPossible(projectId)
  const ok = sorted.length - failed.length
  const what = kind === 'image' ? 'gambar/video' : 'suara'
  const how = byNumber ? 'sesuai nomor di nama file' : 'urut nama file'
  return {
    bundle: getBundle(projectId),
    message: `${ok} ${what} dipasang ${how}.` + (failed.length ? ` ${failed.length} gagal: ${failed.slice(0, 3).join('; ')}` : '')
  }
}

interface Entry {
  scene: number | null
  title?: string
  narration?: string
  prompt?: string
  videoPrompt?: string
  image?: string
  audio?: string
  voice?: string
  provider?: TtsProvider
  generate?: boolean
}

const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v : undefined)

function pickStr(o: Record<string, unknown>, keys: string[]): string | undefined {
  for (const k of keys) {
    const v = str(o[k])
    if (v) return v
  }
  return undefined
}

function toProvider(v: unknown): TtsProvider | undefined {
  const s = typeof v === 'string' ? v.trim().toLowerCase() : ''
  if (s === 'voicebox' || s === 'voice studio' || s === 'voicestudio') return 'local'
  return PROVIDERS.find((p) => p === s)
}

/** One scene of a JSON file; a bare string is the picture or voice file for the next scene. */
function toEntry(raw: unknown, kind: Kind): Entry | null {
  if (typeof raw === 'string') return { scene: null, ...(kind === 'image' ? { image: raw } : { audio: raw }) }
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const n = Number(o.scene ?? o.adegan ?? o.clip ?? o.no ?? o.index)
  return {
    scene: Number.isInteger(n) && n > 0 ? n : null,
    title: pickStr(o, ['title', 'judul']),
    narration: pickStr(o, ['narration', 'narasi', 'text', 'teks', 'naskah']),
    prompt: pickStr(o, ['prompt', 'imagePrompt', 'image_prompt', 'visualPrompt', 'visual']),
    videoPrompt: pickStr(o, ['videoPrompt', 'video_prompt']),
    image: pickStr(o, ['image', 'gambar', 'video', 'imageUrl', 'image_url', 'imagePath', 'videoUrl', 'video_url', 'videoPath', 'file']),
    audio: pickStr(o, ['audio', 'suara', 'audioUrl', 'audio_url', 'audioPath', 'voiceFile', 'voice_file']),
    voice: pickStr(o, ['voice', 'voiceId', 'voice_id', 'profile', 'profile_id', 'suaraNarator']),
    provider: toProvider(o.provider ?? o.tts ?? o.engine),
    generate: typeof o.generate === 'boolean' ? o.generate : undefined
  }
}

/**
 * A JSON file of scenes. An array, or an object with `scenes` (also `clips`, `items`, `adegan`) plus
 * defaults for every scene: `voice`, `provider`, `generate`. Per scene: `scene` (1-based, else in order),
 * `title`, `narration`, `prompt`, `image` or `audio` (path relative to the JSON, absolute, or a link), and
 * `voice`/`provider` for the narrator. For a voice JSON, scenes with narration but no audio file are voiced
 * (unless `generate` is false); for an image JSON, scenes with a prompt but no picture are drawn only when
 * `generate` is true, since drawing can cost credits.
 */
export async function importJson(projectId: string, kind: Kind): Promise<ImportResult | null> {
  const [file] = await pick(kind === 'image' ? 'Pilih file JSON gambar' : 'Pilih file JSON suara', 'json', false)
  if (!file) return null
  getProject(projectId)
  let data: unknown
  try {
    data = JSON.parse(readFileSync(file, 'utf8').replace(/^﻿/, ''))
  } catch (e) {
    throw new Error(`File JSON tidak valid: ${(e as Error).message}`)
  }
  const top = (Array.isArray(data) ? {} : (data ?? {})) as Record<string, unknown>
  const list = Array.isArray(data) ? data : (top.scenes ?? top.clips ?? top.items ?? top.adegan ?? top.data)
  if (!Array.isArray(list) || !list.length) throw new Error('JSON harus berisi daftar adegan, misalnya [{"scene": 1, ...}] atau {"scenes": [...]}.')
  const defaults: TtsOverride & { generate?: boolean } = {
    voice: pickStr(top, ['voice', 'voiceId', 'voice_id', 'profile', 'profile_id']),
    provider: toProvider(top.provider ?? top.tts ?? top.engine),
    generate: typeof top.generate === 'boolean' ? top.generate : undefined
  }
  const base = dirname(file)
  const failed: string[] = []
  let media = 0
  let texts = 0
  const voiceJobs: { clipId: string; override: TtsOverride }[] = []
  const imageJobs: string[] = []
  let next = 1
  for (const raw of list) {
    const e = toEntry(raw, kind)
    if (!e) continue
    const n = e.scene ?? next
    next = n + 1
    const clip = clipAt(projectId, n)
    const text: Parameters<typeof patchClipText>[1] = {}
    if (e.title) text.title = e.title
    if (e.narration) text.narration = e.narration
    if (e.prompt) text.visualPrompt = e.prompt
    if (e.videoPrompt) text.videoPrompt = e.videoPrompt
    if (Object.keys(text).length) {
      patchClipText(clip.id, text)
      texts++
    }
    const src = kind === 'image' ? e.image : e.audio
    const generate = e.generate ?? defaults.generate ?? kind === 'audio'
    try {
      if (src) {
        await (kind === 'image' ? putImage(clip, src, base) : putAudio(clip, src, base))
        media++
      } else if (kind === 'audio' && generate && getClip(clip.id).narration.trim()) {
        voiceJobs.push({ clipId: clip.id, override: { provider: e.provider ?? defaults.provider, voice: e.voice ?? defaults.voice } })
      } else if (kind === 'image' && generate && getClip(clip.id).visualPrompt.trim()) {
        imageJobs.push(clip.id)
      }
    } catch (err) {
      failed.push(`adegan ${n}: ${(err as Error).message}`)
    }
  }
  touchProject(projectId)
  // Jobs start after every text is in place, so each one reads its final narration or prompt.
  for (const j of voiceJobs) {
    try {
      generateClipTts(j.clipId, j.override)
    } catch (err) {
      failed.push((err as Error).message)
    }
  }
  for (const id of imageJobs) {
    try {
      generateClipImage(id)
    } catch (err) {
      failed.push((err as Error).message)
    }
  }
  if (kind === 'audio' && media) syncIfPossible(projectId)
  const what = kind === 'image' ? 'gambar/video' : 'suara'
  const parts = [
    media && `${media} ${what} dipasang`,
    voiceJobs.length && `${voiceJobs.length} suara sedang dibuat`,
    imageJobs.length && `${imageJobs.length} gambar sedang dibuat`,
    texts && `${texts} adegan diperbarui teksnya`
  ].filter(Boolean)
  return {
    bundle: getBundle(projectId),
    message: (parts.length ? `${parts.join(', ')}.` : 'Tidak ada yang diubah dari JSON ini.') + (failed.length ? ` ${failed.length} gagal: ${failed.slice(0, 3).join('; ')}` : '')
  }
}

/** Files dropped on a clip card: the first picture and voice go to that clip, more go to the clips after it. */
export async function importDropped(clipId: string, paths: string[]): Promise<ImportResult> {
  const clip = getClip(clipId)
  const start = clipsOf(clip.projectId).findIndex((c) => c.id === clipId) + 1
  const ext = (p: string): string => extname(p).slice(1).toLowerCase()
  const sorted = [...paths].sort((a, b) => natural.compare(basename(a), basename(b)))
  const groups: Record<Kind, string[]> = {
    image: sorted.filter((p) => IMAGE_EXT.includes(ext(p)) || VIDEO_EXT.includes(ext(p))),
    audio: sorted.filter((p) => AUDIO_EXT.includes(ext(p)))
  }
  if (!groups.image.length && !groups.audio.length) throw new Error('Taruh file gambar (PNG, JPG, WebP), video (MP4, MOV, WebM), atau suara (MP3, WAV, M4A, OGG, FLAC).')
  const failed: string[] = []
  for (const kind of ['image', 'audio'] as const) {
    for (let i = 0; i < groups[kind].length; i++) {
      const target = clipAt(clip.projectId, start + i)
      try {
        await (kind === 'image' ? putImage(target, groups[kind][i], null) : putAudio(target, groups[kind][i], null))
      } catch (e) {
        failed.push(`${basename(groups[kind][i])}: ${(e as Error).message}`)
      }
    }
  }
  touchProject(clip.projectId)
  if (groups.audio.length) syncIfPossible(clip.projectId)
  const parts = [groups.image.length && `${groups.image.length} gambar/video`, groups.audio.length && `${groups.audio.length} suara`].filter(Boolean)
  return {
    bundle: getBundle(clip.projectId),
    message: `${parts.join(' dan ')} dipasang mulai klip ${start}.` + (failed.length ? ` ${failed.length} gagal: ${failed.slice(0, 3).join('; ')}` : '')
  }
}
