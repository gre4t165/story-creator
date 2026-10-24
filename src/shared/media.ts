import type { Asset, Character, Clip, Project } from './types'

/** What can be cleaned up: the pictures, voices and videos of clips. Music, logos and exports are left alone. */
export type MediaKind = 'image' | 'audio' | 'video'

/**
 * Assets nothing uses any more: not on a clip, not a character sheet, not the cover, not a logo overlay, not the
 * music. They are what is left after "remove all" (and old versions of regenerated pictures), kept so undo can bring
 * them back. The editor counts them and the main process deletes them, so both read the same rule from here.
 */
export function looseAssets(
  project: { coverAssetId: Project['coverAssetId']; editor: Pick<Project['editor'], 'overlays' | 'musicAssetId'> },
  clips: Pick<Clip, 'imageAssetId' | 'videoAssetId' | 'audioAssetId'>[],
  characters: Pick<Character, 'sheetAssetId'>[],
  assets: Asset[],
  kinds: MediaKind[] = ['image', 'audio', 'video']
): Asset[] {
  const used = new Set<string>()
  const add = (id: string | null | undefined): void => {
    if (id) used.add(id)
  }
  clips.forEach((c) => [c.imageAssetId, c.videoAssetId, c.audioAssetId].forEach(add))
  characters.forEach((c) => add(c.sheetAssetId))
  add(project.coverAssetId)
  add(project.editor.musicAssetId)
  for (const o of project.editor.overlays ?? []) if (o.kind === 'image') add(o.assetId)
  return assets.filter((a) => (kinds as string[]).includes(a.kind) && !used.has(a.id))
}
