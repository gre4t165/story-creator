import { useState } from 'react'
import { Check, KeyRound, Minus, Sparkles } from 'lucide-react'
import { PRO_FEATURES } from '@shared/license'
import { Badge, Button, confirmDialog, cx, inputCls } from '../components/ui'
import { errorText } from '../lib/format'
import { useApp } from '../store/app'
import { useLicense } from '../store/license'

/** Settings › Lisensi: the plan, the activation code, and what Pro adds. */
export function LicenseSection() {
  const { state, set } = useLicense()
  const { toast } = useApp()
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState<'activate' | 'deactivate' | 'refresh' | null>(null)
  if (!state) return null
  const pro = state.plan === 'pro'

  const run = async (kind: NonNullable<typeof busy>, fn: () => Promise<void>): Promise<void> => {
    setBusy(kind)
    try {
      await fn()
    } catch (e) {
      toast('error', errorText(e))
    } finally {
      setBusy(null)
    }
  }

  const activate = (): void =>
    void run('activate', async () => {
      set(await window.api.license.activate(code))
      setCode('')
      toast('success', 'Pro aktif di komputer ini. Terima kasih!')
    })

  const deactivate = async (): Promise<void> => {
    const ok = await confirmDialog({
      title: 'Nonaktifkan Pro di komputer ini?',
      body: 'Aplikasi kembali ke versi gratis di komputer ini, dan kodenya bisa dipakai di komputer lain. Kamu bisa mengaktifkannya lagi kapan saja dengan kode yang sama.',
      confirm: 'Nonaktifkan'
    })
    if (ok) void run('deactivate', async () => set(await window.api.license.deactivate()))
  }

  const date = (ms: number | null): string => (ms ? new Date(ms).toLocaleDateString('id-ID', { day: 'numeric', month: 'long', year: 'numeric' }) : '-')

  return (
    <>
      <div>
        <h1 className="font-display text-[34px] font-bold tracking-[-0.015em]">Lisensi</h1>
        <p className="mt-2 max-w-[700px] text-[15px] text-ink-2">Versi gratis sudah lengkap untuk membuat video. Pro menghilangkan batasnya.</p>
      </div>

      {!state.configured && (
        <p className="rounded-xl border border-sun bg-sun-soft px-4 py-3 text-[13px] text-sun-ink">
          Lisensi belum diatur di versi ini (kunci dan server lisensi belum diisi), jadi semua fitur terbuka dan tidak ada batas. Lihat license-server/README.md.
        </p>
      )}
      {state.configured && (
        <section className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
          <div className="flex items-center gap-3">
            <span className={cx('flex size-11 items-center justify-center rounded-xl border border-ink', pro ? 'bg-accent text-white' : 'bg-sand text-ink')}>
              {pro ? <Sparkles className="size-5" /> : <KeyRound className="size-5" />}
            </span>
            <div className="flex flex-1 flex-col">
              <span className="flex items-center gap-2 text-lg font-bold">
                {pro ? 'Story Creator Pro' : 'Versi gratis'}
                {pro && <Badge tone="ok">Aktif</Badge>}
                {state.status === 'recheck' && <Badge tone="warn">Perlu diperiksa ulang</Badge>}
              </span>
              <span className="text-[13px] text-ink-2">
                {pro
                  ? `Kode ${state.code} · diaktifkan ${date(state.activatedAt)}`
                  : state.status === 'recheck'
                    ? 'Lisensi perlu diperiksa ulang. Sambungkan ke internet, lalu klik Periksa sekarang.'
                    : 'Ekspor 720p dengan watermark, maksimal 3 proyek.'}
              </span>
            </div>
            {!pro && state.buyUrl && (
              <Button variant="primary" icon={<Sparkles className="size-4" />} onClick={() => void window.api.app.openExternal(state.buyUrl)}>
                Beli Pro
              </Button>
            )}
          </div>

          {(pro || state.status === 'recheck') && state.code ? (
            <div className="flex flex-col gap-2 border-t border-dashed border-line pt-4">
              <p className="text-[13px] text-ink-2">
                {state.status === 'recheck'
                  ? 'Pro berhenti sementara sampai aplikasi bisa memeriksa lisensinya.'
                  : `Lisensi diperiksa ulang otomatis sekitar ${date(state.nextCheckAt)}, dan tetap jalan tanpa internet di antara itu.`}
              </p>
              <div className="flex flex-wrap gap-2">
                <Button size="sm" loading={busy === 'refresh'} onClick={() => void run('refresh', async () => set(await window.api.license.refresh()))}>
                  Periksa sekarang
                </Button>
                <Button size="sm" variant="ghost" loading={busy === 'deactivate'} onClick={() => void deactivate()}>
                  Nonaktifkan di komputer ini
                </Button>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-2 border-t border-dashed border-line pt-4">
              <label className="text-sm font-semibold" htmlFor="kode-aktivasi">
                Kode aktivasi
              </label>
              <div className="flex gap-2">
                <input
                  id="kode-aktivasi"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && code.trim() && activate()}
                  placeholder="Tempel kode dari email atau halaman pembelian"
                  autoComplete="off"
                  spellCheck={false}
                  className={cx(inputCls, 'h-11 font-mono text-sm')}
                />
                <Button className="h-11 shrink-0" variant="primary" loading={busy === 'activate'} disabled={!code.trim() || !state.configured} onClick={activate}>
                  Aktifkan
                </Button>
              </div>
              <span className="text-[13px] text-muted">
                {state.configured
                  ? 'Kode dikirim otomatis setelah pembayaran. Satu kode bisa dipakai di 2 komputer. Saat aktivasi, yang dikirim ke server lisensi hanya kode, ID komputer (hash, bukan data pribadi), dan nama komputer.'
                  : 'Pembelian dan aktivasi belum tersedia di versi aplikasi ini.'}
              </span>
            </div>
          )}
          <span className="font-mono text-xs text-muted">ID komputer: {state.deviceId}</span>
        </section>
      )}

      <section className="overflow-hidden rounded-2xl border border-line bg-surface">
        <div className="grid grid-cols-[1.2fr_1fr_1.3fr] gap-3 border-b border-line bg-sand px-5 py-2.5 text-[13px] font-semibold">
          <span />
          <span>Gratis</span>
          <span>Pro</span>
        </div>
        {PRO_FEATURES.map((f, i) => (
          <div key={f.id} className={cx('grid grid-cols-[1.2fr_1fr_1.3fr] items-center gap-3 px-5 py-3 text-sm', i > 0 && 'border-t border-line')}>
            <span className="font-semibold">{f.label}</span>
            <span className="flex items-center gap-1.5 text-muted">
              <Minus className="size-3.5 shrink-0" />
              {f.free}
            </span>
            <span className="flex items-center gap-1.5 font-medium text-ok-ink">
              <Check className="size-3.5 shrink-0" strokeWidth={3} />
              {f.pro}
            </span>
          </div>
        ))}
      </section>
    </>
  )
}
