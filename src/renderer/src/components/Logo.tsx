import logoUrl from '../assets/logo.svg'

/**
 * The Story Creator mark: a story (speech bubble) that plays as a video (play button), with a spark for the
 * creating. assets/logo.svg is also what scripts/make-icon.cjs turns into the installer and taskbar icon, so the
 * app and its icon never drift apart. Brand colors stay fixed whatever accent the user picks.
 */
export function LogoMark({ size = 34 }: { size?: number }) {
  return <img src={logoUrl} width={size} height={size} alt="" draggable={false} className="shrink-0" />
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5">
      <LogoMark />
      <span className="flex flex-col leading-none">
        <span className="font-display text-[21px] font-bold tracking-[-0.01em]">Story Creator</span>
        <span className="mt-[3px] self-end text-[10.5px] font-medium text-muted">cc by Bang Story</span>
      </span>
    </span>
  )
}
