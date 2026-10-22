/**
 * Where to cut a take of `weights.length` scenes. Each cut should land in a pause (longer is better, since
 * scenes are separated by <long pause>) close to where the scene is expected to end: from Whisper word
 * timings when `known`, else from the scene's share of the text. Solved over all cuts at once so they stay
 * in order; every cut also has its expected spot as a fallback.
 */
export function chooseCuts(total: number, weights: number[], silences: { start: number; end: number }[], known?: number[]): number[] {
  const n = weights.length
  if (n < 2) return []
  const sum = weights.reduce((a, b) => a + b, 0) || n
  // Where each cut should be: from word timings when known, else from each scene's share of the text.
  const expected: number[] = []
  if (known && known.length === n - 1) expected.push(...known)
  else {
    let acc = 0
    for (let k = 0; k < n - 1; k++) {
      acc += weights[k] || 1
      expected.push((total * acc) / sum)
    }
  }
  const avg = total / n
  const minGap = Math.min(0.8, avg * 0.3)
  const cands = [
    ...silences.filter((s) => s.start > 0.05 && s.end < total - 0.05).map((s) => ({ t: (s.start + s.end) / 2, dur: s.end - s.start })),
    ...expected.map((t) => ({ t, dur: 0 }))
  ].sort((a, b) => a.t - b.t)
  const m = cands.length
  const score = (k: number, j: number): number => cands[j].dur * 2 - Math.abs(cands[j].t - expected[k]) / avg

  const best: number[][] = Array.from({ length: n - 1 }, () => new Array<number>(m).fill(-Infinity))
  const from: number[][] = Array.from({ length: n - 1 }, () => new Array<number>(m).fill(-1))
  for (let j = 0; j < m; j++) if (cands[j].t >= minGap) best[0][j] = score(0, j)
  for (let k = 1; k < n - 1; k++) {
    for (let j = 0; j < m; j++) {
      for (let i = 0; i < j; i++) {
        if (best[k - 1][i] === -Infinity || cands[j].t - cands[i].t < minGap) continue
        const v = best[k - 1][i] + score(k, j)
        if (v > best[k][j]) {
          best[k][j] = v
          from[k][j] = i
        }
      }
    }
  }
  let j = -1
  for (let x = 0; x < m; x++) if (total - cands[x].t >= minGap && (j < 0 || best[n - 2][x] > best[n - 2][j])) j = x
  if (j < 0 || best[n - 2][j] === -Infinity) return expected
  const cuts: number[] = []
  for (let k = n - 2; k >= 0; k--) {
    cuts.unshift(cands[j].t)
    j = from[k][j]
  }
  return cuts
}

/**
 * Cuts between scenes when Whisper timed the words: each cut sits in the pause that overlaps the gap
 * between one scene's last word and the next scene's first word (a little slack, since a word's end can
 * run into the pause), or in the middle of that gap when no pause is found. Never inside a word.
 */
export function cutsFromWords(gaps: { end: number; start: number }[], silences: { start: number; end: number }[]): number[] {
  const slack = 0.3
  let prev = 0
  return gaps.map(({ end, start }) => {
    const lo = Math.min(end, start)
    const hi = Math.max(end, start)
    let best: { from: number; to: number } | null = null
    for (const s of silences) {
      const from = Math.max(s.start, lo - slack)
      const to = Math.min(s.end, hi + slack)
      if (to > from && (!best || to - from > best.to - best.from)) best = { from, to }
    }
    const cut = Math.max(prev, best ? (best.from + best.to) / 2 : (lo + hi) / 2)
    prev = cut
    return cut
  })
}
