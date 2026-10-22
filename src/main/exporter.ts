import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import ffmpegStatic from 'ffmpeg-static'
import {
  CAPTION_BOX_PAD,
  CAPTION_BOX_RADIUS,
  CAPTION_MAX_WIDTH,
  captionFontFile,
  captionScaleOf,
  layoutCaptionLines,
  roundedRectPath,
  POPPINS_CELL,
  displayWord,
  resolveCaption,
  timelineChunks,
  type CaptionChunk,
  type ResolvedCaption
} from '@shared/captions'
import { cameraPerspective, TRANSITIONS, transitionSecOf } from '@shared/motion'
import { clipCaptionWords, musicSpan, voiceSpan } from '@shared/timeline'
import { anchorOffset, contrastColor, overlayEnd, textEffects } from '@shared/overlays'
import { sfxPlay } from '@shared/sfx'
import type { Asset, Clip, ExportOptions, ImageOverlay, Job, ProjectBundle, TextOverlay } from '@shared/types'
import { emit } from './events'
import { runJob, type TaskCtx } from './jobs'
import { fontMeasure } from './fontMetrics'
import { assetAbsPath, binPath, dataDir, fontsDir, sfxDir } from './paths'
import { getBundle, insertJob, touchProject } from './repo'

function ffmpegPath(): string {
  if (!ffmpegStatic) throw new Error('FFmpeg tidak ditemukan di aplikasi')
  return binPath(ffmpegStatic)
}

function outputSize(aspect: '16:9' | '9:16', res: ExportOptions['resolution']): { w: number; h: number } {
  const long = res === 720 ? 1280 : res === 1080 ? 1920 : 3840
  const short = res
  return aspect === '16:9' ? { w: long, h: short } : { w: short, h: long }
}

/** Runs ffmpeg in `cwd`, reporting progress from its `time=` output against `totalSec`. */
function runFfmpeg(args: string[], cwd: string, signal: AbortSignal, totalSec?: number, onProgress?: (f: number) => void): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(ffmpegPath(), ['-hide_banner', '-y', ...args], { cwd, windowsHide: true })
    let tail = ''
    const onAbort = (): void => {
      p.kill('SIGKILL')
    }
    signal.addEventListener('abort', onAbort)
    p.stderr.on('data', (d: Buffer) => {
      const s = d.toString()
      tail = (tail + s).slice(-4000)
      if (totalSec && onProgress) {
        const m = /time=(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(s)
        if (m) onProgress(Math.min(1, (+m[1] * 3600 + +m[2] * 60 + +m[3]) / totalSec))
      }
    })
    p.on('error', reject)
    p.on('close', (code) => {
      signal.removeEventListener('abort', onAbort)
      if (signal.aborted) return reject(new Error('Dibatalkan'))
      if (code === 0) resolve()
      else reject(new Error(`FFmpeg gagal (kode ${code}): ${tail.split('\n').slice(-6).join(' ').trim()}`))
    })
  })
}

// ---------- captions ----------

const FONT_BY_WEIGHT: Record<number, { name: string; bold: number }> = {
  500: { name: 'Poppins Medium', bold: 0 },
  600: { name: 'Poppins SemiBold', bold: 0 },
  700: { name: 'Poppins', bold: -1 },
  800: { name: 'Poppins ExtraBold', bold: 0 }
}

/** #RRGGBB + opacity → ASS &HAABBGGRR */
function assColor(hex: string, opacity = 1): string {
  const h = hex.replace('#', '')
  const a = Math.round((1 - opacity) * 255)
    .toString(16)
    .padStart(2, '0')
  return `&H${a}${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}`.toUpperCase()
}

function assInlineColor(hex: string): string {
  const h = hex.replace('#', '')
  return `&H${h.slice(4, 6)}${h.slice(2, 4)}${h.slice(0, 2)}&`.toUpperCase()
}

function assTime(sec: number): string {
  const cs = Math.max(0, Math.round(sec * 100))
  const h = Math.floor(cs / 360000)
  const m = Math.floor((cs % 360000) / 6000)
  const s = Math.floor((cs % 6000) / 100)
  return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs % 100).padStart(2, '0')}`
}

function srtTime(sec: number): string {
  const ms = Math.max(0, Math.round(sec * 1000))
  const h = Math.floor(ms / 3600000)
  const m = Math.floor((ms % 3600000) / 60000)
  const s = Math.floor((ms % 60000) / 1000)
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')},${String(ms % 1000).padStart(3, '0')}`
}

const escapeAss = (t: string): string => t.replace(/\\/g, '\\\\').replace(/[{}]/g, '')

interface CaptionTrack {
  chunks: CaptionChunk[]
  style: ResolvedCaption
  pos: string
  sizeScale: number
}

/** Overlay text styles; each line then sets its own size, colors and position with override tags. */
const OVERLAY_STYLES = [
  'Style: OvPlain,Poppins,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H8F000000,-1,0,0,0,100,100,0,0,1,0,2,5,0,0,0,1',
  'Style: OvOutline,Poppins,48,&H00FFFFFF,&H00FFFFFF,&H00000000,&H00000000,-1,0,0,0,100,100,0,0,1,3,0,5,0,0,0,1',
  'Style: OvBox,Poppins,48,&H00FFFFFF,&H00FFFFFF,&HFF000000,&H26000000,-1,0,0,0,100,100,0,0,4,12,0,5,0,0,0,1'
]

/** One Dialogue line per text overlay, placed with \an (anchor) and \pos like the editor preview. */
function overlayEvents(texts: TextOverlay[], total: number, w: number, h: number): string[] {
  const out: string[] = []
  for (const o of texts) {
    const end = overlayEnd(o, total)
    if (end <= o.start || !o.text.trim()) continue
    const px = o.size * h
    const fs = Math.max(8, Math.round(px * POPPINS_CELL))
    const fx = textEffects(o.style, px)
    const style = o.style === 'box' ? 'OvBox' : o.style === 'outline' ? 'OvOutline' : 'OvPlain'
    const tags = [
      `\\an${o.anchor}`,
      `\\pos(${Math.round(o.x * w)},${Math.round(o.y * h)})`,
      '\\q2',
      `\\fs${fs}`,
      o.bold ? '\\fnPoppins\\b1' : '\\fnPoppins Medium\\b0',
      `\\c${assInlineColor(o.color)}`
    ]
    if (o.style === 'box') tags.push(`\\bord${fx.pad}`, `\\4c${assInlineColor(contrastColor(o.color))}`, '\\4a&H26&')
    if (o.style === 'outline') tags.push(`\\bord${fx.outline}`, `\\3c${assInlineColor(contrastColor(o.color))}`)
    if (o.style === 'plain') tags.push('\\bord0', `\\shad${fx.shadow}`)
    const text = escapeAss(o.text).replace(/\r?\n/g, '\\N')
    out.push(`Dialogue: 2,${assTime(o.start)},${assTime(end)},${style},,0,0,0,,{${tags.join('')}}${text}`)
  }
  return out
}

/** The subtitle file burned into the video: optional captions (box on layer 0, text on 1) and overlay text above them (layer 2). */
function buildAss(captions: CaptionTrack | null, texts: TextOverlay[], total: number, w: number, h: number): string {
  const lines = [
    '[Script Info]',
    'ScriptType: v4.00+',
    `PlayResX: ${w}`,
    `PlayResY: ${h}`,
    'WrapStyle: 0',
    'ScaledBorderAndShadow: yes',
    '',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    ...(captions ? captionStyleLines(captions, w, h) : []),
    ...OVERLAY_STYLES,
    '',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    ...(captions ? captionEvents(captions, w, h) : []),
    ...overlayEvents(texts, total, w, h)
  ]
  return lines.join('\n') + '\n'
}

/** Caption size in pixels (one em), the vertical margin and the box padding for a frame of height h. */
function captionMetrics({ style, sizeScale }: CaptionTrack, h: number): { px: number; marginV: number; pad: number } {
  const px = style.size * h * sizeScale
  return { px, marginV: Math.round(h * 0.07), pad: style.box ? px * CAPTION_BOX_PAD : 0 }
}

function captionStyleLines(track: CaptionTrack, w: number, h: number): string[] {
  const { style, pos } = track
  // Poppins comes in several weight files; the other caption fonts have a single one.
  const font = style.fontInfo.id === 'poppins' ? (FONT_BY_WEIGHT[style.weight] ?? FONT_BY_WEIGHT[700]) : { name: style.fontInfo.family, bold: 0 }
  const { px, marginV } = captionMetrics(track, h)
  const size = Math.round(px * style.fontInfo.cell)
  const boxed = !!style.box
  const align = pos === 'atas' ? 8 : pos === 'tengah' ? 5 : 2
  // A boxed caption is plain text over its own rounded box (CapBox); libass can only draw square boxes.
  const outline = boxed ? 0 : Math.max(1, Math.round(style.outline * h))
  const outlineColor = boxed ? '&HFF000000' : assColor(style.outlineColor)
  const side = Math.round((w * (1 - CAPTION_MAX_WIDTH)) / 2)
  const lines = [
    `Style: Cap,${font.name},${size},${assColor(style.color)},${assColor(style.color)},${outlineColor},&HFF000000,${font.bold},0,0,0,100,100,0,0,1,${outline},0,${align},${side},${side},${marginV},1`
  ]
  if (boxed) lines.push(`Style: CapBox,${font.name},${size},${assColor(style.box!, style.boxAlpha)},&H00FFFFFF,&HFF000000,&HFF000000,0,0,0,0,100,100,0,0,1,0,0,7,0,0,0,1`)
  return lines
}

function captionEvents(track: CaptionTrack, w: number, h: number): string[] {
  const { chunks, style, pos } = track
  const { px, marginV, pad } = captionMetrics(track, h)
  const measure = fontMeasure(join(fontsDir(), captionFontFile(style)))
  const lineH = px * style.fontInfo.cell
  const lines: string[] = []
  const base = assInlineColor(style.color)
  const hl = assInlineColor(style.highlight)
  const highlight = style.highlight.toLowerCase() !== style.color.toLowerCase()
  chunks.forEach((c, i) => {
    const next = chunks[i + 1]
    const holdUntil = next ? Math.min(next.start, c.end + 0.6) : c.end + 0.6
    const shown = c.words.map((x) => displayWord(x.text, style))
    // The same line breaks as the preview, written out so libass does not wrap on its own.
    const layout = layoutCaptionLines(shown, (t) => measure(t) * px, w * CAPTION_MAX_WIDTH)
    const breaks = new Set<number>()
    let count = 0
    for (const l of layout.slice(0, -1)) breaks.add((count += l.length))
    const words = shown.map((t) => escapeAss(t))
    const textOf = (color: (k: number) => string): string =>
      words.map((_, k) => `${k === 0 ? '' : breaks.has(k) ? '\\N' : ' '}${color(k)}`).join('')

    if (style.box) {
      const textW = Math.max(...layout.map((l) => measure(l.join(' ')) * px))
      const textH = layout.length * lineH
      const top = pos === 'atas' ? marginV : pos === 'tengah' ? (h - textH) / 2 : h - marginV - textH
      const path = roundedRectPath(w / 2 - textW / 2 - pad, top - pad, w / 2 + textW / 2 + pad, top + textH + pad, px * CAPTION_BOX_RADIUS)
      lines.push(`Dialogue: 0,${assTime(c.start)},${assTime(holdUntil)},CapBox,,0,0,0,,{\\an7\\pos(0,0)\\p1}${path}`)
    }
    if (!highlight) {
      lines.push(`Dialogue: 1,${assTime(c.start)},${assTime(holdUntil)},Cap,,0,0,0,,${textOf((k) => words[k])}`)
      return
    }
    c.words.forEach((wd, j) => {
      const start = j === 0 ? c.start : wd.start
      const end = j + 1 < c.words.length ? c.words[j + 1].start : holdUntil
      if (end <= start) return
      lines.push(`Dialogue: 1,${assTime(start)},${assTime(end)},Cap,,0,0,0,,${textOf((k) => (k === j ? `{\\c${hl}}${words[k]}{\\c${base}}` : words[k]))}`)
    })
  })
  return lines
}

function buildSrt(chunks: CaptionChunk[]): string {
  return (
    chunks
      .map((c, i) => {
        const next = chunks[i + 1]
        const end = next ? Math.min(next.start, c.end + 0.6) : c.end + 0.6
        return `${i + 1}\n${srtTime(c.start)} --> ${srtTime(end)}\n${c.words.map((w) => w.text).join(' ')}\n`
      })
      .join('\n') + '\n'
  )
}

// ---------- timeline ----------

interface Segment {
  clip: Clip
  start: number
  own: number
  overlap: number
  /** Extra frames rendered past the transition, so xfade never runs out of the first clip. */
  pad: number
  transition: string
}

/**
 * Places clips on whole frames. xfade stops the whole video when the first clip ends before the transition
 * offset, which happens with a one-frame cut whose offset falls between two frames. Frame-aligned starts
 * plus two spare frames per segment keep every transition inside the footage.
 */
function planSegments(clips: Clip[], fps: number): Segment[] {
  let t = 0
  const frames = clips.map((clip) => {
    const startF = Math.round(t * fps)
    t += clip.durationMs / 1000
    return { startF, endF: Math.max(startF + 1, Math.round(t * fps)) }
  })
  return clips.map((clip, i) => {
    const { startF, endF } = frames[i]
    const last = i === clips.length - 1
    const tr = TRANSITIONS.find((x) => x.id === clip.transition)
    let overlapF = 0
    if (!last) {
      // The clip's own transition length, never longer than either clip it joins.
      const room = Math.max(1, Math.min(endF - startF, frames[i + 1].endF - frames[i + 1].startF) - 1)
      overlapF = tr?.ffmpeg ? Math.min(room, Math.max(1, Math.round(transitionSecOf(clip) * fps))) : 1
    }
    return {
      clip,
      start: startF / fps,
      own: (endF - startF) / fps,
      overlap: overlapF / fps,
      pad: last ? 0 : 2 / fps,
      transition: tr?.ffmpeg ?? 'fade'
    }
  })
}

/**
 * The size a camera move is rendered at before the final scale: the source's own detail, cropped to the frame,
 * so the move resamples real pixels once. Never below the output size, and at most twice it.
 */
function workSize(srcW: number | null | undefined, srcH: number | null | undefined, size: { w: number; h: number }): { w: number; h: number } {
  if (!srcW || !srcH) return size
  const aspect = size.w / size.h
  const cropW = srcW / srcH > aspect ? srcH * aspect : srcW
  const f = Math.min(2, Math.max(1, cropW / size.w))
  return { w: Math.round((size.w * f) / 2) * 2, h: Math.round((size.h * f) / 2) * 2 }
}

/** Scale and crop to the work size, the camera move, then down to the output size. */
function cameraChain(cam: string | null, work: { w: number; h: number }, size: { w: number; h: number }, between: string[] = []): string {
  return [
    `scale=${work.w}:${work.h}:force_original_aspect_ratio=increase:flags=lanczos`,
    `crop=${work.w}:${work.h}`,
    'setsar=1',
    ...between,
    ...(cam ? [cam] : []),
    ...(work.w !== size.w || work.h !== size.h ? [`scale=${size.w}:${size.h}:flags=lanczos`, 'setsar=1'] : []),
    'format=yuv420p'
  ].join(',')
}

/** An audio length to assume when an older asset never recorded its duration. */
const UNKNOWN_AUDIO_MS = 10 * 60 * 1000

function assetOf(bundle: ProjectBundle, id: string | null): Asset | undefined {
  return id ? bundle.assets.find((a) => a.id === id) : undefined
}

async function renderSegment(
  bundle: ProjectBundle,
  seg: Segment,
  index: number,
  opts: ExportOptions,
  size: { w: number; h: number },
  tmp: string,
  signal: AbortSignal
): Promise<string> {
  const { clip } = seg
  const out = `seg_${String(index).padStart(3, '0')}.mp4`
  const len = seg.own + seg.overlap + seg.pad
  const frames = Math.max(1, Math.round(len * opts.fps))
  const video = clip.motionType === 'video' ? assetOf(bundle, clip.videoAssetId) : undefined
  const enc = ['-an', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', String(opts.fps)]
  if (video) {
    const cam = cameraPerspective(clip.videoCamera, clip.videoStrength, Math.max(2, Math.round(seg.own * opts.fps)), opts.fps)
    const work = cam ? workSize(video.width, video.height, size) : size
    const vf = cameraChain(cam, work, size, [`fps=${opts.fps}`, `tpad=stop_mode=clone:stop_duration=${len.toFixed(3)}`])
    // A video trimmed on the timeline starts that far into its file.
    const from = clip.mediaInMs > 0 ? ['-ss', (clip.mediaInMs / 1000).toFixed(3)] : []
    await runFfmpeg([...from, '-i', assetAbsPath(bundle.project.id, video.localPath), '-vf', vf, '-t', len.toFixed(3), ...enc, out], tmp, signal)
    return out
  }
  const image = assetOf(bundle, clip.imageAssetId)
  if (!image) throw new Error(`Klip ${String(index + 1).padStart(2, '0')} (“${clip.title}”) belum punya gambar.`)
  const ownFrames = Math.max(2, Math.round(seg.own * opts.fps))
  const cam = cameraPerspective(clip.cameraPreset, clip.motionStrength, ownFrames, opts.fps)
  const vf = cameraChain(cam, cam ? workSize(image.width, image.height, size) : size, size)
  await runFfmpeg(
    [
      '-loop',
      '1',
      '-framerate',
      String(opts.fps),
      '-t',
      len.toFixed(3),
      '-i',
      assetAbsPath(bundle.project.id, image.localPath),
      '-vf',
      vf,
      '-frames:v',
      String(frames),
      ...enc,
      out
    ],
    tmp,
    signal
  )
  return out
}

async function renderProject(ctx: TaskCtx, projectId: string, opts: ExportOptions): Promise<string> {
  const bundle = getBundle(projectId)
  if (!bundle.clips.length) throw new Error('Proyek belum punya klip')
  const size = outputSize(bundle.project.aspectRatio, opts.resolution)
  const tmp = join(dataDir(), 'tmp', `export-${ctx.jobId}`)
  mkdirSync(tmp, { recursive: true })
  try {
    const segs = planSegments(bundle.clips, opts.fps)
    const total = segs.reduce((n, s) => n + s.own, 0)

    // 1. one silent video segment per clip, two at a time
    const files: string[] = new Array(segs.length)
    let done = 0
    let next = 0
    const worker = async (): Promise<void> => {
      while (next < segs.length) {
        const i = next++
        files[i] = await renderSegment(bundle, segs[i], i, opts, size, tmp, ctx.signal)
        done++
        ctx.progress(0.03 + 0.6 * (done / segs.length), `Merender klip ${done} dari ${segs.length}`)
      }
    }
    await Promise.all([worker(), worker()])

    // 2. captions
    const style = resolveCaption(bundle.project.editor)
    // Captions follow each clip's voice as trimmed and placed on the timeline.
    const chunks = timelineChunks(
      segs.map((s) => {
        const audio = assetOf(bundle, s.clip.audioAssetId)
        if (!audio) return { start: s.start, words: [] }
        const shown = clipCaptionWords(s.clip, audio.meta.words ?? [], audio.durationMs ?? UNKNOWN_AUDIO_MS)
        return { start: s.start, words: shown.words, key: audio.id, offset: shown.offset }
      })
    )
    const burn = opts.burnCaptions && !!style && chunks.length > 0
    // Overlays are part of the picture, so they are drawn even when captions are left out.
    const overlays = bundle.project.editor.overlays ?? []
    const texts = overlays.filter((o): o is TextOverlay => o.kind === 'text' && !!o.text.trim() && o.start < total)
    const images = overlays
      .filter((o): o is ImageOverlay => o.kind === 'image' && o.start < total)
      .map((o) => ({ o, asset: assetOf(bundle, o.assetId) }))
      .filter((x): x is { o: ImageOverlay; asset: Asset } => !!x.asset && existsSync(assetAbsPath(projectId, x.asset.localPath)))
    const useAss = burn || texts.length > 0
    if (useAss) {
      const captions = burn
        ? {
            chunks,
            style: style!,
            pos: bundle.project.editor.captionPosition,
            sizeScale: captionScaleOf(bundle.project.editor)
          }
        : null
      writeFileSync(join(tmp, 'captions.ass'), buildAss(captions, texts, total, size.w, size.h), 'utf8')
      mkdirSync(join(tmp, 'fonts'), { recursive: true })
      for (const f of readdirSync(fontsDir()).filter((x) => x.endsWith('.ttf'))) copyFileSync(join(fontsDir(), f), join(tmp, 'fonts', f))
    }

    // 3. one ffmpeg pass: transitions + captions + audio mix
    const args: string[] = []
    files.forEach((f) => args.push('-i', f))
    const graph: string[] = []
    let v = '[0:v]'
    segs.slice(0, -1).forEach((s, i) => {
      const label = `[x${i}]`
      graph.push(`${v}[${i + 1}:v]xfade=transition=${s.transition}:duration=${s.overlap.toFixed(6)}:offset=${segs[i + 1].start.toFixed(6)}${label}`)
      v = label
    })
    // Logos and watermarks sit on the picture, under captions and overlay text.
    images.forEach(({ o, asset }, k) => {
      args.push('-i', assetAbsPath(projectId, asset.localPath))
      const iw = Math.max(2, Math.round((o.width * size.w) / 2) * 2)
      const ih = Math.max(2, Math.round((iw * (asset.height || iw)) / (asset.width || iw) / 2) * 2)
      const { ax, ay } = anchorOffset(o.anchor)
      const x = Math.round(o.x * size.w - ax * iw)
      const y = Math.round(o.y * size.h - ay * ih)
      const end = overlayEnd(o, total)
      graph.push(`[${files.length + k}:v]format=rgba,scale=${iw}:${ih},colorchannelmixer=aa=${o.opacity.toFixed(2)}[ov${k}]`)
      graph.push(`${v}[ov${k}]overlay=x=${x}:y=${y}:enable='between(t,${o.start.toFixed(3)},${end.toFixed(3)})'[vo${k}]`)
      v = `[vo${k}]`
    })
    graph.push(`${v}${useAss ? 'ass=captions.ass:fontsdir=fonts,' : ''}format=yuv420p[vout]`)

    let inputIndex = files.length + images.length
    const voices: string[] = []
    segs.forEach((s, i) => {
      const audio = assetOf(bundle, s.clip.audioAssetId)
      if (!audio) return
      // The voice as trimmed on the timeline, placed in its clip, and cut (with a short fade) at the clip's end.
      const span = voiceSpan(s.clip, audio.durationMs ?? UNKNOWN_AUDIO_MS)
      if (span.playMs <= 0) return
      args.push('-i', assetAbsPath(projectId, audio.localPath))
      const ms = Math.round(s.start * 1000 + span.startMs)
      const cut = span.playMs < span.lengthMs ? `,afade=t=out:st=${Math.max(0, span.playMs / 1000 - 0.06).toFixed(3)}:d=0.06` : ''
      // Narration volume: for all clips plus this clip's own adjustment.
      const db = (bundle.project.editor.voiceVolumeDb ?? 0) + (s.clip.voiceGainDb ?? 0)
      const gain = Math.abs(db) > 0.01 ? `volume=${db.toFixed(2)}dB,` : ''
      graph.push(
        `[${inputIndex}:a]atrim=start=${(span.inMs / 1000).toFixed(3)}:end=${((span.inMs + span.playMs) / 1000).toFixed(3)},asetpts=PTS-STARTPTS${cut},aresample=48000,aformat=channel_layouts=stereo,${gain}adelay=${ms}|${ms}[a${i}]`
      )
      voices.push(`[a${i}]`)
      inputIndex++
    })
    // Sound effects from the library: looping ones repeat to fill their length, ambiences fade in and out.
    const sfxLabels: string[] = []
    const sfxDb = bundle.project.editor.sfxVolumeDb ?? 0
    for (const item of bundle.project.editor.sfx ?? []) {
      const file = join(sfxDir(), item.file)
      if (!existsSync(file) || item.start >= total) continue
      const play = sfxPlay(item, total)
      if (play.loop) args.push('-stream_loop', '-1')
      args.push('-i', file)
      const ms = Math.round(play.startSec * 1000)
      const fades = play.fadeSec
        ? `,afade=t=in:d=${play.fadeSec.toFixed(3)},afade=t=out:st=${(play.playSec - play.fadeSec).toFixed(3)}:d=${play.fadeSec.toFixed(3)}`
        : ''
      const label = `[s${sfxLabels.length}]`
      graph.push(
        `[${inputIndex}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=0:${play.playSec.toFixed(3)},asetpts=PTS-STARTPTS,volume=${(item.volumeDb + sfxDb).toFixed(2)}dB${fades},adelay=${ms}|${ms}${label}`
      )
      sfxLabels.push(label)
      inputIndex++
    }

    const music = assetOf(bundle, bundle.project.editor.musicAssetId)
    let aout: string | null = null
    if (voices.length) {
      graph.push(`${voices.join('')}amix=inputs=${voices.length}:normalize=0:dropout_transition=0[voice]`)
      aout = '[voice]'
    }
    if (music) {
      // The music's stretch of the timeline: it starts `inSec` into the song, loops if needed and fades out.
      const span = musicSpan(bundle.project.editor, total)
      const len = span.endSec - span.startSec
      const delay = Math.round(span.startSec * 1000)
      args.push('-stream_loop', '-1', '-i', assetAbsPath(projectId, music.localPath))
      graph.push(
        `[${inputIndex}:a]aresample=48000,aformat=channel_layouts=stereo,atrim=start=${span.inSec.toFixed(3)},asetpts=PTS-STARTPTS,atrim=0:${len.toFixed(3)},volume=${bundle.project.editor.musicVolumeDb}dB,afade=t=out:st=${Math.max(0, len - 2).toFixed(3)}:d=${Math.min(2, len).toFixed(3)}${delay ? `,adelay=${delay}|${delay}` : ''}[mus]`
      )
      inputIndex++
      if (aout) {
        if (opts.duckMusic) {
          graph.push('[voice]asplit=2[v1][v2]')
          graph.push('[mus][v2]sidechaincompress=threshold=0.02:ratio=8:attack=20:release=500[duck]')
          graph.push('[v1][duck]amix=inputs=2:normalize=0:dropout_transition=0[mix]')
        } else {
          graph.push('[voice][mus]amix=inputs=2:normalize=0:dropout_transition=0[mix]')
        }
        aout = '[mix]'
      } else aout = '[mus]'
    }
    if (sfxLabels.length) {
      // Effects join after the music ducking, so narration never pushes them down.
      graph.push(`${sfxLabels.join('')}amix=inputs=${sfxLabels.length}:normalize=0:dropout_transition=0[sfx]`)
      if (aout) {
        graph.push(`${aout}[sfx]amix=inputs=2:normalize=0:dropout_transition=0[withsfx]`)
        aout = '[withsfx]'
      } else aout = '[sfx]'
    }
    if (aout) {
      // loudnorm works at 192 kHz internally, so resample back to 48 kHz afterwards.
      graph.push(`${aout}${opts.normalizeAudio ? 'loudnorm=I=-14:LRA=11:TP=-1.5,' : ''}aresample=48000,apad,atrim=0:${total.toFixed(3)}[aout]`)
    } else {
      graph.push(`anullsrc=r=48000:cl=stereo,atrim=0:${total.toFixed(3)}[aout]`)
    }
    writeFileSync(join(tmp, 'graph.txt'), graph.join(';\n'), 'utf8')

    const folder = opts.folder
    mkdirSync(folder, { recursive: true })
    const base = (opts.fileName.trim() || 'video').replace(/[<>:"/\\|?*]+/g, '-').replace(/\.mp4$/i, '')
    let outPath = join(folder, `${base}.mp4`)
    for (let n = 2; existsSync(outPath); n++) outPath = join(folder, `${base}-${n}.mp4`)

    ctx.progress(0.64, 'Menggabungkan klip, suara, dan caption')
    await runFfmpeg(
      [
        ...args,
        '-filter_complex_script',
        'graph.txt',
        '-map',
        '[vout]',
        '-map',
        '[aout]',
        '-c:v',
        'libx264',
        '-preset',
        'medium',
        '-crf',
        opts.resolution === 2160 ? '20' : '19',
        '-r',
        String(opts.fps),
        '-c:a',
        'aac',
        '-b:a',
        '192k',
        '-ar',
        '48000',
        '-movflags',
        '+faststart',
        '-t',
        total.toFixed(3),
        outPath
      ],
      tmp,
      ctx.signal,
      total,
      (f) => ctx.progress(0.64 + 0.34 * f, 'Menggabungkan klip, suara, dan caption')
    )
    if (opts.writeSrt && chunks.length) writeFileSync(outPath.replace(/\.mp4$/i, '.srt'), buildSrt(chunks), 'utf8')
    return outPath
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function startExport(projectId: string, opts: ExportOptions): Job {
  const job = insertJob({ projectId, kind: 'export', provider: 'ffmpeg', payload: { ...opts } })
  emit.job(job)
  return runJob(job, 'export', async (ctx) => {
    const out = await renderProject(ctx, projectId, opts)
    touchProject(projectId, { status: 'exported' })
    return { message: out }
  })
}
