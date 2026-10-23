import { useState } from 'react'
import { randomMotions } from '@shared/motion'
import { fitClipsToMusic } from '@shared/timeline'
import { confirmDialog } from '../components/ui'
import { useApp } from '../store/app'
import { useProject } from '../store/project'
import { errorText, mmss } from './format'

/**
 * Background music that sets the pace of the pictures: picks a song (or uses the current one), then shares
 * its length out over the clips in their storyboard order, cutting on the beat where it can. Voices are never
 * cut short. Shared by the Storyboard and the editor's music tab.
 */
export function useMusicFit(): { busy: boolean; fit(pickNew: boolean): Promise<void> } {
  const { toast } = useApp()
  const [busy, setBusy] = useState(false)

  const fit = async (pickNew: boolean): Promise<void> => {
    const s = useProject.getState()
    const project = s.project
    if (!project || busy) return
    setBusy(true)
    try {
      await s.flush()
      let music = project.editor.musicAssetId ? (s.assets[project.editor.musicAssetId] ?? null) : null
      let inMs = project.editor.musicInMs ?? 0
      if (pickNew || !music) {
        const picked = await window.api.assets.pickMusic(project.id)
        if (!picked) return
        s.addAsset(picked)
        music = picked
        inMs = 0
      } else {
        const ok = await confirmDialog({
          title: 'Sesuaikan durasi gambar dengan musik?',
          body: 'Panjang tiap klip diatur ulang supaya video sepanjang musik dan pergantian gambar jatuh di ketukan. Klip bersuara tidak dipotong lebih pendek dari narasinya.',
          confirm: 'Sesuaikan'
        })
        if (!ok) return
      }
      if (!music.durationMs) throw new Error('Durasi musik tidak terbaca. Coba file MP3 atau WAV lain.')
      const beats = await window.api.assets.musicBeats(music.id).catch(() => [])
      const { clips, assets } = useProject.getState()
      const musicMs = Math.max(1000, music.durationMs - inMs)
      const { durations, fits } = fitClipsToMusic(clips, (id) => assets[id]?.durationMs ?? null, musicMs, beats)
      const st = useProject.getState()
      // Every clip length and the song itself change together, so one undo puts all of it back.
      st.batch('Sesuaikan gambar dengan musik', () => {
        clips.forEach((c, i) => st.updateClip(c.id, { durationMs: durations[i] }))
        // The song now runs the whole video.
        st.updateEditor({ musicAssetId: music.id, musicStartMs: 0, musicInMs: inMs, musicEndMs: null })
      })
      toast(
        fits ? 'success' : 'error',
        fits
          ? `${clips.length} gambar disesuaikan dengan musik ${mmss(musicMs)}${beats.length ? ', berganti di ketukan' : ''}.`
          : `Narasi lebih panjang dari musik (${mmss(musicMs)}). Klip mengikuti panjang suaranya, jadi musik berhenti sebelum video selesai.`
      )
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return { busy, fit }
}

/** A different camera move on every picture, neighbours never the same. */
export function shuffleMotions(): number {
  const { clips, updateClip, batch } = useProject.getState()
  const moves = randomMotions(clips.length)
  batch('Acak gerak', () => clips.forEach((c, i) => updateClip(c.id, moves[i])))
  return clips.length
}
