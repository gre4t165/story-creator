import { useEffect, useRef, useState } from 'react'
import { Bot, Lock, Play, Sparkles, Square } from 'lucide-react'
import { getFreeImageModel } from '@shared/freemodels'
import { getImageModel } from '@shared/higgsfield'
import { FREE_LIMITS } from '@shared/license'
import { DURATIONS, LANGUAGES, clipCountFor, defaultEdgeVoice, defaultVoiceFor, llmName } from '@shared/models'
import { RELAX_KINDS, RELAX_LENGTHS, RELAX_STORY_DURATIONS, newRelaxSettings, relaxClipCount } from '@shared/relax'
import { getStyle } from '@shared/styles'
import type { KeyStatus, LlmProvider, RelaxKind, TtsProvider, VoiceOption } from '@shared/types'
import { Select } from '../../components/Select'
import { StylePicker } from '../../components/StylePicker'
import { Button, Chip, Field, Segmented, confirmDialog, cx } from '../../components/ui'
import { errorText } from '../../lib/format'
import { geminiPreview } from '../../lib/voicePreviews'
import { TTS_NAMES, TTS_ORDER, ttsReadiness, usableImageModel, usableTts } from '../../lib/keys'
import { useApp } from '../../store/app'
import { useIsPro, useLicense } from '../../store/license'
import { useProject } from '../../store/project'
import { ModelSection } from './ModelSection'

/** One sample plays at a time, from the list rows or the button beside the picker. */
function usePreviewPlayer(): { playing: string | null; toggle: (id: string, url: string) => void } {
  const audio = useRef<HTMLAudioElement | null>(null)
  const [playing, setPlaying] = useState<string | null>(null)
  useEffect(() => () => audio.current?.pause(), [])
  return {
    playing,
    toggle: (id, url) => {
      audio.current?.pause()
      if (playing === id) return setPlaying(null)
      const a = new Audio(url)
      a.onended = () => setPlaying(null)
      audio.current = a
      setPlaying(id)
      void a.play().catch(() => setPlaying(null))
    }
  }
}

function VoicePicker({ provider, language, value, onChange }: { provider: TtsProvider; language: string; value: string; onChange: (v: string) => void }) {
  const [voices, setVoices] = useState<VoiceOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const player = usePreviewPlayer()

  useEffect(() => {
    setVoices(null)
    setError(null)
    window.api.settings
      .voices(provider, language)
      .then((list) => {
        // Gemini samples ship with the app; ElevenLabs sends its own preview links.
        const v = provider === 'gemini' ? list.map((x) => ({ ...x, previewUrl: x.previewUrl ?? geminiPreview(x.id, x.name) })) : list
        setVoices(v)
        if (!v.some((x) => x.id === value) && v[0]) onChange(v[0].id)
      })
      .catch((e) => setError(errorText(e)))
  }, [provider, language])

  const urlOf = (id: string): string | null => voices?.find((v) => v.id === id)?.previewUrl ?? null
  const current = voices?.find((v) => v.id === value)

  const playButton = (id: string, size: 'row' | 'field') => {
    const url = urlOf(id)
    if (!url) return null
    const on = player.playing === id
    return (
      <button
        type="button"
        aria-label={on ? 'Hentikan contoh suara' : 'Dengarkan contoh suara'}
        title={on ? 'Hentikan' : 'Dengarkan contoh'}
        onClick={() => player.toggle(id, url)}
        className={cx(
          'flex shrink-0 items-center justify-center rounded-full border transition-colors',
          size === 'row' ? 'size-7' : 'size-12 rounded-xl',
          on ? 'border-accent bg-accent text-white' : 'border-line-2 bg-surface text-ink hover:border-ink-2'
        )}
      >
        {on ? <Square className="size-3.5" fill="currentColor" /> : <Play className="ml-px size-3.5" fill="currentColor" />}
      </button>
    )
  }

  if (error) return <p className="flex h-12 flex-1 items-center rounded-xl bg-bad-soft px-3.5 text-[13px] text-bad-ink">{error}</p>
  return (
    <>
      <Select
        label="Suara narator"
        size="lg"
        value={value}
        onChange={onChange}
        disabled={!voices}
        className="flex-1"
        menuWidth={380}
        renderAction={(o) => playButton(o.value, 'row')}
        options={
          voices
            ? voices.map((v) =>
                // Gemini tones and Edge's "gender · locale" are short; ElevenLabs labels are longer, so they go on a second line.
                provider === 'elevenlabs' || provider === 'local' ? { value: v.id, label: v.name, note: v.description || undefined } : { value: v.id, label: v.name, hint: v.description || undefined }
              )
            : [{ value, label: 'Memuat daftar suara…' }]
        }
      />
      {current && playButton(current.id, 'field')}
    </>
  )
}

/** What each kind of video asks for in the idea box. */
const IDEA_COPY: Record<RelaxKind | 'story', { label: string; placeholder: string; tip: string; duration: string }> = {
  story: {
    label: 'Ide cerita atau sinopsis',
    placeholder: 'Tahun 1336 di istana Majapahit. Gajah Mada bersumpah tidak akan menikmati palapa sebelum Nusantara bersatu…',
    tip: 'Tips: tulis juga suasana yang kamu mau, misalnya tegang, lucu, atau haru.',
    duration: 'Durasi video'
  },
  sleep: {
    label: 'Ide cerita pengantar tidur',
    placeholder: 'Perjalanan pelan menyusuri desa di kaki gunung saat hujan sore, singgah di warung teh, lalu pulang ke rumah kayu yang hangat…',
    tip: 'Tips: pilih tempat yang damai dan perjalanan yang pelan. Tanpa konflik, tanpa kejutan.',
    duration: 'Panjang cerita'
  },
  meditation: {
    label: 'Tema meditasi',
    placeholder: 'Meditasi sebelum tidur: napas perlahan, relaksasi tubuh dari kepala sampai kaki, lalu membayangkan pantai sepi saat senja…',
    tip: 'Tips: sebut tujuannya (tidur, cemas, fokus) dan tempat yang ingin dibayangkan.',
    duration: 'Panjang meditasi'
  },
  ambience: {
    label: 'Tempat dan suasana',
    placeholder: 'Pondok kayu di tengah hutan pinus saat hujan malam: jendela berembun, perapian menyala, teras basah, lampu temaram…',
    tip: 'Tips: satu tempat dengan beberapa sudut pandang. Suaranya dipilih di editor, bagian Suasana.',
    duration: 'Jumlah pemandangan'
  }
}

export function IdeaStep() {
  const { project, clips, updateProject, updateEditor, batch, flush, load, record } = useProject()
  const pro = useIsPro()
  const { toast, go } = useApp()
  const [busy, setBusy] = useState(false)
  const [writer, setWriter] = useState<{ provider: LlmProvider; model: string } | null>(null)
  const [keys, setKeys] = useState<KeyStatus[]>([])

  useEffect(() => {
    void window.api.settings.get().then((s) => setWriter({ provider: s.llmProvider, model: s.llmModels[s.llmProvider] }))
    void window.api.settings.keys().then(setKeys)
  }, [])

  // Before any narration exists, move to a narrator service that has a working key.
  const hasVoice = clips.some((c) => c.audioAssetId)
  useEffect(() => {
    if (!project || !keys.length || hasVoice) return
    const use = usableTts(project.ttsProvider, keys)
    if (use !== project.ttsProvider) updateProject({ ttsProvider: use, ttsVoice: defaultVoiceFor(use, project.language) })
  }, [keys, project?.id])

  // Before any picture exists, start on an image model whose service has a working key.
  const hasImage = clips.some((c) => c.imageAssetId)
  useEffect(() => {
    if (!project || !keys.length || hasImage) return
    const use = usableImageModel(project.imageModel, keys)
    if (use !== project.imageModel) updateProject({ imageModel: use })
  }, [keys, project?.id])

  if (!project) return null
  const ready = ttsReadiness(keys)
  const blocked = keys.length ? TTS_ORDER.filter((p) => !ready[p].ok) : []
  const openSettings = async (): Promise<void> => {
    await flush()
    go({ name: 'settings', back: { name: 'project', id: project.id } })
  }

  const relax = project.editor.relax
  const copy = IDEA_COPY[relax?.kind ?? 'story']
  const durations = relax ? RELAX_STORY_DURATIONS[relax.kind] : DURATIONS
  const clipCount = relax ? relaxClipCount(relax.kind, project.durationSec) : clipCountFor(project.durationSec)
  const perClip = Math.round(project.durationSec / clipCount)

  /** Story or one of the relax kinds; one undo step for the kind, its story length and the caption style. */
  const setKind = (kind: RelaxKind | 'story'): void => {
    if (kind === (relax?.kind ?? 'story')) return
    const list = kind === 'story' ? DURATIONS : RELAX_STORY_DURATIONS[kind]
    const durationSec = list.some((d) => d.sec === project.durationSec) ? project.durationSec : list[Math.min(1, list.length - 1)].sec
    batch('Jenis video', () => {
      if (kind === 'story') {
        updateEditor({ relax: undefined, captionStyle: project.editor.captionStyle === 'none' ? 'karaoke' : project.editor.captionStyle })
      } else {
        // Sleep videos have no captions on screen; the subtitle file can still be exported for YouTube.
        updateEditor({ relax: relax ? { ...relax, kind } : newRelaxSettings(kind), captionStyle: 'none' })
      }
      updateProject({ durationSec })
    })
  }

  const pickLength = async (sec: number): Promise<void> => {
    if (!relax) return
    if (sec > FREE_LIMITS.maxRelaxSec && !(await useLicense.getState().ensure('relax-long'))) return
    updateEditor({ relax: { ...relax, lengthSec: sec } })
  }
  const model = getFreeImageModel(project.imageModel) ?? getImageModel(project.imageModel)

  const compose = async (): Promise<void> => {
    if (!project.synopsis.trim()) {
      toast('error', 'Tulis ide cerita atau sinopsis dulu.')
      return
    }
    if (clips.length) {
      const ok = await confirmDialog({
        title: 'Susun ulang naskah?',
        body: `Proyek ini sudah punya ${clips.length} adegan. Menyusun ulang akan mengganti semua adegan beserta naskahnya. Pemeran tetap ada, sedangkan gambar dan suara lama tersimpan di riwayat tapi tidak lagi terpasang.`,
        confirm: 'Susun ulang'
      })
      if (!ok) return
    }
    setBusy(true)
    try {
      await flush()
      const bundle = await record('Susun naskah', async () => {
        const b = await window.api.story.script(project.id)
        load(b)
        return b
      })
      toast('success', `${bundle.clips.length} adegan siap. Baca dan rapikan naskahnya dulu.`)
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="relative h-full">
      <div className="scroll-thin h-full overflow-y-auto pb-28">
        <div className="mx-auto grid max-w-[1400px] grid-cols-[minmax(0,1fr)_540px] gap-10 px-14 pt-8">
          <div className="flex flex-col gap-[22px]">
            <div>
              <p className="text-[13px] font-semibold text-accent">Langkah 1 dari 4</p>
              <h1 className="mt-1.5 font-display text-[40px] font-bold leading-tight tracking-[-0.02em]">Ceritakan idemu</h1>
              <p className="mt-2 text-[15px] text-ink-2">
                Sebut tokoh, tempat, dan akhir ceritanya. Makin jelas, makin rapi susunan klip dari AI.
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Jenis video</span>
              <Segmented
                value={relax?.kind ?? 'story'}
                onChange={setKind}
                className="self-start"
                options={[{ id: 'story' as const, label: 'Cerita' }, ...RELAX_KINDS.map((k) => ({ id: k.id, label: k.label, title: k.hint }))]}
              />
              {relax && <span className="text-[13px] text-muted">{RELAX_KINDS.find((k) => k.id === relax.kind)?.hint} Video bisa sampai 10 jam: gambarnya diulang mulus di bawah suara suasana.</span>}
            </div>

            <div className="flex flex-col gap-2 rounded-2xl border-[1.5px] border-ink bg-surface px-[18px] pb-3 pt-4 shadow-ink-md">
              <label htmlFor="sinopsis" className="text-[13px] font-semibold text-ink-2">
                {copy.label}
              </label>
              <textarea
                id="sinopsis"
                rows={5}
                value={project.synopsis}
                maxLength={4000}
                onChange={(e) => updateProject({ synopsis: e.target.value })}
                placeholder={copy.placeholder}
                className="resize-none bg-transparent text-base leading-relaxed outline-none placeholder:text-muted/70"
              />
              <div className="flex items-center justify-between text-xs text-muted">
                <span>{copy.tip}</span>
                <span className="font-mono">{project.synopsis.length.toLocaleString('id-ID')} / 4.000</span>
              </div>
            </div>

            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">{copy.duration}</span>
              <div className="flex flex-wrap gap-2">
                {durations.map((d) => (
                  <Chip key={d.sec} on={project.durationSec === d.sec} onClick={() => updateProject({ durationSec: d.sec })} className="h-10 px-4">
                    {d.label}
                  </Chip>
                ))}
              </div>
              <span className="text-[13px] text-muted">
                {relax?.kind === 'ambience'
                  ? `${clipCount} pemandangan, masing-masing ${perClip} detik, lalu diulang.`
                  : `Sekitar ${clipCount} klip, masing-masing kurang lebih ${perClip} detik. Durasi akhir mengikuti panjang suara narasi.`}
              </span>
            </div>

            {relax && (
              <div className="flex flex-col gap-2">
                <span className="text-sm font-semibold">Panjang video akhir</span>
                <div className="flex flex-wrap gap-2">
                  {RELAX_LENGTHS.map((l) => (
                    <Chip key={l.sec} on={relax.lengthSec === l.sec} onClick={() => void pickLength(l.sec)} className="h-10 px-4">
                      {!pro && l.sec > FREE_LIMITS.maxRelaxSec && <Lock className="size-3.5" />}
                      {l.label}
                    </Chip>
                  ))}
                </div>
                <span className="text-[13px] text-muted">
                  Setelah {relax.kind === 'ambience' ? 'semua pemandangan tampil' : 'cerita selesai'}, gambar diulang mulus sampai panjang ini. Bisa diubah lagi di editor.
                  {!pro && ` Versi gratis sampai 10 menit.`}
                </span>
              </div>
            )}

            <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-5">
              <Field label="Bahasa naskah dan suara">
                <Select
                  label="Bahasa naskah dan suara"
                  size="lg"
                  value={project.language}
                  onChange={(v) => updateProject({ language: v, ...(project.ttsProvider === 'edge' ? { ttsVoice: defaultEdgeVoice(v) } : {}) })}
                  options={LANGUAGES.map((l) => ({ value: l.code, label: l.label }))}
                />
              </Field>
              <div className="flex flex-col gap-1.5">
                <span className="text-sm font-semibold">Format</span>
                <div className="grid grid-cols-2 gap-2">
                  {(
                    [
                      { id: '16:9', label: '16:9', sub: 'YouTube', w: 26, h: 15 },
                      { id: '9:16', label: '9:16', sub: 'Shorts, Reels, TikTok', w: 13, h: 22 }
                    ] as const
                  ).map((f) => {
                    const on = project.aspectRatio === f.id
                    return (
                      <button
                        key={f.id}
                        type="button"
                        aria-pressed={on}
                        onClick={() => updateProject({ aspectRatio: f.id })}
                        className={cx(
                          'flex h-12 items-center gap-2.5 rounded-xl px-3 text-left',
                          on ? 'border-2 border-accent bg-accent-soft' : 'border border-line-2 bg-surface hover:border-ink-2'
                        )}
                      >
                        <span className="flex w-[26px] justify-center">
                          <span className="rounded-[3px] border-[1.8px] border-ink" style={{ width: f.w, height: f.h }} />
                        </span>
                        <span className="flex flex-col leading-tight">
                          <span className="text-sm font-semibold">{f.label}</span>
                          <span className="text-xs text-ink-2">{f.sub}</span>
                        </span>
                      </button>
                    )
                  })}
                </div>
              </div>
            </div>

            {relax?.kind !== 'ambience' && (
            <div className="flex flex-col gap-2">
              <span className="text-sm font-semibold">Suara narator</span>
              {relax && (
                <div className="flex flex-wrap items-center gap-2">
                  <Segmented
                    size="sm"
                    value={relax.voice}
                    onChange={(v) => updateEditor({ relax: { ...relax, voice: v } })}
                    options={[
                      { id: 'calm' as const, label: 'Tenang dan pelan' },
                      { id: 'whisper' as const, label: 'Berbisik (ASMR)' }
                    ]}
                  />
                  <span className="text-[13px] text-muted">
                    {relax.voice === 'whisper'
                      ? 'Bisikan paling meyakinkan di ElevenLabs (model v3) dan Gemini. Edge hanya dipelankan; Voicebox memakai gaya suaranya sendiri.'
                      : 'Narator dipelankan dan diberi jeda panjang di semua layanan, kecuali Voicebox yang memakai gaya suaranya sendiri.'}
                  </span>
                </div>
              )}
              <div className="flex items-center gap-2">
                <Segmented
                  value={project.ttsProvider}
                  onChange={(v) => updateProject({ ttsProvider: v, ttsVoice: defaultVoiceFor(v, project.language) })}
                  options={TTS_ORDER.map((p) => ({
                    id: p,
                    label: TTS_NAMES[p],
                    disabled: blocked.includes(p),
                    title: ready[p].reason ?? undefined
                  }))}
                />
                <VoicePicker provider={project.ttsProvider} language={project.language} value={project.ttsVoice} onChange={(v) => updateProject({ ttsVoice: v })} />
              </div>
              {blocked.length > 0 && (
                <span className="text-[13px] text-muted">
                  {blocked.map((p) => `${ready[p].reason} (${TTS_NAMES[p]})`).join('. ')}. Edge (gratis) tetap bisa dipakai tanpa kunci.{' '}
                  <button type="button" onClick={() => void openSettings()} className="font-semibold text-accent-dark hover:underline">
                    Atur di Pengaturan
                  </button>
                </span>
              )}
              {project.ttsProvider === 'local' && (
                <span className="text-[13px] text-muted">
                  Suara dibuat oleh Voicebox atau voice studio di komputer kamu, gratis dan offline. Buka aplikasinya dulu; alamat servernya diatur di
                  Pengaturan (bawaan http://127.0.0.1:17493). Waktu caption diperkirakan lalu dirapikan Whisper kalau modelnya sudah diunduh.
                </span>
              )}
              {project.ttsProvider === 'edge' && (
                <span className="text-[13px] text-muted">
                  Suara Edge gratis dan tanpa kunci, dengan waktu per kata yang presisi untuk caption. Layanannya tidak resmi dari Microsoft, jadi sesekali bisa
                  gagal. Kalau begitu, pindah ke Gemini atau ElevenLabs.
                </span>
              )}
            </div>
            )}

            <ModelSection
              project={project}
              clipCount={clipCount}
              perClip={perClip}
              onChange={(patch) => {
                updateProject(patch)
                // New projects start with the models picked last; resolution stays with this project.
                if (!('videoResolution' in patch)) void window.api.settings.set(patch)
              }}
            />
          </div>

          <aside className="flex flex-col gap-3.5 self-start rounded-[18px] border border-line bg-surface p-5">
            <div className="flex items-baseline justify-between">
              <h2 className="font-display text-[22px] font-bold">Gaya visual</h2>
              <span className="text-[13px] text-muted">{getStyle(project.styleId).name}</span>
            </div>
            <p className="-mt-1.5 text-[13px] text-ink-2">Dipakai untuk semua gambar di proyek ini, termasuk lembar karakter.</p>
            <StylePicker value={project.styleId} onChange={(id) => updateProject({ styleId: id })} />
          </aside>
        </div>
      </div>

      <footer className="absolute inset-x-0 bottom-0 flex h-[84px] items-center gap-4 border-t border-line bg-surface px-14">
        <div className="flex flex-col gap-0.5">
          <span className="text-[15px] font-semibold">
            ± {clipCount} adegan · gambar {model.name}
          </span>
          <span className="flex items-center gap-1.5 text-[13px] text-muted">
            <Bot className="size-3.5" />
            Disusun oleh {writer ? `${llmName(writer.provider)} · ` : ''}
            <span className={cx('font-mono', writer && !writer.model && 'text-accent-dark')}>{writer ? writer.model || 'model belum dipilih' : '…'}</span>
            <button type="button" onClick={() => void openSettings()} className="font-semibold text-accent-dark hover:underline">
              Ganti
            </button>
          </span>
        </div>
        <div className="flex-1" />
        {clips.length > 0 && !busy && (
          <Button size="lg" onClick={() => updateProject({ step: 2 })}>
            Lihat naskah
          </Button>
        )}
        <Button variant="primary" size="lg" className="h-[50px]" loading={busy} icon={!busy && <Sparkles className="size-[18px]" />} onClick={() => void compose()}>
          {clips.length ? 'Susun ulang naskah' : 'Susun naskah'}
        </Button>
      </footer>
    </div>
  )
}
