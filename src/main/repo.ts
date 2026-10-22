import { randomUUID } from 'node:crypto'
import { cpSync, existsSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import type {
  Asset,
  AssetKind,
  AssetMeta,
  Character,
  Clip,
  EditorSettings,
  Job,
  JobKind,
  JobStatus,
  NewProjectInput,
  Project,
  ProjectBundle,
  ProjectSnapshot,
  ProjectSummary
} from '@shared/types'
import { defaultVoiceFor } from '@shared/models'
import { visualSourceOf } from '@shared/script'
import { getDb } from './db'
import { assetUrl, projectDir, projectsRoot } from './paths'
import { getSettings } from './settings'

export const DEFAULT_EDITOR: EditorSettings = {
  captionStyle: 'karaoke',
  captionPosition: 'bawah',
  captionSize: 'sedang',
  musicAssetId: null,
  musicVolumeDb: -18,
  duckMusic: true,
  overlays: []
}

type Row = Record<string, any>

const toProject = (r: Row): Project => ({
  id: r.id,
  title: r.title,
  synopsis: r.synopsis,
  durationSec: r.duration_sec,
  language: r.language,
  aspectRatio: r.aspect_ratio,
  styleId: r.style_id,
  ttsProvider: r.tts_provider,
  ttsVoice: r.tts_voice,
  imageModel: r.image_model,
  videoModel: r.video_model,
  videoResolution: r.video_resolution ?? null,
  status: r.status,
  step: r.step,
  coverAssetId: r.cover_asset_id,
  editor: { ...DEFAULT_EDITOR, ...JSON.parse(r.editor_json || '{}') },
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

const toCharacter = (r: Row): Character => ({
  id: r.id,
  projectId: r.project_id,
  name: r.name,
  description: r.description,
  sheetAssetId: r.sheet_asset_id,
  sort: r.sort
})

const toClip = (r: Row): Clip => ({
  id: r.id,
  projectId: r.project_id,
  sort: r.sort,
  title: r.title,
  story: r.story ?? '',
  visualPrompt: r.visual_prompt,
  visualSource: r.visual_source ?? null,
  narration: r.narration,
  durationMs: r.duration_ms,
  characterIds: JSON.parse(r.character_ids || '[]'),
  motionType: r.motion_type,
  cameraPreset: r.camera_preset,
  motionStrength: r.motion_strength,
  videoPrompt: r.video_prompt,
  transition: r.transition,
  videoCamera: r.video_camera ?? 'static',
  videoStrength: r.video_strength ?? 'halus',
  transitionMs: r.transition_ms ?? null,
  voiceGainDb: r.voice_gain_db ?? 0,
  mediaInMs: r.media_in_ms ?? 0,
  voiceInMs: r.voice_in_ms ?? 0,
  voiceOutMs: r.voice_out_ms ?? null,
  voiceStartMs: r.voice_start_ms ?? 0,
  imageAssetId: r.image_asset_id,
  videoAssetId: r.video_asset_id,
  audioAssetId: r.audio_asset_id
})

export const toAsset = (r: Row): Asset => ({
  id: r.id,
  projectId: r.project_id,
  clipId: r.clip_id,
  characterId: r.character_id,
  kind: r.kind,
  provider: r.provider,
  model: r.model,
  prompt: r.prompt,
  remoteId: r.remote_id,
  remoteUrl: r.remote_url,
  localPath: r.local_path,
  url: assetUrl(r.project_id, r.local_path),
  durationMs: r.duration_ms,
  width: r.width,
  height: r.height,
  meta: JSON.parse(r.meta_json || '{}'),
  createdAt: r.created_at
})

export const toJob = (r: Row): Job => ({
  id: r.id,
  projectId: r.project_id,
  clipId: r.clip_id,
  characterId: r.character_id,
  kind: r.kind,
  provider: r.provider,
  status: r.status,
  progress: r.progress,
  message: r.message,
  error: r.error,
  resultAssetId: r.result_asset_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at
})

// ---------- projects ----------

export function listProjects(): ProjectSummary[] {
  const rows = getDb()
    .prepare(
      `SELECT p.*,
        (SELECT COUNT(*) FROM clips c WHERE c.project_id = p.id) AS clip_count,
        (SELECT COALESCE(SUM(duration_ms), 0) FROM clips c WHERE c.project_id = p.id) AS total_ms,
        (SELECT a.local_path FROM assets a WHERE a.id = p.cover_asset_id) AS cover_path
       FROM projects p ORDER BY p.updated_at DESC`
    )
    .all() as Row[]
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    styleId: r.style_id,
    status: r.status,
    step: r.step,
    clipCount: r.clip_count,
    totalMs: r.total_ms,
    coverUrl: r.cover_path ? assetUrl(r.id, r.cover_path) : null,
    updatedAt: r.updated_at
  }))
}

export function createProject(input: NewProjectInput): Project {
  const s = getSettings()
  const now = Date.now()
  const id = randomUUID()
  const tts = input.ttsProvider ?? s.defaultTtsProvider
  const language = input.language ?? s.defaultLanguage
  getDb()
    .prepare(
      `INSERT INTO projects (id, title, synopsis, duration_sec, language, aspect_ratio, style_id, tts_provider, tts_voice,
        image_model, video_model, status, step, editor_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?)`
    )
    .run(
      id,
      'Proyek tanpa judul',
      input.synopsis ?? '',
      input.durationSec ?? 60,
      language,
      input.aspectRatio ?? '16:9',
      input.styleId ?? 'stickman',
      tts,
      defaultVoiceFor(tts, language),
      s.imageModel,
      s.videoModel,
      JSON.stringify(DEFAULT_EDITOR),
      now,
      now
    )
  projectDir(id)
  return getProject(id)
}

export function getProject(id: string): Project {
  const r = getDb().prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row | undefined
  if (!r) throw new Error('Proyek tidak ditemukan')
  return toProject(r)
}

export function getBundle(id: string): ProjectBundle {
  const db = getDb()
  return {
    project: getProject(id),
    characters: (db.prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY sort').all(id) as Row[]).map(toCharacter),
    clips: (db.prepare('SELECT * FROM clips WHERE project_id = ? ORDER BY sort').all(id) as Row[]).map(toClip),
    assets: (db.prepare('SELECT * FROM assets WHERE project_id = ? ORDER BY created_at').all(id) as Row[]).map(toAsset),
    jobs: (
      db
        .prepare("SELECT * FROM jobs WHERE project_id = ? AND (status IN ('queued','running') OR updated_at > ?) ORDER BY created_at")
        .all(id, Date.now() - 10 * 60 * 1000) as Row[]
    ).map(toJob)
  }
}

export function touchProject(id: string, patch: Partial<Pick<Project, 'status' | 'step' | 'coverAssetId' | 'title'>> = {}): void {
  const sets: string[] = ['updated_at = @now']
  if (patch.status) sets.push('status = @status')
  if (patch.step) sets.push('step = @step')
  if (patch.coverAssetId !== undefined) sets.push('cover_asset_id = @coverAssetId')
  if (patch.title) sets.push('title = @title')
  getDb()
    .prepare(`UPDATE projects SET ${sets.join(', ')} WHERE id = @id`)
    .run({ ...patch, id, now: Date.now() })
}

/** Saves the editable parts of a project. Asset links stay owned by the main process. */
export function saveSnapshot(snap: ProjectSnapshot): number {
  const db = getDb()
  const now = Date.now()
  const p = snap.project
  db.transaction(() => {
    db.prepare(
      `UPDATE projects SET title = @title, synopsis = @synopsis, duration_sec = @durationSec, language = @language,
        aspect_ratio = @aspectRatio, style_id = @styleId, tts_provider = @ttsProvider, tts_voice = @ttsVoice,
        image_model = @imageModel, video_model = @videoModel, video_resolution = @videoResolution, status = @status, step = @step, editor_json = @editor, updated_at = @now
       WHERE id = @id`
    ).run({ ...p, editor: JSON.stringify(p.editor), now })

    const charIds = snap.characters.map((c) => c.id)
    db.prepare(
      `DELETE FROM characters WHERE project_id = ? AND id NOT IN (${charIds.map(() => '?').join(',') || "''"})`
    ).run(p.id, ...charIds)
    const upChar = db.prepare(
      `INSERT INTO characters (id, project_id, name, description, sort) VALUES (@id, @projectId, @name, @description, @sort)
       ON CONFLICT(id) DO UPDATE SET name = excluded.name, description = excluded.description, sort = excluded.sort`
    )
    for (const c of snap.characters) upChar.run({ ...c, projectId: p.id })

    const clipIds = snap.clips.map((c) => c.id)
    db.prepare(`DELETE FROM clips WHERE project_id = ? AND id NOT IN (${clipIds.map(() => '?').join(',') || "''"})`).run(
      p.id,
      ...clipIds
    )
    const upClip = db.prepare(
      `INSERT INTO clips (id, project_id, sort, title, story, visual_prompt, narration, duration_ms, character_ids, motion_type,
         camera_preset, motion_strength, video_prompt, transition, video_camera, video_strength, transition_ms, voice_gain_db,
         media_in_ms, voice_in_ms, voice_out_ms, voice_start_ms)
       VALUES (@id, @projectId, @sort, @title, @story, @visualPrompt, @narration, @durationMs, @characterIds, @motionType,
         @cameraPreset, @motionStrength, @videoPrompt, @transition, @videoCamera, @videoStrength, @transitionMs, @voiceGainDb,
         @mediaInMs, @voiceInMs, @voiceOutMs, @voiceStartMs)
       ON CONFLICT(id) DO UPDATE SET sort = excluded.sort, title = excluded.title, story = excluded.story, visual_prompt = excluded.visual_prompt,
         narration = excluded.narration, duration_ms = excluded.duration_ms, character_ids = excluded.character_ids,
         motion_type = excluded.motion_type, camera_preset = excluded.camera_preset, motion_strength = excluded.motion_strength,
         video_prompt = excluded.video_prompt, transition = excluded.transition, video_camera = excluded.video_camera,
         video_strength = excluded.video_strength, transition_ms = excluded.transition_ms, voice_gain_db = excluded.voice_gain_db,
         media_in_ms = excluded.media_in_ms, voice_in_ms = excluded.voice_in_ms, voice_out_ms = excluded.voice_out_ms,
         voice_start_ms = excluded.voice_start_ms`
    )
    for (const c of snap.clips)
      upClip.run({
        ...c,
        projectId: p.id,
        characterIds: JSON.stringify(c.characterIds),
        videoCamera: c.videoCamera ?? 'static',
        videoStrength: c.videoStrength ?? 'halus',
        transitionMs: c.transitionMs ?? null,
        voiceGainDb: c.voiceGainDb ?? 0,
        mediaInMs: Math.round(c.mediaInMs ?? 0),
        voiceInMs: Math.round(c.voiceInMs ?? 0),
        voiceOutMs: c.voiceOutMs == null ? null : Math.round(c.voiceOutMs),
        voiceStartMs: Math.round(c.voiceStartMs ?? 0)
      })
  })()
  return now
}

export function removeProject(id: string): void {
  getDb().prepare('DELETE FROM projects WHERE id = ?').run(id)
  const dir = join(projectsRoot(), id)
  if (existsSync(dir)) rmSync(dir, { recursive: true, force: true })
}

export function duplicateProject(id: string): ProjectSummary {
  const db = getDb()
  const src = getBundle(id)
  const newId = randomUUID()
  const now = Date.now()
  const idMap = new Map<string, string>()
  const mapId = (old: string | null): string | null => {
    if (!old) return null
    if (!idMap.has(old)) idMap.set(old, randomUUID())
    return idMap.get(old)!
  }
  db.transaction(() => {
    const p = db.prepare('SELECT * FROM projects WHERE id = ?').get(id) as Row
    db.prepare(
      `INSERT INTO projects (id, title, synopsis, duration_sec, language, aspect_ratio, style_id, tts_provider, tts_voice,
         image_model, video_model, video_resolution, status, step, cover_asset_id, editor_json, created_at, updated_at)
       SELECT @newId, @title, synopsis, duration_sec, language, aspect_ratio, style_id, tts_provider, tts_voice,
         image_model, video_model, video_resolution, status, step, @cover, editor_json, @now, @now FROM projects WHERE id = @id`
    ).run({ newId, id, title: `${p.title} (salinan)`, cover: mapId(p.cover_asset_id), now })
    for (const a of src.assets) {
      db.prepare(
        `INSERT INTO assets (id, project_id, clip_id, character_id, kind, provider, model, prompt, remote_id, remote_url, local_path,
           duration_ms, width, height, meta_json, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        mapId(a.id),
        newId,
        mapId(a.clipId),
        mapId(a.characterId),
        a.kind,
        a.provider,
        a.model,
        a.prompt,
        a.remoteId,
        a.remoteUrl,
        a.localPath,
        a.durationMs,
        a.width,
        a.height,
        JSON.stringify(a.meta),
        a.createdAt
      )
    }
    for (const c of src.characters) {
      db.prepare('INSERT INTO characters (id, project_id, name, description, sheet_asset_id, sort) VALUES (?, ?, ?, ?, ?, ?)').run(
        mapId(c.id),
        newId,
        c.name,
        c.description,
        mapId(c.sheetAssetId),
        c.sort
      )
    }
    for (const c of src.clips) {
      db.prepare(
        `INSERT INTO clips (id, project_id, sort, title, story, visual_prompt, visual_source, narration, duration_ms, character_ids,
           motion_type, camera_preset, motion_strength, video_prompt, transition, image_asset_id, video_asset_id, audio_asset_id,
           video_camera, video_strength, transition_ms, voice_gain_db, media_in_ms, voice_in_ms, voice_out_ms, voice_start_ms)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        mapId(c.id),
        newId,
        c.sort,
        c.title,
        c.story,
        c.visualPrompt,
        c.visualSource,
        c.narration,
        c.durationMs,
        JSON.stringify(c.characterIds.map((x) => mapId(x))),
        c.motionType,
        c.cameraPreset,
        c.motionStrength,
        c.videoPrompt,
        c.transition,
        mapId(c.imageAssetId),
        mapId(c.videoAssetId),
        mapId(c.audioAssetId),
        c.videoCamera,
        c.videoStrength,
        c.transitionMs,
        c.voiceGainDb,
        c.mediaInMs,
        c.voiceInMs,
        c.voiceOutMs,
        c.voiceStartMs
      )
    }
  })()
  const srcDir = join(projectsRoot(), id)
  if (existsSync(srcDir)) cpSync(srcDir, projectDir(newId), { recursive: true })
  return listProjects().find((p) => p.id === newId)!
}

// ---------- story ----------

export type StoryClip = Omit<
  Clip,
  | 'id'
  | 'projectId'
  | 'sort'
  | 'imageAssetId'
  | 'videoAssetId'
  | 'audioAssetId'
  | 'characterIds'
  | 'visualSource'
  | 'videoCamera'
  | 'videoStrength'
  | 'transitionMs'
  | 'voiceGainDb'
  | 'mediaInMs'
  | 'voiceInMs'
  | 'voiceOutMs'
  | 'voiceStartMs'
> & {
  characterNames: string[]
}

/** A complete storyboard in one go (script and visuals); used by the development harness. */
export function replaceStory(
  projectId: string,
  title: string,
  characters: { name: string; description: string }[],
  clips: StoryClip[]
): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM clips WHERE project_id = ?').run(projectId)
    db.prepare('DELETE FROM characters WHERE project_id = ?').run(projectId)
    const byName = new Map<string, string>()
    characters.forEach((c, i) => {
      const id = randomUUID()
      byName.set(c.name.trim().toLowerCase(), id)
      db.prepare('INSERT INTO characters (id, project_id, name, description, sort) VALUES (?, ?, ?, ?, ?)').run(
        id,
        projectId,
        c.name,
        c.description,
        i
      )
    })
    clips.forEach((c, i) => {
      const ids = c.characterNames.map((n) => byName.get(n.trim().toLowerCase())).filter((x): x is string => !!x)
      db.prepare(
        `INSERT INTO clips (id, project_id, sort, title, story, visual_prompt, visual_source, narration, duration_ms, character_ids,
           motion_type, camera_preset, motion_strength, video_prompt, transition)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        projectId,
        i,
        c.title,
        c.story,
        c.visualPrompt,
        visualSourceOf(c),
        c.narration,
        c.durationMs,
        JSON.stringify(ids),
        c.motionType,
        c.cameraPreset,
        c.motionStrength,
        c.videoPrompt,
        c.transition
      )
    })
    db.prepare("UPDATE projects SET title = ?, status = 'storyboard', step = 3, updated_at = ? WHERE id = ?").run(
      title,
      Date.now(),
      projectId
    )
  })()
}

export interface ScriptScene {
  title: string
  story: string
  narration: string
  durationMs: number
}

/**
 * Replaces all scenes with a freshly written script. Characters stay: the visual step reuses the ones
 * whose names come back, so their character sheets survive a rewrite.
 */
export function replaceScript(projectId: string, title: string, scenes: ScriptScene[]): void {
  const db = getDb()
  db.transaction(() => {
    db.prepare('DELETE FROM clips WHERE project_id = ?').run(projectId)
    const insert = db.prepare(
      `INSERT INTO clips (id, project_id, sort, title, story, narration, duration_ms, character_ids)
       VALUES (?, ?, ?, ?, ?, ?, ?, '[]')`
    )
    scenes.forEach((c, i) => insert.run(randomUUID(), projectId, i, c.title, c.story, c.narration, c.durationMs))
    db.prepare("UPDATE projects SET title = ?, status = 'script', step = 2, updated_at = ? WHERE id = ?").run(title, Date.now(), projectId)
  })()
}

export interface SceneVisual {
  clipId: string
  visualPrompt: string
  characterNames: string[]
  cameraPreset: Clip['cameraPreset']
  motionStrength: Clip['motionStrength']
  videoPrompt: string
  transition: Clip['transition']
}

/**
 * Stores a visual plan for some scenes. Characters are matched by name: known ones keep their look and
 * sheet, new ones are added. Each updated scene remembers the story it was planned from.
 */
export function applyVisuals(projectId: string, characters: { name: string; description: string }[], scenes: SceneVisual[]): void {
  const db = getDb()
  db.transaction(() => {
    const existing = db.prepare('SELECT id, name FROM characters WHERE project_id = ? ORDER BY sort').all(projectId) as Row[]
    const byName = new Map<string, string>(existing.map((c) => [String(c.name).trim().toLowerCase(), c.id as string]))
    let sort = existing.length
    for (const c of characters) {
      const key = c.name.trim().toLowerCase()
      if (!key || byName.has(key)) continue
      const id = randomUUID()
      db.prepare('INSERT INTO characters (id, project_id, name, description, sort) VALUES (?, ?, ?, ?, ?)').run(
        id,
        projectId,
        c.name.trim(),
        c.description,
        sort++
      )
      byName.set(key, id)
    }
    const update = db.prepare(
      `UPDATE clips SET visual_prompt = @visualPrompt, visual_source = @visualSource, character_ids = @characterIds,
         camera_preset = @cameraPreset, motion_strength = @motionStrength, video_prompt = @videoPrompt, transition = @transition
       WHERE id = @clipId AND project_id = @projectId`
    )
    for (const v of scenes) {
      const clip = getClip(v.clipId)
      const ids = [...new Set(v.characterNames.map((n) => byName.get(n.trim().toLowerCase())).filter((x): x is string => !!x))]
      update.run({ ...v, projectId, visualSource: visualSourceOf(clip), characterIds: JSON.stringify(ids) })
    }
    db.prepare(
      "UPDATE projects SET status = CASE WHEN status IN ('draft', 'script') THEN 'storyboard' ELSE status END, step = 3, updated_at = ? WHERE id = ?"
    ).run(Date.now(), projectId)
  })()
}

// ---------- clips, characters, assets ----------

export function getClip(id: string): Clip {
  const r = getDb().prepare('SELECT * FROM clips WHERE id = ?').get(id) as Row | undefined
  if (!r) throw new Error('Klip tidak ditemukan')
  return toClip(r)
}

export function getCharacter(id: string): Character {
  const r = getDb().prepare('SELECT * FROM characters WHERE id = ?').get(id) as Row | undefined
  if (!r) throw new Error('Pemeran tidak ditemukan')
  return toCharacter(r)
}

export function charactersOf(projectId: string): Character[] {
  return (getDb().prepare('SELECT * FROM characters WHERE project_id = ? ORDER BY sort').all(projectId) as Row[]).map(toCharacter)
}

export function clipsOf(projectId: string): Clip[] {
  return (getDb().prepare('SELECT * FROM clips WHERE project_id = ? ORDER BY sort').all(projectId) as Row[]).map(toClip)
}

const CLIP_COLS: Partial<Record<keyof Clip, string>> = {
  imageAssetId: 'image_asset_id',
  videoAssetId: 'video_asset_id',
  audioAssetId: 'audio_asset_id',
  durationMs: 'duration_ms',
  motionType: 'motion_type',
  videoCamera: 'video_camera',
  videoStrength: 'video_strength',
  mediaInMs: 'media_in_ms',
  voiceInMs: 'voice_in_ms',
  voiceOutMs: 'voice_out_ms',
  voiceStartMs: 'voice_start_ms'
}

export function patchClip(id: string, patch: Partial<Clip>): void {
  const entries = Object.entries(patch).filter(([k]) => k in CLIP_COLS)
  if (!entries.length) return
  const sets = entries.map(([k]) => `${CLIP_COLS[k as keyof Clip]} = ?`).join(', ')
  getDb()
    .prepare(`UPDATE clips SET ${sets} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id)
}

function insertClipRow(c: Clip, projectId: string, sort: number): void {
  getDb()
    .prepare(
      `INSERT INTO clips (id, project_id, sort, title, story, visual_prompt, visual_source, narration, duration_ms, character_ids,
         motion_type, camera_preset, motion_strength, video_prompt, transition, image_asset_id, video_asset_id, audio_asset_id,
         video_camera, video_strength, transition_ms, voice_gain_db, media_in_ms, voice_in_ms, voice_out_ms, voice_start_ms)
       VALUES (@id, @projectId, @sort, @title, @story, @visualPrompt, @visualSource, @narration, @durationMs, @characterIds,
         @motionType, @cameraPreset, @motionStrength, @videoPrompt, @transition, @imageAssetId, @videoAssetId, @audioAssetId,
         @videoCamera, @videoStrength, @transitionMs, @voiceGainDb, @mediaInMs, @voiceInMs, @voiceOutMs, @voiceStartMs)`
    )
    .run({ ...c, projectId, sort, characterIds: JSON.stringify(c.characterIds) })
}

/** Puts a new clip right after another one (used when the editor splits a clip). */
export function insertClipAfter(afterId: string, c: Clip): void {
  const db = getDb()
  db.transaction(() => {
    const after = getClip(afterId)
    db.prepare('UPDATE clips SET sort = sort + 1 WHERE project_id = ? AND sort > ?').run(after.projectId, after.sort)
    insertClipRow(c, after.projectId, after.sort + 1)
  })()
}

/** Adds an empty scene at the end of a project (an import with more files than scenes). */
export function appendClip(projectId: string, title: string): Clip {
  const row = getDb().prepare('SELECT COALESCE(MAX(sort), -1) AS sort FROM clips WHERE project_id = ?').get(projectId) as { sort: number }
  const clip: Clip = {
    id: randomUUID(),
    projectId,
    sort: row.sort + 1,
    title,
    story: '',
    visualPrompt: '',
    visualSource: null,
    narration: '',
    durationMs: 5000,
    characterIds: [],
    motionType: 'camera',
    cameraPreset: 'zoomin',
    motionStrength: 'halus',
    videoPrompt: '',
    transition: 'fade',
    videoCamera: 'static',
    videoStrength: 'halus',
    transitionMs: null,
    voiceGainDb: 0,
    mediaInMs: 0,
    voiceInMs: 0,
    voiceOutMs: null,
    voiceStartMs: 0,
    imageAssetId: null,
    videoAssetId: null,
    audioAssetId: null
  }
  insertClipRow(clip, projectId, clip.sort)
  return clip
}

/** Text fields of a clip changed outside the editor's own saves (a split moves narration between clips). */
export function patchClipText(
  id: string,
  patch: Partial<Pick<Clip, 'title' | 'story' | 'narration' | 'visualSource' | 'transition' | 'visualPrompt' | 'videoPrompt'>>
): void {
  const cols: Record<string, string> = {
    title: 'title',
    story: 'story',
    narration: 'narration',
    visualSource: 'visual_source',
    transition: 'transition',
    visualPrompt: 'visual_prompt',
    videoPrompt: 'video_prompt'
  }
  const entries = Object.entries(patch).filter(([k]) => k in cols)
  if (!entries.length) return
  getDb()
    .prepare(`UPDATE clips SET ${entries.map(([k]) => `${cols[k]} = ?`).join(', ')} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), id)
}

export function setCharacterSheet(id: string, assetId: string): void {
  getDb().prepare('UPDATE characters SET sheet_asset_id = ? WHERE id = ?').run(assetId, id)
}

export function getAsset(id: string | null): Asset | null {
  if (!id) return null
  const r = getDb().prepare('SELECT * FROM assets WHERE id = ?').get(id) as Row | undefined
  return r ? toAsset(r) : null
}

export function insertAsset(a: {
  id?: string
  projectId: string
  clipId?: string | null
  characterId?: string | null
  kind: AssetKind
  provider?: string | null
  model?: string | null
  prompt?: string | null
  remoteId?: string | null
  remoteUrl?: string | null
  localPath: string
  durationMs?: number | null
  width?: number | null
  height?: number | null
  meta?: AssetMeta
}): Asset {
  const id = a.id ?? randomUUID()
  getDb()
    .prepare(
      `INSERT INTO assets (id, project_id, clip_id, character_id, kind, provider, model, prompt, remote_id, remote_url, local_path,
        duration_ms, width, height, meta_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      id,
      a.projectId,
      a.clipId ?? null,
      a.characterId ?? null,
      a.kind,
      a.provider ?? null,
      a.model ?? null,
      a.prompt ?? null,
      a.remoteId ?? null,
      a.remoteUrl ?? null,
      a.localPath,
      a.durationMs ?? null,
      a.width ?? null,
      a.height ?? null,
      JSON.stringify(a.meta ?? {}),
      Date.now()
    )
  return getAsset(id)!
}

export function updateAssetMeta(id: string, meta: AssetMeta): void {
  getDb().prepare('UPDATE assets SET meta_json = ? WHERE id = ?').run(JSON.stringify(meta), id)
}

// ---------- jobs ----------

export function insertJob(j: {
  projectId: string
  clipId?: string | null
  characterId?: string | null
  kind: JobKind
  provider: string
  payload?: Record<string, unknown>
}): Job {
  const id = randomUUID()
  const now = Date.now()
  getDb()
    .prepare(
      `INSERT INTO jobs (id, project_id, clip_id, character_id, kind, provider, status, progress, payload_json, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?, ?)`
    )
    .run(id, j.projectId, j.clipId ?? null, j.characterId ?? null, j.kind, j.provider, JSON.stringify(j.payload ?? {}), now, now)
  return getJob(id)!
}

export function getJob(id: string): Job | null {
  const r = getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined
  return r ? toJob(r) : null
}

export function getJobRaw(id: string): Row | undefined {
  return getDb().prepare('SELECT * FROM jobs WHERE id = ?').get(id) as Row | undefined
}

export function updateJob(
  id: string,
  patch: Partial<{ status: JobStatus; progress: number; message: string | null; error: string | null; remoteId: string; resultAssetId: string }>
): Job {
  const cols: Record<string, string> = {
    status: 'status',
    progress: 'progress',
    message: 'message',
    error: 'error',
    remoteId: 'remote_id',
    resultAssetId: 'result_asset_id'
  }
  const entries = Object.entries(patch).filter(([k]) => k in cols)
  const sets = [...entries.map(([k]) => `${cols[k]} = ?`), 'updated_at = ?'].join(', ')
  getDb()
    .prepare(`UPDATE jobs SET ${sets} WHERE id = ?`)
    .run(...entries.map(([, v]) => v), Date.now(), id)
  return getJob(id)!
}

export function unfinishedJobs(): Row[] {
  return getDb().prepare("SELECT * FROM jobs WHERE status IN ('queued','running')").all() as Row[]
}

/** A queued or running project-wide job of this kind, such as a narration take. */
export function activeProjectJob(projectId: string, kind: JobKind): Job | null {
  const r = getDb()
    .prepare("SELECT * FROM jobs WHERE project_id = ? AND kind = ? AND status IN ('queued','running') LIMIT 1")
    .get(projectId, kind) as Row | undefined
  return r ? toJob(r) : null
}

export function activeJobFor(target: { clipId?: string; characterId?: string }, kind: JobKind): Job | null {
  const r = getDb()
    .prepare(
      `SELECT * FROM jobs WHERE kind = ? AND status IN ('queued','running') AND ${target.clipId ? 'clip_id' : 'character_id'} = ? LIMIT 1`
    )
    .get(kind, target.clipId ?? target.characterId) as Row | undefined
  return r ? toJob(r) : null
}
