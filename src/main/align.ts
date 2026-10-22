import type { WordTiming } from '@shared/types'

/**
 * Puts real times on the script's own words using what Whisper heard. The script is the truth for the
 * text (captions keep its spelling); Whisper only tells when each word was said. Words are matched with
 * an edit-distance alignment that tolerates mishearings ("Gajamata" for "Gajah Mada") and numbers
 * written differently; words Whisper missed get times spread over the gap around them.
 */

export interface Heard {
  text: string
  start: number
  end: number
}

const norm = (w: string): string =>
  w
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '')

function similarity(a: string, b: string): number {
  if (!a || !b) return 0
  if (a === b) return 1
  if (a.length >= 3 && b.length >= 3 && (a.startsWith(b) || b.startsWith(a))) return 0.8
  const m = a.length
  const n = b.length
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    prev = cur
  }
  return 1 - prev[n] / Math.max(m, n)
}

/** Splits Whisper segments into single words (with -ml 1 most already are), sharing a segment's time by length. */
export function splitHeard(segments: Heard[]): Heard[] {
  const out: Heard[] = []
  for (const s of segments) {
    const words = s.text.split(/\s+/).filter((w) => norm(w))
    if (!words.length) continue
    const total = words.reduce((n, w) => n + w.length, 0)
    let t = s.start
    for (const w of words) {
      const d = ((s.end - s.start) * w.length) / total
      out.push({ text: w, start: t, end: t + d })
      t += d
    }
  }
  return out
}

export function alignWords(script: string[], heard: Heard[], total: number): WordTiming[] {
  const n = script.length
  const m = heard.length
  if (!n) return []
  const a = script.map(norm)
  const b = heard.map((h) => norm(h.text))
  const GAP = 1
  const cost = (i: number, j: number): number => {
    const s = similarity(a[i], b[j])
    return s >= 0.99 ? 0 : s >= 0.6 ? 0.5 : 1.3
  }

  // Edit-distance table over script (rows) and heard (columns).
  const d: Float64Array[] = Array.from({ length: n + 1 }, () => new Float64Array(m + 1))
  for (let i = 1; i <= n; i++) d[i][0] = i * GAP
  for (let j = 1; j <= m; j++) d[0][j] = j * GAP
  for (let i = 1; i <= n; i++)
    for (let j = 1; j <= m; j++) d[i][j] = Math.min(d[i - 1][j - 1] + cost(i - 1, j - 1), d[i - 1][j] + GAP, d[i][j - 1] + GAP)

  const pair = new Array<number>(n).fill(-1)
  let i = n
  let j = m
  while (i > 0 && j > 0) {
    if (d[i][j] === d[i - 1][j - 1] + cost(i - 1, j - 1)) {
      pair[i - 1] = j - 1
      i--
      j--
    } else if (d[i][j] === d[i - 1][j] + GAP) i--
    else j--
  }

  const out: WordTiming[] = script.map((text, k) => (pair[k] >= 0 ? { text, start: heard[pair[k]].start, end: heard[pair[k]].end } : { text, start: -1, end: -1 }))
  // A weak match is likely one heard word standing for several script words ("1336" for "thirteen thirty six").
  const weak = script.map((_, k) => pair[k] >= 0 && similarity(a[k], b[pair[k]]) < 0.99)

  // Words without a match share the time between their matched neighbours, by length.
  let k = 0
  while (k < n) {
    if (out[k].start >= 0) {
      k++
      continue
    }
    const from = k
    while (k < n && out[k].start < 0) k++
    const before = from > 0 ? out[from - 1] : null
    const after = k < n ? out[k] : null
    let start = before ? before.end : 0
    let end = after ? after.start : total
    const run = out.slice(from, k)
    // No room between neighbours: share a neighbour's own span instead, a weak match first.
    if (end - start < 0.08 * run.length) {
      if (after && weak[k]) {
        end = after.end
        run.push(after)
      } else if (before) {
        start = before.start
        run.unshift(before)
      }
    }
    end = Math.max(end, start + 0.08 * run.length)
    const weight = run.map((w) => Math.max(2, norm(w.text).length))
    const sum = weight.reduce((x, y) => x + y, 0)
    let t = start
    run.forEach((w, x) => {
      const dur = ((end - start) * weight[x]) / sum
      w.start = t
      w.end = t + dur
      t += dur
    })
  }
  // Whisper sometimes gives a word no length (often the last one); let it run until the next word starts.
  out.forEach((w, x) => {
    if (w.end - w.start >= 0.08) return
    const limit = x + 1 < n ? out[x + 1].start : Math.max(total, w.end)
    w.end = Math.max(w.end, Math.min(limit, w.start + 0.3))
  })
  return out
}
