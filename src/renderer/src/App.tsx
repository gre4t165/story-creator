import { useEffect } from 'react'
import { ConfirmHost } from './components/ui'
import { Toasts } from './components/Toasts'
import { applyAccent } from './lib/theme'
import { Home } from './pages/Home'
import { ProjectPage } from './pages/project/ProjectPage'
import { Settings } from './pages/Settings'
import { useApp } from './store/app'
import { useProject } from './store/project'

const KIND_LABEL: Record<string, string> = {
  image: 'Gambar',
  sheet: 'Lembar karakter',
  video: 'Video AI',
  tts: 'Suara',
  export: 'Ekspor'
}

export function App() {
  const route = useApp((s) => s.route)

  useEffect(() => {
    void window.api.settings.get().then((s) => applyAccent(s.accent))
  }, [])

  useEffect(() => {
    const p = useProject.getState
    const offs = [
      window.api.on.job((job) => {
        p().upsertJob(job)
        const { toast } = useApp.getState()
        if (job.status === 'failed' && job.error) toast('error', `${KIND_LABEL[job.kind] ?? 'Proses'} gagal: ${job.error}`)
        if (job.status === 'done' && job.kind === 'export' && job.message) {
          const path = job.message
          toast('success', 'Video selesai diekspor.', { label: 'Buka folder', run: () => void window.api.exporter.reveal(path) })
        }
      }),
      window.api.on.clip((e) => p().applyClip(e.clipId, e.patch)),
      window.api.on.character((e) => p().applyCharacter(e.characterId, e.patch)),
      window.api.on.asset((a) => p().addAsset(a))
    ]
    return () => offs.forEach((off) => off())
  }, [])

  // A file dropped anywhere but a drop target would make Chromium open it in place of the app.
  useEffect(() => {
    const stop = (e: DragEvent): void => {
      if (e.dataTransfer?.types.includes('Files')) e.preventDefault()
    }
    window.addEventListener('dragover', stop)
    window.addEventListener('drop', stop)
    return () => {
      window.removeEventListener('dragover', stop)
      window.removeEventListener('drop', stop)
    }
  }, [])

  // Finish any pending save before the window closes.
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      const s = useProject.getState()
      if (s.saveState === 'dirty' || s.saveState === 'saving') {
        e.preventDefault()
        e.returnValue = ''
        void s.flush().then(() => window.close())
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [])

  return (
    <>
      {route.name === 'home' && <Home />}
      {route.name === 'settings' && <Settings />}
      {route.name === 'project' && <ProjectPage key={route.id} id={route.id} />}
      <Toasts />
      <ConfirmHost />
    </>
  )
}
