import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import { WHISPER_TIMING, captionNeedsSync, estimateWordTimings } from '@shared/captions'
import { estimateNarrationMs } from '@shared/script'
import { defaultVoiceFor } from '@shared/models'
import { spokenWords, stripVoiceTags } from '@shared/speech'
import type { Clip, Job, Project, WordTiming } from '@shared/types'
import { emit } from './events'
import { runJob, type TaskCtx } from './jobs'
import { assetAbsPath, binPath, dataDir } from './paths'
import {
  activeProjectJob,
  clipsOf,
  getAsset,
  getClip,
  getProject,
  insertAsset,
  insertJob,
  patchClip,
  touchProject,
  updateAssetMeta
} from './repo'
import { getSettings, ttsModelName } from './settings'
import { chooseCuts, cutsFromWords } from './cuts'
import { probeDurationMs } from './services/audio'
import * as edge from './services/edgetts'
import * as eleven from './services/elevenlabs'
import * as gemini from './services/gemini'
import * as localtts from './services/localtts'
import { timeScript, whisperReady } from './whisper'

/**
 * Voices many scenes in one continuous take and cuts it per scene. A single take keeps the voice, pace and
 * intonation consistent, which separate requests per scene do not. Long scripts are voiced in parts of a
 * few minutes each.
 */

const GEMINI_PART_SEC = 240
const ELEVEN_PART_CHARS = 2400
// Edge takes long text in one request, but a few minutes per take keeps a failure cheap to retry.
const EDGE_PART_CHARS = 3000

interface Segment {
  clip: Clip
  file: string
  durationMs: number
  words: WordTiming[]
  estimated: boolean
  timedBy?: string
}

function ffmpeg(args: string[], signal: AbortSignal): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = execFile(binPath(ffmpegStatic!), ['-hide_banner', '-nostats', ...args], { windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, _out, stderr) => {
      if (signal.aborted) return reject(new Error('Dibatalkan'))
      if (err) return reject(new Error(`FFmpeg gagal: ${String(stderr).split('\n').slice(-4).join(' ').trim()}`))
      resolve(String(stderr))
    })
    signal.addEventListener('abort', () => p.kill('SIGKILL'), { once: true })
  })
}

async function detectSilences(file: string, signal: AbortSignal): Promise<{ start: number; end: number }[]> {
  const log = await ffmpeg(['-i', file, '-af', 'silencedetect=noise=-38dB:d=0.25', '-f', 'null', '-'], signal)
  const out: { start: number; end: number }[] = []
  let start: number | null = null
  for (const line of log.split('\n')) {
    const s = /silence_start:\s*(-?[\d.]+)/.exec(line)
    if (s) start = Math.max(0, Number(s[1]))
    const e = /silence_end:\s*([\d.]+)/.exec(line)
    if (e && start != null) {
      out.push({ start, end: Number(e[1]) })
      start = null
    }
  }
  return out
}

/** Groups scenes into takes that fit one request, keeping the script order. */
function parts(clips: Clip[], provider: Project['ttsProvider']): Clip[][] {
  const out: Clip[][] = []
  let cur: Clip[] = []
  let size = 0
  for (const c of clips) {
    const byChars = provider === 'elevenlabs' || provider === 'edge' || provider === 'local'
    const s = byChars ? c.narration.length : estimateNarrationMs(c.narration) / 1000
    const limit = provider === 'elevenlabs' ? ELEVEN_PART_CHARS : provider === 'edge' || provider === 'local' ? EDGE_PART_CHARS : GEMINI_PART_SEC
    if (cur.length && size + s > limit) {
      out.push(cur)
      cur = []
      size = 0
    }
    cur.push(c)
    size += s
  }
  if (cur.length) out.push(cur)
  return out
}

async function cut(src: string, start: number, end: number, dst: string, signal: AbortSignal): Promise<void> {
  await ffmpeg(['-y', '-i', src, '-ss', start.toFixed(3), '-to', end.toFixed(3), '-c:a', 'pcm_s16le', '-ac', '1', dst], signal)
}

/** Word timings for a take from the local Whisper model, or null when it is off, missing or fails. */
async function whisperTimes(take: string, words: string[], p: Project, total: number, tmp: string, ctx: TaskCtx, note: () => void): Promise<WordTiming[] | null> {
  if (!getSettings().whisperAuto || !whisperReady() || !words.length) return null
  note()
  try {
    return await timeScript(take, words, p.language, total, tmp, ctx.signal)
  } catch (e) {
    if (ctx.signal.aborted) throw e
    console.warn('[whisper]', (e as Error).message)
    return null
  }
}

async function geminiTake(p: Project, voice: string, group: Clip[], tmp: string, ctx: TaskCtx, note: () => void): Promise<Segment[]> {
  // A long pause between scenes gives the cutter a clear gap to find.
  const wav = await gemini.speak(group.map((c) => c.narration.trim()).join('\n<long pause>\n'), voice, p.language, ctx.signal)
  const take = join(tmp, `take-${randomUUID()}.wav`)
  writeFileSync(take, wav)
  const total = (await probeDurationMs(take)) / 1000
  const silences = await detectSilences(take, ctx.signal)

  // With Whisper, every script word gets its real time, and scene ends come from the words themselves.
  const perScene = group.map((c) => spokenWords(c.narration))
  const timed = await whisperTimes(take, perScene.flat(), p, total, tmp, ctx, note)
  const ranges: WordTiming[][] = []
  let gaps: { end: number; start: number }[] | null = null
  if (timed) {
    let at = 0
    for (const w of perScene) {
      ranges.push(timed.slice(at, at + w.length))
      at += w.length
    }
    gaps = []
    for (let k = 0; k < group.length - 1; k++) {
      const end = ranges[k][ranges[k].length - 1]?.end
      const start = ranges[k + 1][0]?.start
      if (end == null || start == null) {
        gaps = null
        break
      }
      gaps.push({ end, start })
    }
  }
  const cuts = gaps ? cutsFromWords(gaps, silences) : chooseCuts(total, group.map((c) => stripVoiceTags(c.narration).length), silences)
  const bounds = [0, ...cuts, total]
  const out: Segment[] = []
  for (let k = 0; k < group.length; k++) {
    const start = bounds[k]
    const end = bounds[k + 1]
    const len = end - start
    const file = join(tmp, `seg-${randomUUID()}.wav`)
    await cut(take, start, end, file, ctx.signal)
    let words: WordTiming[]
    if (timed) {
      words = ranges[k].map((w) => ({ ...w, start: Math.min(len, Math.max(0, w.start - start)), end: Math.min(len, Math.max(0, w.end - start)) }))
    } else {
      // Spread the words over the spoken part only, not the pauses around it.
      const lead = silences.find((s) => s.start <= start + 0.01 && s.end > start)?.end ?? start
      const tail = silences.find((s) => s.start < end && s.end >= end - 0.01)?.start ?? end
      words = estimateWordTimings(stripVoiceTags(group[k].narration), Math.max(0.3, tail - lead)).map((w) => ({
        ...w,
        start: w.start + (lead - start),
        end: w.end + (lead - start)
      }))
    }
    out.push({ clip: group[k], file, durationMs: Math.round(len * 1000), words, estimated: !timed, timedBy: timed ? WHISPER_TIMING : undefined })
  }
  return out
}

/**
 * Cuts a take into scenes at the time of the words, which a service reported exactly (ElevenLabs, Edge).
 * Without any timings it falls back to cutting at the quietest pauses, like a Gemini take without Whisper.
 */
async function splitByWords(group: Clip[], take: string, allWords: WordTiming[], tmp: string, ctx: TaskCtx): Promise<Segment[]> {
  const total = (await probeDurationMs(take)) / 1000
  if (!allWords.length) {
    const silences = await detectSilences(take, ctx.signal)
    const bounds = [0, ...chooseCuts(total, group.map((c) => stripVoiceTags(c.narration).length), silences), total]
    const out: Segment[] = []
    for (let k = 0; k < group.length; k++) {
      const file = join(tmp, `seg-${randomUUID()}.wav`)
      await cut(take, bounds[k], bounds[k + 1], file, ctx.signal)
      const len = bounds[k + 1] - bounds[k]
      out.push({ clip: group[k], file, durationMs: Math.round(len * 1000), words: estimateWordTimings(stripVoiceTags(group[k].narration), Math.max(0.3, len)), estimated: true })
    }
    return out
  }
  // The alignment gives every spoken word; count them off per scene to find where each one starts and ends.
  const counts = group.map((c) => spokenWords(c.narration).length)
  const expected = counts.reduce((a, b) => a + b, 0)
  const scale = expected ? allWords.length / expected : 1
  const ranges: { first: WordTiming | undefined; last: WordTiming | undefined; words: WordTiming[] }[] = []
  let at = 0
  for (const n of counts) {
    const from = Math.round(at * scale)
    at += n
    const to = Math.max(from, Math.round(at * scale))
    const words = allWords.slice(from, to)
    ranges.push({ first: words[0], last: words[words.length - 1], words })
  }
  const bounds = [0]
  for (let k = 0; k < group.length - 1; k++) {
    const a = ranges[k].last?.end
    const b = ranges[k + 1].first?.start
    bounds.push(a != null && b != null ? (a + b) / 2 : (total * (k + 1)) / group.length)
  }
  bounds.push(total)
  const out: Segment[] = []
  for (let k = 0; k < group.length; k++) {
    const start = bounds[k]
    const end = Math.max(start + 0.3, bounds[k + 1])
    const file = join(tmp, `seg-${randomUUID()}.wav`)
    await cut(take, start, end, file, ctx.signal)
    const words = ranges[k].words.map((w) => ({ ...w, start: Math.max(0, w.start - start), end: Math.max(0, w.end - start) }))
    out.push({ clip: group[k], file, durationMs: Math.round((end - start) * 1000), words, estimated: false })
  }
  return out
}

async function elevenTake(
  p: Project,
  voice: string,
  group: Clip[],
  context: { previous?: string; next?: string },
  tmp: string,
  ctx: TaskCtx
): Promise<Segment[]> {
  const r = await eleven.speak(group.map((c) => c.narration.trim()).join('\n\n'), voice, p.language, ctx.signal, context)
  const take = join(tmp, `take-${randomUUID()}.mp3`)
  writeFileSync(take, r.audio)
  return splitByWords(group, take, r.words, tmp, ctx)
}

async function edgeTake(voice: string, group: Clip[], tmp: string, ctx: TaskCtx): Promise<Segment[]> {
  const r = await edge.speak(edge.joinScenes(group.map((c) => c.narration)), voice, ctx.signal)
  const take = join(tmp, `take-${randomUUID()}.mp3`)
  writeFileSync(take, r.audio)
  return splitByWords(group, take, r.words, tmp, ctx)
}

/**
 * A local voice server speaks each scene on its own: it gives no word times to cut one take by, and cloned
 * voices stay steady from scene to scene anyway. Captions start from estimates and Whisper re-times them.
 */
async function localTake(p: Project, voice: string, group: Clip[], tmp: string, ctx: TaskCtx): Promise<Segment[]> {
  const out: Segment[] = []
  for (const clip of group) {
    const wav = await localtts.speak(clip.narration, voice, p.language, ctx.signal)
    const file = join(tmp, `scene-${randomUUID()}.wav`)
    writeFileSync(file, wav)
    const durationMs = await probeDurationMs(file)
    const words = estimateWordTimings(stripVoiceTags(clip.narration), durationMs / 1000)
    out.push({ clip, file, durationMs, words, estimated: true })
  }
  return out
}

function store(p: Project, s: Segment, voice: string, takeId: string, bytes: Buffer): void {
  const rel = `audio/${randomUUID()}.wav`
  const abs = assetAbsPath(p.id, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, bytes)
  const asset = insertAsset({
    projectId: p.id,
    clipId: s.clip.id,
    kind: 'audio',
    provider: p.ttsProvider,
    model: ttsModelName(p.ttsProvider),
    prompt: s.clip.narration,
    localPath: rel,
    durationMs: s.durationMs,
    meta: { words: s.words, estimatedTimings: s.estimated, voice, take: takeId, ...(s.timedBy ? { timedBy: s.timedBy } : {}) }
  })
  emit.asset(asset)
  // Each piece already carries half of the pause on either side, so the pieces play back as the one take.
  const durationMs = Math.max(1500, s.durationMs)
  // A new take starts untrimmed at the clip's start.
  const patch = { audioAssetId: asset.id, durationMs, voiceInMs: 0, voiceOutMs: null, voiceStartMs: 0 }
  patchClip(s.clip.id, patch)
  emit.clip({ clipId: s.clip.id, patch })
}

/** Voices the scenes that need it ("missing") or every scene ("all") as one continuous take. */
export function generateNarration(projectId: string, mode: 'missing' | 'all'): Job {
  const running = activeProjectJob(projectId, 'narration')
  if (running) return running
  const project = getProject(projectId)
  const targets = clipsOf(projectId).filter((c) => c.narration.trim() && (mode === 'all' || !c.audioAssetId))
  if (!targets.length) throw new Error('Tidak ada naskah narasi yang perlu disuarakan.')
  const job = insertJob({ projectId, kind: 'narration', provider: project.ttsProvider, payload: { mode, clipIds: targets.map((c) => c.id) } })
  emit.job(job)
  return runJob(job, 'tts', async (ctx) => {
    const p = getProject(projectId)
    const voice = p.ttsVoice || defaultVoiceFor(p.ttsProvider, p.language)
    if (p.ttsProvider === 'elevenlabs' && !voice) throw new Error('Pilih suara ElevenLabs dulu di langkah Ide cerita.')
    if (p.ttsProvider === 'local' && !voice) throw new Error('Pilih suara Voicebox dulu di langkah Ide cerita.')
    const clips = targets.map((c) => getClip(c.id)).filter((c) => c.narration.trim())
    const groups = parts(clips, p.ttsProvider)
    const tmp = join(dataDir(), 'tmp', `narration-${ctx.jobId}`)
    mkdirSync(tmp, { recursive: true })
    const takeId = randomUUID()
    try {
      let done = 0
      for (let g = 0; g < groups.length; g++) {
        const group = groups[g]
        ctx.progress(0.05 + 0.85 * (done / clips.length), groups.length > 1 ? `Membuat suara bagian ${g + 1} dari ${groups.length}` : 'Membuat suara narasi')
        const segments =
          p.ttsProvider === 'elevenlabs'
            ? await elevenTake(
                p,
                voice,
                group,
                { previous: groups[g - 1]?.map((c) => c.narration).join('\n\n'), next: groups[g + 1]?.map((c) => c.narration).join('\n\n') },
                tmp,
                ctx
              )
            : p.ttsProvider === 'edge'
              ? await edgeTake(voice, group, tmp, ctx)
              : p.ttsProvider === 'local'
                ? await localTake(p, voice, group, tmp, ctx)
                : await geminiTake(p, voice, group, tmp, ctx, () =>
                  ctx.progress(0.05 + 0.85 * ((done + group.length * 0.6) / clips.length), 'Menyinkronkan caption dengan Whisper')
                )
        ctx.progress(0.05 + 0.85 * ((done + group.length * 0.9) / clips.length), 'Memotong suara per adegan')
        for (const s of segments) store(p, s, voice, takeId, readFileSync(s.file))
        done += group.length
      }
      touchProject(projectId)
      return { message: `${clips.length} adegan disuarakan dalam satu rekaman` }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}

/**
 * Re-times caption words with the local Whisper model on each scene's audio: scenes whose timings are
 * estimates or came from an older Whisper method, or every Gemini-voiced scene with "all".
 */
export function syncCaptions(projectId: string, mode: 'stale' | 'all' = 'stale'): Job {
  const running = activeProjectJob(projectId, 'align')
  if (running) return running
  if (!whisperReady()) throw new Error('Model Whisper belum diunduh. Unduh dulu di Pengaturan, bagian Caption akurat.')
  const targets = clipsOf(projectId).filter((c) => {
    const a = getAsset(c.audioAssetId)
    return !!a && (mode === 'all' ? a.provider === 'gemini' : captionNeedsSync(a))
  })
  if (!targets.length) throw new Error('Semua caption sudah memakai waktu dari suara aslinya.')
  const job = insertJob({ projectId, kind: 'align', provider: 'whisper' })
  emit.job(job)
  return runJob(job, 'whisper', async (ctx) => {
    const project = getProject(projectId)
    const tmp = join(dataDir(), 'tmp', `align-${ctx.jobId}`)
    try {
      for (let i = 0; i < targets.length; i++) {
        ctx.progress(0.03 + 0.95 * (i / targets.length), `Menyinkronkan klip ${i + 1} dari ${targets.length}`)
        const asset = getAsset(getClip(targets[i].id).audioAssetId)
        if (!asset) continue
        // Caption text fixed by hand stays: those words are timed against the voice instead of the script's.
        const edited = asset.meta.editedWords && asset.meta.words?.length ? asset.meta.words.map((w) => w.text) : null
        const words = edited ?? spokenWords(asset.prompt ?? targets[i].narration)
        if (!words.length) continue
        const seconds = (asset.durationMs ?? targets[i].durationMs) / 1000
        const timed = await timeScript(assetAbsPath(projectId, asset.localPath), words, project.language, seconds, tmp, ctx.signal)
        updateAssetMeta(asset.id, { ...asset.meta, words: timed, estimatedTimings: false, timedBy: WHISPER_TIMING })
        emit.asset(getAsset(asset.id)!)
      }
      return { message: `${targets.length} klip disinkronkan` }
    } finally {
      rmSync(tmp, { recursive: true, force: true })
    }
  })
}
