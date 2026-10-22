import { useEffect, useState } from 'react'
import { ExternalLink } from 'lucide-react'

const CHANNEL_URL = 'https://youtube.com/bangtutorial'
const TUTORIAL_ID = '5EbWJo3VnRA'

/** Settings › Tentang aplikasi: version, the tutorial video, credits and licences. */
export function AboutSection() {
  const [version, setVersion] = useState('')
  useEffect(() => {
    void window.api.app.version().then(setVersion)
  }, [])
  const open = (url: string): void => void window.api.app.openExternal(url)

  return (
    <section className="flex flex-col gap-5 rounded-2xl border border-line bg-surface p-6 text-[15px] leading-relaxed text-ink-2">
      <div className="flex items-end justify-between gap-4">
        <div className="flex flex-col">
          <h1 className="font-display text-[34px] font-bold tracking-[-0.015em] text-ink">Story Creator</h1>
          <button
            type="button"
            onClick={() => open(CHANNEL_URL)}
            title="Buka channel YouTube Bang Tutorial"
            className="self-start text-sm font-medium text-muted underline-offset-2 hover:text-accent-dark hover:underline"
          >
            by Bang Tutorial
          </button>
        </div>
        {version && <span className="rounded-full border border-line-2 px-3 py-1 font-mono text-xs text-ink">Versi {version}</span>}
      </div>

      <div className="flex flex-col gap-2.5">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <h2 className="text-base font-semibold text-ink">Tutorial</h2>
          <span className="text-[13px] text-muted">Cara membuat video dari ide sampai ekspor dengan Story Creator</span>
        </div>
        {/* No autoplay: a play the viewer starts is what YouTube counts as a view. */}
        <div className="overflow-hidden rounded-xl border border-line-2 bg-ink">
          <iframe
            src={`https://www.youtube.com/embed/${TUTORIAL_ID}?rel=0&playsinline=1`}
            title="Tutorial Story Creator"
            className="block aspect-video w-full"
            allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen"
            allowFullScreen
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
        <button
          type="button"
          onClick={() => open(`https://youtu.be/${TUTORIAL_ID}`)}
          className="inline-flex items-center gap-1.5 self-start text-[13px] font-semibold text-accent-dark hover:underline"
        >
          Tonton di YouTube
          <ExternalLink className="size-3.5" />
        </button>
      </div>

      <p>Semua proyek, gambar, video, dan suara disimpan di komputer ini.</p>
      <p>
        Aplikasi ini menyertakan FFmpeg (lisensi GPL) untuk merender video, whisper.cpp (lisensi MIT) untuk menyamakan caption dengan suara, dan font caption
        dari Google Fonts (SIL Open Font License dan Apache 2.0). Model Whisper Small (lisensi MIT) diunduh terpisah. File lisensinya ikut terpasang di folder
        aplikasi.
      </p>
      <p>
        Logo Gemini, OpenRouter, Groq, ElevenLabs, dan Higgsfield adalah merek milik pemiliknya masing-masing, dipakai hanya untuk menandai layanan yang
        terhubung. Ikon penyedia berasal dari LobeHub Icons (lisensi MIT).
      </p>
    </section>
  )
}
