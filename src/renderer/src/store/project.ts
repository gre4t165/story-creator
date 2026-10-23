import { create } from 'zustand'
import type { Asset, Character, Clip, Job, Project, ProjectBundle, ProjectSnapshot } from '@shared/types'
import { errorText } from '../lib/format'
import { COALESCE_MS, MAX_HISTORY, differs, hasLinkChanges, linkChanges, same, trackedOf, transform, type HistoryEntry, type Tracked } from '../lib/history'
import { useApp } from './app'

export type SaveState = 'saved' | 'dirty' | 'saving' | 'error'

interface ProjectState {
  loaded: boolean
  project: Project | null
  characters: Character[]
  clips: Clip[]
  assets: Record<string, Asset>
  jobs: Record<string, Job>
  saveState: SaveState
  saveError: string | null
  savedAt: number | null
  selectedClipId: string | null
  /** Labels of the actions undo and redo would act on now, or null when there is nothing to undo or redo. */
  history: { undo: string | null; redo: string | null }

  load(bundle: ProjectBundle): void
  unload(): void
  select(clipId: string | null): void
  updateProject(patch: Partial<Project>): void
  updateEditor(patch: Partial<Project['editor']>): void
  updateClip(id: string, patch: Partial<Clip>): void
  updateCharacter(id: string, patch: Partial<Character>): void
  addClip(afterId: string | null): string
  removeClip(id: string): void
  moveClip(id: string, dir: -1 | 1): void
  addCharacter(init?: { name: string; description: string }): string
  removeCharacter(id: string): void
  save(): Promise<void>
  flush(): Promise<void>

  undo(): Promise<void>
  redo(): Promise<void>
  /** Runs an action done in the main process (import, split, new script) as one undo step. */
  record<T>(label: string, fn: () => Promise<T>): Promise<T>
  /** Several edits made in a row become one undo step. */
  batch(label: string, fn: () => void): void
  clearHistory(): void

  applyClip(clipId: string, patch: Partial<Clip>): void
  applyCharacter(characterId: string, patch: Partial<Character>): void
  addAsset(asset: Asset): void
  upsertJob(job: Job): void
}

const AUTOSAVE_MS = 1200
let timer: ReturnType<typeof setTimeout> | null = null
let inFlight: Promise<void> | null = null
let changedDuringSave = false

function snapshot(s: ProjectState): ProjectSnapshot {
  const { createdAt: _c, updatedAt: _u, coverAssetId: _cv, ...project } = s.project!
  return {
    project,
    characters: s.characters.map(({ sheetAssetId: _s, ...c }) => c),
    clips: s.clips.map(({ imageAssetId: _i, videoAssetId: _v, audioAssetId: _a, ...c }) => c)
  }
}

const newId = (): string => crypto.randomUUID()

// Undo history lives outside the state: only its labels are shown, and changing it must not re-render the editor.
let past: HistoryEntry[] = []
let future: HistoryEntry[] = []
/** While more than one edit is grouped into one step. */
let groupDepth = 0
let groupBefore: Tracked | null = null
/** After an undo or redo, the next edit starts a new step even if it has the same key as the last one. */
let breakCoalesce = false
let undoing = false

const has = (o: object, keys: string[]): boolean => keys.some((k) => k in o)
const sameValues = (cur: object, patch: object): boolean => Object.entries(patch).every(([k, v]) => same((cur as Record<string, unknown>)[k], v))

function clipLabel(patch: object): string {
  if (has(patch, ['narration', 'story'])) return 'Ubah naskah'
  if (has(patch, ['title'])) return 'Ubah judul klip'
  if (has(patch, ['visualPrompt', 'videoPrompt'])) return 'Ubah prompt'
  if (has(patch, ['durationMs', 'mediaInMs', 'voiceInMs', 'voiceOutMs', 'voiceStartMs'])) return 'Ubah durasi'
  if (has(patch, ['cameraPreset', 'motionStrength', 'motionType', 'videoCamera', 'videoStrength'])) return 'Ubah gerak'
  if (has(patch, ['transition', 'transitionMs'])) return 'Ubah transisi'
  if (has(patch, ['voiceGainDb'])) return 'Ubah volume suara'
  return 'Ubah klip'
}

function editorLabel(patch: object): string {
  if (has(patch, ['overlays'])) return 'Ubah overlay'
  if (has(patch, ['sfx', 'sfxVolumeDb'])) return 'Ubah SFX'
  if (Object.keys(patch).some((k) => k.startsWith('music') || k === 'duckMusic')) return 'Ubah musik'
  if (Object.keys(patch).some((k) => k.startsWith('caption'))) return 'Ubah caption'
  return 'Ubah editor'
}

export const useProject = create<ProjectState>((set, get) => {
  const touch = (): void => {
    if (get().saveState === 'saving') changedDuringSave = true
    set({ saveState: get().saveState === 'saving' ? 'saving' : 'dirty' })
    if (timer) clearTimeout(timer)
    timer = setTimeout(() => void get().save(), AUTOSAVE_MS)
  }
  const resort = (clips: Clip[]): Clip[] => clips.map((c, i) => ({ ...c, sort: i }))
  const now = (): Tracked => trackedOf(get().project!, get().characters, get().clips)
  const syncHistory = (): void => set({ history: { undo: past[past.length - 1]?.label ?? null, redo: future[future.length - 1]?.label ?? null } })
  const resetHistory = (): void => {
    past = []
    future = []
    groupDepth = 0
    groupBefore = null
    breakCoalesce = false
  }

  /** Adds one finished action to the history; quick edits with the same key (typing, dragging) join the last step. */
  const push = (before: Tracked, after: Tracked, label: string, key: string | null): void => {
    const t = Date.now()
    const last = past[past.length - 1]
    if (key && last && last.key === key && !breakCoalesce && t - last.at < COALESCE_MS) {
      last.after = after
      last.at = t
    } else {
      if (!differs(before, after)) return
      past.push({ label, key, at: t, before, after })
      if (past.length > MAX_HISTORY) past.shift()
    }
    future = []
    breakCoalesce = false
    syncHistory()
  }

  /** Runs a change made in the store and remembers it. Inside batch() the whole group is remembered at its end. */
  const edit = (label: string, key: string | null, change: () => void): void => {
    if (groupDepth > 0 || !get().project) return change()
    const before = now()
    change()
    push(before, now(), label, key)
  }

  /** Applies what one step changed (from → to) on top of the current state, then saves it and puts asset links back. */
  const applyChange = async (from: Tracked, to: Tracked): Promise<void> => {
    const cur = now()
    const next = transform(cur, from, to)
    const s = get()
    const i = s.clips.findIndex((c) => c.id === s.selectedClipId)
    set({
      project: { ...s.project!, ...next.project },
      characters: next.characters,
      clips: next.clips,
      selectedClipId: next.clips.some((c) => c.id === s.selectedClipId) ? s.selectedClipId : (next.clips[Math.max(0, Math.min(i, next.clips.length - 1))]?.id ?? null)
    })
    touch()
    const links = linkChanges(cur, next)
    try {
      await get().flush()
      if (hasLinkChanges(links)) await window.api.projects.setLinks(next.project.id, links)
    } catch (e) {
      useApp.getState().toast('error', errorText(e))
    }
  }

  return {
    loaded: false,
    project: null,
    characters: [],
    clips: [],
    assets: {},
    jobs: {},
    saveState: 'saved',
    saveError: null,
    savedAt: null,
    selectedClipId: null,
    history: { undo: null, redo: null },

    load: (b) => {
      // Another project starts with a clean history; reloading the same one (after an import) keeps it.
      if (get().project?.id !== b.project.id) resetHistory()
      set({
        loaded: true,
        project: b.project,
        characters: b.characters,
        clips: b.clips,
        assets: Object.fromEntries(b.assets.map((a) => [a.id, a])),
        jobs: Object.fromEntries(b.jobs.map((j) => [j.id, j])),
        saveState: 'saved',
        saveError: null,
        savedAt: b.project.updatedAt,
        selectedClipId: get().selectedClipId && b.clips.some((c) => c.id === get().selectedClipId) ? get().selectedClipId : (b.clips[0]?.id ?? null)
      })
      syncHistory()
    },
    unload: () => {
      if (timer) clearTimeout(timer)
      resetHistory()
      set({ loaded: false, project: null, characters: [], clips: [], assets: {}, jobs: {}, selectedClipId: null, saveState: 'saved', history: { undo: null, redo: null } })
    },
    select: (clipId) => set({ selectedClipId: clipId }),

    updateProject: (patch) => {
      if (sameValues(get().project!, patch)) return
      edit('Ubah pengaturan proyek', `project:${Object.keys(patch).sort().join(',')}`, () => {
        set({ project: { ...get().project!, ...patch } })
        touch()
      })
    },
    updateEditor: (patch) => {
      if (sameValues(get().project!.editor, patch)) return
      edit(editorLabel(patch), `editor:${Object.keys(patch).sort().join(',')}`, () => {
        const p = get().project!
        set({ project: { ...p, editor: { ...p.editor, ...patch } } })
        touch()
      })
    },
    updateClip: (id, patch) => {
      const cur = get().clips.find((c) => c.id === id)
      if (cur && sameValues(cur, patch)) return
      edit(clipLabel(patch), `clip:${id}:${Object.keys(patch).sort().join(',')}`, () => {
        set({ clips: get().clips.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
        touch()
      })
    },
    updateCharacter: (id, patch) => {
      const cur = get().characters.find((c) => c.id === id)
      if (cur && sameValues(cur, patch)) return
      edit('Ubah pemeran', `char:${id}:${Object.keys(patch).sort().join(',')}`, () => {
        set({ characters: get().characters.map((c) => (c.id === id ? { ...c, ...patch } : c)) })
        touch()
      })
    },
    addClip: (afterId) => {
      const p = get().project!
      const clips = [...get().clips]
      const at = afterId ? clips.findIndex((c) => c.id === afterId) + 1 : clips.length
      const clip: Clip = {
        id: newId(),
        projectId: p.id,
        sort: at,
        title: 'Adegan baru',
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
      clips.splice(at, 0, clip)
      edit('Tambah klip', null, () => {
        set({ clips: resort(clips), selectedClipId: clip.id })
        touch()
      })
      return clip.id
    },
    removeClip: (id) => {
      edit('Hapus klip', null, () => {
        const clips = get().clips
        const i = clips.findIndex((c) => c.id === id)
        const rest = resort(clips.filter((c) => c.id !== id))
        set({ clips: rest, selectedClipId: rest[Math.min(i, rest.length - 1)]?.id ?? null })
        touch()
      })
    },
    moveClip: (id, dir) => {
      const clips = [...get().clips]
      const i = clips.findIndex((c) => c.id === id)
      const j = i + dir
      if (i < 0 || j < 0 || j >= clips.length) return
      ;[clips[i], clips[j]] = [clips[j], clips[i]]
      edit('Pindahkan klip', null, () => {
        set({ clips: resort(clips) })
        touch()
      })
    },
    addCharacter: (init) => {
      const p = get().project!
      const c: Character = {
        id: newId(),
        projectId: p.id,
        name: init?.name.trim() || 'Pemeran baru',
        description: init?.description.trim() ?? '',
        sheetAssetId: null,
        sort: get().characters.length
      }
      edit('Tambah pemeran', null, () => {
        set({ characters: [...get().characters, c] })
        touch()
      })
      return c.id
    },
    removeCharacter: (id) => {
      edit('Hapus pemeran', null, () => {
        set({
          characters: get().characters.filter((c) => c.id !== id),
          clips: get().clips.map((c) => ({ ...c, characterIds: c.characterIds.filter((x) => x !== id) }))
        })
        touch()
      })
    },

    save: async () => {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (!get().project) return
      if (inFlight) {
        changedDuringSave = true
        return inFlight
      }
      if (get().saveState === 'saved') return
      changedDuringSave = false
      set({ saveState: 'saving', saveError: null })
      inFlight = (async () => {
        try {
          const { updatedAt } = await window.api.projects.save(snapshot(get()))
          set({ savedAt: updatedAt, saveState: changedDuringSave ? 'dirty' : 'saved' })
        } catch (e) {
          set({ saveState: 'error', saveError: errorText(e) })
        } finally {
          inFlight = null
        }
        if (changedDuringSave) {
          changedDuringSave = false
          timer = setTimeout(() => void get().save(), 300)
        }
      })()
      return inFlight
    },
    flush: async () => {
      if (inFlight) await inFlight
      if (get().saveState === 'dirty' || get().saveState === 'error') await get().save()
    },

    undo: async () => {
      if (undoing || !get().project) return
      const entry = past.pop()
      if (!entry) return
      undoing = true
      future.push(entry)
      breakCoalesce = true
      try {
        await applyChange(entry.after, entry.before)
      } finally {
        undoing = false
        syncHistory()
      }
    },
    redo: async () => {
      if (undoing || !get().project) return
      const entry = future.pop()
      if (!entry) return
      undoing = true
      past.push(entry)
      breakCoalesce = true
      try {
        await applyChange(entry.before, entry.after)
      } finally {
        undoing = false
        syncHistory()
      }
    },
    record: async (label, fn) => {
      if (!get().project) return fn()
      const before = now()
      try {
        return await fn()
      } finally {
        // The main process reports its changes as events right around the reply; give them a moment to arrive.
        await new Promise((resolve) => setTimeout(resolve, 80))
        if (get().project?.id === before.project.id) push(before, now(), label, null)
      }
    },
    batch: (label, fn) => {
      if (!get().project) return fn()
      if (groupDepth === 0) groupBefore = now()
      groupDepth++
      try {
        fn()
      } finally {
        groupDepth--
        if (groupDepth === 0 && groupBefore) {
          const before = groupBefore
          groupBefore = null
          if (get().project) push(before, now(), label, null)
        }
      }
    },
    clearHistory: () => {
      resetHistory()
      syncHistory()
    },

    applyClip: (clipId, patch) => set({ clips: get().clips.map((c) => (c.id === clipId ? { ...c, ...patch } : c)) }),
    applyCharacter: (characterId, patch) =>
      set({ characters: get().characters.map((c) => (c.id === characterId ? { ...c, ...patch } : c)) }),
    addAsset: (asset) => {
      if (asset.projectId !== get().project?.id) return
      set({ assets: { ...get().assets, [asset.id]: asset } })
    },
    upsertJob: (job) => {
      if (job.projectId !== get().project?.id) return
      set({ jobs: { ...get().jobs, [job.id]: job } })
    }
  }
})

/** Latest active or recent job of a kind for a clip or character. */
export function jobFor(jobs: Record<string, Job>, kind: Job['kind'], target: { clipId?: string; characterId?: string }): Job | null {
  let best: Job | null = null
  for (const j of Object.values(jobs)) {
    if (j.kind !== kind) continue
    if (target.clipId && j.clipId !== target.clipId) continue
    if (target.characterId && j.characterId !== target.characterId) continue
    if (!best || j.createdAt > best.createdAt) best = j
  }
  return best
}

export const isRunning = (j: Job | null | undefined): boolean => !!j && (j.status === 'queued' || j.status === 'running')
