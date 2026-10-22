import { app } from 'electron'
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'

export function dataDir(): string {
  return app.getPath('userData')
}

export function dbPath(): string {
  return join(dataDir(), 'studio.db')
}

export function projectsRoot(): string {
  const dir = join(dataDir(), 'projects')
  mkdirSync(dir, { recursive: true })
  return dir
}

export function projectDir(projectId: string): string {
  const dir = join(projectsRoot(), projectId)
  mkdirSync(dir, { recursive: true })
  return dir
}

/** Absolute path of an asset stored relative to its project folder. */
export function assetAbsPath(projectId: string, localPath: string): string {
  return join(projectsRoot(), projectId, localPath)
}

/** The built-in CC0 sound effect library. */
export function sfxDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'sfx') : join(app.getAppPath(), 'resources', 'sfx')
}

export function fontsDir(): string {
  return app.isPackaged ? join(process.resourcesPath, 'fonts') : join(app.getAppPath(), 'resources', 'fonts')
}

/** URL the renderer uses for a stored asset (served by the studio:// protocol). */
export function assetUrl(projectId: string, localPath: string): string {
  const rel = `${projectId}/${localPath}`.split(/[\\/]/).map(encodeURIComponent).join('/')
  return `studio://asset/${rel}`
}

/** ffmpeg-static / ffprobe-static paths, fixed up for the unpacked asar folder in the installed app. */
export function binPath(p: string): string {
  return p.replace('app.asar', 'app.asar.unpacked')
}
