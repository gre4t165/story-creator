import { useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, Download, FolderOpen, Lock, Moon, RotateCcw } from 'lucide-react'
import { relaxLengthSec, relaxSizeEstimateGb } from '@shared/relax'
import type { ExportOptions, Job } from '@shared/types'
import { Button, Modal, Progress, Switch, cx, inputCls } from '../../components/ui'
import { clipNumber, durationLabel, errorText, mmss } from '../../lib/format'
import { FREE_LIMITS, WATERMARK_TEXT, proMessage, PRO_PREFIX } from '@shared/license'
import { useApp } from '../../store/app'
import { useIsPro, useLicense } from '../../store/license'
import { isRunning, useProject } from '../../store/project'

const RESOLUTIONS: { id: ExportOptions['resolution']; label: string; sub: string; mb: number }[] = [
  { id: 720, label: '720p', sub: 'Lebih kecil', mb: 0.4 },
  { id: 1080, label: '1080p', sub: 'Disarankan', mb: 0.75 },
  { id: 2160, label: '4K', sub: 'Lebih lama', mb: 2.4 }
]

function slug(s: string): string {
  return (
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'video'
  )
}

export function ExportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { project, clips, jobs, flush } = useProject()
  const { toast, openUpgrade } = useApp()
  const pro = useIsPro()
  const [opts, setOpts] = useState<ExportOptions | null>(null)
  const [jobId, setJobId] = useState<string | null>(null)

  useEffect(() => {
    if (!open || !project) return
    // A finished or failed export is not shown again; an export still running keeps its progress.
    setJobId((id) => (id && isRunning(useProject.getState().jobs[id]) ? id : null))
    void window.api.exporter.defaultFolder().then((folder) =>
      setOpts({
        fileName: slug(project.title),
        resolution: useLicense.getState().state?.plan === 'pro' ? 1080 : FREE_LIMITS.maxExportHeight,
        fps: 30,
        // A looping relax video never burns captions: they would come back with every loop.
        burnCaptions: !project.editor.relax && project.editor.captionStyle !== 'none',
        writeSrt: false,
        normalizeAudio: true,
        duckMusic: project.editor.duckMusic,
        folder
      })
    )
  }, [open])

  if (!project || !opts) return null
  const job: Job | null = jobId ? (jobs[jobId] ?? null) : null
  const running = isRunning(job)
  const totalMs = clips.reduce((n, c) => n + c.durationMs, 0)
  const missing = clips
    .map((c, i) => ({ c, i }))
    .filter(({ c }) => !(c.imageAssetId || (c.motionType === 'video' && c.videoAssetId)))
  const relax = project.editor.relax
  // An ambience has no narration on purpose.
  const noVoice = relax?.kind === 'ambience' ? 0 : clips.filter((c) => !c.audioAssetId).length
  const res = RESOLUTIONS.find((r) => r.id === opts.resolution)!
  const lengthSec = relax ? relaxLengthSec(relax, totalMs / 1000, pro) : totalMs / 1000
  const sizeMb = relax
    ? Math.round(relaxSizeEstimateGb(lengthSec, opts.resolution) * 1000 * (opts.fps === 60 ? 1.4 : 1))
    : Math.round((totalMs / 1000) * res.mb * (opts.fps === 60 ? 1.5 : 1))
  const sizeText = sizeMb >= 1000 ? `± ${(sizeMb / 1000).toFixed(1).replace('.', ',')} GB` : `± ${sizeMb} MB`
  const set = (p: Partial<ExportOptions>): void => setOpts({ ...opts, ...p })

  const start = async (): Promise<void> => {
    try {
      await flush()
      const j = await window.api.exporter.start(project.id, opts)
      useProject.getState().upsertJob(j)
      setJobId(j.id)
    } catch (e) {
      toast('error', errorText(e))
    }
  }

  const allToggles: { key: keyof ExportOptions; title: string; desc: string; disabled?: boolean }[] = [
    {
      key: 'burnCaptions',
      title: 'Tempel caption ke video',
      desc: project.editor.captionStyle === 'none' ? 'Gaya caption diatur ke Tanpa caption' : 'Caption jadi bagian dari gambar',
      disabled: project.editor.captionStyle === 'none'
    },
    { key: 'writeSrt', title: 'Simpan juga file subtitle (.srt)', desc: 'Untuk diunggah terpisah ke YouTube' },
    { key: 'normalizeAudio', title: 'Samakan volume suara', desc: 'Normalisasi ke −14 LUFS, standar YouTube' },
    {
      key: 'duckMusic',
      title: 'Kecilkan musik saat narasi',
      desc: project.editor.musicAssetId ? 'Musik otomatis turun ketika ada suara' : 'Belum ada musik latar',
      disabled: !project.editor.musicAssetId
    }
  ]
  // Relax videos: no burned captions (they would loop), and hours of audio get a limiter instead of loudness normalising.
  const toggles = relax ? allToggles.filter((t) => t.key !== 'burnCaptions' && t.key !== 'normalizeAudio') : allToggles

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Ekspor video"
      subtitle={`${project.title} · ${relax ? durationLabel(lengthSec) : mmss(totalMs)} · ${clips.length} klip · ${project.aspectRatio}`}
      width={640}
    >
      {job?.status === 'done' ? (
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <CheckCircle2 className="size-12 text-ok-ink" />
          <p className="text-lg font-semibold">Video selesai diekspor</p>
          <p className="break-all font-mono text-[13px] text-ink-2">{job.message}</p>
          <div className="flex gap-2.5">
            <Button icon={<FolderOpen className="size-4" />} onClick={() => job.message && void window.api.exporter.reveal(job.message)}>
              Buka folder
            </Button>
            <Button icon={<RotateCcw className="size-4" />} onClick={() => setJobId(null)}>
              Ekspor lagi
            </Button>
            <Button variant="ink" onClick={onClose}>
              Selesai
            </Button>
          </div>
        </div>
      ) : (
        <>
          {missing.length > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-sun bg-sun-soft px-3.5 py-2.5 text-[13px] text-sun-ink">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>
                Klip {missing.map(({ i }) => clipNumber(i)).join(', ')} belum punya gambar. Buat gambarnya dulu di Storyboard sebelum ekspor.
              </span>
            </div>
          )}
          {missing.length === 0 && noVoice > 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-line bg-sand px-3.5 py-2.5 text-[13px] text-ink-2">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{noVoice} klip belum punya suara narasi. Klip itu akan tampil tanpa suara dan tanpa caption.</span>
            </div>
          )}
          {relax && missing.length === 0 && (
            <div className="flex items-start gap-2.5 rounded-xl border border-line bg-sand px-3.5 py-2.5 text-[13px] text-ink-2">
              <Moon className="mt-0.5 size-4 shrink-0" />
              <span>
                {lengthSec > totalMs / 1000 + 1
                  ? `Bagian cerita (${durationLabel(totalMs / 1000)}) dirender sekali, lalu diulang mulus sampai ${durationLabel(lengthSec)}. Video panjang tetap cepat diekspor.`
                  : `Video sepanjang ceritanya, ${durationLabel(lengthSec)}.`}{' '}
                Caption tidak ditempel; simpan file .srt kalau ingin subtitle di YouTube.
                {!pro && relax.lengthSec > lengthSec && ` Versi gratis dibatasi ${durationLabel(lengthSec)}.`}
              </span>
            </div>
          )}
          <label className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Nama file</span>
            <div className="flex h-[46px] overflow-hidden rounded-xl border border-line-2">
              <input value={opts.fileName} onChange={(e) => set({ fileName: e.target.value })} className="flex-1 px-3.5 text-[15px] outline-none" />
              <span className="flex items-center border-l border-line-2 bg-sand px-3.5 font-mono text-sm text-ink-2">.mp4</span>
            </div>
          </label>
          <div className="grid grid-cols-[minmax(0,1fr)_170px] gap-3.5">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Resolusi</span>
              <div className="grid grid-cols-3 gap-1.5">
                {RESOLUTIONS.map((r) => {
                  const on = r.id === opts.resolution
                  const locked = !pro && r.id > FREE_LIMITS.maxExportHeight
                  return (
                    <button
                      key={r.id}
                      type="button"
                      aria-pressed={on}
                      title={locked ? 'Khusus Pro' : undefined}
                      onClick={() => (locked ? openUpgrade(proMessage('export-hd').slice(PRO_PREFIX.length)) : set({ resolution: r.id }))}
                      className={cx('flex h-14 flex-col items-center justify-center rounded-xl', on ? 'border-2 border-accent bg-accent-soft' : 'border border-line-2 hover:border-ink-2')}
                    >
                      <span className="flex items-center gap-1 text-[15px] font-semibold">
                        {r.label}
                        {locked && <Lock className="size-3 text-muted" />}
                      </span>
                      <span className="text-xs text-ink-2">{r.sub}</span>
                    </button>
                  )
                })}
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-semibold">Frame rate</span>
              <div className="grid grid-cols-2 gap-1.5">
                {([30, 60] as const).map((f) => (
                  <button
                    key={f}
                    type="button"
                    aria-pressed={opts.fps === f}
                    title={!pro && f > FREE_LIMITS.maxFps ? 'Khusus Pro' : undefined}
                    onClick={() => (!pro && f > FREE_LIMITS.maxFps ? openUpgrade(proMessage('export-60fps').slice(PRO_PREFIX.length)) : set({ fps: f }))}
                    className={cx(
                      'flex h-14 items-center justify-center gap-1 rounded-xl text-[15px] font-semibold',
                      opts.fps === f ? 'border-2 border-accent bg-accent-soft' : 'border border-line-2 hover:border-ink-2'
                    )}
                  >
                    {f} fps
                    {!pro && f > FREE_LIMITS.maxFps && <Lock className="size-3 text-muted" />}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {!pro && (
            <div className="flex items-start gap-2.5 rounded-xl border border-line bg-sand px-3.5 py-2.5 text-[13px] text-ink-2">
              <Lock className="mt-0.5 size-4 shrink-0" />
              <span>
                Versi gratis: maksimal {FREE_LIMITS.maxExportHeight}p, {FREE_LIMITS.maxFps} fps, dan ada watermark “{WATERMARK_TEXT}” di pojok kanan bawah.{' '}
                <button type="button" className="font-semibold text-accent-dark hover:underline" onClick={() => openUpgrade(proMessage('no-watermark').slice(PRO_PREFIX.length))}>
                  Lihat Pro
                </button>
              </span>
            </div>
          )}
          <div className="flex flex-col rounded-[14px] border border-line">
            {toggles.map((t, i) => (
              <div key={t.key} className={cx('flex items-center gap-3.5 px-3.5 py-2.5', i > 0 && 'border-t border-line', t.disabled && 'opacity-60')}>
                <div className="flex flex-1 flex-col">
                  <span className="text-sm font-semibold">{t.title}</span>
                  <span className="text-[13px] text-muted">{t.desc}</span>
                </div>
                <Switch on={!!opts[t.key] && !t.disabled} onChange={(v) => !t.disabled && set({ [t.key]: v })} label={t.title} />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-1.5">
            <span className="text-sm font-semibold">Simpan ke</span>
            <div className="flex gap-2">
              <div className={cx(inputCls, 'flex h-11 min-w-0 flex-1 items-center gap-2.5 bg-sand font-mono text-[13px]')}>
                <FolderOpen className="size-[17px] shrink-0 text-ink-2" />
                <span className="truncate">{opts.folder}</span>
              </div>
              <Button
                className="h-11"
                onClick={async () => {
                  const f = await window.api.exporter.pickFolder()
                  if (f) set({ folder: f })
                }}
              >
                Ganti folder
              </Button>
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 rounded-[14px] bg-sand px-3.5 py-3">
            <div className="flex flex-col">
              <span className="text-xs text-ink-2">Durasi</span>
              <span className={cx('text-base font-semibold', !relax && 'font-mono')}>{relax ? durationLabel(lengthSec) : mmss(totalMs)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-ink-2">Perkiraan ukuran</span>
              <span className="text-base font-semibold">{sizeText}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-xs text-ink-2">Biaya</span>
              <span className="text-base font-semibold text-ok-ink">0 kredit</span>
            </div>
          </div>
          {job && (running || job.status === 'failed') && (
            <div className="flex flex-col gap-1.5">
              <div className="flex justify-between text-[13px]">
                <span className={job.status === 'failed' ? 'text-bad-ink' : 'text-ink-2'}>
                  {job.status === 'failed' ? job.error : (job.message ?? 'Menyiapkan…')}
                </span>
                {running && <span className="font-mono">{Math.round(job.progress * 100)}%</span>}
              </div>
              {running && <Progress value={job.progress} />}
            </div>
          )}
          <div className="flex items-center gap-2.5">
            <span className="flex-1 text-[13px] text-muted">
              {running && 'Kamu boleh menutup dialog ini, ekspor tetap berjalan.'}
            </span>
            {running ? (
              <Button variant="danger" onClick={() => job && void window.api.generate.cancel(job.id)}>
                Batalkan
              </Button>
            ) : (
              <Button onClick={onClose}>Batal</Button>
            )}
            <Button variant="primary" size="lg" icon={<Download className="size-[18px]" />} loading={running} disabled={missing.length > 0} onClick={() => void start()}>
              {running ? 'Mengekspor…' : 'Mulai ekspor'}
            </Button>
          </div>
        </>
      )}
    </Modal>
  )
}
