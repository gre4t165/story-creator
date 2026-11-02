import { Check, KeyRound, Sparkles } from 'lucide-react'
import { PRO_FEATURES } from '@shared/license'
import { useApp } from '../store/app'
import { useLicense } from '../store/license'
import { Button, Modal } from './ui'

/** Opened when something needs Pro: says what, what Pro adds, and where to buy or enter a code. */
export function UpgradeDialog() {
  const upgrade = useApp((s) => s.upgrade)
  const close = useApp((s) => s.closeUpgrade)
  const go = useApp((s) => s.go)
  const route = useApp((s) => s.route)
  const state = useLicense((s) => s.state)

  const toSettings = (): void => {
    close()
    go({ name: 'settings', tab: 'license', back: route.name === 'settings' ? (route.back ?? { name: 'home' }) : route })
  }

  return (
    <Modal open={!!upgrade} onClose={close} title="Fitur Pro" subtitle={upgrade?.message} width={560}>
      <div className="flex flex-col gap-1 rounded-[14px] border border-line">
        {PRO_FEATURES.map((f, i) => (
          <div key={f.id} className={`grid grid-cols-[1.1fr_1fr_1.2fr] items-center gap-3 px-3.5 py-2 text-[13px] ${i > 0 ? 'border-t border-line' : ''}`}>
            <span className="font-semibold">{f.label}</span>
            <span className="text-muted">{f.free}</span>
            <span className="flex items-center gap-1.5 font-medium text-ok-ink">
              <Check className="size-3.5 shrink-0" strokeWidth={3} />
              {f.pro}
            </span>
          </div>
        ))}
      </div>
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        <Button icon={<KeyRound className="size-4" />} onClick={toSettings}>
          Punya kode aktivasi
        </Button>
        <Button
          variant="primary"
          icon={<Sparkles className="size-4" />}
          disabled={!state?.buyUrl}
          title={state?.buyUrl ? undefined : 'Tautan pembelian belum diatur di versi aplikasi ini'}
          onClick={() => {
            if (state?.buyUrl) void window.api.app.openExternal(state.buyUrl)
          }}
        >
          Beli Pro
        </Button>
      </div>
    </Modal>
  )
}
