import type { ReactNode } from 'react'
import { EyeOff, Shirt, ShieldCheck } from 'lucide-react'
import { normalizeRules, type ContentRules } from '@shared/content'
import type { AppSettings, KeyStatus } from '@shared/types'
import { Badge, Segmented, Switch } from '../components/ui'

function Row({ icon, title, body, on, onChange, children }: { icon: ReactNode; title: string; body: ReactNode; on: boolean; onChange: (v: boolean) => void; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 border-t border-line pt-4 first:border-t-0 first:pt-0">
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-[10px] border border-line-2 bg-paper text-ink">{icon}</span>
        <div className="flex flex-1 flex-col gap-0.5">
          <span className="text-base font-bold">{title}</span>
          <span className="text-[13px] leading-relaxed text-ink-2">{body}</span>
        </div>
        <Switch on={on} onChange={onChange} label={title} />
      </div>
      {on && children && <div className="ml-[52px] flex flex-col gap-3">{children}</div>}
    </div>
  )
}

/** Rules every picture and AI video follows: hidden, censored faces and modest clothing for women. */
export function ContentSection({ settings, gemini, onSettings }: { settings: AppSettings; gemini?: KeyStatus; onSettings: (s: AppSettings) => void }) {
  const r = normalizeRules(settings.contentRules)
  const set = async (patch: Partial<ContentRules>): Promise<void> => onSettings(await window.api.settings.set({ contentRules: { ...r, ...patch } }))
  const geminiReady = !!gemini?.configured && !gemini.unreadable

  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface px-5 py-[18px]">
      <Row
        icon={<EyeOff className="size-5" />}
        title="Wajah tidak ditampakkan"
        body="Berlaku untuk manusia dan hewan. Prompt meminta tokoh digambar dari belakang, sebagai siluet, atau wajahnya tertutup. Setelah gambar atau video AI jadi, Gemini memeriksanya, lalu wajah yang masih terlihat disensor otomatis."
        on={r.hideFaces}
        onChange={(v) => void set({ hideFaces: v })}
      >
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-sm font-semibold">Cara menyensor</span>
          <Segmented
            size="sm"
            value={r.censorStyle}
            onChange={(v) => void set({ censorStyle: v })}
            options={[
              { id: 'blur', label: 'Blur' },
              { id: 'mosaic', label: 'Mozaik' }
            ]}
          />
        </div>
        {geminiReady ? (
          <span className="flex items-center gap-2 text-[13px] text-ok-ink">
            <ShieldCheck className="size-4" />
            Pemeriksaan wajah memakai kunci Gemini yang sudah kamu isi (tier gratis cukup).
          </span>
        ) : (
          <span className="flex flex-wrap items-center gap-2 text-[13px] text-bad-ink">
            <Badge tone="bad">Butuh kunci Gemini</Badge>
            Isi kunci Google Gemini di bagian Layanan AI. Tanpa itu, gambar baru tertahan sampai bisa diperiksa.
          </span>
        )}
      </Row>
      <Row
        icon={<Shirt className="size-5" />}
        title="Pakaian sopan untuk wanita"
        body="Setiap wanita dan anak perempuan, termasuk figuran, memakai pakaian longgar yang menutup lengan sampai pergelangan dan kaki sampai mata kaki. Berlaku juga untuk adegan sejarah, olahraga, pantai, dan pesta."
        on={r.modestWomen}
        onChange={(v) => void set({ modestWomen: v })}
      >
        <label className="flex items-center gap-3 text-sm">
          <Switch on={r.hijab} onChange={(v) => void set({ hijab: v })} label="Wanita memakai hijab" />
          <span className="font-semibold">Wanita memakai hijab</span>
        </label>
      </Row>
      <p className="rounded-xl bg-sand px-3.5 py-2.5 text-[13px] text-ink-2">
        Aturan ini berlaku untuk gambar, lembar karakter, dan video AI yang dibuat setelah ini. Gambar yang sudah ada tidak berubah; buat ulang gambarnya
        kalau ingin ikut aturan baru. Naskah visual (storyboard) yang ditulis setelah ini juga sudah menghindari wajah dan memakai pakaian sopan.
      </p>
    </section>
  )
}
