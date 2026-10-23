import type { Character, Clip, LinkRestore, Project } from '@shared/types'

/**
 * Undo and redo for a project, as pure functions so they can be tested without the app.
 *
 * An entry keeps the project as it was before and after one user action. Undoing does not put the old copy
 * back: it applies only what that action changed on top of the current state ("transform"). That way a picture
 * or voice that finished generating after the action is not thrown away by an unrelated undo.
 */

/** Navigation (step, status) and the cover are not edits, so they are not undone. */
type Untracked = 'createdAt' | 'updatedAt' | 'coverAssetId' | 'step' | 'status'
export type TrackedProject = Omit<Project, Untracked>

export interface Tracked {
  project: TrackedProject
  characters: Character[]
  clips: Clip[]
}

export interface HistoryEntry {
  label: string
  /** Edits with the same key in quick succession (typing, dragging a slider) become one entry. */
  key: string | null
  at: number
  before: Tracked
  after: Tracked
}

export const MAX_HISTORY = 100
/** How long after the last change an edit with the same key still joins the same entry. */
export const COALESCE_MS = 1000

export function trackedOf(project: Project, characters: Character[], clips: Clip[]): Tracked {
  const { createdAt: _c, updatedAt: _u, coverAssetId: _cv, step: _s, status: _st, ...rest } = project
  return { project: rest, characters, clips }
}

export function same(a: unknown, b: unknown): boolean {
  return a === b || JSON.stringify(a) === JSON.stringify(b)
}

type Rec = Record<string, unknown>

/** `cur` with every key that differs between `from` and `to` set to its value in `to`. */
function patchKeys(cur: Rec, from: Rec, to: Rec, skip: string[] = []): Rec {
  let out = cur
  for (const k of new Set([...Object.keys(from), ...Object.keys(to)])) {
    if (skip.includes(k) || same(from[k], to[k])) continue
    if (out === cur) out = { ...cur }
    if (to[k] === undefined) delete out[k]
    else out[k] = to[k]
  }
  return out
}

/** Items matched by id: changed fields are patched, removed items go, added items come back where they were. */
function mergeList<T extends { id: string; sort: number }>(cur: T[], from: T[], to: T[]): T[] {
  const fromBy = new Map(from.map((x) => [x.id, x]))
  const toBy = new Map(to.map((x) => [x.id, x]))
  let out = cur.map((item) => {
    const f = fromBy.get(item.id)
    const t = toBy.get(item.id)
    return f && t ? (patchKeys(item as Rec, f as Rec, t as Rec, ['sort']) as unknown as T) : item
  })
  out = out.filter((x) => !(fromBy.has(x.id) && !toBy.has(x.id)))

  for (const [i, item] of to.entries()) {
    if (fromBy.has(item.id) || out.some((x) => x.id === item.id)) continue
    // Right after the item that came before it, or at its old position when that one is gone too.
    const prevAt = i > 0 ? out.findIndex((x) => x.id === to[i - 1].id) : -1
    out.splice(prevAt >= 0 ? prevAt + 1 : Math.min(i, out.length), 0, item)
  }

  // Items both states have, in the order `to` has them: they take each other's places.
  const common = to.filter((x) => fromBy.has(x.id)).map((x) => x.id)
  const commonFrom = from.filter((x) => toBy.has(x.id)).map((x) => x.id)
  if (!same(common, commonFrom)) {
    const set = new Set(common)
    const slots = out.flatMap((x, i) => (set.has(x.id) ? [i] : []))
    const byId = new Map(out.map((x) => [x.id, x]))
    const ordered = common.flatMap((id) => (byId.has(id) ? [byId.get(id)!] : []))
    out = [...out]
    slots.forEach((slot, n) => {
      out[slot] = ordered[n]
    })
  }
  return out.map((x, i) => (x.sort === i ? x : { ...x, sort: i }))
}

/** `cur` with the change that turned `from` into `to` applied. Undo is (after → before), redo (before → after). */
export function transform(cur: Tracked, from: Tracked, to: Tracked): Tracked {
  const editor = patchKeys(cur.project.editor as unknown as Rec, from.project.editor as unknown as Rec, to.project.editor as unknown as Rec)
  const project = patchKeys(cur.project as unknown as Rec, from.project as unknown as Rec, to.project as unknown as Rec, ['editor']) as unknown as TrackedProject
  return {
    project: editor === (cur.project.editor as unknown) ? project : { ...project, editor: editor as unknown as TrackedProject['editor'] },
    characters: mergeList(cur.characters, from.characters, to.characters),
    clips: mergeList(cur.clips, from.clips, to.clips)
  }
}

/** The links that differ between two states, for clips and characters that are new or whose links changed. */
export function linkChanges(prev: Tracked, next: Tracked): LinkRestore {
  const prevClips = new Map(prev.clips.map((c) => [c.id, c]))
  const prevChars = new Map(prev.characters.map((c) => [c.id, c]))
  return {
    clips: next.clips
      .filter((c) => {
        const p = prevClips.get(c.id)
        return !p || p.imageAssetId !== c.imageAssetId || p.videoAssetId !== c.videoAssetId || p.audioAssetId !== c.audioAssetId || p.visualSource !== c.visualSource
      })
      .map((c) => ({ id: c.id, imageAssetId: c.imageAssetId, videoAssetId: c.videoAssetId, audioAssetId: c.audioAssetId, visualSource: c.visualSource })),
    characters: next.characters
      .filter((c) => !prevChars.has(c.id) || prevChars.get(c.id)!.sheetAssetId !== c.sheetAssetId)
      .map((c) => ({ id: c.id, sheetAssetId: c.sheetAssetId }))
  }
}

export const hasLinkChanges = (l: LinkRestore): boolean => l.clips.length > 0 || l.characters.length > 0

/** Whether two states differ in anything undo covers. */
export function differs(a: Tracked, b: Tracked): boolean {
  return a.project !== b.project || a.characters !== b.characters || a.clips !== b.clips ? !same(a, b) : false
}
