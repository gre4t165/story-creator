import { randomUUID } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { estimateWordTimings } from '@shared/captions'
import { avoidTerms, faceSafe, imageRules, imageRulesShort, normalizeRules, sheetViews, videoRules, type ContentRules } from '@shared/content'
import { FREE_PROVIDER_NAMES, getFreeImageModel, type FreeImageModel } from '@shared/freemodels'
import { defaultVoiceFor } from '@shared/models'
import { stripVoiceTags } from '@shared/speech'
import { getImageModel, getVideoModel, imageBody, maxRefs, promptLimit, videoBody, type HfModel } from '@shared/higgsfield'
import { getStyle } from '@shared/styles'
import type { AspectRatio, Asset, Character, Clip, CreditEstimate, Job, Project, TtsOverride, WordTiming } from '@shared/types'
import * as censor from './censor'
import { getDb } from './db'
import { emit } from './events'
import { runJob, type TaskCtx } from './jobs'
import { assetAbsPath } from './paths'
import {
  activeJobFor,
  charactersOf,
  clipsOf,
  getAsset,
  getCharacter,
  getClip,
  getJob,
  getProject,
  insertAsset,
  insertJob,
  patchClip,
  setCharacterSheet,
  touchProject,
  unfinishedJobs,
  updateAssetMeta,
  updateJob
} from './repo'
import { dropCache, getSettings, readCache, ttsModelName, writeCache } from './settings'
import { probeDurationMs, probeSize } from './services/audio'
import * as cloudflare from './services/cloudflare'
import * as edge from './services/edgetts'
import * as eleven from './services/elevenlabs'
import * as gemini from './services/gemini'
import * as hf from './services/higgsfield'
import * as localtts from './services/localtts'
import * as pollinations from './services/pollinations'
import { downloadTo, sleep } from './services/http'

const DAY = 24 * 60 * 60 * 1000

function extFromType(contentType: string, url: string, fallback: string): string {
  if (/png/.test(contentType)) return '.png'
  if (/jpe?g/.test(contentType)) return '.jpg'
  if (/webp/.test(contentType)) return '.webp'
  if (/mp4/.test(contentType)) return '.mp4'
  const m = /\.(png|jpe?g|webp|mp4|mov)(\?|$)/i.exec(url)
  return m ? `.${m[1].toLowerCase()}` : fallback
}

function saveFile(projectId: string, folder: string, ext: string, bytes: Buffer): string {
  const rel = `${folder}/${randomUUID()}${ext}`
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, bytes)
  return rel
}

/** A URL Higgsfield can fetch for a stored asset: its own recent result URL, or a fresh upload. */
async function publicUrlFor(asset: Asset, signal: AbortSignal): Promise<string> {
  if (asset.remoteUrl && asset.provider === 'higgsfield' && Date.now() - asset.createdAt < 6 * DAY) return asset.remoteUrl
  const up = asset.meta.uploadedUrl as string | undefined
  const at = asset.meta.uploadedAt as number | undefined
  if (up && at && Date.now() - at < 0.5 * DAY) return up
  const url = await hf.uploadFile(assetAbsPath(asset.projectId, asset.localPath), signal)
  updateAssetMeta(asset.id, { ...asset.meta, uploadedUrl: url, uploadedAt: Date.now() })
  return url
}

function imageProgress(ctx: TaskCtx, what: string) {
  return (status: hf.HfStatus, elapsed: number): void => {
    if (status === 'queued') ctx.progress(0.12, 'Mengantre di Higgsfield')
    else ctx.progress(0.15 + 0.75 * (1 - Math.exp(-elapsed / 45_000)), what)
  }
}

// ---------- prompts ----------

function characterLine(c: Character): string {
  return `${c.name}: ${c.description}`
}

/** Splits the storyboard's "Avoid:" line off the scene, so it can be phrased as a clear instruction. */
function splitAvoid(visual: string): { scene: string; avoid: string } {
  const lines = visual.split('\n')
  const i = lines.findIndex((l) => /^\s*avoid\s*:/i.test(l))
  if (i < 0) return { scene: visual.trim(), avoid: '' }
  const avoid = lines[i].replace(/^\s*avoid\s*:\s*/i, '').replace(/\.$/, '').trim()
  lines.splice(i, 1)
  return { scene: lines.join('\n').trim(), avoid }
}

/**
 * The image prompt for a clip. The scene comes first so the model gets the content right, then who the
 * characters are, then the art style. Clothing follows the scene's Wardrobe line when it has one, so a
 * character can change out of the outfit on their reference sheet (no spacesuit indoors).
 */
function rules(): ContentRules {
  return normalizeRules(getSettings().contentRules)
}

function clipPrompt(project: Project, clip: Clip, chars: Character[], refNames: string[], limit: number): string {
  const style = getStyle(project.styleId)
  const r = rules()
  const { scene, avoid: sceneAvoid } = splitAvoid(clip.visualPrompt)
  // The content rules add their own "must not appear" words, after the scene's own.
  const avoid = [sceneAvoid, ...avoidTerms(r)].filter(Boolean).join(', ')
  const wardrobe = /^\s*wardrobe\s*:/im.test(scene)
  const parts = [`Scene:\n${scene}`]
  const ruleText = imageRules(r)
  // Right after the scene, so it outranks any pose or outfit the scene or a reference sheet suggests.
  if (ruleText) parts.push(ruleText)
  if (chars.length)
    parts.push(
      `Recurring characters in this scene. Keep each one's body, ${r.hideFaces ? '' : 'face, '}hair and skin exactly as described${refNames.length ? ' and as on their reference sheet' : ''}.` +
        (wardrobe
          ? ' Their clothing follows the Wardrobe line of the scene: the default outfit only where it says so, otherwise the custom outfit.'
          : ' They wear their default outfit.') +
        `\n${chars.map(characterLine).join('\n')}`
    )
  if (refNames.length)
    parts.push(
      `Reference images are character sheets, in this order: ${refNames.join(', ')}. Use them for each character's identity, proportions and colors. ` +
        (wardrobe ? 'Copy the costume from a sheet only for characters whose Wardrobe line says "default outfit". ' : 'Match the costume to the sheet. ') +
        'Do not copy the sheet layout, poses or plain background.'
    )
  parts.push(`Art style: ${faceSafe(style.prompt, r)}`)
  if (avoid) parts.push(`Must not appear in the image: ${avoid}.`)
  parts.push(`Frame format ${project.aspectRatio}, full-bleed composition.`)
  const full = parts.join('\n\n')
  if (full.length <= limit) return full
  // Models with short prompt limits get the short content rules first (they must never be cut off), then the
  // scene, so trimming only loses scene and style detail.
  return [imageRulesShort(r), scene, chars.map(characterLine).join('; '), avoid && `Must not appear: ${avoid}.`, faceSafe(style.prompt, r)].filter(Boolean).join('\n\n')
}

function sheetPrompt(project: Project, c: Character): string {
  const style = getStyle(project.styleId)
  const r = rules()
  return [
    faceSafe(style.prompt, r),
    `Character reference sheet for "${c.name}": ${c.description}. The character is ${faceSafe(style.characterHint, r)}.`,
    `${sheetViews(r)}, on a plain light neutral background (this overrides any background instruction above). Consistent proportions, costume and colors in all three views.`,
    imageRules(r)
  ]
    .filter(Boolean)
    .join('\n\n')
}

// ---------- waiting for character sheets ----------

async function waitForSheets(characterIds: string[], signal: AbortSignal): Promise<void> {
  const started = Date.now()
  while (Date.now() - started < 15 * 60 * 1000) {
    const pending = characterIds.some((id) => activeJobFor({ characterId: id }, 'sheet'))
    if (!pending) return
    await sleep(2000, signal)
  }
}

async function referenceUrls(model: HfModel, chars: Character[], signal: AbortSignal): Promise<{ urls: string[]; names: string[] }> {
  const limit = maxRefs(model)
  if (limit === 0) return { urls: [], names: [] }
  await waitForSheets(
    chars.map((c) => c.id),
    signal
  )
  const urls: string[] = []
  const names: string[] = []
  for (const c of chars) {
    const fresh = getCharacter(c.id)
    const sheet = getAsset(fresh.sheetAssetId)
    if (!sheet || urls.length >= limit) continue
    urls.push(await publicUrlFor(sheet, signal))
    names.push(fresh.name)
  }
  return { urls, names }
}

// ---------- finishing a Higgsfield request (also used to resume after a restart) ----------

interface MediaPayload {
  target: 'clip-image' | 'sheet' | 'clip-video'
  model: string
  prompt: string
}

/** What a provider handed back, ready to be stored as the clip's (or character's) next asset. */
interface Delivered {
  bytes: Buffer
  contentType: string
  /** Where it came from: Higgsfield results have a link and a request id, free services return the bytes directly. */
  url: string | null
  requestId: string | null
  provider: string
}

// ---------- face check before storing ----------

const TARGET_OF: Record<string, MediaPayload['target']> = { image: 'clip-image', sheet: 'sheet', video: 'clip-video' }

/**
 * A result whose face check failed (no Gemini key, quota, network) is kept here instead of being thrown away,
 * so "try again" checks the same picture again instead of paying for a new one.
 */
function pendingBase(job: Job, target: MediaPayload['target']): string {
  return assetAbsPath(job.projectId, `pending/${target}-${job.clipId ?? job.characterId ?? job.id}`)
}

function savePending(job: Job, payload: MediaPayload, got: Delivered): void {
  try {
    const base = pendingBase(job, payload.target)
    mkdirSync(dirname(base), { recursive: true })
    writeFileSync(`${base}.bin`, got.bytes)
    writeFileSync(`${base}.json`, JSON.stringify({ payload, got: { ...got, bytes: undefined } }))
  } catch {
    // Keeping the copy is a convenience; the error the user sees is the face check itself.
  }
}

/** A result kept by savePending for this clip or character, taken out so it is only reused once (and only for two days). */
function takePending(job: Job): { payload: MediaPayload; got: Delivered } | null {
  const target = TARGET_OF[job.kind]
  if (!target) return null
  const base = pendingBase(job, target)
  try {
    if (!existsSync(`${base}.json`) || !existsSync(`${base}.bin`)) return null
    const fresh = Date.now() - statSync(`${base}.bin`).mtimeMs < 2 * DAY
    const saved = JSON.parse(readFileSync(`${base}.json`, 'utf8')) as { payload: MediaPayload; got: Omit<Delivered, 'bytes'> }
    const bytes = readFileSync(`${base}.bin`)
    rmSync(`${base}.json`, { force: true })
    rmSync(`${base}.bin`, { force: true })
    return fresh ? { payload: saved.payload, got: { ...saved.got, bytes } } : null
  } catch {
    return null
  }
}

/** Covers faces in a new picture or video when the content rules say so. Returns what to store and a note for the asset. */
async function applyContentRules(job: Job, payload: MediaPayload, got: Delivered, ctx?: TaskCtx): Promise<{ got: Delivered; meta: Record<string, unknown> }> {
  const r = rules()
  if (!r.hideFaces) return { got, meta: {} }
  const isVideo = payload.target === 'clip-video'
  ctx?.progress(isVideo ? 0.9 : 0.94, 'Memeriksa wajah')
  try {
    const out = isVideo
      ? await censor.censorVideo(got.bytes, r.censorStyle, ctx?.signal, (f) => ctx?.progress(0.9 + 0.08 * f, 'Menyensor wajah di video'))
      : await censor.censorImage(got.bytes, got.contentType, r.censorStyle, ctx?.signal)
    return { got: { ...got, bytes: out.bytes, contentType: out.contentType }, meta: { facesCensored: out.faces, censorStyle: r.censorStyle } }
  } catch (e) {
    const msg = (e as Error)?.message ?? String(e)
    if (/Dibatalkan/.test(msg) || ctx?.signal.aborted) throw e
    savePending(job, payload, got)
    const what = isVideo ? 'Video' : 'Gambar'
    throw new Error(`${what} sudah jadi, tapi wajahnya belum bisa diperiksa: ${msg} Klik buat ulang: ${what.toLowerCase()} yang sama diperiksa lagi tanpa membuat baru.`)
  }
}

/** Saves a finished picture or video as an asset and puts it on its clip or character. Shared by every provider. */
async function commitMedia(job: Job, payload: MediaPayload, raw: Delivered, ctx?: TaskCtx): Promise<string> {
  const isVideo = payload.target === 'clip-video'
  const { got, meta } = await applyContentRules(job, payload, raw, ctx)
  const rel = saveFile(job.projectId, isVideo ? 'videos' : 'images', extFromType(got.contentType, got.url ?? '', isVideo ? '.mp4' : '.png'), got.bytes)
  const abs = assetAbsPath(job.projectId, rel)
  const size = await probeSize(abs)
  const durationMs = isVideo ? await probeDurationMs(abs).catch(() => null) : null
  const asset = insertAsset({
    projectId: job.projectId,
    clipId: job.clipId,
    characterId: job.characterId,
    kind: isVideo ? 'video' : 'image',
    provider: got.provider,
    model: payload.model,
    prompt: payload.prompt,
    remoteId: got.requestId,
    remoteUrl: got.url,
    localPath: rel,
    durationMs,
    width: size?.width ?? null,
    height: size?.height ?? null,
    ...(Object.keys(meta).length ? { meta } : {})
  })
  emit.asset(asset)
  if (payload.target === 'sheet' && job.characterId) {
    setCharacterSheet(job.characterId, asset.id)
    emit.character({ characterId: job.characterId, patch: { sheetAssetId: asset.id } })
  } else if (payload.target === 'clip-image' && job.clipId) {
    patchClip(job.clipId, { imageAssetId: asset.id })
    emit.clip({ clipId: job.clipId, patch: { imageAssetId: asset.id } })
    const project = getProject(job.projectId)
    const first = clipsOf(job.projectId)[0]
    if (!project.coverAssetId || first?.id === job.clipId) touchProject(job.projectId, { coverAssetId: asset.id })
  } else if (payload.target === 'clip-video' && job.clipId) {
    const patch = { videoAssetId: asset.id, motionType: 'video' as const, mediaInMs: 0 }
    patchClip(job.clipId, patch)
    emit.clip({ clipId: job.clipId, patch })
  }
  touchProject(job.projectId)
  return asset.id
}

async function finishHiggsfield(ctx: TaskCtx, job: Job, requestId: string, payload: MediaPayload): Promise<string> {
  const isVideo = payload.target === 'clip-video'
  const result = await hf.waitForResult(
    requestId,
    imageProgress(ctx, isVideo ? 'Membuat video' : payload.target === 'sheet' ? 'Membuat lembar karakter' : 'Membuat gambar'),
    ctx.signal,
    isVideo ? 30 * 60 * 1000 : 15 * 60 * 1000
  )
  const url = isVideo ? result.video?.url : result.images?.[0]?.url
  if (!url) throw new Error('Higgsfield selesai tanpa file hasil')
  ctx.progress(0.93, 'Mengunduh hasil')
  const { bytes, contentType } = await downloadTo(url, ctx.signal)
  return commitMedia(job, payload, { bytes, contentType, url, requestId, provider: 'higgsfield' }, ctx)
}

function startHiggsfield(job: Job, build: (ctx: TaskCtx) => Promise<{ endpoint: string; body: Record<string, unknown>; payload: MediaPayload }>): Job {
  emit.job(job)
  return runJob(job, 'higgsfield', async (ctx) => {
    const pending = takePending(job)
    if (pending) return commitMedia(job, pending.payload, pending.got, ctx)
    ctx.progress(0.04, 'Menyiapkan prompt')
    const { endpoint, body, payload } = await build(ctx)
    ctx.progress(0.08, 'Mengirim ke Higgsfield')
    const requestId = await hf.submit(endpoint, body, ctx.signal)
    ctx.setRemote(requestId)
    updateJobPayload(job.id, payload)
    return finishHiggsfield(ctx, job, requestId, payload)
  })
}

function updateJobPayload(jobId: string, payload: MediaPayload): void {
  getDb().prepare('UPDATE jobs SET payload_json = ? WHERE id = ?').run(JSON.stringify(payload), jobId)
}

/** Cuts a prompt to a limit at a word boundary; the scene-first short prompt can still run a little over. */
function fit(prompt: string, limit: number): string {
  if (prompt.length <= limit) return prompt
  const cut = prompt.slice(0, limit)
  const space = cut.lastIndexOf(' ')
  return (space > limit * 0.8 ? cut.slice(0, space) : cut).trim()
}

/**
 * The character sheets a direct model can take as references (only Gemini does), read from disk because
 * Gemini takes the bytes inline instead of a link. Waits for sheets still being drawn, like Higgsfield does.
 */
async function localReferences(model: FreeImageModel, chars: Character[], signal: AbortSignal): Promise<{ refs: gemini.ImageRef[]; names: string[] }> {
  if (model.refs === 0) return { refs: [], names: [] }
  await waitForSheets(
    chars.map((c) => c.id),
    signal
  )
  const refs: gemini.ImageRef[] = []
  const names: string[] = []
  for (const c of chars) {
    const fresh = getCharacter(c.id)
    const sheet = getAsset(fresh.sheetAssetId)
    if (!sheet || refs.length >= model.refs) continue
    try {
      const path = assetAbsPath(sheet.projectId, sheet.localPath)
      const ext = extname(path).toLowerCase()
      refs.push({ data: readFileSync(path), mimeType: ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : ext === '.webp' ? 'image/webp' : 'image/png' })
      names.push(fresh.name)
    } catch {
      // A sheet whose file was deleted is skipped; the description in the prompt still carries the look.
    }
  }
  return { refs, names }
}

interface DirectRequest {
  prompt: string
  aspect: AspectRatio
  refs: gemini.ImageRef[]
  payload: Omit<MediaPayload, 'prompt'>
}

/**
 * A picture from a service called directly (Cloudflare, Pollinations, Gemini). They answer in one request, so
 * there is nothing to resume after a restart and no remote id; the job just waits for the bytes and stores
 * them like any other result.
 */
function startFree(job: Job, model: FreeImageModel, build: (ctx: TaskCtx) => Promise<DirectRequest>): Job {
  emit.job(job)
  return runJob(job, 'freeimage', async (ctx) => {
    const pending = takePending(job)
    if (pending) return commitMedia(job, pending.payload, pending.got, ctx)
    ctx.progress(0.05, 'Menyiapkan prompt')
    const { prompt: raw, aspect, refs, payload } = await build(ctx)
    const prompt = fit(raw, model.promptLimit)
    const where = FREE_PROVIDER_NAMES[model.provider]
    const started = Date.now()
    ctx.progress(0.12, `Menggambar di ${where}`)
    const tick = setInterval(() => ctx.progress(0.12 + 0.78 * (1 - Math.exp(-(Date.now() - started) / 20_000)), `Menggambar di ${where}`), 1500)
    let got: { bytes: Buffer; contentType: string }
    try {
      got =
        model.provider === 'gemini'
          ? await gemini.generateImage(model, prompt, aspect, refs, ctx.signal)
          : await (model.provider === 'cloudflare' ? cloudflare : pollinations).generateImage(model, prompt, aspect, ctx.signal)
    } finally {
      clearInterval(tick)
    }
    ctx.progress(0.93, 'Menyimpan hasil')
    return commitMedia(job, { ...payload, prompt }, { ...got, url: null, requestId: null, provider: model.provider }, ctx)
  })
}

// ---------- public entry points ----------

export function generateClipImage(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'image')
  if (existing) return existing
  const clip = getClip(clipId)
  const free = getFreeImageModel(getProject(clip.projectId).imageModel)
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'image', provider: free?.provider ?? 'higgsfield' })
  if (free)
    return startFree(job, free, async (ctx) => {
      const fresh = getClip(clipId)
      const project = getProject(fresh.projectId)
      const chars = charactersOf(project.id).filter((c) => fresh.characterIds.includes(c.id))
      // Without reference images (Cloudflare, Pollinations) the character descriptions in the prompt carry the look.
      const { refs, names } = await localReferences(free, chars, ctx.signal)
      return {
        prompt: clipPrompt(project, fresh, chars, names, free.promptLimit),
        aspect: project.aspectRatio,
        refs,
        payload: { target: 'clip-image', model: free.id }
      }
    })
  return startHiggsfield(job, async (ctx) => {
    const fresh = getClip(clipId)
    const project = getProject(fresh.projectId)
    const model = getImageModel(project.imageModel)
    const chars = charactersOf(project.id).filter((c) => fresh.characterIds.includes(c.id))
    const refs = await referenceUrls(model, chars, ctx.signal)
    const prompt = clipPrompt(project, fresh, chars, refs.names, promptLimit(model))
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, project.aspectRatio, refs.urls),
      payload: { target: 'clip-image', model: model.id, prompt }
    }
  })
}

export function generateCharacterSheet(characterId: string): Job {
  const existing = activeJobFor({ characterId }, 'sheet')
  if (existing) return existing
  const c = getCharacter(characterId)
  const free = getFreeImageModel(getProject(c.projectId).imageModel)
  const job = insertJob({ projectId: c.projectId, characterId, kind: 'sheet', provider: free?.provider ?? 'higgsfield' })
  if (free)
    return startFree(job, free, async () => {
      const project = getProject(c.projectId)
      return { prompt: sheetPrompt(project, getCharacter(characterId)), aspect: '16:9', refs: [], payload: { target: 'sheet', model: free.id } }
    })
  return startHiggsfield(job, async () => {
    const project = getProject(c.projectId)
    const model = getImageModel(project.imageModel)
    const prompt = sheetPrompt(project, getCharacter(characterId))
    return {
      endpoint: model.id,
      body: imageBody(model, prompt, '16:9', []),
      payload: { target: 'sheet', model: model.id, prompt }
    }
  })
}

export function generateClipVideo(clipId: string): Job {
  const existing = activeJobFor({ clipId }, 'video')
  if (existing) return existing
  const clip = getClip(clipId)
  if (!clip.imageAssetId) throw new Error('Buat gambar klip ini dulu sebelum membuat video AI.')
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'video', provider: 'higgsfield' })
  return startHiggsfield(job, async (ctx) => {
    const fresh = getClip(clipId)
    const image = getAsset(fresh.imageAssetId)
    if (!image) throw new Error('Gambar klip tidak ditemukan')
    const project = getProject(fresh.projectId)
    const model = getVideoModel(project.videoModel)
    ctx.progress(0.05, 'Menyiapkan gambar awal')
    const url = await publicUrlFor(image, ctx.signal)
    let prompt =
      fresh.videoPrompt.trim() ||
      `${splitAvoid(fresh.visualPrompt).scene.replace(/\.$/, '')}. Subtle natural motion of the characters and environment, the camera slowly pushes in. Keep the art style of the first frame.`
    if (model.input.mode === 'reference')
      prompt = `Open on the exact scene of the reference image and keep its art style, characters and composition. ${prompt}`
    const extra = videoRules(rules())
    if (extra) prompt = `${prompt.trim().replace(/\.?$/, '.')} ${extra}`
    return {
      endpoint: model.id,
      body: videoBody(model, prompt, url, fresh.durationMs / 1000, project.aspectRatio, project.videoResolution),
      payload: { target: 'clip-video', model: model.id, prompt }
    }
  })
}

/** Voices one clip, with the project's narrator or the one a voice JSON chose for this clip. */
export function generateClipTts(clipId: string, override: TtsOverride = {}): Job {
  const existing = activeJobFor({ clipId }, 'tts')
  if (existing) return existing
  const clip = getClip(clipId)
  const project = getProject(clip.projectId)
  const provider = override.provider ?? project.ttsProvider
  const job = insertJob({ projectId: clip.projectId, clipId, kind: 'tts', provider })
  emit.job(job)
  return runJob(job, 'tts', async (ctx) => {
    const fresh = getClip(clipId)
    const p = getProject(fresh.projectId)
    const text = fresh.narration.trim()
    if (!text) throw new Error('Naskah klip ini masih kosong')
    ctx.progress(0.2, 'Membuat suara')
    let rel: string
    let words: WordTiming[] | undefined
    let estimated = false
    // A voice chosen for another service would not exist on this one.
    const voice = override.voice?.trim() || (provider === p.ttsProvider ? p.ttsVoice : '') || defaultVoiceFor(provider, p.language)
    if (provider === 'elevenlabs') {
      if (!voice) throw new Error('Pilih suara ElevenLabs dulu di langkah Ide cerita.')
      const out = await eleven.speak(text, voice, p.language, ctx.signal)
      rel = saveFile(p.id, 'audio', '.mp3', out.audio)
      words = out.words
    } else if (provider === 'edge') {
      const out = await edge.speak(text, voice, ctx.signal)
      rel = saveFile(p.id, 'audio', '.mp3', out.audio)
      words = out.words
    } else if (provider === 'local') {
      const wav = await localtts.speak(text, voice, p.language, ctx.signal)
      rel = saveFile(p.id, 'audio', '.wav', wav)
    } else {
      const wav = await gemini.speak(text, voice, p.language, ctx.signal)
      rel = saveFile(p.id, 'audio', '.wav', wav)
    }
    ctx.progress(0.85, 'Mengukur durasi')
    const audioMs = await probeDurationMs(assetAbsPath(p.id, rel))
    if (!words?.length) {
      words = estimateWordTimings(stripVoiceTags(text), audioMs / 1000)
      estimated = true
    }
    const asset = insertAsset({
      projectId: p.id,
      clipId,
      kind: 'audio',
      provider,
      model: ttsModelName(provider),
      prompt: text,
      localPath: rel,
      durationMs: audioMs,
      meta: { words, estimatedTimings: estimated, voice }
    })
    emit.asset(asset)
    const durationMs = Math.max(1500, audioMs + 400)
    const patch = { audioAssetId: asset.id, durationMs, voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
    patchClip(clipId, patch)
    emit.clip({ clipId, patch })
    touchProject(p.id)
    return asset.id
  })
}

export function generateMissingImages(projectId: string): Job[] {
  const jobs: Job[] = []
  const project = getProject(projectId)
  const model = getImageModel(project.imageModel)
  // Character sheets only help models that take them as references: most Higgsfield ones and Gemini.
  const direct = getFreeImageModel(project.imageModel)
  if (direct ? direct.refs > 0 : maxRefs(model) > 0) {
    const needed = new Set(clipsOf(projectId).flatMap((c) => c.characterIds))
    for (const c of charactersOf(projectId)) {
      if (needed.has(c.id) && !c.sheetAssetId) jobs.push(generateCharacterSheet(c.id))
    }
  }
  for (const clip of clipsOf(projectId)) {
    if (!clip.imageAssetId) jobs.push(generateClipImage(clip.id))
  }
  return jobs
}

/** Turns every clip that has an image but no AI video yet into a video. */
export function generateMissingVideos(projectId: string): Job[] {
  const clips = clipsOf(projectId)
  if (clips.some((c) => !c.imageAssetId)) throw new Error('Buat gambar semua klip dulu sebelum menjadikannya video.')
  return clips.filter((c) => !c.videoAssetId).map((c) => generateClipVideo(c.id))
}

export function generateMissingTts(projectId: string): Job[] {
  return clipsOf(projectId)
    .filter((c) => !c.audioAssetId && c.narration.trim())
    .map((c) => generateClipTts(c.id))
}

/** After a restart, keep polling Higgsfield requests that were already submitted; fail the rest. */
export function resumeJobs(): void {
  for (const row of unfinishedJobs()) {
    const payload = JSON.parse(row.payload_json || '{}') as Partial<MediaPayload>
    if (row.provider === 'higgsfield' && row.remote_id && payload.target) {
      const job = getJob(row.id)!
      runJob(job, 'higgsfield', (ctx) => finishHiggsfield(ctx, job, row.remote_id, payload as MediaPayload))
    } else {
      emit.job(updateJob(row.id, { status: 'failed', error: 'Terhenti karena aplikasi ditutup. Coba lagi.', message: null }))
    }
  }
}

export async function setActiveAsset(clipId: string, assetId: string): Promise<void> {
  const asset = getAsset(assetId)
  if (!asset || asset.clipId !== clipId) throw new Error('Aset tidak cocok dengan klip ini')
  const patch: Partial<Clip> =
    asset.kind === 'image'
      ? { imageAssetId: asset.id }
      : asset.kind === 'video'
        ? { videoAssetId: asset.id, mediaInMs: 0 }
        : asset.kind === 'audio'
          ? { audioAssetId: asset.id, durationMs: Math.max(1500, (asset.durationMs ?? 0) + 400), voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
          : {}
  patchClip(clipId, patch)
  emit.clip({ clipId, patch })
}

/** Estimates that failed recently (no key, or a model the account cannot use), so pickers do not keep asking. */
const failedEstimates = new Map<string, number>()

/**
 * Credits for one image, or one clip video of about `seconds`. The model pickers ask for every model,
 * so answers are kept for a day and failures for ten minutes.
 */
export async function estimateCredits(
  kind: 'image' | 'video',
  modelId: string,
  aspect: AspectRatio,
  seconds = 5,
  resolution?: string | null
): Promise<CreditEstimate | null> {
  // Free models have no price to estimate.
  if (kind === 'image' && getFreeImageModel(modelId)) return null
  const model = kind === 'image' ? getImageModel(modelId) : getVideoModel(modelId)
  const body =
    kind === 'image'
      ? imageBody(model, 'estimate', aspect, [])
      : videoBody(model, 'estimate', 'https://example.com/frame.png', seconds, aspect, resolution)
  const key = `estimate:${model.id}:${JSON.stringify(body)}`
  const hit = readCache<CreditEstimate>(key)
  if (hit && Date.now() - hit.updatedAt < DAY) return hit.value
  const failedAt = failedEstimates.get(key)
  if (failedAt && Date.now() - failedAt < 10 * 60 * 1000) return null
  const value = await hf.estimate(model.id, body)
  if (value) writeCache(key, value)
  else failedEstimates.set(key, Date.now())
  return value
}

/** Prices can differ per account, so a new Higgsfield key starts from fresh estimates. */
export function forgetEstimates(): void {
  failedEstimates.clear()
  dropCache('estimate:')
}
