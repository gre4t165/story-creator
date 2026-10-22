import { execFile } from 'node:child_process'
import ffmpegStatic from 'ffmpeg-static'
import { binPath } from '../paths'

export function pcmToWav(pcm: Buffer, sampleRate = 24000, channels = 1, bits = 16): Buffer {
  const blockAlign = (channels * bits) / 8
  const byteRate = sampleRate * blockAlign
  const h = Buffer.alloc(44)
  h.write('RIFF', 0)
  h.writeUInt32LE(36 + pcm.length, 4)
  h.write('WAVE', 8)
  h.write('fmt ', 12)
  h.writeUInt32LE(16, 16)
  h.writeUInt16LE(1, 20)
  h.writeUInt16LE(channels, 22)
  h.writeUInt32LE(sampleRate, 24)
  h.writeUInt32LE(byteRate, 28)
  h.writeUInt16LE(blockAlign, 32)
  h.writeUInt16LE(bits, 34)
  h.write('data', 36)
  h.writeUInt32LE(pcm.length, 40)
  return Buffer.concat([h, pcm])
}

export function isWav(bytes: Buffer): boolean {
  return bytes.length > 12 && bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE'
}

interface MediaInfo {
  durationMs: number | null
  width: number | null
  height: number | null
}

/** Reads duration and frame size from `ffmpeg -i`, which prints stream info and exits without an output file. */
function probe(absPath: string): Promise<MediaInfo> {
  return new Promise((resolve) => {
    execFile(binPath(ffmpegStatic!), ['-hide_banner', '-i', absPath], { windowsHide: true }, (_err, _stdout, stderr) => {
      const text = String(stderr)
      const d = /Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/.exec(text)
      const size = /Stream #\d+:\d+.*?: Video:.*?,\s*(\d{2,5})x(\d{2,5})/.exec(text)
      resolve({
        durationMs: d ? Math.round((+d[1] * 3600 + +d[2] * 60 + +d[3]) * 1000) : null,
        width: size ? +size[1] : null,
        height: size ? +size[2] : null
      })
    })
  })
}

export async function probeDurationMs(absPath: string): Promise<number> {
  const info = await probe(absPath)
  if (info.durationMs == null) throw new Error('Durasi media tidak terbaca')
  return info.durationMs
}

export async function probeSize(absPath: string): Promise<{ width: number; height: number } | null> {
  const info = await probe(absPath)
  return info.width && info.height ? { width: info.width, height: info.height } : null
}
