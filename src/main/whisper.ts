import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync } from 'node:fs'
import { cpus } from 'node:os'
import { join } from 'node:path'
import { once } from 'node:events'
import { app, shell } from 'electron'
import ffmpegStatic from 'ffmpeg-static'
import type { WhisperStatus } from '@shared/types'
import { alignWords, splitHeard, type Heard } from './align'
import { emit } from './events'
import { binPath, dataDir } from './paths'

/**
 * Local speech recognition with whisper.cpp (bundled `whisper-cli`) and the multilingual Whisper Small
 * model, downloaded once into the app's data folder. Used to time caption words against the real voice.
 */

const MODEL = {
  file: 'ggml-small.bin',
  url: 'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-small.bin',
  bytes: 487_601_967,
  sha256: '1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b'
}

export function modelDir(): string {
  const dir = join(dataDir(), 'models', 'whisper')
  mkdirSync(dir, { recursive: true })
  return dir
}

const modelPath = (): string => join(modelDir(), MODEL.file)

function cliPath(): string {
  return app.isPackaged ? join(process.resourcesPath, 'whisper', 'whisper-cli.exe') : join(app.getAppPath(), 'resources', 'whisper', 'whisper-cli.exe')
}

let download: { ctrl: AbortController; received: number; phase: 'downloading' | 'verifying' } | null = null
let lastError: string | null = null

export function whisperStatus(): WhisperStatus {
  if (download) return { state: download.phase, received: download.received, total: MODEL.bytes, error: null }
  const ready = existsSync(modelPath()) && statSync(modelPath()).size === MODEL.bytes
  const part = `${modelPath()}.part`
  return {
    state: ready ? 'ready' : 'missing',
    received: ready ? MODEL.bytes : existsSync(part) ? statSync(part).size : 0,
    total: MODEL.bytes,
    error: ready ? null : lastError
  }
}

export const whisperReady = (): boolean => whisperStatus().state === 'ready' && existsSync(cliPath())

function sha256(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file)
      .on('data', (c) => h.update(c))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject)
  })
}

/** Downloads the model, resuming a partial file, and checks it against the published SHA-256. */
export async function downloadModel(): Promise<void> {
  if (download || whisperReady()) return
  const part = `${modelPath()}.part`
  const ctrl = new AbortController()
  download = { ctrl, received: existsSync(part) ? statSync(part).size : 0, phase: 'downloading' }
  lastError = null
  let lastEmit = 0
  const report = (force = false): void => {
    if (force || Date.now() - lastEmit > 250) {
      lastEmit = Date.now()
      emit.whisper(whisperStatus())
    }
  }
  report(true)
  try {
    if (download.received < MODEL.bytes) {
      const have = download.received
      // Development builds can fetch from a local copy (STUDIO_WHISPER_URL) to test resuming.
      const url = (!app.isPackaged && process.env.STUDIO_WHISPER_URL) || MODEL.url
      const res = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: ctrl.signal })
      if (!res.ok || !res.body) throw new Error(`Unduhan gagal (HTTP ${res.status})`)
      const resumed = res.status === 206
      if (!resumed) download.received = 0
      const out = createWriteStream(part, { flags: resumed ? 'a' : 'w' })
      try {
        for await (const chunk of res.body as unknown as AsyncIterable<Uint8Array>) {
          if (!out.write(chunk)) await once(out, 'drain')
          download.received += chunk.length
          report()
        }
      } finally {
        out.end()
        await once(out, 'close')
      }
    }
    download.phase = 'verifying'
    report(true)
    if ((await sha256(part)) !== MODEL.sha256) {
      rmSync(part, { force: true })
      throw new Error('File model rusak atau tidak lengkap. Coba unduh lagi.')
    }
    renameSync(part, modelPath())
  } catch (e) {
    lastError = ctrl.signal.aborted ? null : ((e as Error).message ?? String(e))
    if (!ctrl.signal.aborted) throw e
  } finally {
    download = null
    emit.whisper(whisperStatus())
  }
}

export function cancelDownload(): void {
  download?.ctrl.abort()
}

export function removeModel(): void {
  cancelDownload()
  rmSync(modelPath(), { force: true })
  rmSync(`${modelPath()}.part`, { force: true })
  lastError = null
  emit.whisper(whisperStatus())
}

export function openModelFolder(): void {
  void shell.openPath(modelDir())
}

/** Whisper's language codes differ from ours only for Javanese. */
const whisperLanguage = (code: string): string => (code === 'jv' ? 'jw' : code)

function run(file: string, args: string[], signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = execFile(file, args, { windowsHide: true, maxBuffer: 64 * 1024 * 1024 }, (err, _out, stderr) => {
      if (signal?.aborted) return reject(new Error('Dibatalkan'))
      if (err) return reject(new Error(`Whisper gagal: ${String(stderr).trim().split('\n').slice(-3).join(' ')}`))
      resolve()
    })
    signal?.addEventListener('abort', () => p.kill('SIGKILL'), { once: true })
  })
}

type Token = { text: string; t_dtw?: number }
type JsonSegment = { text: string; offsets: { from: number; to: number }; tokens?: Token[] }

/**
 * Word-level recognition of an audio file (any format FFmpeg reads). Times are in seconds.
 * Word starts come from DTW token alignment, which follows the voice far closer than whisper's own
 * segment times. No prompt is given: a prompt that repeats the script can make Whisper loop on a
 * phrase ("tidak tidak tidak ..."), and the captions take their spelling from the script anyway.
 */
export async function recognize(audio: string, language: string, tmp: string, signal?: AbortSignal): Promise<Heard[]> {
  if (!whisperReady()) throw new Error('Model Whisper belum diunduh. Unduh dulu di Pengaturan.')
  mkdirSync(tmp, { recursive: true })
  const wav = join(tmp, `whisper-${Date.now()}-${Math.random().toString(36).slice(2)}.wav`)
  await run(binPath(ffmpegStatic!), ['-hide_banner', '-y', '-i', audio, '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', wav], signal)
  const outBase = wav.replace(/\.wav$/, '')
  const threads = String(Math.max(2, Math.min(8, Math.floor(cpus().length / 2))))
  // One word per segment (-ml 1 -sow), full JSON with DTW token times (DTW needs flash attention off).
  await run(
    cliPath(),
    ['-m', modelPath(), '-f', wav, '-l', whisperLanguage(language), '-ml', '1', '-sow', '-ojf', '-of', outBase, '-np', '-t', threads, '-nfa', '-dtw', 'small'],
    signal
  )
  const json = JSON.parse(readFileSync(`${outBase}.json`, 'utf8')) as { transcription?: JsonSegment[] }
  rmSync(wav, { force: true })
  rmSync(`${outBase}.json`, { force: true })
  const words = (json.transcription ?? []).map((s) => {
    const dtw = (s.tokens ?? []).filter((t) => !t.text.startsWith('[_') && (t.t_dtw ?? -1) >= 0)
    const start = dtw.length ? dtw[0].t_dtw! / 100 : s.offsets.from / 1000
    return { text: s.text, start, end: Math.max(start, s.offsets.to / 1000) }
  })
  // Starts only move forward, and a word lasts until the next one starts at the latest.
  words.forEach((w, i) => {
    if (i > 0 && w.start < words[i - 1].start) w.start = words[i - 1].start
    w.end = Math.max(w.end, w.start)
  })
  words.forEach((w, i) => {
    const next = words[i + 1]
    if (next && next.start > w.start) w.end = Math.min(w.end, next.start)
  })
  return splitHeard(words)
}

/** Times for the script's words in an audio file: recognition, then alignment to the known text. */
export async function timeScript(audio: string, words: string[], language: string, durationSec: number, tmp: string, signal?: AbortSignal) {
  const heard = await recognize(audio, language, tmp, signal)
  return alignWords(words, heard, durationSec)
}
