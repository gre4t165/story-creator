import type { AccentId } from '@shared/appearance'

/** The accent is a data attribute on <html>; styles.css maps it to colors (light and dark). */
export function applyAccent(accent: AccentId): void {
  if (accent === 'bata') delete document.documentElement.dataset.accent
  else document.documentElement.dataset.accent = accent
}
