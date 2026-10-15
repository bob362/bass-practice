/**
 * Guitar Pro PDF の読み取り結果を小節ごとに出す。
 *
 *   node --experimental-strip-types scripts/eval-gp-pdf.mts path/to/tab.pdf
 *
 * 拍の合計は 4分音符 = 1。4/4 なら 4 が正解。
 */
import fs from 'fs'
import { parseGuitarProPdf } from '../src/utils/gpPdfParser.ts'

const path = process.argv[2]
if (!path) {
  console.error('usage: node --experimental-strip-types scripts/eval-gp-pdf.mts <file.pdf>')
  process.exit(1)
}

const buf = fs.readFileSync(path)
const score = await parseGuitarProPdf(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), path)
if (!score) {
  console.error('no score')
  process.exit(1)
}

const expected = 4
let onBeat = 0
let numbered = 0
let aligned = 0
let hammers = 0
let slides = 0
let dead = 0
let ties = 0
let notes = 0
const bad: string[] = []

score.measures.forEach((m, i) => {
  const sum = m.beats.reduce((s, b) => s + b.duration, 0)
  const rounded = Math.round(sum * 1000) / 1000
  if (Math.abs(sum - expected) < 0.06) onBeat++
  else bad.push(`${m.number ?? i + 1}\t${rounded}`)
  if (m.number != null) {
    numbered++
    if (m.number === i + 1) aligned++
  }
  for (const b of m.beats) {
    notes += b.notes.length
    for (const n of b.notes) {
      if (n.hammer) hammers++
      if (n.slide) slides++
      if (n.dead) dead++
      if (n.tie) ties++
    }
  }
})

console.log(`file\t${path}`)
console.log(`tuning\t${score.tuning}`)
console.log(`tempo\t${score.tempo}`)
console.log(`measures\t${score.measures.length}`)
console.log(`numbered\t${numbered}`)
console.log(`numbers_match_index\t${aligned}`)
console.log(`bars_sum_to_4\t${onBeat}`)
console.log(`notes\t${notes}`)
console.log(`hammers\t${hammers}`)
console.log(`slides\t${slides}`)
console.log(`dead\t${dead}`)
console.log(`ties\t${ties}`)
console.log('off_beat_measures')
for (const line of bad) console.log(line)
