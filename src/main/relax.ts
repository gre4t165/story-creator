import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, extname } from 'node:path'
import { BrowserWindow, dialog } from 'electron'
import type { Asset } from '@shared/types'
import { devPick } from './importer'
import { assetAbsPath } from './paths'
import { getProject, insertAsset } from './repo'
import { probeDurationMs } from './services/audio'
import * as eleven from './services/elevenlabs'

/**
 * Sounds for the ambience layers of a relax video that are not in the built-in library: a file of the user's own,
 * or one made by ElevenLabs from a description. Both become "ambience" assets of the project; adding one as a
 * layer is an editor change (undoable), like picking music.
 */

const AUDIO_TYPES = ['mp3', 'wav', 'm4a', 'ogg', 'flac', 'aac', 'opus']

/** A recording from disk, e.g. rain recorded at home or a sound bought from a library. */
export async function pickAmbience(projectId: string): Promise<Asset | null> {
  getProject(projectId)
  const win = BrowserWindow.getFocusedWindow()
  const paths =
    devPick() ??
    (await dialog.showOpenDialog(win!, {
      title: 'Pilih suara suasana',
      filters: [{ name: 'Audio', extensions: AUDIO_TYPES }],
      properties: ['openFile']
    })).filePaths
  const src = paths[0]
  if (!src) return null
  const rel = `ambience/${randomUUID()}${extname(src).toLowerCase()}`
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  copyFileSync(src, abs)
  const durationMs = await probeDurationMs(abs).catch(() => null)
  return insertAsset({ projectId, kind: 'ambience', provider: 'local', prompt: src.split(/[\\/]/).pop() ?? 'suasana', localPath: rel, durationMs })
}

/** A seamless loop made by ElevenLabs Sound Effects from a description, with the user's own key. */
export async function generateAmbience(projectId: string, description: string, seconds: number): Promise<Asset> {
  getProject(projectId)
  const text = description.trim()
  if (!text) throw new Error('Tulis dulu suara yang kamu mau, misalnya "hujan deras di atap seng pada malam hari".')
  if (text.length > 450) throw new Error('Deskripsi suaranya terlalu panjang. Cukup satu atau dua kalimat.')
  const audio = await eleven.soundEffect(text, seconds)
  const rel = `ambience/${randomUUID()}.mp3`
  const abs = assetAbsPath(projectId, rel)
  mkdirSync(dirname(abs), { recursive: true })
  writeFileSync(abs, audio)
  const durationMs = await probeDurationMs(abs).catch(() => null)
  return insertAsset({ projectId, kind: 'ambience', provider: 'elevenlabs', model: 'eleven_text_to_sound_v2', prompt: text, localPath: rel, durationMs })
}
