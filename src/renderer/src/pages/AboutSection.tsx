import { useEffect, useState } from 'react'

const CHANNEL_URL = 'https://youtube.com/bangtutorial'

/** Settings › Tentang aplikasi: version, credits and licences. */
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
            cc by Bang Story
          </button>
        </div>
        {version && <span className="rounded-full border border-line-2 px-3 py-1 font-mono text-xs text-ink">Versi {version}</span>}
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
