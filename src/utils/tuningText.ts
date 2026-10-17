/**
 * チューニング表記テキストのパース（純粋関数）
 * ヘッダーの「Drop D」「Tune down 1/2 step」「(1) = G b」を alphaTex 音名に直す。
 * alphaTex の音名は低い弦から。弦番号 s = 1(最高音) .. N(最低音)。
 */

export interface TuningResult {
  tuning: string
  label: string
}

const LETTERS = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

// 標準チューニング。midi。s=1 が最高音
const STANDARD: Record<number, number[]> = {
  4: [43, 38, 33, 28],
  5: [43, 38, 33, 28, 23],
  6: [48, 43, 38, 33, 28, 23],
}

const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

const DROP_RE = /\b[dD][rR][oO][pP](?:[eE][dD])?\s+([A-G])(?:\s*([b#]))?(?![a-z])/
const ENTRY_RE = /(?:\((\d)\)\s*)?=\s*([A-G])(?:\s*([b#]))?(?![\w])/g
const STANDARD_TARGET_RE = /\b([A-G])(?:\s*([b#]))?\s+standard\b/

function midiName(m: number): string {
  return `${LETTERS[m % 12]}${Math.floor(m / 12) - 1}`
}

function pcOf(letter: string, acc: string | undefined): number {
  return LETTER_PC[letter] + (acc === '#' ? 1 : acc === 'b' ? -1 : 0)
}

function pcDist(a: number, b: number): number {
  const d = Math.abs(((a - b) % 12 + 12) % 12)
  return Math.min(d, 12 - d)
}

/** pc を ref に一番近いオクターブに。同点は低い方 */
function pitchOf(letter: string, acc: string | undefined, ref: number): number {
  const pc = pcOf(letter, acc)
  const base = pc + 12 * Math.floor((ref - pc) / 12)
  const up = base + 12
  return up - ref < ref - base ? up : base
}

function stdFor(N: number): number[] {
  const out = [...(STANDARD[N] ?? STANDARD[4])]
  while (out.length < N) {
    const s = out.length + 1
    // 追加弦は低い方に並べる。5弦 = B0, 6弦 = F#0
    out.push(s === 5 ? 23 : s === 6 ? 18 : 18 - 5 * (s - 6))
  }
  return out
}

/** 'Eb standard' は E からの差を -6..+5 に正規化 */
function standardShift(text: string): number | null {
  const m = text.match(STANDARD_TARGET_RE)
  if (!m) return null
  const diff = pcOf(m[1], m[2] || undefined) - 4
  return (((diff + 6) % 12) + 12) % 12 - 6
}

/** 「tune down 1/2 step」等 → 半音数の符号付き変位 */
function stepShift(text: string): number | null {
  const low = text.toLowerCase()
  if (standardShift(text) == null && !/(tune|half|whole|full|one|step|down|up)/.test(low)) return null
  let mag = 0
  if (/1\s*1\/2\s*steps?/.test(low)) mag = 1.5
  else if (/2\s*steps?/.test(low)) mag = 2
  else if (/half\s+step/.test(low)) mag = 0.5
  else if (/whole\s+step|full\s+step|one\s+step/.test(low)) mag = 1
  else if (/down\s+1\/2/.test(low)) mag = 0.5
  else if (/1\/2\s*step/.test(low)) mag = 0.5
  else if (/1\s*steps?/.test(low)) mag = 1
  if (mag === 0) return null
  const down = !/tune\s+up/i.test(text)
  const sign = down ? -1 : 1
  // 1/2 step = 1半音, 1 step = 2半音
  return sign * Math.round(mag * 2)
}

function shiftLabel(n: number): string {
  if (n === -1) return '半音下げ'
  if (n === -2) return '全音下げ'
  return `${Math.abs(n)}半音${n < 0 ? '下げ' : '上げ'}`
}

interface Entry {
  s: number
  letter: string
  acc?: string
}

export function parseTuningText(text: string, stringCount: number): TuningResult {
  const t = (text ?? '').replace(/♭/g, 'b').replace(/♯/g, '#')
  const matches = [...t.matchAll(ENTRY_RE)]
  let N = STANDARD[stringCount] ? stringCount : 4
  for (const e of matches) {
    if (e[1]) N = Math.max(N, parseInt(e[1], 10))
  }
  const std = stdFor(N)
  const lowestStd = std[std.length - 1]
  const tuner = std.slice()

  let dropLetter: string | null = null
  const dm = t.match(DROP_RE)
  if (dm) {
    dropLetter = dm[1]
    const target = pitchOf(dm[1], dm[2] || undefined, lowestStd - 2)
    const delta = target - (lowestStd - 2)
    for (let i = 0; i < tuner.length - 1; i++) tuner[i] += delta
    tuner[tuner.length - 1] = target
  }

  const shift = stepShift(t)
  if (shift) {
    for (let i = 0; i < tuner.length; i++) tuner[i] += shift
  }

  // 弦ごとの指定。明示番号があれば N を伸ばした後で割り当てる
  const explicit = matches.filter(e => e[1])
  const implicit = matches.filter(e => !e[1])
  const assignments: Entry[] = []
  for (const e of explicit) {
    const n = parseInt(e[1], 10)
    if (n >= 1 && n <= N) assignments.push({ s: n, letter: e[2], acc: e[3] || undefined })
  }
  if (implicit.length > 0) {
    if (explicit.length === 0) {
      const cnt = implicit.length
      if (cnt >= N) {
        implicit.slice(0, N).forEach((e, i) => assignments.push({ s: i + 1, letter: e[2], acc: e[3] || undefined }))
      } else {
        implicit.forEach((e, i) => assignments.push({ s: N - cnt + 1 + i, letter: e[2], acc: e[3] || undefined }))
      }
    } else {
      // 混在時は未指定の弦の低い方から
      const used = new Set(explicit.map(e => parseInt(e[1], 10)).filter(n => n >= 1 && n <= N))
      const free: number[] = []
      for (let s = N; s >= 1; s--) if (!used.has(s)) free.push(s)
      implicit.slice(0, free.length).forEach((e, i) => assignments.push({ s: free[i], letter: e[2], acc: e[3] || undefined }))
    }
  }

  let changed = false
  const hasAnyAcc = matches.some(e => !!e[3])
  for (const a of assignments) {
    const ref = tuner[a.s - 1]
    let pitch: number
    if (!a.acc && !hasAnyAcc && pcDist(pcOf(a.letter, undefined), ref % 12) <= 1) {
      // 臨時記号のグリフが落ちた可能性が高いので元の音を残す
      pitch = ref
    } else {
      pitch = pitchOf(a.letter, a.acc, ref)
    }
    if (pitch !== tuner[a.s - 1]) changed = true
    tuner[a.s - 1] = pitch
  }

  const tuning = tuner.slice().reverse().map(midiName).join(' ')

  let label: string
  if (changed) {
    label = tuning
  } else if (dropLetter) {
    label = shift ? `ドロップ${dropLetter} ${shiftLabel(shift)}` : `ドロップ${dropLetter}`
  } else if (shift) {
    label = shiftLabel(shift)
  } else {
    label = 'スタンダード'
  }
  return { tuning, label }
}
