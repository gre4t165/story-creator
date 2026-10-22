import { BrowserWindow } from 'electron'
import { EVENTS } from '@shared/api'
import type { Asset, CharacterPatchEvent, ClipPatchEvent, Job, WhisperStatus } from '@shared/types'

function send(channel: string, payload: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send(channel, payload)
  }
}

export const emit = {
  job: (job: Job): void => send(EVENTS.job, job),
  clip: (e: ClipPatchEvent): void => send(EVENTS.clip, e),
  character: (e: CharacterPatchEvent): void => send(EVENTS.character, e),
  asset: (asset: Asset): void => send(EVENTS.asset, asset),
  whisper: (status: WhisperStatus): void => send(EVENTS.whisper, status)
}
